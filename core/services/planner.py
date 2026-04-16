# core/services/planner.py
from __future__ import annotations
PLANNER_VERSION = "v4-fat-veg-fix"
import re as _re
from typing import List, Dict, Tuple, Optional
from core.models import Food

CATALOG_FIELDS = ("id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g")

# ── Hard exclusions ────────────────────────────────────────────────────────────
HARD_EXCLUDE_KW = [
    "applebee","mcdonald","burger king","wendy","kfc","popeyes","taco bell",
    "pizza hut","domino","little caesars","subway","chipotle","panera","chick-fil",
    "restaurant","fast food","cafeteria","school",
    "pepperoni","salami","bacon","sausage","hot dog","bologna","pastrami",
    "prosciutto","cured","smoked","baby food","babyfood","infant","formula",
    "tube","enteral","meal replacement","alaska native","usda commodity",
    "candy","chips","nacho","puffs","cake","cookie","donut","doughnut",
    "pastry","danish","muffin","tart","toaster","pop-tart","poptart",
    "croissant","waffle","pancake","granola bar","cereal bar","snack bar",
    "energy bar","protein bar","salad","sandwich","ready-to-eat",
]

AVOID_CHEESE_HEAVY = [
    "cheese, goat","goat cheese","cheddar","brie","gouda","parmesan",
    "hard type","processed cheese","cheese sauce","nacho cheese",
]

# Things that must never appear as a fat choice
FAT_AVOID = [
    "mayo","mayonnaise","dressing","salad dressing",
    "cream","lard","shortening","margarine","ghee","tallow","suet","dripping",
    "spray","blend","sauce","dip","fried","processed",
]

# ── Keyword groups ─────────────────────────────────────────────────────────────
CARB_KW_OATS   = ["oat","oats","oatmeal"]
CARB_KW_RICE   = ["rice"]
CARB_KW_PASTA  = ["pasta","spaghetti","noodle","macaroni","penne","linguine"]
CARB_KW_POTATO = ["potato","potatoes","sweet potato","sweet potatoes"]
CARB_KW_BREAD  = ["bread","toast","tortilla","bagel","bun","roll","pita","wrap"]
CARB_PREF_DRY  = ["dry","uncooked","not cooked","raw"]

PROTEIN_KW_POULTRY = ["chicken","turkey"]
PROTEIN_KW_EGGS    = ["egg","eggs"]
PROTEIN_KW_DAIRY   = ["greek yogurt","yogurt","yoghurt","skyr","quark","cottage cheese"]
PROTEIN_KW_WHEY    = ["whey","protein powder"]
PROTEIN_KW_SEAFOOD = ["shrimp","prawn","scallop"]
PROTEIN_KW_FISH    = ["salmon","tuna","cod","fish","trout","sardine","mackerel","tilapia","halibut"]

ALL_FISH_SEAFOOD_KW = PROTEIN_KW_SEAFOOD + PROTEIN_KW_FISH + [
    "roughy","crab","lobster","anchovy","bass","catfish","herring",
    "flounder","haddock","pollock","perch","eel","squid","octopus",
]

# Fats for SEARCHING (specific, avoids mayo/dressings)
FAT_KW = ["olive oil","coconut oil","canola oil","sunflower oil","nuts","almond",
          "walnut","cashew","peanut butter","avocado","dark chocolate"]

FRUIT_KW = [
    "banana","apple","orange","berries","strawberry","blueberry","raspberry",
    "blackberry","grape","kiwi","pear","melon","peach","mango","pineapple",
    "papaya","plum","cherry","apricot","fig","watermelon","cantaloupe","honeydew",
]

VEG_KW = [
    "broccoli","spinach","tomato","lettuce","cucumber","pepper","zucchini",
    "carrot","cauliflower","kale","arugula","asparagus","green beans","celery",
    "onion","garlic","mushroom","eggplant","bell pepper","brussels sprout",
]

# ── Meal rules ─────────────────────────────────────────────────────────────────
BREAKFAST_BANNED_KW = (
    ALL_FISH_SEAFOOD_KW
    + ["lamb","beef","pork","veal","steak","roast","chop","chicken","turkey"]
)

LUNCH_DINNER_BANNED_PROTEIN_KW = PROTEIN_KW_WHEY + ["greek yogurt","yogurt","yoghurt"]

SNACK_BANNED_CARB_KW = (
    CARB_KW_POTATO + CARB_KW_RICE + CARB_KW_PASTA + CARB_KW_OATS
    + ["cereal","granola","muesli","oatmeal"]
)

# ── Helpers ────────────────────────────────────────────────────────────────────
def _name(name: str) -> str:
    return (name or "").strip().lower()

def _has_any(name: str, kws: List[str]) -> bool:
    n = _name(name)
    return any(k in n for k in kws)

def _hard_excluded(name: str, allergy_terms: List[str]) -> bool:
    n = _name(name)
    if any(k in n for k in HARD_EXCLUDE_KW): return True
    if any(k in n for k in AVOID_CHEESE_HEAVY): return True
    if allergy_terms and any(t in n for t in allergy_terms): return True
    return False

def _macro_ok(f: Dict) -> bool:
    kcal = f.get("kcal_per_100g")
    if not kcal or kcal <= 0: return False
    protein = f.get("protein_per_100g")
    fat     = f.get("fat_per_100g")
    carbs   = f.get("carbs_per_100g")
    return not all(x is None or x == 0 for x in [protein, fat, carbs])

