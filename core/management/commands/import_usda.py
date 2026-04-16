import os
import time
import itertools
import requests
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter

from django.core.management.base import BaseCommand
from django.db import transaction
from django.apps import apps

APP_LABEL = "core"
MODEL_NAME = "Food"

FDC_API_BASE = "https://api.nal.usda.gov/fdc/v1"
DEFAULT_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"]

# Support BOTH modern and legacy nutrient numbers
MAP_CORE = {
    "1008": "kcal_per_100g",  # Energy (kcal) modern
    "208":  "kcal_per_100g",  # Energy (kcal) legacy
    "1003": "protein_per_100g",
    "203":  "protein_per_100g",
    "1004": "fat_per_100g",
    "204":  "fat_per_100g",
    "1005": "carbs_per_100g",
    "205":  "carbs_per_100g",
}
MAP_OPTIONAL = {
    "1079": "fiber_per_100g",       # Fiber (modern)
    "291":  "fiber_per_100g",       # Fiber (legacy)
    "2000": "sugars_per_100g",      # Sugars (modern, incl. NLEA)
    "269":  "sugars_per_100g",      # Sugars (legacy)
    "1093": "sodium_mg_per_100g",   # Sodium mg (modern)
    "307":  "sodium_mg_per_100g",   # Sodium mg (legacy)
}
# Energy in kJ — convert to kcal if kcal missing
ENERGY_KJ_NUMBERS = {"1002", "268"}  # modern + legacy

def make_session():
    s = requests.Session()
    retries = Retry(
        total=5, connect=5, read=5, backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",), raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=20)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    s.headers.update({
        "User-Agent": "nutri-gpt/1.0 (contact: you@example.com)",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate, br",
    })
    return s

def chunked(iterable, size):
    it = iter(iterable)
    while True:
        block = list(itertools.islice(it, size))
        if not block:
            return
        yield block

def model_has_field(model_cls, field):
    return any(f.name == field for f in model_cls._meta.get_fields())

def maybe_set(d: dict, model_cls, field: str, value):
    if model_has_field(model_cls, field):
        d[field] = value

