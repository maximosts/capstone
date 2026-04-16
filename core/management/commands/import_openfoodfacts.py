import time
import requests
from tqdm import tqdm
from django.core.management.base import BaseCommand
from core.models import Food

SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
FDC_API_BASE = "https://api.nal.usda.gov/fdc/v1"
# Categories with lots of items that usually have nutrition data
CATEGORIES = [
    "breakfast-cereals",
    "meats",
    "milk-and-milk-products",
    "cheeses",
    "plant-based-foods-and-beverages",
    "legumes",
    "nuts-and-seeds",
    "vegetables",
    "fruits",
    "breads",
    "pastas",
    "rice-and-cereals",
    "oils-and-fats",
]

def fetch_page(category: str, page: int, page_size: int = 250):
    params = {
        "action": "process",
        "tagtype_0": "categories",
        "tag_contains_0": "contains",
        "tag_0": category,
        "page_size": page_size,
        "page": page,
        "json": 1,
        # request only what we need to reduce bandwidth
        "fields": "code,product_name,generic_name,nutrition_data_per,"
                  "nutriments,labels_tags,allergens_tags,lang",
    }
    r = requests.get(SEARCH_URL, params=params, timeout=25)
    r.raise_for_status()
    return r.json()

def get_float(d, key, default=0.0):
    try:
        v = d.get(key)
        if v in (None, "", "nan"):
            return default
        return float(v)
    except Exception:
        return default

def extract_macros(product):
    """
    Returns kcal, protein, fat, carbs per 100g.
    Handles kcal vs kJ; ignores per-serving; skips if no nutrition data.
    """
    nutr = product.get("nutriments") or {}
    # Only accept entries that declare per 100g or have explicit *_100g keys
    per = (product.get("nutrition_data_per") or "").lower()  # "100g" or "serving"
    # kcal
    kcal = get_float(nutr, "energy-kcal_100g", 0.0)
    if kcal == 0.0:
        # Sometimes only kJ is present
        kj = get_float(nutr, "energy_100g", 0.0) or get_float(nutr, "energy-kj_100g", 0.0)
        if kj:
            kcal = kj / 4.184

    protein = get_float(nutr, "proteins_100g", 0.0)
    fat     = get_float(nutr, "fat_100g", 0.0)
    carbs   = get_float(nutr, "carbohydrates_100g", 0.0)

    # Hard rule: must be per 100g (or appear to be via *_100g keys)
    has_100g_keys = any(k.endswith("_100g") for k in nutr.keys())
    if per not in ("", "100g") and not has_100g_keys:
        return None  # skip per-serving-only entries (inconsistent units)

    # Reject if everything is zero (no nutrition)
    if (kcal == 0.0) and (protein == 0.0) and (fat == 0.0) and (carbs == 0.0):
        return None

    return round(kcal, 2), round(protein, 2), round(fat, 2), round(carbs, 2)

class Command(BaseCommand):
    help = "Import foods with macros from OpenFoodFacts (paginated + vetted)"

    def handle(self, *args, **kwargs):
        imported = 0
        for cat in CATEGORIES:
            self.stdout.write(self.style.WARNING(f"Fetching: {cat}"))
            page = 1
            cat_count = 0
            while True:
                try:
                    data = fetch_page(cat, page)
                except Exception as e:
                    self.stderr.write(f"  ! fetch error page {page}: {e}")
                    break

                products = data.get("products", [])
                if not products:
                    break

                for p in tqdm(products, desc=f"{cat} p{page}", leave=False):
                    name = (p.get("product_name") or p.get("generic_name") or "").strip()
                    if not name:
                        continue

                    macros = extract_macros(p)
                    if not macros:
                        continue
                    kcal, protein, fat, carbs = macros

                    labels = p.get("labels_tags") or []
                    allergens = p.get("allergens_tags") or []
                    diet_tags = []
                    if any("vegan" in t for t in labels):
                        diet_tags.append("vegan")
                    if any("vegetarian" in t for t in labels):
                        diet_tags.append("vegetarian")
                    if "en:gluten-free" in labels:
                        diet_tags.append("gluten-free")

                    code = (p.get("code") or name.lower().replace(" ", "_"))[:64]

                    Food.objects.update_or_create(
                        # if you added external_id use that here; else use name unique
                        name=name[:100],
                        defaults={
                            "kcal": kcal,
                            "protein": protein,
                            "fat": fat,
                            "carbs": carbs,
                            "diet_tags": diet_tags,
                            "allergens": allergens,
                        },
                    )
                    imported += 1
                    cat_count += 1

                # last page when fewer than page_size
                if len(products) < 250:
                    break
                page += 1
                time.sleep(0.2)

            self.stdout.write(self.style.SUCCESS(f"  ✓ {cat}: +{cat_count}"))
        self.stdout.write(self.style.SUCCESS(f"✅ Imported/updated: {imported} foods with macros"))