def _classify(name: str) -> str:
    """Classify a food name into a slot. Uses broad oil/nut matching for fat."""
    n = _name(name)
    if _has_any(n, PROTEIN_KW_POULTRY + PROTEIN_KW_EGGS + PROTEIN_KW_DAIRY + PROTEIN_KW_WHEY + PROTEIN_KW_SEAFOOD + PROTEIN_KW_FISH):
        return "protein"
    if _has_any(n, CARB_KW_OATS + CARB_KW_RICE + CARB_KW_PASTA + CARB_KW_POTATO + CARB_KW_BREAD):
        return "carb"
    if _has_any(n, VEG_KW):
        return "veg"
    # Fat classification: broad — includes bare "oil" and "nut" to catch olive oil, almonds etc.
    FAT_CLASSIFY = [
        "oil","nut","nuts","almond","walnut","cashew","pecan","pistachio",
        "peanut butter","almond butter","avocado","dark chocolate",
    ]
    if _has_any(n, FAT_CLASSIFY):
        if not _has_any(n, ["peanut butter cup","candy","cookie","chip","dressing","mayo","cream"]):
            return "fat"
    if _has_any(n, FRUIT_KW):
        return "fruit"
    return "other"

def _goal(profile: dict) -> str:
    return (profile or {}).get("goal","").lower().strip()

def _is_dry_carb(food_name: str) -> bool:
    n = _name(food_name)
    if any(k in n for k in ["rice","pasta","noodle","spaghetti","oat"]):
        return any(k in n for k in ["dry","uncooked","not cooked","raw"])
    return False

def _as_item(food: Optional[Dict], grams: float) -> Optional[Dict]:
    if not food: return None
    g = float(grams)
    if g <= 0: return None
    return {"id": int(food["id"]), "name": clean_food_name(food["name"]), "grams": g}

def _find_meal(plan: dict, meal_name: str) -> Optional[Dict]:
    for m in plan.get("meals", []):
        if (m.get("name") or "").lower() == meal_name.lower():
            return m
    return None

def _get_slot_item(meal: Optional[Dict], slot: str) -> Optional[Dict]:
    if not meal: return None
    for it in meal.get("items", []):
        if _classify(it.get("name","")) == slot:
            return it
    return None

def _remove_all_of_slot(meal: Dict, slot: str) -> None:
    meal["items"] = [it for it in meal.get("items",[]) if _classify(it.get("name","")) != slot]

def _keep_one_per_slot(meal: Dict, allowed_slots: List[str]) -> None:
    kept: List[Dict] = []
    seen = set()
    for it in meal.get("items", []):
        s = _classify(it.get("name",""))
        if s not in allowed_slots: continue
        if s in seen: continue
        seen.add(s)
        kept.append(it)
    meal["items"] = kept

def _bump_meal_slot(meal: Dict, slot: str, delta: float, cap: float):
    MIN_BY_SLOT = {"carb":40,"protein":80,"veg":100,"fruit":80,"fat":5}
    for it in meal.get("items",[]):
        if _classify(it.get("name","")) == slot:
            new_g = float(it.get("grams") or 0.0) + float(delta)
            new_g = min(cap, max(MIN_BY_SLOT.get(slot,10), new_g))
            it["grams"] = new_g
            return

def deduplicate_meal_items(plan: dict):
    for meal in plan.get("meals",[]):
        seen = set(); uniq = []
        for it in meal.get("items",[]):
            fid = it.get("id")
            if fid in seen: continue
            seen.add(fid); uniq.append(it)
        meal["items"] = uniq

# ── Name cleaner ───────────────────────────────────────────────────────────────
_DROP_PARENS  = _re.compile(r"\s*\(includes[^)]*\)", _re.IGNORECASE)
_DROP_PARENS2 = _re.compile(r"\s*\([^)]{30,}\)",    _re.IGNORECASE)
_BRAND_NOISE  = [r"\babbott\b",r"\beas\b",r"\busda\b",r"\bfdc\b",r"\bnestl[eé]\b",
                 r"\bkellogg\b",r"\bquaker\b",r"\bgeneral mills\b"]
_USDA_PREFIXES = [
    "beverages","vegetables and vegetable products","fruits and fruit juices",
    "dairy and egg products","beef products","poultry products","pork products",
    "finfish and shellfish products","legumes and legume products",
    "cereal grains and pasta","baked products","fats and oils",
    "nut and seed products","sausages and luncheon meats",
    "soups sauces and gravies","spices and herbs","snacks","sweets",
    "meals entrees and side dishes",
]
_FRIENDLY = [
    (["whey protein","protein powder","protein supplement"],       "Whey protein"),
    (["greek yogurt","yogurt, greek","yogurt, plain, greek"],      "Greek yogurt"),
    (["cottage cheese"],                                           "Cottage cheese"),
    (["chicken breast","chicken, breast"],                         "Chicken breast"),
    (["chicken thigh"],                                            "Chicken thigh"),
    (["chicken"],                                                  "Chicken"),
    (["turkey breast","turkey, breast"],                           "Turkey breast"),
    (["ground turkey"],                                            "Ground turkey"),
    (["ground beef"],                                              "Ground beef"),
    (["salmon"],                                                   "Salmon"),
    (["tuna"],                                                     "Tuna"),
    (["tilapia"],                                                  "Tilapia"),
    (["cod"],                                                      "Cod"),
    (["shrimp"],                                                   "Shrimp"),
    (["egg, whole","whole egg","eggs, whole"],                     "Eggs"),
    (["egg white"],                                                "Egg whites"),
    (["rolled oats","oats, rolled"],                               "Rolled oats"),
    (["oatmeal"],                                                  "Oatmeal"),
    (["white rice","rice, white"],                                 "White rice"),
    (["brown rice","rice, brown"],                                 "Brown rice"),
    (["wild rice"],                                                "Wild rice"),
    (["pasta","spaghetti"],                                        "Pasta"),
    (["sweet potato"],                                             "Sweet potato"),
    (["potato, white","white potato"],                             "White potato"),
    (["potato"],                                                   "Potato"),
    (["bread, whole"],                                             "Whole wheat bread"),
    (["bread, white"],                                             "White bread"),
    (["bread"],                                                    "Bread"),
    (["bagel"],                                                    "Bagel"),
    (["tortilla, flour"],                                          "Flour tortilla"),
    (["tortilla, corn"],                                           "Corn tortilla"),
    (["tortilla"],                                                 "Tortilla"),
    (["peanut butter"],                                            "Peanut butter"),
    (["almond butter"],                                            "Almond butter"),
    (["almonds","almond, whole"],                                  "Almonds"),
    (["walnuts","walnut"],                                         "Walnuts"),
    (["cashews","cashew"],                                         "Cashews"),
    (["olive oil","oil, olive"],                                   "Olive oil"),
    (["coconut oil","oil, coconut"],                               "Coconut oil"),
    (["avocado"],                                                  "Avocado"),
    (["banana"],                                                   "Banana"),
    (["apple"],                                                    "Apple"),
    (["orange"],                                                   "Orange"),
    (["blueberries","blueberry"],                                  "Blueberries"),
    (["strawberries","strawberry"],                                "Strawberries"),
    (["raspberries","raspberry"],                                  "Raspberries"),
    (["mango"],                                                    "Mango"),
    (["broccoli"],                                                 "Broccoli"),
    (["spinach"],                                                  "Spinach"),
    (["kale"],                                                     "Kale"),
    (["tomato"],                                                   "Tomato"),
    (["cucumber"],                                                 "Cucumber"),
    (["zucchini"],                                                 "Zucchini"),
    (["bell pepper","pepper, sweet"],                              "Bell pepper"),
    (["carrot"],                                                   "Carrot"),
    (["mushroom"],                                                 "Mushrooms"),
    (["asparagus"],                                                "Asparagus"),
    (["green beans"],                                              "Green beans"),
    (["cauliflower"],                                              "Cauliflower"),
    (["dark chocolate"],                                           "Dark chocolate"),
]