def is_clean_name(name: str) -> bool:
    """Reject USDA verbose names like 'CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY'."""
    if len(name) > 65:
        return False
    if name.count(",") >= 3:
        return False
    letters = [c for c in name if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.7:
        return False
    return True

def norm_number(n):
    """Normalize nutrient number to plain string (strip decimals like '269.3' -> '269')."""
    s = str(n)
    if "." in s:
        s = s.split(".", 1)[0]
    return s

def get_nutrient_number(n):
    # Try common shapes
    num = (n.get("nutrient") or {}).get("number")
    if num:
        return norm_number(num)
    num = n.get("nutrientNumber")
    if num:
        return norm_number(num)
    nid = n.get("nutrientId")
    if nid is not None:
        return norm_number(nid)
    return None

def extract_nutrients(food, debug=False):
    """
    Returns:
      core  : dict(kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g)
      optional: dict(fiber_per_100g, sugars_per_100g, sodium_mg_per_100g)
    Strategy:
      - Support modern (1008/1003/1004/1005) and legacy (208/203/204/205).
      - If kcal missing but kJ (1002/268) present, convert.
      - If kcal still missing/zero but macros exist, compute kcal via Atwater.
      - If the same nutrient appears multiple times, keep the **largest** positive value.
    """
    core = {
        "kcal_per_100g": None,
        "protein_per_100g": None,
        "fat_per_100g": None,
        "carbs_per_100g": None,
    }
    optional = {}
    kj = None
    seen = []

    def keep_max(d, key, val):
        if val is None:
            return
        try:
            v = float(val)
        except (TypeError, ValueError):
            return
        if v <= 0:
            return
        cur = d.get(key)
        if cur is None or v > float(cur):
            d[key] = v

    for n in (food.get("foodNutrients") or []):
        number = get_nutrient_number(n)
        amount = n.get("amount")
        if not number or amount is None:
            continue
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            continue

        seen.append((number, amount))

        if number in MAP_CORE:
            keep_max(core, MAP_CORE[number], amount)
        elif number in ENERGY_KJ_NUMBERS:
            kj = amount
        elif number in MAP_OPTIONAL:
            keep_max(optional, MAP_OPTIONAL[number], amount)

    # 1) kcal from kJ if missing
    if (core["kcal_per_100g"] in (None, 0.0)) and kj not in (None, 0.0):
        core["kcal_per_100g"] = round(kj / 4.184, 2)

    # 2) kcal from Atwater if still missing/zero but any macro exists
    has_any_macro = (
        ((core.get("protein_per_100g") or 0.0) > 0.0) or
        ((core.get("carbs_per_100g")   or 0.0) > 0.0) or
        ((core.get("fat_per_100g")     or 0.0) > 0.0)
    )
    if (core["kcal_per_100g"] in (None, 0.0)) and has_any_macro:
        p = core.get("protein_per_100g") or 0.0
        c = core.get("carbs_per_100g")   or 0.0
        f = core.get("fat_per_100g")     or 0.0
        est_kcal = 4.0 * p + 4.0 * c + 9.0 * f
        if est_kcal > 0:
            core["kcal_per_100g"] = round(est_kcal, 2)

    if debug:
        return core, optional, seen
    return core, optional


class Command(BaseCommand):
    help = "Import USDA FDC foods with per-100g macros (supports legacy & modern nutrient numbers)."

    def add_arguments(self, parser):
        parser.add_argument("--page-size", type=int, default=100, help="foods/list page size (1..200)")
        parser.add_argument("--max-pages", type=int, default=1, help="max pages to pull per dataType")
        parser.add_argument("--data-types", type=str, default=";".join(DEFAULT_TYPES),
                            help='Semicolon-separated: "Foundation;SR Legacy;Survey (FNDDS)"')
        parser.add_argument("--batch-size", type=int, default=8, help="detail batch size (try 6–20)")
        parser.add_argument("--sleep", type=float, default=0.15, help="sleep between requests (seconds)")
        parser.add_argument("--continue-from", type=int, default=1, help="start page number")
        parser.add_argument("--debug", action="store_true", help="print sample nutrient numbers")

    def handle(self, *args, **opts):
        # Resolve model dynamically
        try:
            Food = apps.get_model(APP_LABEL, MODEL_NAME)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Cannot load {APP_LABEL}.{MODEL_NAME}: {e}"))
            return

        api_key = os.getenv("FDC_API_KEY") or os.getenv("USDA_FDC_API_KEY")
        if not api_key:
            self.stderr.write(self.style.ERROR("Missing FDC_API_KEY / USDA_FDC_API_KEY in .env"))
            return

        page_size  = max(1, min(200, opts["page_size"]))
        max_pages  = max(1, opts["max_pages"])
        batch_size = max(5, min(20, opts["batch_size"]))  # keep modest for format=full
        data_types = [x.strip() for x in opts["data_types"].split(";") if x.strip()]
        sleep_s    = max(0.0, opts["sleep"])
        start_page = max(1, opts["continue_from"])
        debug      = bool(opts["debug"])

        session = make_session()
        grand_total = 0

        # Determine a stable lookup key
        use_fdc_id = model_has_field(Food, "fdc_id")
        use_external_id = (not use_fdc_id) and model_has_field(Food, "external_id")

        for dtype in data_types:
            self.stdout.write(self.style.HTTP_INFO(f"Fetching dataType: {dtype}"))

            # 1) Collect IDs via foods/list
            fdc_ids = []
            for page in range(start_page, start_page + max_pages):
                try:
                    r = session.get(
                        f"{FDC_API_BASE}/foods/list",
                        params={
                            "api_key": api_key,
                            "dataType": dtype,
                            "pageNumber": page,
                            "pageSize": page_size,
                        },
                        timeout=(5, 30),
                    )
                    r.raise_for_status()
                    rows = r.json()
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f"  ! {dtype} page {page} failed: {e}"))
                    break

                if not rows:
                    self.stdout.write(f"  ✓ no more rows at page {page}")
                    break

                ids = [row["fdcId"] for row in rows if "fdcId" in row]
                fdc_ids.extend(ids)
                self.stdout.write(f"  ✓ page {page}: +{len(ids)} ids (total {len(fdc_ids)})")
                time.sleep(sleep_s)

            if not fdc_ids:
                self.stdout.write(self.style.WARNING(f"  ! No IDs collected for {dtype}"))
                continue

            # 2) Fetch details in batches (format=full for robust nutrients)
            dtype_upserts = 0
            dtype_with_macros = 0

            for bi, batch in enumerate(chunked(fdc_ids, batch_size), start=1):
                self.stdout.write(f"  → details batch {bi} ({len(batch)} ids)")
                try:
                    r = session.get(
                        f"{FDC_API_BASE}/foods",
                        params={
                            "api_key": api_key,
                            "fdcIds": ",".join(map(str, batch)),
                            "format": "full",
                        },
                        timeout=(8, 45),
                    )
                    r.raise_for_status()
                    foods = r.json()
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f"    ! batch {bi} failed: {e}"))
                    continue

                if not isinstance(foods, list):
                    self.stdout.write(self.style.WARNING("    ! unexpected payload (not a list)"))
                    continue

                upserts_this_batch = 0
                with transaction.atomic():
                    for idx, f in enumerate(foods):
                        fdc_id = f.get("fdcId")
                        name   = (f.get("description") or "").strip()
                        if not fdc_id or not name:
                            continue

                        if not is_clean_name(name):
                            continue

                        if debug and idx < 3:
                            _, _, seen = extract_nutrients(f, debug=True)
                            self.stdout.write(
                                f"      sample {idx+1} '{name[:50]}': "
                                f"got nutrient numbers: {[n for n,_ in seen][:20]}"
                            )

                        # Extract macros
                        core_optional = extract_nutrients(f, debug=False)
                        if len(core_optional) == 3:
                            core, optional, _ = core_optional
                        else:
                            core, optional = core_optional

                        # Require at least one macro or kcal
                        if not any(v not in (None, 0.0) for v in core.values()):
                            if debug and idx < 3:
                                self.stdout.write("        -> SKIP (no macros parsed)")
                            continue
                        dtype_with_macros += 1

                        # category best-effort
                        category = ""
                        if isinstance(f.get("foodCategory"), dict):
                            category = (f["foodCategory"].get("description") or "").strip()
                        elif isinstance(f.get("foodCategory"), str):
                            category = (f.get("foodCategory") or "").strip()

                        defaults = {
                            "name": name[:255],
                            "kcal_per_100g": core.get("kcal_per_100g") or 0.0,
                            "protein_per_100g": core.get("protein_per_100g") or 0.0,
                            "fat_per_100g": core.get("fat_per_100g") or 0.0,
                            "carbs_per_100g": core.get("carbs_per_100g") or 0.0,
                        }
                        # Optional metadata if your model has them
                        maybe_set(defaults, Food, "category", (category or dtype)[:128])
                        maybe_set(defaults, Food, "source", "USDA FDC")
                        maybe_set(defaults, Food, "brand", (f.get("brandOwner") or "")[:128])
                        maybe_set(defaults, Food, "data_type", (f.get("dataType") or dtype)[:64])
                        for k, v in optional.items():
                            maybe_set(defaults, Food, k, v)

                        # Choose a unique lookup
                        if model_has_field(Food, "fdc_id"):
                            lookup = {"fdc_id": fdc_id}
                        elif model_has_field(Food, "external_id"):
                            lookup = {"external_id": str(fdc_id)}
                        else:
                            lookup = {"name": defaults["name"]}

                        # IMPORTANT: use **lookup here (fixed)
                        Food.objects.update_or_create(**lookup, defaults=defaults)

                        dtype_upserts += 1
                        grand_total += 1
                        upserts_this_batch += 1

                self.stdout.write(
                    f"    ✓ batch {bi}: upserted {upserts_this_batch} (with macros so far: {dtype_with_macros})"
                )
                time.sleep(sleep_s)

            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✓ {dtype}: rows with macros {dtype_with_macros}, total upserts {dtype_upserts}"
                )
            )

        self.stdout.write(self.style.SUCCESS(f"✅ Imported/updated total rows: {grand_total}"))
