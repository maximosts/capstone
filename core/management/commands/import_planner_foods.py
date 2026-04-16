# core/management/commands/import_planner_foods.py
"""
Targeted import of the food categories the planner actually needs:
  - Fats:     olive oil, nuts, peanut butter, avocado
  - Proteins: chicken, turkey, salmon, tuna, eggs, Greek yogurt, cottage cheese
  - Carbs:    oats, rice, potato, sweet potato, bread, pasta
  - Veg:      broccoli, spinach, carrot, etc.
  - Fruit:    banana, apple, berries, etc.

Uses the USDA FDC /foods/search endpoint (one query per category)
so we get the right foods instead of whatever the paginated list
happens to return first.

Usage:
    python manage.py import_planner_foods
    python manage.py import_planner_foods --sleep 0.3   # slower if rate-limited
    python manage.py import_planner_foods --dry-run     # print names only
"""
from __future__ import annotations

import os
import time
import requests
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter
from dotenv import load_dotenv

load_dotenv()

from django.core.management.base import BaseCommand
from django.db import transaction
from django.apps import apps

APP_LABEL  = "core"
MODEL_NAME = "Food"
FDC_API_BASE = "https://api.nal.usda.gov/fdc/v1"

# ---------------------------------------------------------------------------
# Search queries — each entry is (search_query, max_results_to_keep)
# Prefer "Foundation" and "SR Legacy" data types: they have per-100g values
# and no branded noise.
# ---------------------------------------------------------------------------
SEARCH_TARGETS = [
    # ── Fats ────────────────────────────────────────────────────────────────
    ("olive oil",                        10),
    ("peanut butter",                    10),
    ("almonds raw",                      10),
    ("walnuts raw",                      10),
    ("cashews raw",                      10),
    ("avocado raw",                      10),
    ("dark chocolate",                    8),
    ("sunflower seeds",                   8),
    ("flaxseed",                          8),
    ("chia seeds",                        8),

    # ── Proteins ────────────────────────────────────────────────────────────
    ("chicken breast raw",               15),
    ("chicken breast skinless boneless", 10),
    ("turkey breast raw",                12),
    ("salmon raw",                       12),
    ("tuna raw",                         10),
    ("cod raw",                          10),
    ("tilapia raw",                      10),
    ("shrimp raw",                       10),
    ("eggs whole raw",                   10),
    ("greek yogurt plain",               12),
    ("cottage cheese",                   10),
    ("skyr",                              8),
    ("whey protein powder",              10),

    # ── Carbs ───────────────────────────────────────────────────────────────
    ("oats rolled raw",                  10),
    ("white rice dry raw",               10),
    ("brown rice dry raw",               10),
    ("wild rice dry raw",                 8),
    ("pasta dry",                        10),
    ("spaghetti dry",                     8),
    ("potato raw",                       10),
    ("sweet potato raw",                 10),
    ("bread whole wheat",                10),
    ("bread white",                      10),
    ("bagel plain",                       8),
    ("tortilla corn",                     8),
    ("pita bread",                        8),

    # ── Vegetables ──────────────────────────────────────────────────────────
    ("broccoli raw",                     10),
    ("spinach raw",                      10),
    ("tomato raw",                       10),
    ("cucumber raw",                      8),
    ("bell pepper raw",                  10),
    ("carrot raw",                       10),
    ("zucchini raw",                      8),
    ("cauliflower raw",                   8),
    ("kale raw",                          8),
    ("green beans raw",                   8),
    ("mushroom raw",                      8),
    ("onion raw",                         8),
    ("asparagus raw",                     8),
    ("celery raw",                        8),
    ("eggplant raw",                      8),

    # ── Fruits ──────────────────────────────────────────────────────────────
    ("banana raw",                       10),
    ("apple raw",                        10),
    ("orange raw",                       10),
    ("strawberry raw",                    8),
    ("blueberry raw",                     8),
    ("raspberry raw",                     8),
    ("grape raw",                         8),
    ("mango raw",                         8),
    ("pineapple raw",                     8),
    ("kiwi raw",                          8),
    ("pear raw",                          8),
    ("watermelon raw",                    8),
    ("peach raw",                         8),
]

# Prefer these data types — they use per-100g nutrient values reliably
PREFERRED_DATA_TYPES = {"Foundation", "SR Legacy"}