def clean_food_name(raw: str) -> str:
    if not raw: return raw
    name = raw.strip()
    nl   = name.lower()
    for keywords, friendly in _FRIENDLY:
        if any(k in nl for k in keywords):
            return friendly
    name = _DROP_PARENS.sub("", name)
    name = _DROP_PARENS2.sub("", name)
    for pat in _BRAND_NOISE:
        name = _re.sub(pat, "", name, flags=_re.IGNORECASE)
    for prefix in _USDA_PREFIXES:
        if name.lower().startswith(prefix + ","):
            name = name[len(prefix)+1:].strip()
            break
    if "," in name:
        parts = [p.strip() for p in name.split(",")]
        qualifiers = {"raw","whole","fresh","plain","natural","dry","cooked",
                      "white","brown","dark","skim","low-fat","nonfat","lean"}
        if len(parts) > 1 and parts[1].lower().split()[0] in qualifiers:
            name = f"{parts[0]}, {parts[1]}"
        else:
            name = parts[0]
    name = _re.sub(r"\s+", " ", name).strip()
    return (name[0].upper() + name[1:]) if name else raw

# ── Scoring ────────────────────────────────────────────────────────────────────
def _score_food(f: Dict, include: List[str], prefer: List[str], avoid: List[str]) -> int:
    n = _name(f.get("name",""))
    score  = 6 * sum(k in n for k in include)
    score += 2 * sum(k in n for k in prefer)
    score -= 6 * sum(k in n for k in avoid)
    if any(k in n for k in ["chicken","turkey","shrimp","fish","salmon","tuna","cod"]):
        if "raw" in n: score += 10
        if any(x in n for x in ["cooked","braised","fried","breaded"]): score -= 10
    if any(k in n for k in ["rice","pasta","noodle","spaghetti","oat"]):
        if any(p in n for p in ["dry","uncooked","not cooked","raw"]): score += 8
        elif "cooked" in n: score += 2
    if any(x in n for x in ["sweetened","candied","in syrup","dessert","frosted"]): score -= 10
    score += int(min(8, (f.get("protein_per_100g") or 0) // 5))
    if any(x in n for x in ["prepared","instant","mix","flavored"]): score -= 3
    return score

def _pick_best(catalog: List[Dict], include: List[str], prefer: Optional[List[str]]=None,
               avoid: Optional[List[str]]=None) -> Optional[Dict]:
    prefer = prefer or []; avoid = avoid or []
    candidates = [f for f in catalog
                  if any(k in _name(f.get("name","")) for k in include)
                  and not any(k in _name(f.get("name","")) for k in avoid)]
    if not candidates: return None
    candidates.sort(key=lambda x: _score_food(x, include=include, prefer=prefer, avoid=avoid), reverse=True)
    return candidates[0]

# ── Catalog ────────────────────────────────────────────────────────────────────
def _force_include_staples(filtered: List[Dict], allergy_terms: List[str] = None) -> List[Dict]:
    allergy_terms = allergy_terms or []
    staples: List[Dict] = []
    def add_best(include, prefer=None, avoid=None):
        f = _pick_best(filtered, include=include, prefer=prefer or [], avoid=(avoid or [])+allergy_terms)
        if f: staples.append(f)

    # Carbs
    add_best(CARB_KW_RICE,       prefer=["plain","cooked"]+CARB_PREF_DRY, avoid=["fried","pudding"])
    add_best(["potato","potatoes"], prefer=["raw","white"], avoid=["fried","chip","sweet"])
    add_best(["sweet potato","sweet potatoes"], prefer=["raw"], avoid=["fried","chip","candied"])
    add_best(["bagel"], prefer=["plain"], avoid=["sweet","cinnamon","chocolate"])
    add_best(CARB_KW_BREAD, prefer=["plain","whole"], avoid=["sweet","stuffed"])
    add_best(CARB_KW_OATS, prefer=["rolled","plain"], avoid=["instant","sweet","flavored"])

    # Proteins
    add_best(["chicken","breast"], prefer=["raw","skinless","boneless"], avoid=["cooked","fried","breaded"])
    add_best(["turkey","breast"],  prefer=["raw","skinless","boneless"], avoid=["cooked","fried","breaded"])
    add_best(["egg","whole"], prefer=["raw","fresh"], avoid=["dried","powdered"])
    add_best(["greek yogurt","yogurt"], prefer=["plain","greek"], avoid=["sweet","flavored","fruit","frozen"])
    add_best(["salmon"], prefer=["raw","fresh","atlantic"], avoid=["smoked","canned","cured"])

    # Fats — force at least one into catalog guaranteed
    add_best(["olive oil"], prefer=["extra virgin","virgin"], avoid=FAT_AVOID+["spray","blend"])
    add_best(["almond","almonds"], prefer=["raw","whole","unsalted"], avoid=["candied","honey","flavored","chocolate"])
    add_best(["walnut","walnuts"], prefer=["raw","whole","unsalted"], avoid=["candied","honey","flavored"])
    add_best(["avocado"], prefer=["raw","fresh"], avoid=FAT_AVOID)

    # Vegetables — force at least 2-3 into catalog guaranteed
    add_best(["broccoli"], prefer=["raw","fresh"], avoid=["frozen","canned","cream"])
    add_best(["spinach"], prefer=["raw","fresh"], avoid=["frozen","canned","cream"])
    add_best(["carrot","carrots"], prefer=["raw","fresh"], avoid=["frozen","canned","glazed"])
    add_best(["zucchini"], prefer=["raw","fresh"], avoid=["frozen","canned"])
    add_best(["bell pepper","pepper"], prefer=["raw","fresh"], avoid=["frozen","canned","pickled"])

    # Fruit
    add_best(["banana"], prefer=["raw","fresh"], avoid=["dried","chips"])
    add_best(["apple"], prefer=["raw","fresh"], avoid=["dried","juice","sauce"])

    by_id = {}
    for f in staples: by_id[f["id"]] = f
    return list(by_id.values())

def build_catalog(profile: dict, targets: dict, limit: int=200, restrictions: Optional[dict]=None) -> List[Dict]:
    qs  = Food.objects.filter(kcal_per_100g__gt=0)
    raw = list(qs.values(*CATALOG_FIELDS)[:5000])

    allergy_terms: List[str] = []
    if restrictions:
        def _expand(term):
            t = str(term).lower().strip()
            yield t
            if t.endswith("s") and len(t) > 3:
                yield t[:-1]  # "peanuts" → "peanut" to match "peanut butter"
        for a in (restrictions.get("allergies") or []):
            allergy_terms.extend(_expand(a))
        for e in (restrictions.get("exclusions") or restrictions.get("exclude") or []):
            allergy_terms.extend(_expand(e))

    filtered = [f for f in raw if _macro_ok(f) and not _hard_excluded(f.get("name",""), allergy_terms)]
    staples  = _force_include_staples(filtered, allergy_terms)

    TEMPLATE_ANY = (
        CARB_KW_OATS + CARB_KW_RICE + CARB_KW_PASTA + CARB_KW_POTATO + CARB_KW_BREAD
        + PROTEIN_KW_POULTRY + PROTEIN_KW_EGGS + PROTEIN_KW_DAIRY + PROTEIN_KW_WHEY
        + PROTEIN_KW_SEAFOOD + PROTEIN_KW_FISH + FAT_KW + FRUIT_KW + VEG_KW
    )
    scored = []
    for f in filtered:
        n    = _name(f.get("name",""))
        base = 40 if any(k in n for k in TEMPLATE_ANY) else -80
        base += _score_food(f, include=TEMPLATE_ANY,
                            prefer=["raw","plain","fresh","whole"],
                            avoid=["sweetened","candied","syrup","fried","processed"])
        scored.append((base, f))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [f for (_s,f) in scored[:limit]]

    by_id = {f["id"]:f for f in (staples + top)}
    merged = list(by_id.values())
    staple_ids = {f["id"] for f in staples}
    merged.sort(key=lambda f: (0 if f["id"] in staple_ids else 1))
    return merged[:limit]

# ── Slot pickers ───────────────────────────────────────────────────────────────
def resolve_carb_strict(catalog: List[Dict], prefer: str, meal: str) -> Optional[Dict]:
    p = (prefer or "").lower().strip()
    meal_l = (meal or "").lower().strip()

    if meal_l == "breakfast":
        if p in ("oats","oatmeal"):
            return _pick_best(catalog, include=["oat"], prefer=["rolled","plain"],
                              avoid=["instant","sweet","cookie","flavored"])
        if p in ("bread","bagel","tortilla","wrap"):
            return _pick_best(catalog, include=CARB_KW_BREAD, prefer=["plain","whole","wheat"],
                              avoid=["sweet","cinnamon","chocolate","stuffed"])
        return (_pick_best(catalog, include=CARB_KW_OATS, prefer=["rolled","plain","whole"],
                           avoid=["instant","sweet","cookie","flavored"])
             or _pick_best(catalog, include=CARB_KW_BREAD, prefer=["plain","whole","wheat"],
                           avoid=["sweet","stuffed"]))

    if meal_l == "snack":
        return pick_snack_carb(catalog)

    if p == "rice":
        return (_pick_best(catalog, include=["rice"], prefer=["dry","uncooked","raw"],
                           avoid=["fried","pudding","instant","flavored"])
             or _pick_best(catalog, include=["rice"], prefer=["cooked","plain"],
                           avoid=["fried","pudding"]))
    if p in ("potato","white potato","potatoes"):
        return _pick_best(catalog, include=["potato","potatoes"],
                          prefer=["raw","fresh","whole","white"],
                          avoid=["sweet potato","sweet potatoes","fried","chip","mashed","instant"])
    if p in ("sweet potato","sweet potatoes"):
        return _pick_best(catalog, include=["sweet potato","sweet potatoes"],
                          prefer=["raw","fresh","whole"],
                          avoid=["fried","chip","mashed","instant","candied"])
    if p == "pasta":
        return (_pick_best(catalog, include=CARB_KW_PASTA,
                           prefer=["dry","uncooked","raw","plain"],
                           avoid=["mac and cheese","with cheese","fried"])
             or _pick_best(catalog, include=CARB_KW_PASTA,
                           prefer=["cooked","plain"],
                           avoid=["mac and cheese","with cheese","fried"]))
    if p in ("bread","bagel","tortilla","wrap"):
        return _pick_best(catalog, include=CARB_KW_BREAD, prefer=["plain","whole","wheat"],
                          avoid=["sweet","cinnamon","chocolate","stuffed"])
    return None

def pick_breakfast_carb(catalog):
    return resolve_carb_strict(catalog, prefer="oats", meal="Breakfast")

def pick_breakfast_protein(catalog, prefer=None):
    p = (prefer or "").lower().strip()
    for kw_list, pref in [
        (PROTEIN_KW_EGGS,  ["whole","raw","fresh"]),
        (["greek yogurt","yogurt","yoghurt","skyr","quark"], ["greek","plain","natural"]),
        (PROTEIN_KW_WHEY,  ["whey","plain","unflavored"]),
    ]:
        if p and not any(p in k for k in kw_list): continue
        f = _pick_best(catalog, include=kw_list, prefer=pref,
                       avoid=["dried","powdered","sweet","flavored","fruit","frozen","ice cream","bar","ready-to-drink"])
        if f and not _has_any(f["name"], list(BREAKFAST_BANNED_KW)):
            return f
    return None

def pick_fruit(catalog):
    _fruit_avoid = ["canned","in syrup","juice","dried","sweetened",
                    "cereal","oat","oatmeal","bread","muffin","bar",
                    "flavored","instant","quaker","kellogg","roughy"] + ALL_FISH_SEAFOOD_KW
    return _pick_best(catalog, include=FRUIT_KW, prefer=["raw","fresh","whole"],
                      avoid=_fruit_avoid)

def pick_veg(catalog):
    return _pick_best(catalog, include=VEG_KW, prefer=["raw","fresh","whole"],
                      avoid=["pickled","canned","cream","cheese","fried","breaded",
                             "subway","sandwich","sub on","teriyaki","restaurant",
                             "with lettuce","with tomato","noodle","egg","spinach noodle"])

def pick_fat(catalog) -> Optional[Dict]:
    # Try in order: olive oil → peanut butter → other nut butters → whole nuts → avocado → dark choc
    for include, prefer, avoid_extra in [
        (["olive oil"],                   ["extra virgin","virgin"], ["spray"]),
        (["peanut butter"],               ["natural"],               ["candy","sweet","chocolate"]),
        (["almond butter","cashew butter","sunflower butter"], ["natural","plain"], []),
        (["almond","walnut","cashew","pecan","pistachio"], ["raw","unsalted","whole"], ["candied","honey","flavored","chocolate"]),
        (["avocado"],                     ["raw","fresh"],           ["sauce","dip"]),
        (["dark chocolate"],              ["70","dark","cacao"],     ["candy bar","cookie","milk chocolate"]),
    ]:
        f = _pick_best(catalog, include=include, prefer=prefer, avoid=FAT_AVOID+avoid_extra)
        if f: return f
    return None

def pick_protein_main(catalog, prefer="chicken"):
    p = (prefer or "chicken").lower().strip()
    avoid = ["cooked","smoked","cured","fried","breaded","salad","sandwich","nugget"]
    mapping = {
        "chicken": (["chicken","breast"], ["raw","fresh","skinless","boneless"]),
        "turkey":  (["turkey","breast"],  ["raw","fresh","skinless","boneless"]),
        "fish":    (PROTEIN_KW_FISH,      ["raw","fresh"]),
        "shrimp":  (PROTEIN_KW_SEAFOOD,   ["raw","fresh"]),
    }
    inc, pref = mapping.get(p, mapping["chicken"])
    return (_pick_best(catalog, include=inc, prefer=pref, avoid=avoid)
         or _pick_best(catalog, include=["chicken","breast"],
                       prefer=["raw","fresh"], avoid=avoid))

def pick_snack_fat(catalog) -> Optional[Dict]:
    """Fat for snacks — skip olive oil (a cooking oil, not a snack food)."""
    for include, prefer, avoid_extra in [
        (["peanut butter"],               ["natural"],               ["candy","sweet","chocolate"]),
        (["almond butter","cashew butter","sunflower butter"], ["natural","plain"], []),
        (["almond","walnut","cashew","pecan","pistachio"], ["raw","unsalted","whole"], ["candied","honey","flavored","chocolate"]),
        (["avocado"],                     ["raw","fresh"],           ["sauce","dip"]),
        (["dark chocolate"],              ["70","dark","cacao"],     ["candy bar","cookie","milk chocolate"]),
    ]:
        f = _pick_best(catalog, include=include, prefer=prefer, avoid=FAT_AVOID+avoid_extra)
        if f: return f
    return None

def pick_snack_protein(catalog):
    return (_pick_best(catalog, include=PROTEIN_KW_EGGS,
                       prefer=["whole","raw","fresh"], avoid=["dried","powdered"])
         or _pick_best(catalog, include=["cottage cheese","skyr","quark"],
                       prefer=["plain","natural"],
                       avoid=["sweet","flavored","fruit"]+PROTEIN_KW_WHEY))

def pick_snack_carb(catalog):
    _snack_fruit_avoid = ["juice","syrup","canned","dried","cereal","oat","oatmeal",
                          "bread","muffin","bar","flavored","instant","quaker","kellogg",
                          "roughy","orange roughy"] + ALL_FISH_SEAFOOD_KW
    return (_pick_best(catalog, include=FRUIT_KW, prefer=["raw","fresh","whole"],
                       avoid=_snack_fruit_avoid)
         or _pick_best(catalog, include=CARB_KW_BREAD, prefer=["plain","whole","wheat"],
                       avoid=["sweet","stuffed"]+list(SNACK_BANNED_CARB_KW)))

# ── Totals ─────────────────────────────────────────────────────────────────────
def compute_totals_from_db(plan: dict, catalog: List[Dict]) -> Tuple[dict, List[dict]]:
    by_id = {f["id"]:f for f in catalog}
    K = P = F = C = 0.0
    meals_named: List[Dict] = []
    for meal in plan.get("meals",[]):
        items_named = []
        for it in meal.get("items",[]):
            fid = it.get("id")
            if fid not in by_id: continue
            f = by_id[fid]
            grams = float(it.get("grams") or 0.0)
            if grams <= 0: continue
            factor = grams / 100.0
            if f["kcal_per_100g"]:    K += f["kcal_per_100g"]    * factor
            if f["protein_per_100g"]: P += f["protein_per_100g"] * factor
            if f["fat_per_100g"]:     F += f["fat_per_100g"]     * factor
            if f["carbs_per_100g"]:   C += f["carbs_per_100g"]   * factor
            items_named.append({"id":int(fid), "name":clean_food_name(f["name"]), "grams":round(grams,1)})
        meals_named.append({"name":meal.get("name",""), "items":items_named})
    return {"kcal":round(K,1),"protein":round(P,1),"fat":round(F,1),"carbs":round(C,1)}, meals_named

def validate_plan(plan: dict, catalog: List[Dict]) -> Tuple[bool, Optional[str]]:
    if not isinstance(plan,dict): return False,"Plan is not a dict"
    if "meals" not in plan or "totals" not in plan: return False,"Missing meals or totals"
    valid_ids = {f["id"] for f in catalog}
    meals = plan.get("meals",[])
    if not isinstance(meals,list) or not meals: return False,"meals must be non-empty"
    for meal in meals:
        items = meal.get("items")
        if not isinstance(items,list) or not items: return False,"meal has no items"
        for it in items:
            if not {"id","grams"} <= set(it.keys()): return False,"item missing id/grams"
            if it["id"] not in valid_ids: return False,f"unknown food id {it['id']}"
            try: g = float(it["grams"])
            except Exception: return False,"grams not numeric"
            if g<=0 or g>1500: return False,f"grams out of bounds: {g}"
    return True, None

# ── Normalize (enforce meal structure) ────────────────────────────────────────
def normalize_meals_to_structure(plan: dict, catalog: List[Dict]) -> None:
    """
    Enforce:
      Breakfast: carb + protein + fruit + fat  (4 items)
      Lunch:     protein + carb + veg + fat    (4 items)
      Dinner:    protein + carb + veg + fat    (4 items)
      Snack:     (fruit or bread) + fat        (2 items)
    """
    breakfast = _find_meal(plan,"Breakfast")
    lunch     = _find_meal(plan,"Lunch")
    dinner    = _find_meal(plan,"Dinner")
    snack     = _find_meal(plan,"Snack")

    if breakfast:
        breakfast["items"] = [it for it in breakfast.get("items",[])
                               if not _has_any(it.get("name",""), list(BREAKFAST_BANNED_KW))]
        _keep_one_per_slot(breakfast, ["carb","protein","fruit","fat"])
        if _get_slot_item(breakfast,"carb") is None:
            f = pick_breakfast_carb(catalog)
            if f: breakfast["items"].insert(0, _as_item(f,80))
        if _get_slot_item(breakfast,"protein") is None:
            f = pick_breakfast_protein(catalog)
            if f:
                nn = _name(f["name"])
                g  = 35 if ("whey" in nn or "protein powder" in nn) else (200 if ("yogurt" in nn or "skyr" in nn) else 120)
                breakfast["items"].append(_as_item(f,g))
        if _get_slot_item(breakfast,"fruit") is None:
            f = pick_fruit(catalog)
            if f: breakfast["items"].append(_as_item(f,150))
        if _get_slot_item(breakfast,"fat") is None:
            f = pick_fat(catalog)
            if f: breakfast["items"].append(_as_item(f,15))
        breakfast["items"] = [x for x in breakfast["items"] if x][:4]

    def fix_main(meal, default_carb, meal_name):
        if not meal: return
        meal["items"] = [it for it in meal.get("items",[])
                         if not (_classify(it.get("name","")) == "protein"
                                 and _has_any(it.get("name",""), list(LUNCH_DINNER_BANNED_PROTEIN_KW)))]
        _keep_one_per_slot(meal, ["protein","carb","veg","fat"])
        if _get_slot_item(meal,"protein") is None:
            f = pick_protein_main(catalog,"chicken")
            if f: meal["items"].insert(0, _as_item(f,200))
        if _get_slot_item(meal,"carb") is None:
            f = resolve_carb_strict(catalog, prefer=default_carb, meal=meal_name)
            if f: meal["items"].append(_as_item(f, 100 if _is_dry_carb(f["name"]) else 300))
        if _get_slot_item(meal,"veg") is None:
            f = pick_veg(catalog)
            if f: meal["items"].append(_as_item(f,200))
        if _get_slot_item(meal,"fat") is None:
            f = pick_fat(catalog)
            if f: meal["items"].append(_as_item(f,15))
        _keep_one_per_slot(meal, ["protein","carb","veg","fat"])
        meal["items"] = [x for x in meal["items"] if x][:4]

    fix_main(lunch,  "rice",   "Lunch")
    fix_main(dinner, "potato", "Dinner")

    if snack:
        snack["items"] = [it for it in snack.get("items",[])
                          if not _has_any(it.get("name",""), list(SNACK_BANNED_CARB_KW))
                          and not _has_any(it.get("name",""), list(LUNCH_DINNER_BANNED_PROTEIN_KW))
                          and not _has_any(it.get("name",""), FAT_AVOID)]
        _keep_one_per_slot(snack, ["fruit","carb","fat","protein"])
        has_base = any(_classify(it.get("name","")) in ("fruit","carb") for it in snack.get("items",[]))
        if not has_base:
            f = pick_snack_carb(catalog)
            if f: snack["items"].insert(0, _as_item(f, 150 if _classify(f["name"])=="fruit" else 80))
        if _get_slot_item(snack,"fat") is None:
            f = pick_snack_fat(catalog)
            if f: snack["items"].append(_as_item(f,15))
        _keep_one_per_slot(snack, ["fruit","carb","fat"])
        snack["items"] = [x for x in snack["items"] if x][:2]

    deduplicate_meal_items(plan)

def enforce_meal_rules(plan, catalog):
    normalize_meals_to_structure(plan, catalog)

# ── Swaps (applied AFTER template, BEFORE adjust) ─────────────────────────────
def apply_swaps(plan: dict, catalog: List[Dict], swaps: List[Dict]):
    if not swaps: return
    for s in swaps:
        meal_name = (s.get("meal") or "").strip()
        slot      = (s.get("slot") or "").strip().lower()
        prefer    = (s.get("prefer") or "").strip().lower()
        meal      = _find_meal(plan, meal_name)
        if not meal: continue
        ml = meal_name.lower()

        new_food = None; default_g = 100.0

        if ml == "breakfast":
            if slot == "protein":
                new_food = pick_breakfast_protein(catalog, prefer=prefer)
                if new_food:
                    nn = _name(new_food["name"])
                    default_g = 35 if ("whey" in nn or "protein powder" in nn) else (200 if ("yogurt" in nn or "skyr" in nn) else 120)
            elif slot == "carb":
                new_food = resolve_carb_strict(catalog, prefer=prefer or "oats", meal="Breakfast")
                default_g = 80
        elif ml in ("lunch","dinner"):
            if slot == "protein":
                new_food = pick_protein_main(catalog, prefer=prefer or "chicken")
                default_g = 200
            elif slot == "carb":
                new_food = resolve_carb_strict(catalog, prefer=prefer or "rice", meal=meal_name)
                if new_food: default_g = 100 if _is_dry_carb(new_food["name"]) else 300
        elif ml == "snack":
            if slot in ("carb","fruit"):
                new_food = pick_snack_carb(catalog)
                if new_food: default_g = 150 if _classify(new_food["name"])=="fruit" else 80
            elif slot == "protein":
                new_food = pick_snack_protein(catalog); default_g = 120

        if new_food:
            _remove_all_of_slot(meal, slot)
            meal.setdefault("items",[]).append(_as_item(new_food, default_g))

# ── Adjust to targets ─────────────────────────────────────────────────────────
def adjust_plan_to_targets(plan, targets, catalog, profile):
    t_k = float(targets.get("kcal") or 0)
    t_p = float(targets.get("protein") or 0)
    t_f = float(targets.get("fat") or 0)
    t_c = float(targets.get("carbs") or 0)
    if t_k <= 0: return

    def totals():
        tot,_ = compute_totals_from_db(plan, catalog)
        return tot

    breakfast = _find_meal(plan,"Breakfast")
    lunch     = _find_meal(plan,"Lunch")
    dinner    = _find_meal(plan,"Dinner")
    snack     = _find_meal(plan,"Snack")

    CAP = {
        "b_carb":40+150, "b_protein":220, "b_fat":40,
        "ld_protein":320, "ld_carb_dry":160, "ld_carb_wet":450, "ld_veg":400, "ld_fat":40,
        "s_carb":140, "s_fruit":300, "s_fat":35,
    }

    def lc(): # lunch carb cap
        c = _get_slot_item(lunch,"carb")
        return CAP["ld_carb_dry"] if (c and _is_dry_carb(c.get("name",""))) else CAP["ld_carb_wet"]
    def dc(): # dinner carb cap
        c = _get_slot_item(dinner,"carb")
        return CAP["ld_carb_dry"] if (c and _is_dry_carb(c.get("name",""))) else CAP["ld_carb_wet"]

    kcal_lo = 0.95 * t_k
    kcal_hi = 1.05 * t_k

    for _ in range(80):
        tot = totals()
        K,P,F,C = tot["kcal"],tot["protein"],tot["fat"],tot["carbs"]

        kcal_ok    = kcal_lo <= K <= kcal_hi
        protein_ok = t_p<=0 or (0.88*t_p <= P <= 1.15*t_p)
        carbs_ok   = t_c<=0 or (0.80*t_c <= C <= 1.25*t_c)
        fat_ok     = t_f<=0 or (0.75*t_f <= F <= 1.25*t_f)

        if kcal_ok and protein_ok and carbs_ok and fat_ok: break

        if K > kcal_hi:
            if t_p>0 and P > 1.20*t_p:
                if lunch:  _bump_meal_slot(lunch,  "protein",-25,CAP["ld_protein"])
                if dinner: _bump_meal_slot(dinner, "protein",-25,CAP["ld_protein"])
                continue
            if lunch:     _bump_meal_slot(lunch,     "carb",-20,lc())
            if dinner:    _bump_meal_slot(dinner,    "carb",-20,dc())
            if breakfast: _bump_meal_slot(breakfast, "carb",-15,CAP["b_carb"])
            if snack:     _bump_meal_slot(snack,     "fat", -3, CAP["s_fat"])
            if breakfast: _bump_meal_slot(breakfast, "fat", -2, CAP["b_fat"])
            if lunch:     _bump_meal_slot(lunch,     "fat", -2, CAP["ld_fat"])
            if dinner:    _bump_meal_slot(dinner,    "fat", -2, CAP["ld_fat"])
            continue

        if K < kcal_lo:
            if lunch:     _bump_meal_slot(lunch,     "carb",+25,lc())
            if dinner:    _bump_meal_slot(dinner,    "carb",+25,dc())
            if breakfast: _bump_meal_slot(breakfast, "carb",+15,CAP["b_carb"])
            if totals()["kcal"] < kcal_lo:
                if snack:     _bump_meal_slot(snack,     "fat",+3,CAP["s_fat"])
                if breakfast: _bump_meal_slot(breakfast, "fat",+2,CAP["b_fat"])
                if lunch:     _bump_meal_slot(lunch,     "fat",+2,CAP["ld_fat"])
                if dinner:    _bump_meal_slot(dinner,    "fat",+2,CAP["ld_fat"])
            if t_p>0 and totals()["protein"] < 0.92*t_p:
                if lunch:  _bump_meal_slot(lunch,  "protein",+20,CAP["ld_protein"])
                if dinner: _bump_meal_slot(dinner, "protein",+20,CAP["ld_protein"])
            continue

        if t_p>0 and P < 0.90*t_p:
            if lunch:     _bump_meal_slot(lunch,     "protein",+20,CAP["ld_protein"])
            if dinner:    _bump_meal_slot(dinner,    "protein",+20,CAP["ld_protein"])
            if breakfast: _bump_meal_slot(breakfast, "protein",+10,CAP["b_protein"])
            continue

        if t_c>0 and C < 0.85*t_c:
            if lunch:     _bump_meal_slot(lunch,     "carb",+20,lc())
            if dinner:    _bump_meal_slot(dinner,    "carb",+20,dc())
            if breakfast: _bump_meal_slot(breakfast, "carb",+10,CAP["b_carb"])
            continue

        if t_p>0 and P > 1.15*t_p:
            if lunch:  _bump_meal_slot(lunch,  "protein",-15,CAP["ld_protein"])
            if dinner: _bump_meal_slot(dinner, "protein",-15,CAP["ld_protein"])
            continue

        if t_f>0 and not fat_ok:
            if F < 0.75*t_f:
                if snack:     _bump_meal_slot(snack,     "fat",+4,CAP["s_fat"])
                if breakfast: _bump_meal_slot(breakfast, "fat",+3,CAP["b_fat"])
                if lunch:     _bump_meal_slot(lunch,     "fat",+3,CAP["ld_fat"])
                if dinner:    _bump_meal_slot(dinner,    "fat",+3,CAP["ld_fat"])
            else:
                if snack:     _bump_meal_slot(snack,     "fat",-4,CAP["s_fat"])
                if breakfast: _bump_meal_slot(breakfast, "fat",-3,CAP["b_fat"])
                if lunch:     _bump_meal_slot(lunch,     "fat",-3,CAP["ld_fat"])
                if dinner:    _bump_meal_slot(dinner,    "fat",-3,CAP["ld_fat"])
            continue
        break

    enforce_meal_rules(plan, catalog)

# ── Template plan ──────────────────────────────────────────────────────────────
def generate_template_plan(profile: dict, targets: dict, restrictions: dict, catalog: List[Dict]) -> dict:
    goal  = _goal(profile)
    meals: List[Dict] = []

    # Breakfast: carb + protein + fruit + fat
    b_carb  = pick_breakfast_carb(catalog)
    b_prot  = pick_breakfast_protein(catalog)
    b_fruit = pick_fruit(catalog)
    b_fat   = pick_snack_fat(catalog)
    b_items = []
    if b_carb:  b_items.append(_as_item(b_carb, 80))
    if b_prot:
        nn = _name(b_prot["name"])
        b_items.append(_as_item(b_prot, 35 if ("whey" in nn or "protein" in nn) else (200 if ("yogurt" in nn or "skyr" in nn) else 120)))
    if b_fruit: b_items.append(_as_item(b_fruit, 150))
    if b_fat:   b_items.append(_as_item(b_fat, 15))
    if b_items: meals.append({"name":"Breakfast","items":[x for x in b_items if x][:4]})

    # Lunch: protein + carb + veg + fat
    l_prot = pick_protein_main(catalog,"chicken")
    l_carb = resolve_carb_strict(catalog,"rice","Lunch")
    l_veg  = pick_veg(catalog)
    l_fat  = pick_fat(catalog)
    l_items = []
    if l_prot: l_items.append(_as_item(l_prot, 200))
    if l_carb: l_items.append(_as_item(l_carb, 100 if _is_dry_carb(l_carb["name"]) else 300))
    if l_veg:  l_items.append(_as_item(l_veg, 200))
    if l_fat:  l_items.append(_as_item(l_fat, 15))
    if l_items: meals.append({"name":"Lunch","items":[x for x in l_items if x][:4]})

    # Dinner: protein + carb + veg + fat
    d_pref = "fish" if ("cut" in goal or "loss" in goal) else "turkey"
    d_prot = pick_protein_main(catalog, d_pref) or pick_protein_main(catalog,"chicken")
    d_carb = resolve_carb_strict(catalog,"potato","Dinner")
    d_veg  = pick_veg(catalog)
    d_fat  = pick_fat(catalog)
    d_items = []
    if d_prot: d_items.append(_as_item(d_prot, 200))
    if d_carb: d_items.append(_as_item(d_carb, 100 if _is_dry_carb(d_carb["name"]) else 300))
    if d_veg:  d_items.append(_as_item(d_veg, 200))
    if d_fat:  d_items.append(_as_item(d_fat, 15))
    if d_items: meals.append({"name":"Dinner","items":[x for x in d_items if x][:4]})

    # Snack: fruit/bread + fat (no olive oil for snacks)
    s_carb = pick_snack_carb(catalog)
    s_fat  = pick_snack_fat(catalog)
    s_items = []
    if s_carb: s_items.append(_as_item(s_carb, 150 if _classify(s_carb["name"])=="fruit" else 80))
    if s_fat:  s_items.append(_as_item(s_fat, 15))
    if s_items: meals.append({"name":"Snack","items":[x for x in s_items if x][:2]})

    plan = {"meals":meals,"totals":{"kcal":0,"protein":0,"fat":0,"carbs":0}}

    # Apply swaps THEN normalize THEN adjust — order matters
    swaps = (restrictions or {}).get("swaps") or []
    if isinstance(swaps, list) and swaps:
        apply_swaps(plan, catalog, swaps)

    # Normalize fills any missing slots after swaps
    enforce_meal_rules(plan, catalog)
    adjust_plan_to_targets(plan, targets, catalog, profile)
    enforce_meal_rules(plan, catalog)
    deduplicate_meal_items(plan)
    return plan

def generate_meal_plan(profile, targets, restrictions, catalog, mode="template"):
    restrictions = restrictions or {}
    return generate_template_plan(profile, targets, restrictions, catalog)