# ---------------------------------------------------------------------------
# Nutrient number map (same as import_usda.py)
# ---------------------------------------------------------------------------
MAP_CORE = {
    "1008": "kcal_per_100g",
    "208":  "kcal_per_100g",
    "1003": "protein_per_100g",
    "203":  "protein_per_100g",
    "1004": "fat_per_100g",
    "204":  "fat_per_100g",
    "1005": "carbs_per_100g",
    "205":  "carbs_per_100g",
}
MAP_OPTIONAL = {
    "1079": "fiber_per_100g",
    "291":  "fiber_per_100g",
    "2000": "sugars_per_100g",
    "269":  "sugars_per_100g",
    "1093": "sodium_mg_per_100g",
    "307":  "sodium_mg_per_100g",
}
ENERGY_KJ = {"1002", "268"}


def _norm(n):
    s = str(n)
    return s.split(".")[0] if "." in s else s


def _make_session():
    s = requests.Session()
    retries = Retry(
        total=5, backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",), raise_on_status=False,
    )
    a = HTTPAdapter(max_retries=retries)
    s.mount("http://", a)
    s.mount("https://", a)
    s.headers["User-Agent"] = "nutri-planner-import/1.0"
    return s


def _extract_nutrients(food: dict):
    core = {"kcal_per_100g": None, "protein_per_100g": None,
            "fat_per_100g": None, "carbs_per_100g": None}
    optional = {}
    kj = None

    def keep_max(d, key, val):
        try:
            v = float(val)
        except Exception:
            return
        if v <= 0:
            return
        if d.get(key) is None or v > d[key]:
            d[key] = v

    for n in (food.get("foodNutrients") or []):
        num = None
        for path in [
            lambda x: x.get("nutrient", {}).get("number"),
            lambda x: x.get("nutrientNumber"),
            lambda x: x.get("nutrientId"),
        ]:
            try:
                num = path(n)
            except Exception:
                pass
            if num is not None:
                break
        if num is None:
            continue
        num = _norm(num)
        # FIX 2: search endpoint uses "value", detail endpoint uses "amount"
        amount = n.get("amount") if n.get("amount") is not None else n.get("value")
        if amount is None:
            continue
        if num in MAP_CORE:
            keep_max(core, MAP_CORE[num], amount)
        elif num in ENERGY_KJ:
            try:
                kj = float(amount)
            except Exception:
                pass
        elif num in MAP_OPTIONAL:
            keep_max(optional, MAP_OPTIONAL[num], amount)

    # kcal from kJ fallback
    if not core["kcal_per_100g"] and kj:
        core["kcal_per_100g"] = round(kj / 4.184, 2)

    # kcal from Atwater fallback
    if not core["kcal_per_100g"]:
        p = core.get("protein_per_100g") or 0
        c = core.get("carbs_per_100g") or 0
        f = core.get("fat_per_100g") or 0
        est = 4 * p + 4 * c + 9 * f
        if est > 0:
            core["kcal_per_100g"] = round(est, 2)

    return core, optional


def _model_has(model, field):
    return any(f.name == field for f in model._meta.get_fields())


def _is_clean_name(name: str) -> bool:
    """
    Return True only for simple, readable food names.
    Rejects USDA verbose entries like "CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, COOKED, ROASTED"
    """
    # Too long
    if len(name) > 65:
        return False
    # 3+ commas → overly specific USDA description
    if name.count(",") >= 3:
        return False
    # All-caps (classic SR Legacy verbose style)
    letters = [c for c in name if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.7:
        return False
    return True


class Command(BaseCommand):
    help = "Import targeted food categories needed by the meal planner (fats, veg, fruit, etc.)"

    def add_arguments(self, parser):
        parser.add_argument("--sleep",   type=float, default=0.2,
                            help="Seconds between API requests (default 0.2)")
        parser.add_argument("--dry-run", action="store_true",
                            help="Print what would be imported without saving")

    def handle(self, *args, **opts):
        try:
            Food = apps.get_model(APP_LABEL, MODEL_NAME)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Cannot load {APP_LABEL}.{MODEL_NAME}: {e}"))
            return

        api_key = os.getenv("FDC_API_KEY") or os.getenv("USDA_FDC_API_KEY")
        if not api_key:
            self.stderr.write(self.style.ERROR(
                "Missing FDC_API_KEY / USDA_FDC_API_KEY in your .env file.\n"
                "Get a free key at https://fdc.nal.usda.gov/api-guide.html"
            ))
            return

        sleep_s  = max(0.0, opts["sleep"])
        dry_run  = opts["dry_run"]
        session  = _make_session()

        grand_total  = 0
        grand_skipped = 0

        for query, max_results in SEARCH_TARGETS:
            self.stdout.write(f'\n🔍  Searching: "{query}" (want {max_results})')

            # FIX 1: dataType must be sent as repeated params, not comma-separated
            try:
                r = session.get(
                    f"{FDC_API_BASE}/foods/search",
                    params=[
                        ("api_key", api_key),
                        ("query",   query),
                        ("pageSize", max_results * 3),
                        ("dataType", "Foundation"),
                        ("dataType", "SR Legacy"),
                        ("dataType", "Survey (FNDDS)"),
                    ],
                    timeout=(8, 30),
                )
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                self.stdout.write(self.style.WARNING(f"  ✗ request failed: {e}"))
                time.sleep(sleep_s * 3)
                continue

            foods = data.get("foods") or []

            # Sort: prefer Foundation > SR Legacy > others
            def dtype_rank(f):
                dt = (f.get("dataType") or "").strip()
                if dt == "Foundation":    return 0
                if dt == "SR Legacy":     return 1
                return 2

            foods.sort(key=dtype_rank)
            foods = foods[:max_results]

            imported = 0
            for f in foods:
                fdc_id = f.get("fdcId")
                name   = (f.get("description") or "").strip()
                if not fdc_id or not name:
                    grand_skipped += 1
                    continue

                if not _is_clean_name(name):
                    grand_skipped += 1
                    continue

                core, optional = _extract_nutrients(f)

                # Skip if no useful nutritional data
                if not core.get("kcal_per_100g"):
                    grand_skipped += 1
                    continue

                if dry_run:
                    self.stdout.write(
                        f"  [dry] {name[:60]:<60} | "
                        f"kcal={core['kcal_per_100g']:.0f} "
                        f"P={core['protein_per_100g'] or 0:.1f} "
                        f"F={core['fat_per_100g'] or 0:.1f} "
                        f"C={core['carbs_per_100g'] or 0:.1f}"
                    )
                    imported += 1
                    continue

                category = ""
                if isinstance(f.get("foodCategory"), dict):
                    category = (f["foodCategory"].get("description") or "").strip()
                elif isinstance(f.get("foodCategory"), str):
                    category = (f.get("foodCategory") or "").strip()

                defaults = {
                    "name":             name[:255],
                    "kcal_per_100g":    core.get("kcal_per_100g")    or 0.0,
                    "protein_per_100g": core.get("protein_per_100g") or 0.0,
                    "fat_per_100g":     core.get("fat_per_100g")     or 0.0,
                    "carbs_per_100g":   core.get("carbs_per_100g")   or 0.0,
                }
                if _model_has(Food, "category"):
                    defaults["category"] = (category or f.get("dataType", ""))[:128]
                if _model_has(Food, "source"):
                    defaults["source"] = "USDA FDC"
                if _model_has(Food, "brand"):
                    defaults["brand"] = (f.get("brandOwner") or "")[:128]
                if _model_has(Food, "data_type"):
                    defaults["data_type"] = (f.get("dataType") or "")[:64]
                for k, v in optional.items():
                    if _model_has(Food, k):
                        defaults[k] = v

                if _model_has(Food, "fdc_id"):
                    lookup = {"fdc_id": fdc_id}
                else:
                    lookup = {"name": defaults["name"]}

                try:
                    with transaction.atomic():
                        Food.objects.update_or_create(**lookup, defaults=defaults)
                    imported += 1
                    grand_total += 1
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f"  ✗ save failed for '{name[:40]}': {e}"))
                    grand_skipped += 1

            self.stdout.write(self.style.SUCCESS(f"  ✓ {imported} foods saved"))
            time.sleep(sleep_s)

        action = "Would import" if dry_run else "Imported"
        self.stdout.write(self.style.SUCCESS(
            f"\n✅  Done. {action} {grand_total} foods total. "
            f"Skipped {grand_skipped} (no macros / bad data)."
        ))