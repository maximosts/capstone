# core/views.py
from __future__ import annotations

from datetime import date
from statistics import mode
from typing import Any, Dict, Tuple
import math

from django.utils import timezone
from core.models import Profile, WeightLog, IntakeLog, PlanLog
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib.auth import login as dj_login
from datetime import date, timedelta
from core.models import Plan
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from core.models import Profile, WeightLog, IntakeLog
from core.services.bayes import run_weekly_bayes_update
from core.services.planner import (
    build_catalog,
    validate_plan,
    compute_totals_from_db,
    generate_meal_plan,
)

# -------------------------
# small parsing helpers
# -------------------------
def _to_int(v, default=None):
    try:
        if v is None or v == "":
            return default
        return int(v)
    except Exception:
        return default


def _to_float(v, default=None):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


# -------------------------
# Targets helpers (auto-seed)
# -------------------------
def _estimate_initial_tdee(p: Profile) -> Tuple[float, float]:
    # Mifflin-St Jeor + reasonable initial uncertainty
    sex = (p.sex or "M").upper()
    w = float(p.weight_kg or 0)
    h = float(p.height_cm or 0)
    a = float(p.age or 0)

    if w <= 0 or h <= 0 or a <= 0:
        raise ValueError("Profile missing age/height/weight")

    if sex == "M":
        bmr = 10 * w + 6.25 * h - 5 * a + 5
    else:
        bmr = 10 * w + 6.25 * h - 5 * a - 161

    activity_map = {
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "active": 1.725,
        "very_active": 1.9,
    }
    mult = activity_map.get((p.activity or "moderate").lower(), 1.55)

    tdee = bmr * mult
    sigma = 300.0
    return float(tdee), float(sigma)


def _goal_kcal_delta(goal: str) -> int:
    g = (goal or "").lower()
    if "loss" in g or "cut" in g:
        return -350
    if "gain" in g or "bulk" in g or "muscle" in g:
        return +250
    return 0


def _derive_macros(p: Profile, kcal_target: int) -> Dict[str, int]:
    w = float(p.weight_kg or 0)

    protein = int(round(max(120, w * 2.0)))   # 2 g/kg, min 120g
    fat     = int(round(max(50,  w * 0.8)))   # 0.8 g/kg, min 50g

    # BUG FIX: if protein + fat already consume more kcal than the target,
    # trim fat (protein is higher priority) so targets are self-consistent.
    MIN_CARB_KCAL = 80 * 4   # keep at least 80 g carbs (320 kcal)
    protein_kcal  = protein * 4
    if protein_kcal + MIN_CARB_KCAL >= kcal_target:
        # protein alone barely fits — zero fat, minimum carbs
        protein = max(80, int((kcal_target - MIN_CARB_KCAL) / 4))
        fat     = 0
    else:
        max_fat_kcal = kcal_target - protein_kcal - MIN_CARB_KCAL
        fat = min(fat, int(max_fat_kcal / 9))
        fat = max(0, fat)

    carbs = int(round((kcal_target - (protein * 4 + fat * 9)) / 4))
    carbs = max(80, carbs)

    return {"protein": protein, "fat": fat, "carbs": carbs}


def _ensure_profile_targets(p: Profile, force_recalc: bool = False) -> Dict[str, int]:
    # if already set and no forced recalc -> return cached targets
    if not force_recalc and all([p.kcal_target, p.protein_g, p.fat_g, p.carbs_g]):
        return {"kcal": p.kcal_target, "protein": p.protein_g, "fat": p.fat_g, "carbs": p.carbs_g}

    # seed posterior if missing
    if not p.tdee_mu or not p.tdee_sigma:
        mu, sigma = _estimate_initial_tdee(p)
        p.tdee_mu = mu
        p.tdee_sigma = sigma
        p.save(update_fields=["tdee_mu", "tdee_sigma"])

    kcal_target = int(round(float(p.tdee_mu) + _goal_kcal_delta(p.goal)))
    macros = _derive_macros(p, kcal_target)

    p.kcal_target = kcal_target
    p.protein_g = macros["protein"]
    p.fat_g = macros["fat"]
    p.carbs_g = macros["carbs"]
    p.save(update_fields=["kcal_target", "protein_g", "fat_g", "carbs_g"])

    return {"kcal": kcal_target, **macros}


def _targets_for_request(request) -> Dict[str, int]:
    if getattr(request, "user", None) and request.user.is_authenticated:
        p, _ = Profile.objects.get_or_create(
            user=request.user,
            defaults={"sex": "M", "age": 25, "height_cm": 175, "weight_kg": 80, "activity": "moderate", "goal": "recomp"},
        )
        return _ensure_profile_targets(p)

    t = request.data.get("targets")
    if not t:
        raise ValueError("targets not set and no profile targets available")
    return t


# -------------------------
# Profile API
# -------------------------
@api_view(["GET", "PUT", "POST"])
@permission_classes([IsAuthenticated])
def profile_view(request):
    profile, _ = Profile.objects.get_or_create(
        user=request.user,
        defaults={
            "sex": "M", "age": 25, "height_cm": 175,
            "weight_kg": 80, "activity": "moderate", "goal": "recomp",
        },
    )

    if request.method == "GET":
        targets = _ensure_profile_targets(profile)

        # Latest logged weight (separate from profile.weight_kg)
        latest_weight_log = (
            WeightLog.objects.filter(user=request.user)
            .order_by("-date").values("date", "weight_kg").first()
        )

        return Response(
            {
                "name":       request.user.get_full_name() or "",
                "email":      request.user.email or request.user.username,

                # Body stats — read-only after registration (weight managed via log)
                "sex":        profile.sex,
                "age":        profile.age,
                "height_cm":  profile.height_cm,
                "weight_kg":  profile.weight_kg,   # initial registration weight
                "latest_weight": latest_weight_log, # most recent logged weight

                # Editable in profile
                "activity":   profile.activity,
                "goal":       profile.goal,
                "allergies":  profile.allergies or "",
                "exclusions": profile.exclusions or "",

                "targets": {
                    "kcal":    targets["kcal"],
                    "protein": targets["protein"],
                    "carbs":   targets["carbs"],
                    "fat":     targets["fat"],
                },
                "posterior": {"tdee_mu": profile.tdee_mu, "tdee_sigma": profile.tdee_sigma},
            },
            status=200,
        )

    # PUT/POST — weight is intentionally NOT accepted here.
    # Weight is tracked via POST /api/log-weight/ which feeds the Bayesian algorithm.
    data = request.data or {}

    goal_changed = False
    new_goal = data.get("goal")
    if new_goal and new_goal != profile.goal:
        if new_goal not in ("cut", "bulk", "recomp", "maintenance"):
            return Response({"detail": "Invalid goal. Must be cut, bulk, recomp or maintenance."}, status=400)
        profile.goal = new_goal
        goal_changed = True

    profile.activity = (
        data.get("activity")
        or data.get("activityLevel")
        or data.get("activity_level")
        or profile.activity
    )

    # Age and height are editable but reset TDEE so it re-estimates with new values
    stat_changed = False
    new_age = _to_int(data.get("age"), None)
    if new_age is not None and new_age != profile.age:
        profile.age = new_age
        stat_changed = True

    new_height = _to_float(data.get("height_cm"), None)
    if new_height is not None and new_height != profile.height_cm:
        profile.height_cm = new_height
        stat_changed = True

    # Allergies and exclusions — accept list or comma-separated string
    def _to_csv(val):
        if val is None:
            return None
        if isinstance(val, list):
            return ",".join(str(v).strip() for v in val if v)
        return str(val).strip()

    allergies  = _to_csv(data.get("allergies"))
    exclusions = _to_csv(data.get("exclusions"))
    if allergies  is not None: profile.allergies  = allergies
    if exclusions is not None: profile.exclusions = exclusions

    if goal_changed or stat_changed:
        # Reset posterior so _ensure_profile_targets re-estimates TDEE
        # from scratch with the updated values
        profile.tdee_mu    = None
        profile.tdee_sigma = None

    profile.save()
    _ensure_profile_targets(profile, force_recalc=True)

    response_data = {"detail": "Profile updated"}
    if goal_changed or stat_changed:
        reasons = []
        if goal_changed: reasons.append("goal")
        if stat_changed: reasons.append("age/height")
        response_data["warning"] = (
            f"You changed your {' and '.join(reasons)} — Bayesian TDEE estimate has been reset. "
            "Your calorie targets have been recalculated from your current stats. "
            "The algorithm will re-learn your TDEE as you log weight over the next few weeks."
        )

    return Response(response_data, status=200)


# -------------------------
# Planner API
# -------------------------
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def generate_plan(request):
    import traceback as _tb
    restrictions = request.data.get("restrictions", {}) or {}
    mode = (request.data.get("mode") or "rule").lower()
    PlanLog.objects.create(user=request.user, mode=mode)

    try:
        targets = _targets_for_request(request)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    try:
        # Build profile dict from DB so the planner gets correct goal/activity
        db_profile, _ = Profile.objects.get_or_create(user=request.user)
        profile_obj = {
            "goal":      db_profile.goal or "",
            "activity":  db_profile.activity or "moderate",
            "weight_kg": float(db_profile.weight_kg or 0),
            "sex":       db_profile.sex or "M",
            "age":       db_profile.age or 25,
            **(request.data.get("profile", {}) or {}),
        }

        catalog = build_catalog(profile_obj, targets, limit=150, restrictions=restrictions)

        # ── GUARANTEED fat + veg injection ────────────────────────────────────
        # Build allergy terms the same way planner does
        _allergy = []
        for _a in (restrictions.get("allergies") or []):
            _allergy.append(str(_a).lower())
        for _e in (restrictions.get("exclusions") or restrictions.get("exclude") or []):
            _allergy.append(str(_e).lower())

        def _blocked(name):
            n = (name or "").lower()
            return any(t in n for t in _allergy)

        from django.db.models import Q as _Q
        from core.models import Food as _Food
        _existing_ids = {f["id"] for f in catalog}

        # Force-fetch fat foods directly from DB
        _fat_queries = [
            _Q(name__icontains="olive oil"),
            _Q(name__icontains="walnut"),
            _Q(name__icontains="almond") & ~_Q(name__icontains="butter"),
            _Q(name__icontains="avocado"),
        ]
        for _q in _fat_queries:
            if any(f.get("_slot") == "fat" for f in catalog):
                break
            _candidates = list(_Food.objects.filter(_q, kcal_per_100g__gt=0).exclude(
                name__icontains="candy").exclude(name__icontains="cookie").exclude(
                name__icontains="spray").values("id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g")[:5])
            for _f in _candidates:
                n = (_f["name"] or "").lower()
                if _blocked(n): continue
                if _f.get("fat_per_100g", 0) and _f["fat_per_100g"] > 8:
                    if _f["id"] not in _existing_ids:
                        catalog.append(_f)
                        _existing_ids.add(_f["id"])
                    break

        # Force-fetch veg foods directly from DB
        _veg_queries = [
            _Q(name__icontains="broccoli") & ~_Q(name__icontains="subway") & ~_Q(name__icontains="sandwich"),
            _Q(name__icontains="spinach") & ~_Q(name__icontains="noodle") & ~_Q(name__icontains="pasta"),
            _Q(name__icontains="carrot") & ~_Q(name__icontains="cake") & ~_Q(name__icontains="muffin"),
            _Q(name__icontains="zucchini"),
            _Q(name__icontains="bell pepper") | _Q(name__icontains="capsicum"),
        ]
        _veg_added = 0
        for _q in _veg_queries:
            if _veg_added >= 2: break
            _candidates = list(_Food.objects.filter(_q, kcal_per_100g__gt=0).values(
                "id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g")[:5])
            for _f in _candidates:
                n = (_f["name"] or "").lower()
                if _blocked(n): continue
                if "raw" in n or "fresh" in n or len(_f["name"]) < 40:
                    if _f["id"] not in _existing_ids:
                        catalog.append(_f)
                        _existing_ids.add(_f["id"])
                        _veg_added += 1
                    break

        # Force-fetch real fruit directly from DB
        _fruit_queries = [
            _Q(name__icontains="banana") & ~_Q(name__icontains="bread") & ~_Q(name__icontains="oat"),
            _Q(name__icontains="apple") & ~_Q(name__icontains="juice") & ~_Q(name__icontains="sauce") & ~_Q(name__icontains="oat"),
            _Q(name__icontains="strawberr") & ~_Q(name__icontains="jam"),
            _Q(name__icontains="blueberr") & ~_Q(name__icontains="muffin"),
        ]
        for _q in _fruit_queries:
            _candidates = list(_Food.objects.filter(_q, kcal_per_100g__gt=0).values(
                "id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g")[:5])
            for _f in _candidates:
                n = (_f["name"] or "").lower()
                if _blocked(n): continue
                if "raw" in n or "fresh" in n:
                    if _f["id"] not in _existing_ids:
                        catalog.append(_f)
                        _existing_ids.add(_f["id"])
                    break
        # ── END injection ──────────────────────────────────────────────────────

        # Strip buckwheat groats from all meals — not a standard meal food
        _BUCKWHEAT_KW = ["buckwheat","groat","groats","kasha"]

        # ── SWAP PRE-PROCESS: normalise swap values before passing to planner ──
        _swaps_raw = (restrictions.get("swaps") or [])
        _swaps_fixed = []
        for _sw in _swaps_raw:
            _sw2 = dict(_sw)
            # "seafood" → "shrimp" so pick_protein_main mapping finds it
            if _sw2.get("prefer") == "seafood":
                _sw2["prefer"] = "shrimp"
            # "dairy" → "greek yogurt" so breakfast protein picker finds it
            if _sw2.get("prefer") == "dairy":
                _sw2["prefer"] = "greek yogurt"
            _swaps_fixed.append(_sw2)
        restrictions = dict(restrictions)
        restrictions["swaps"] = _swaps_fixed
        # ── END SWAP PRE-PROCESS ───────────────────────────────────────────────

        plan = generate_meal_plan(profile_obj, targets, restrictions, catalog, mode=mode)

        # Strip unwanted foods from specific meals
        _breakfast_banned = ["buckwheat","groat","kasha","sweet potato"]
        _breakfast = next((m for m in plan.get("meals",[]) if m.get("name")=="Breakfast"), None)
        if _breakfast:
            _breakfast["items"] = [it for it in _breakfast.get("items",[])
                                    if not any(k in (it.get("name") or "").lower() for k in _breakfast_banned)]
        # Strip buckwheat/groats from all other meals too
        for _m in plan.get("meals", []):
            if _m.get("name") != "Breakfast":
                _m["items"] = [it for it in _m.get("items",[])
                               if not any(k in (it.get("name") or "").lower() for k in ["buckwheat","groat","kasha"])]

        # ── POST-PROCESS SWAPS: re-apply swaps after planner (catches cache issues) ──
        from core.models import Food as _FoodSwap
        _FIELDS = ("id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g")

        def _swap_pick_protein(meal_name, prefer, catalog):
            ml = meal_name.lower()
            avoid = ["cooked","smoked","cured","fried","breaded","salad","sandwich","nugget"]
            if ml == "breakfast":
                p = prefer.lower()
                if p in ("eggs","egg"):
                    for f in catalog:
                        n = (f.get("name") or "").lower()
                        if "egg" in n and not any(x in n for x in ["noodle","pasta","powder","dried","substitute","eggplant"]):
                            return f, 150
                    for f in _FoodSwap.objects.filter(kcal_per_100g__gt=0).exclude(
                            name__icontains="noodle").exclude(name__icontains="pasta").exclude(
                            name__icontains="dried").exclude(name__icontains="eggplant").values(*_FIELDS):
                        n = (f.get("name") or "").lower()
                        if "egg" in n:
                            catalog.append(f)
                            return f, 150
                if p in ("whey","protein powder"):
                    for f in catalog:
                        n = (f.get("name") or "").lower()
                        if ("whey" in n or "protein powder" in n) and "bar" not in n:
                            return f, 35
                if p in ("greek yogurt","dairy","yogurt"):
                    for f in catalog:
                        n = (f.get("name") or "").lower()
                        if ("yogurt" in n or "greek" in n) and "frozen" not in n and "sweet" not in n:
                            return f, 200
            elif ml in ("lunch","dinner"):
                p = prefer.lower()
                mappings = {
                    "chicken": (["chicken","breast"], ["raw","skinless"]),
                    "turkey":  (["turkey","breast"],  ["raw","skinless"]),
                    "fish":    (["salmon","tuna","cod","tilapia","fish"], ["raw","fresh"]),
                    "shrimp":  (["shrimp","prawn"],   ["raw","fresh"]),
                }
                inc, pref = mappings.get(p, mappings["chicken"])
                for f in catalog:
                    n = (f.get("name") or "").lower()
                    if any(k in n for k in inc) and not any(x in n for x in avoid):
                        return f, 200
                # Try DB
                for kw in inc:
                    qs = _FoodSwap.objects.filter(name__icontains=kw, kcal_per_100g__gt=0).values(*_FIELDS)
                    for f in qs:
                        n = (f.get("name") or "").lower()
                        if not any(x in n for x in avoid+["subway","sandwich"]):
                            catalog.append(f)
                            return f, 200
            return None, 100

        from core.services.planner import clean_food_name as _cfn2
        def _item2(f, g): return {"id": int(f["id"]), "name": _cfn2(f["name"]), "grams": float(g)}

        def _cn(name): return (name or "").lower()
        def _slot(name):
            n = _cn(name)
            for k in ["chicken","turkey","egg","yogurt","whey","protein powder","salmon","tuna","cod","fish","shrimp"]:
                if k in n: return "protein"
            for k in ["oat","rice","pasta","spaghetti","noodle","potato","bread","bagel","tortilla","buckwheat","quinoa","groat"]:
                if k in n: return "carb"
            for k in ["oil","walnut","almond","cashew","pecan","avocado","peanut butter","dark chocolate","nut"]:
                if k in n and "noodle" not in n and "pasta" not in n: return "fat"
            for k in ["banana","apple","strawberr","blueberr","raspberr","mango","orange","kiwi","pear","grape","cherry","peach"]:
                if k in n and "oat" not in n and "bread" not in n and "cereal" not in n: return "fruit"
            for k in ["broccoli","spinach","carrot","zucchini","bell pepper","capsicum","asparagus","kale","cauliflower","tomato","cucumber","mushroom"]:
                if k in n and "noodle" not in n and "pasta" not in n and "spaghetti" not in n and "subway" not in n: return "veg"
            return "other"

        for _sw in _swaps_fixed:
            _sml     = _sw.get("meal","")
            _sw_slot = (_sw.get("slot") or "").lower()
            _pref    = (_sw.get("prefer") or "").lower()
            _meal    = next((m for m in plan.get("meals",[]) if m.get("name","").lower() == _sml.lower()), None)
            if not _meal or not _sw_slot or not _pref:
                continue
            if _sw_slot == "protein":
                _new_f, _new_g = _swap_pick_protein(_sml, _pref, catalog)
                if _new_f:
                    _meal["items"] = [it for it in _meal["items"]
                                      if _slot(it.get("name","")) != "protein"]
                    _meal["items"].insert(0, _item2(_new_f, _new_g))

            elif _sw_slot == "carb":
                # Handle carb swaps for all meals including Snack
                _carb_avoid = ["fried","instant","flavored","sweetened","candied","syrup","canned"]
                _carb_new = None; _carb_g = 100
                _p = _pref.lower()

                if _sml.lower() == "snack":
                    if _p == "fruit":
                        # pick real fruit
                        for _cf in catalog:
                            _cn3 = (_cf.get("name") or "").lower()
                            if any(k in _cn3 for k in ["banana","strawberr","blueberr","apple","raspberry","mango"]):
                                if not any(x in _cn3 for x in ["oat","bread","cereal","juice","roughy","potato"]):
                                    _carb_new = _cf; _carb_g = 150; break
                    elif _p in ("bread","wrap"):
                        for _cf in catalog:
                            _cn3 = (_cf.get("name") or "").lower()
                            if any(k in _cn3 for k in ["bread","tortilla","wrap","pita"]) and not any(x in _cn3 for x in _carb_avoid+["sweet","stuffed"]):
                                _carb_new = _cf; _carb_g = 60; break
                    elif _p == "oats":
                        for _cf in catalog:
                            _cn3 = (_cf.get("name") or "").lower()
                            if "oat" in _cn3 and not any(x in _cn3 for x in _carb_avoid):
                                _carb_new = _cf; _carb_g = 50; break
                else:
                    # Lunch/Dinner/Breakfast carb swaps
                    _carb_kw_map = {
                        "rice": ["rice"], "potato": ["potato","potatoes"],
                        "sweet potato": ["sweet potato","sweet potatoes"],
                        "bagel": ["bagel"], "oats": ["oat","oatmeal"],
                        "bread": ["bread","tortilla","wrap","pita","bagel"],
                    }
                    _inc = _carb_kw_map.get(_p, [_p])
                    for _cf in catalog:
                        _cn3 = (_cf.get("name") or "").lower()
                        if any(k in _cn3 for k in _inc) and not any(x in _cn3 for x in _carb_avoid+["fried","chip"]):
                            from core.services.planner import _is_dry_carb as _idc
                            _carb_g = 100 if _idc(_cf["name"]) else 300
                            _carb_new = _cf; break

                if _carb_new:
                    _meal["items"] = [it for it in _meal["items"]
                                      if _slot(it.get("name","")) not in ("carb","fruit")]
                    _meal["items"].insert(0, _item2(_carb_new, _carb_g))
        # ── END POST-PROCESS SWAPS ────────────────────────────────────────────

        # ── POST-PROCESS: inject fat/veg/fruit that the old planner strips ──────

        def _find_in_catalog(catalog, slot, allergy_terms):
            for f in catalog:
                n = (f.get("name") or "").lower()
                if _slot(n) == slot and not any(t in n for t in allergy_terms):
                    return f
            return None

        _allergy2 = [str(a).lower() for a in (restrictions.get("allergies") or [])]
        _allergy2 += [str(e).lower() for e in (restrictions.get("exclusions") or restrictions.get("exclude") or [])]

        # Fat foods — pick best available from catalog
        # prefer_oil=True: almonds for lunch/dinner (denser, less dominant taste)
        # prefer_oil=False: walnuts for breakfast/snack
        _fat_avoid_words = _allergy2 + ["spray","candy","noodle","pasta","spaghetti","sauce","dressing","mayo","cookie","cream","flour"]

        # Seed olive oil into DB if it doesn't exist yet
        from core.models import Food as _FoodModel
        _olive_seed = dict(name="Olive oil, extra virgin", kcal_per_100g=884,
                           protein_per_100g=0, fat_per_100g=100, carbs_per_100g=0, source="seed")
        if not _FoodModel.objects.filter(name="Olive oil, extra virgin").exists():
            _new_f = _FoodModel.objects.create(**_olive_seed)
            catalog.append({"id": _new_f.id, "name": "Olive oil, extra virgin",
                             "kcal_per_100g": 884, "protein_per_100g": 0, "fat_per_100g": 100, "carbs_per_100g": 0})
        else:
            _existing_oil = _FoodModel.objects.filter(name="Olive oil, extra virgin").values(
                "id","name","kcal_per_100g","protein_per_100g","fat_per_100g","carbs_per_100g").first()
            if _existing_oil and _existing_oil["id"] not in {f["id"] for f in catalog}:
                catalog.append(_existing_oil)

        def _find_fat(prefer_oil=False):
            order = (["olive oil","almond","walnut","avocado"] if prefer_oil
                     else ["walnut","almond","avocado","olive oil"])
            for _fname in order:
                for _cf in catalog:
                    _cn2 = (_cf.get("name") or "").lower()
                    if _fname in _cn2 and not any(t in _cn2 for t in _fat_avoid_words):
                        if (_cf.get("fat_per_100g") or 0) > 8:
                            return _cf
            return None

        _fat_oil  = _find_fat(prefer_oil=True)   # olive oil → lunch/dinner
        _fat_nut  = _find_fat(prefer_oil=False)  # walnuts → breakfast/snack
        # Ensure they're different foods if possible
        if _fat_oil and _fat_nut and _fat_oil["id"] == _fat_nut["id"]:
            for _cf in catalog:
                _cn2 = (_cf.get("name") or "").lower()
                if any(k in _cn2 for k in ["walnut","almond","avocado","olive oil"]):
                    if not any(t in _cn2 for t in _fat_avoid_words):
                        if (_cf.get("fat_per_100g") or 0) > 8 and _cf["id"] != _fat_oil["id"]:
                            _fat_nut = _cf
                            break

        # Veg
        _veg_food = None
        for _vname in ["broccoli, raw","broccoli","spinach, baby","spinach","carrots, baby","carrot","zucchini"]:
            for _cf in catalog:
                _cn2 = (_cf.get("name") or "").lower()
                if _vname in _cn2 and not any(t in _cn2 for t in ["noodle","pasta","spaghetti","subway","sandwich","sauce","soup","cream","pickled"]):
                    _veg_food = _cf
                    break
            if _veg_food: break

        # Real fruit (not sweet potato / cereal)
        _fruit_food = None
        _fruit_skip = ["oat","bread","cereal","juice","sauce","jam","muffin","roughy","potato","sweet potato","quaker","kellogg","flavored","instant"]
        for _fname in ["bananas, overripe, raw","bananas","strawberries, raw","strawberries","apples, fuji","apples","blueberries"]:
            for _cf in catalog:
                _cn2 = (_cf.get("name") or "").lower()
                if _fname in _cn2 and not any(t in _cn2 for t in _fruit_skip + _allergy2):
                    _fruit_food = _cf
                    break
            if _fruit_food: break

        from core.services.planner import clean_food_name as _cfn
        def _item(f, g): return {"id": int(f["id"]), "name": _cfn(f["name"]), "grams": float(g)}

        for _meal in plan.get("meals", []):
            _mname = _meal.get("name", "")
            _slots = {_slot(it["name"]) for it in _meal.get("items", [])}

            if _mname in ("Lunch", "Dinner"):
                # Remove duplicate carb slots (keep only first)
                _seen_slots = set(); _clean = []
                for _it in _meal["items"]:
                    _s = _slot(_it["name"])
                    if _s in ("carb",) and _s in _seen_slots: continue
                    _seen_slots.add(_s); _clean.append(_it)
                _meal["items"] = _clean
                _slots = {_slot(it["name"]) for it in _meal["items"]}
                # Add veg
                if "veg" not in _slots and _veg_food:
                    _meal["items"].append(_item(_veg_food, 200))
                # Add olive oil fat
                if "fat" not in _slots and _fat_oil:
                    _meal["items"].append(_item(_fat_oil, 15))
                # Cap at 4
                _meal["items"] = _meal["items"][:4]

            elif _mname == "Breakfast":
                # Remove extra carb slots beyond 1
                _seen_slots = set(); _clean = []
                for _it in _meal["items"]:
                    _s = _slot(_it["name"])
                    if _s == "carb" and _s in _seen_slots: continue
                    _seen_slots.add(_s); _clean.append(_it)
                _meal["items"] = _clean
                _slots = {_slot(it["name"]) for it in _meal["items"]}
                # Add fruit
                if "fruit" not in _slots and _fruit_food:
                    _meal["items"].append(_item(_fruit_food, 150))
                # Add nut fat
                if "fat" not in _slots and _fat_nut:
                    _meal["items"].append(_item(_fat_nut, 15))
                # Cap at 4
                _meal["items"] = _meal["items"][:4]

            elif _mname == "Snack":
                # Replace sweet potato with real fruit if present
                _snack_skip = ["oat","bread","cereal","roughy","potato","sweet potato","quaker"]
                _meal["items"] = [_it for _it in _meal["items"]
                                   if not any(k in (_it.get("name") or "").lower() for k in _snack_skip)]
                _slots = {_slot(it["name"]) for it in _meal["items"]}
                if "fruit" not in _slots and "carb" not in _slots and _fruit_food:
                    _meal["items"].insert(0, _item(_fruit_food, 150))
                if "fat" not in _slots and _fat_nut:
                    _meal["items"].append(_item(_fat_nut, 15))
                _meal["items"] = _meal["items"][:2]
        # ── REBALANCE: trim carbs to hit calorie target after injection ──────
        def _calc_kcal(plan, catalog):
            by_id = {f["id"]: f for f in catalog}
            total = 0.0
            for meal in plan.get("meals", []):
                for it in meal.get("items", []):
                    f = by_id.get(it.get("id"))
                    if f and f.get("kcal_per_100g"):
                        total += f["kcal_per_100g"] * float(it.get("grams", 0)) / 100
            return total

        _target_kcal = targets.get("kcal", 0)
        _max_iters = 40
        _carb_slots = {"oat","rice","pasta","spaghetti","noodle","potato","bread","bagel","buckwheat","quinoa","groat","wild rice"}

        for _ in range(_max_iters):
            _current = _calc_kcal(plan, catalog)
            if _current <= _target_kcal * 1.04:
                break
            _excess = _current - _target_kcal
            # Trim carb items proportionally across all meals
            _trimmed = False
            for _meal in plan.get("meals", []):
                for _it in _meal.get("items", []):
                    _n = (_it.get("name") or "").lower()
                    if any(k in _n for k in _carb_slots):
                        _f = next((f for f in catalog if f["id"] == _it["id"]), None)
                        if _f and _f.get("kcal_per_100g", 0) > 0:
                            _trim_g = min(20, _excess / (_f["kcal_per_100g"] / 100))
                            _new_g  = max(40, float(_it["grams"]) - _trim_g)
                            _it["grams"] = round(_new_g, 1)
                            _trimmed = True
                            break
                if _trimmed:
                    break
            if not _trimmed:
                break
        # ── END REBALANCE ──────────────────────────────────────────────────────

        # ── END POST-PROCESS ───────────────────────────────────────────────────

        ok, err = validate_plan(plan, catalog)
        if not ok:
            return Response({"error": f"Invalid plan: {err}", "raw": plan}, status=400)

        totals, meals_named = compute_totals_from_db(plan, catalog)

        import logging
        log = logging.getLogger(__name__)
        from core.services.planner import pick_veg, pick_snack_carb
        veg_pick = pick_veg(catalog)
        snack_carb_pick = pick_snack_carb(catalog)
        fat_in_catalog = [
            f"{f['name']} (fat={f.get('fat_per_100g',0):.1f})"
            for f in catalog if (f.get('fat_per_100g') or 0) >= 10
        ]
        veg_in_catalog = [f["name"] for f in catalog if any(k in f["name"].lower() for k in ["broccoli","spinach","carrot","pepper","zucchini","kale","tomato","cucumber","mushroom","asparagus","onion","cauliflower"])]
        fruit_in_catalog = [f["name"] for f in catalog if any(k in f["name"].lower() for k in ["banana","apple","orange","strawberr","blueberr","raspberr","grape","mango","pineapple","kiwi","pear","watermelon","peach"])]
        meal_detail = {
            m["name"]: [{"name": it["name"], "grams": it["grams"]} for it in m["items"]]
            for m in meals_named
        }
        from core.services.planner import PLANNER_VERSION as _PV
        log.warning("[PLANNER VERSION] %s", _PV)
        log.warning(
            "[PLAN DEBUG] targets=%s | actual=%s | profile_goal=%s | catalog_size=%d\n"
            "  meals=%s\n  fat_foods=%s\n  pick_veg=%s | pick_snack_carb=%s\n"
            "  veg_in_catalog=%s\n  fruit_in_catalog=%s",
            targets, totals, profile_obj.get("goal"), len(catalog),
            meal_detail, fat_in_catalog[:10],
            veg_pick["name"] if veg_pick else None,
            snack_carb_pick["name"] if snack_carb_pick else None,
            veg_in_catalog[:10], fruit_in_catalog[:10],
        )

        payload = {
            "meals": meals_named,
            "totals_from_db": totals,
            "targets": targets,
            "note": f"Mode={mode}; totals computed from DB.",
            "_debug": {
                "targets": targets,
                "actual": totals,
                "gap": {
                    "kcal":    round(totals["kcal"]    - targets["kcal"],    1),
                    "protein": round(totals["protein"] - targets["protein"], 1),
                    "fat":     round(totals["fat"]     - targets["fat"],     1),
                    "carbs":   round(totals["carbs"]   - targets["carbs"],   1),
                },
                "catalog_size": len(catalog),
                "profile_goal": profile_obj.get("goal"),
            },
        }

        Plan.objects.create(user=request.user, mode=mode, payload=payload)
        return Response(payload, status=200)

    except Exception as e:
        return Response({"error": str(e), "traceback": _tb.format_exc()}, status=500)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def latest_plan(request):
    plan = Plan.objects.filter(user=request.user).order_by("-created_at").first()
    if not plan:
        return Response({}, status=204)  # or {"plan": None}
    return Response(plan.payload, status=200)

# -------------------------
# Logging APIs
# -------------------------
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def log_weight(request):
    d = request.data.get("date") or date.today().isoformat()
    w = float(request.data["weight_kg"])

    WeightLog.objects.update_or_create(
        user=request.user, date=d, defaults={"weight_kg": w}
    )
    # Keep profile.weight_kg current so TDEE re-estimates use latest weight
    Profile.objects.filter(user=request.user).update(weight_kg=w)

    result = {"logged_weight": {"date": d, "weight_kg": w}}

    # --- Auto Bayesian update -------------------------------------------
    # Run every time the user logs weight. The update function itself checks
    # for sufficient data (≥2 weight points, ≥1 intake log) and skips if not.
    upd = run_weekly_bayes_update(request.user.id)
    result["bayes_update"] = upd

    if not upd.get("skipped") and upd.get("days_used", 0) >= 7:
        profile = Profile.objects.get(user=request.user)
        prev_kcal = profile.kcal_target

        profile.tdee_mu    = float(upd["tdee_mean"])
        profile.tdee_sigma = float(upd["tdee_sd"])
        profile.save(update_fields=["tdee_mu", "tdee_sigma"])

        # Force macro recalc from new TDEE
        new_targets = _ensure_profile_targets(profile, force_recalc=True)

        # Cap the per-update change at ±200 kcal to avoid steep single-update jumps.
        # The TDEE is still updated fully so future updates converge smoothly.
        MAX_KCAL_CHANGE = 200
        if prev_kcal is not None and profile.kcal_target is not None:
            raw_delta = profile.kcal_target - int(prev_kcal)
            if abs(raw_delta) > MAX_KCAL_CHANGE:
                capped_kcal = int(prev_kcal) + (MAX_KCAL_CHANGE if raw_delta > 0 else -MAX_KCAL_CHANGE)
                capped_kcal = max(1200, capped_kcal)
                capped_macros = _derive_macros(profile, capped_kcal)
                profile.kcal_target = capped_kcal
                profile.protein_g   = capped_macros["protein"]
                profile.fat_g       = capped_macros["fat"]
                profile.carbs_g     = capped_macros["carbs"]
                profile.save(update_fields=["kcal_target", "protein_g", "fat_g", "carbs_g"])
                new_targets = {"kcal": capped_kcal, **capped_macros}

        # Plateau detection: nudge only when Bayesian didn't already make a
        # meaningful adjustment (avoids double-counting stable-weight signal).
        goal = (profile.goal or "").lower()
        slope = upd.get("slope_kg_per_day", None)
        bayes_delta = abs(profile.kcal_target - int(prev_kcal)) if prev_kcal else 0
        plateau_nudge = 0
        if slope is not None and abs(slope) < 0.02 and bayes_delta < 50:
            if "cut" in goal or "loss" in goal:
                plateau_nudge = -100
            elif "bulk" in goal or "gain" in goal:
                plateau_nudge = +100

        if plateau_nudge != 0:
            new_kcal = max(1200, (profile.kcal_target or 2000) + plateau_nudge)
            profile.kcal_target = new_kcal
            nudged_macros = _derive_macros(profile, new_kcal)
            profile.protein_g = nudged_macros["protein"]
            profile.fat_g     = nudged_macros["fat"]
            profile.carbs_g   = nudged_macros["carbs"]
            profile.save(update_fields=["kcal_target", "protein_g", "fat_g", "carbs_g"])
            new_targets = {"kcal": new_kcal, **nudged_macros}

        # Track delta for dashboard card
        if prev_kcal is not None and profile.kcal_target is not None:
            delta = int(profile.kcal_target) - int(prev_kcal)
            if delta != 0:
                profile.prev_kcal_target       = int(prev_kcal)
                profile.last_kcal_delta        = delta
                profile.last_target_updated_at = timezone.now()
                profile.save(update_fields=["prev_kcal_target", "last_kcal_delta", "last_target_updated_at"])

        result["targets_updated"] = new_targets
        result["plateau_nudge"]   = plateau_nudge

    return Response(result, status=200)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def log_intake(request):
    d = request.data.get("date") or date.today().isoformat()
    kcal = float(request.data["kcal"])

    IntakeLog.objects.update_or_create(
        user=request.user, date=d, defaults={"kcal": kcal}
    )

    result = {"logged_intake": {"date": d, "kcal": kcal}}
    if request.data.get("auto_update"):
        result["bayes_update"] = run_weekly_bayes_update(request.user.id)
    return Response(result, status=200)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_weight_logs(request):
    """
    Returns the user's weight logs as a time series.
    Optional query params:
      - days=30  (default 90)
    """
    try:
        days = int(request.query_params.get("days", 90))
    except Exception:
        days = 90

    qs = (
        WeightLog.objects
        .filter(user=request.user)
        .order_by("date")
    )

    if days > 0:
        # filter last N days (inclusive)
        from datetime import date, timedelta
        start = date.today() - timedelta(days=days - 1)
        qs = qs.filter(date__gte=start)

    data = [{"date": wl.date.isoformat(), "weight_kg": float(wl.weight_kg)} for wl in qs]

    return Response({"weights": data}, status=200)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_weight_logs(request):
    qs = WeightLog.objects.filter(user=request.user).order_by("-date")
    weights = [{"id": w.id, "date": w.date.isoformat(), "weight_kg": float(w.weight_kg)} for w in qs]
    return Response({"weights": weights}, status=200)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def edit_weight_log(request, log_id):
    try:
        log = WeightLog.objects.get(id=log_id, user=request.user)
    except WeightLog.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "DELETE":
        log.delete()
        return Response({"deleted": True}, status=200)

    # PATCH
    new_weight = request.data.get("weight_kg")
    if new_weight is None:
        return Response({"error": "weight_kg is required"}, status=400)
    log.weight_kg = float(new_weight)
    log.save(update_fields=["weight_kg"])

    # Keep profile.weight_kg in sync if this is the most recent log
    latest = WeightLog.objects.filter(user=request.user).order_by("-date").first()
    if latest and latest.id == log.id:
        Profile.objects.filter(user=request.user).update(weight_kg=log.weight_kg)

    return Response({"id": log.id, "date": log.date.isoformat(), "weight_kg": float(log.weight_kg)}, status=200)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_intake_logs(request):
    qs = IntakeLog.objects.filter(user=request.user).order_by("-date")
    intakes = [{"id": i.id, "date": i.date.isoformat(), "kcal": float(i.kcal)} for i in qs]
    return Response({"intakes": intakes}, status=200)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def edit_intake_log(request, log_id):
    try:
        log = IntakeLog.objects.get(id=log_id, user=request.user)
    except IntakeLog.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "DELETE":
        log.delete()
        run_weekly_bayes_update(request.user.id)
        return Response({"deleted": True}, status=200)

    # PATCH
    new_kcal = request.data.get("kcal")
    if new_kcal is None:
        return Response({"error": "kcal is required"}, status=400)
    log.kcal = float(new_kcal)
    log.save(update_fields=["kcal"])
    run_weekly_bayes_update(request.user.id)
    return Response({"id": log.id, "date": log.date.isoformat(), "kcal": float(log.kcal)}, status=200)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard_summary(request):
    user = request.user
    today = timezone.localdate()

    # last 14 weight logs
    weights_qs = (
        WeightLog.objects
        .filter(user=user)
        .order_by("-date")[:14]
    )
    weights = list(reversed([{"date": w.date.isoformat(), "weight_kg": float(w.weight_kg)} for w in weights_qs]))

    # last 7 intake logs
    start_7 = today - timedelta(days=6)
    intakes_qs = IntakeLog.objects.filter(user=user, date__gte=start_7, date__lte=today).order_by("date")
    intakes = [{"date": i.date.isoformat(), "kcal": float(i.kcal)} for i in intakes_qs]

    avg_kcal = round(sum(x["kcal"] for x in intakes) / len(intakes), 0) if intakes else None

    # weight change in last 7 days
    weights_7 = WeightLog.objects.filter(user=user, date__gte=start_7, date__lte=today).order_by("date")
    weight_change = None
    if weights_7.count() >= 2:
        first = float(weights_7.first().weight_kg)
        last  = float(weights_7.last().weight_kg)
        weight_change = round(last - first, 2)

    # plans generated in last 7 days
    plans_generated = PlanLog.objects.filter(user=user, created_at__date__gte=start_7, created_at__date__lte=today).count()

    # latest target adjustment card
    profile, _ = Profile.objects.get_or_create(user=user)

    latest_adjustment = {
        "previous_target": profile.prev_kcal_target,
        "new_target":      profile.kcal_target,
        "delta":           profile.last_kcal_delta,
        "updated_at":      profile.last_target_updated_at.isoformat() if profile.last_target_updated_at else None,
    }

    # ── Today's tracker totals (from FoodEntry) ──────────────────────────
    from core.models import FoodEntry
    today_entries = FoodEntry.objects.filter(user=user, date=today).select_related("food")
    today_kcal    = round(sum(e.kcal    for e in today_entries), 1)
    today_protein = round(sum(e.protein for e in today_entries), 1)
    today_carbs   = round(sum(e.carbs   for e in today_entries), 1)
    today_fat     = round(sum(e.fat     for e in today_entries), 1)

    return Response(
        {
            "weight_progress_14d": weights,
            "weekly_summary": {
                "avg_daily_kcal":  avg_kcal,
                "weight_change_kg": weight_change,
                "plans_generated": plans_generated,
            },
            "latest_calorie_adjustment": latest_adjustment,
            # Real today data for the Daily Calorie Target card
            "profile": {
                "goal":       profile.goal,
                "weight_kg":  profile.weight_kg,
                "height_cm":  profile.height_cm,
                "tdee_mu":    profile.tdee_mu,
            },
            "today_intake": {
                "kcal":    today_kcal,
                "protein": today_protein,
                "carbs":   today_carbs,
                "fat":     today_fat,
            },
            "targets": {
                "kcal":    profile.kcal_target,
                "protein": profile.protein_g,
                "carbs":   profile.carbs_g,
                "fat":     profile.fat_g,
            },
        },
        status=200,
    )
# -------------------------
# Bayesian -> targets endpoint
# -------------------------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def recompute_targets(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)

    upd = run_weekly_bayes_update(request.user.id)
    if upd.get("skipped"):
        return Response({"detail": "skipped", "reason": upd.get("reason"), "bayes": upd}, status=200)

    # store previous kcal target BEFORE update
    prev_kcal = profile.kcal_target

    profile.tdee_mu = float(upd["tdee_mean"])
    profile.tdee_sigma = float(upd["tdee_sd"])
    profile.save(update_fields=["tdee_mu", "tdee_sigma"])

    targets = _ensure_profile_targets(profile, force_recalc=True)  # force so macros update too

    # ✅ now store delta info for dashboard card
    if prev_kcal is not None and profile.kcal_target is not None:
        profile.prev_kcal_target = int(prev_kcal)
        profile.last_kcal_delta = int(profile.kcal_target) - int(prev_kcal)
        profile.last_target_updated_at = timezone.now()
        profile.save(update_fields=["prev_kcal_target", "last_kcal_delta", "last_target_updated_at"])

    return Response(
        {
            "detail": "ok",
            "bayes": upd,
            "posterior": {"tdee_mu": profile.tdee_mu, "tdee_sigma": profile.tdee_sigma},
            "targets": targets,
        },
        status=200,
    )


# ----------------- FRONTEND PAGES (legacy Django templates) -----------------
@login_required
def dashboard(request):
    return render(request, "dashboard.html")


@login_required
def planner(request):
    return render(request, "planner.html")


@login_required
def logs(request):
    return render(request, "logs.html")


@login_required
def profile(request):
    return render(request, "profile.html")


# ─────────────────────────────────────────
# Food Search
# ─────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def food_search(request):
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        return Response({"results": []})

    from core.models import Food as FoodModel
    from django.db.models import Q

    foods = (
        FoodModel.objects
        .filter(Q(name__icontains=q) | Q(brand__icontains=q))
        .exclude(kcal_per_100g__isnull=True)
        .order_by("name")[:20]
    )
    results = [
        {
            "id": f.id,
            "name": f.name,
            "brand": f.brand or "",
            "kcal_per_100g":    round(f.kcal_per_100g    or 0, 1),
            "protein_per_100g": round(f.protein_per_100g or 0, 1),
            "carbs_per_100g":   round(f.carbs_per_100g   or 0, 1),
            "fat_per_100g":     round(f.fat_per_100g     or 0, 1),
        }
        for f in foods
    ]
    return Response({"results": results})


# ─────────────────────────────────────────
# Calorie Tracker (FoodEntry CRUD)
# ─────────────────────────────────────────
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def tracker_entries(request):
    from core.models import FoodEntry, Food as FoodModel

    if request.method == "GET":
        date_str = request.query_params.get("date") or date.today().isoformat()
        entries = FoodEntry.objects.filter(user=request.user, date=date_str).select_related("food")
        data = [
            {
                "id": e.id,
                "food_id": e.food_id,
                "food_name": e.food.name,
                "brand": e.food.brand or "",
                "grams": e.grams,
                "meal_slot": e.meal_slot,
                "kcal": e.kcal,
                "protein": e.protein,
                "carbs": e.carbs,
                "fat": e.fat,
            }
            for e in entries
        ]

        # Also return daily targets for the progress bar
        profile = Profile.objects.filter(user=request.user).first()
        targets = {
            "kcal":    profile.kcal_target    if profile else None,
            "protein": profile.protein_g      if profile else None,
            "carbs":   profile.carbs_g        if profile else None,
            "fat":     profile.fat_g          if profile else None,
        }
        return Response({"entries": data, "targets": targets, "date": date_str})

    # POST — add a food entry
    food_id   = request.data.get("food_id")
    grams     = request.data.get("grams")
    meal_slot = request.data.get("meal_slot", "snack")
    date_str  = request.data.get("date") or date.today().isoformat()

    if not food_id or not grams:
        return Response({"error": "food_id and grams are required"}, status=400)

    try:
        food = FoodModel.objects.get(id=food_id)
    except FoodModel.DoesNotExist:
        return Response({"error": "Food not found"}, status=404)

    entry = FoodEntry.objects.create(
        user=request.user,
        date=date_str,
        food=food,
        grams=float(grams),
        meal_slot=meal_slot,
    )

    # Auto-sync IntakeLog total for this date so the Bayesian algo sees it
    day_entries = FoodEntry.objects.filter(user=request.user, date=date_str).select_related("food")
    total_kcal = sum(e.kcal for e in day_entries)
    IntakeLog.objects.update_or_create(
        user=request.user, date=date_str, defaults={"kcal": total_kcal}
    )

    return Response({
        "id": entry.id,
        "food_name": food.name,
        "grams": entry.grams,
        "meal_slot": entry.meal_slot,
        "kcal": entry.kcal,
        "protein": entry.protein,
        "carbs": entry.carbs,
        "fat": entry.fat,
    }, status=201)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def tracker_delete(request, entry_id):
    from core.models import FoodEntry

    try:
        entry = FoodEntry.objects.get(id=entry_id, user=request.user)
    except FoodEntry.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    entry_date = entry.date
    entry.delete()

    # Re-sync IntakeLog after deletion
    day_entries = FoodEntry.objects.filter(user=request.user, date=entry_date).select_related("food")
    total_kcal = sum(e.kcal for e in day_entries)
    if total_kcal > 0:
        IntakeLog.objects.update_or_create(
            user=request.user, date=entry_date, defaults={"kcal": total_kcal}
        )
    else:
        IntakeLog.objects.filter(user=request.user, date=entry_date).delete()

    return Response({"deleted": True})


# ─────────────────────────────────────────
# Ollama Chat
# ─────────────────────────────────────────
# Chat — multi-conversation
# ─────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def conversation_list(request):
    from core.models import Conversation, ChatMessage
    convos = Conversation.objects.filter(user=request.user).exclude(title__startswith="Coaching — ")
    return Response({
        "conversations": [
            {
                "id":         c.id,
                "title":      c.title,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "preview":    c.messages.last().content[:80] if c.messages.exists() else "",
            }
            for c in convos
        ]
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def conversation_create(request):
    from core.models import Conversation
    title = (request.data.get("title") or "New conversation").strip()[:200]
    convo = Conversation.objects.create(user=request.user, title=title)
    return Response({"id": convo.id, "title": convo.title, "created_at": convo.created_at.isoformat()}, status=201)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def conversation_delete(request, convo_id):
    from core.models import Conversation
    try:
        convo = Conversation.objects.get(id=convo_id, user=request.user)
    except Conversation.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    convo.delete()
    return Response({"deleted": True})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def conversation_rename(request, convo_id):
    from core.models import Conversation
    try:
        convo = Conversation.objects.get(id=convo_id, user=request.user)
    except Conversation.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    title = (request.data.get("title") or "").strip()[:200]
    if title:
        convo.title = title
        convo.save(update_fields=["title"])
    return Response({"id": convo.id, "title": convo.title})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def conversation_messages(request, convo_id):
    from core.models import Conversation, ChatMessage
    try:
        convo = Conversation.objects.get(id=convo_id, user=request.user)
    except Conversation.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    msgs = convo.messages.all()
    return Response({
        "id":    convo.id,
        "title": convo.title,
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in msgs
        ]
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat(request):
    import urllib.request, json as _json
    from core.models import FoodEntry, Conversation, ChatMessage

    convo_id = request.data.get("conversation_id")
    messages  = request.data.get("messages", [])

    if not messages:
        return Response({"error": "messages required"}, status=400)

    # Get or create conversation
    if convo_id:
        try:
            convo = Conversation.objects.get(id=convo_id, user=request.user)
        except Conversation.DoesNotExist:
            return Response({"error": "Conversation not found"}, status=404)
    else:
        convo = Conversation.objects.create(user=request.user, title="New conversation")
        convo_id = convo.id

    today    = timezone.localdate()
    start_28 = today - timedelta(days=27)

    profile = Profile.objects.filter(user=request.user).first()

    weight_logs = list(
        WeightLog.objects.filter(user=request.user, date__gte=start_28)
        .order_by("date").values("date", "weight_kg")
    )
    intake_logs = list(
        IntakeLog.objects.filter(user=request.user, date__gte=today - timedelta(days=13))
        .order_by("date").values("date", "kcal")
    )
    today_entries = list(
        FoodEntry.objects.filter(user=request.user, date=today).select_related("food")
    )
    today_foods = [
        f"{e.food.name} ({e.grams}g, {e.kcal} kcal, P{e.protein}g C{e.carbs}g F{e.fat}g)"
        for e in today_entries
    ]
    today_totals = {
        "kcal":    round(sum(e.kcal    for e in today_entries), 1),
        "protein": round(sum(e.protein for e in today_entries), 1),
        "carbs":   round(sum(e.carbs   for e in today_entries), 1),
        "fat":     round(sum(e.fat     for e in today_entries), 1),
    }

    # Plateau detection
    recent_weights = [w for w in weight_logs if w["date"] >= today - timedelta(days=13)]
    plateau_note = ""
    if len(recent_weights) >= 5:
        vals  = [float(w["weight_kg"]) for w in recent_weights]
        n     = len(vals)
        mean_x = (n - 1) / 2
        slope  = sum((i - mean_x) * (v - sum(vals)/n) for i, v in enumerate(vals)) /                  max(sum((i - mean_x)**2 for i in range(n)), 0.001)
        if abs(slope) < 0.02 and profile and profile.goal in ("cut", "bulk"):
            direction = "losing" if profile.goal == "cut" else "gaining"
            plateau_note = (
                f"\n PLATEAU: Weight slope is {round(slope,4)} kg/day over last {n} days "
                f"(threshold +-0.02). User is on a {profile.goal} and NOT {direction} weight."
            )

    system_prompt = (
        "You are a knowledgeable nutrition and fitness assistant with access to the user's real data. "
        "Give specific, personalised answers using actual numbers from their data. Be concise.\n\n"
    )
    if profile:
        system_prompt += (
            f"=== PROFILE ===\n"
            f"Goal: {profile.goal} | Activity: {profile.activity} | Age: {profile.age} | "
            f"Sex: {profile.sex} | Height: {profile.height_cm}cm | Weight: {profile.weight_kg}kg\n"
            f"Targets: {profile.kcal_target} kcal | P{profile.protein_g}g | C{profile.carbs_g}g | F{profile.fat_g}g\n"
        )
        if profile.allergies:  system_prompt += f"Allergies: {profile.allergies}\n"
        if profile.exclusions: system_prompt += f"Exclusions: {profile.exclusions}\n"

    if weight_logs:
        lines  = ", ".join(f"{w['date'].isoformat()} {w['weight_kg']}kg" for w in weight_logs)
        change = round(float(weight_logs[-1]["weight_kg"]) - float(weight_logs[0]["weight_kg"]), 2)
        system_prompt += f"\n=== WEIGHT (28d) ===\n{lines}\nChange: {change:+.2f} kg\n{plateau_note}"

    if intake_logs:
        lines = ", ".join(f"{i['date'].isoformat()} {round(i['kcal'])}kcal" for i in intake_logs)
        avg   = round(sum(float(i["kcal"]) for i in intake_logs) / len(intake_logs))
        system_prompt += f"\n=== INTAKE (14d) ===\n{lines}\nAverage: {avg} kcal/day\n"

    system_prompt += f"\n=== TODAY ({today}) ===\n"
    if today_foods:
        system_prompt += "\n".join(today_foods) + f"\nTotals: {today_totals['kcal']} kcal | P{today_totals['protein']}g | C{today_totals['carbs']}g | F{today_totals['fat']}g\n"
    else:
        system_prompt += "Nothing logged yet.\n"

    try:
        import os
        from groq import Groq
        client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        reply = completion.choices[0].message.content

        # Save messages
        last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
        if last_user:
            ChatMessage.objects.create(conversation=convo, role="user",      content=last_user["content"])
        ChatMessage.objects.create(conversation=convo, role="assistant", content=reply)

        # Auto-title from first user message
        if convo.title == "New conversation" and last_user:
            convo.title = last_user["content"][:60]
            convo.save(update_fields=["title", "updated_at"])
        else:
            convo.save(update_fields=["updated_at"])

        return Response({"reply": reply, "conversation_id": convo.id, "conversation_title": convo.title})
    except Exception as e:
        return Response({"error": f"AI error: {e}"}, status=502)


# ─────────────────────────────────────────
# Chat History (legacy - kept for compat)
# ─────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chat_history(request):
    return Response({"messages": []})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def chat_clear(request):
    return Response({"cleared": 0})


# ─────────────────────────────────────────
# Create Custom Food
# ─────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_food(request):
    from core.models import Food as FoodModel

    name    = (request.data.get("name") or "").strip()
    kcal    = request.data.get("kcal_per_100g")
    protein = request.data.get("protein_per_100g")
    carbs   = request.data.get("carbs_per_100g")
    fat     = request.data.get("fat_per_100g")

    if not name:
        return Response({"error": "Name is required"}, status=400)
    if kcal is None:
        return Response({"error": "kcal_per_100g is required"}, status=400)

    try:
        kcal    = float(kcal)
        protein = float(protein) if protein is not None else 0.0
        carbs   = float(carbs)   if carbs   is not None else 0.0
        fat     = float(fat)     if fat     is not None else 0.0
    except (ValueError, TypeError):
        return Response({"error": "Macro values must be numbers"}, status=400)

    brand    = (request.data.get("brand") or "").strip()
    category = (request.data.get("category") or "custom").strip()

    food = FoodModel.objects.create(
        name             = name,
        brand            = brand,
        category         = category,
        kcal_per_100g    = kcal,
        protein_per_100g = protein,
        carbs_per_100g   = carbs,
        fat_per_100g     = fat,
        source           = f"user:{request.user.id}",
    )

    return Response({
        "id":               food.id,
        "name":             food.name,
        "brand":            food.brand,
        "kcal_per_100g":    food.kcal_per_100g,
        "protein_per_100g": food.protein_per_100g,
        "carbs_per_100g":   food.carbs_per_100g,
        "fat_per_100g":     food.fat_per_100g,
    }, status=201)




# ─────────────────────────────────────────
# Coaching
# ─────────────────────────────────────────

COACHING_PLANS = {
    "starter": {"name": "Starter", "price": "€29/mo"},
    "pro":     {"name": "Pro",     "price": "€59/mo"},
    "elite":   {"name": "Elite",   "price": "€99/mo"},
}

def _get_coaching_conversation(user):
    """Get or create the coaching conversation for this user."""
    from core.models import Conversation
    title = f"Coaching — {user.username}"
    convo, _ = Conversation.objects.get_or_create(user=user, title=title)
    return convo


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def coaching_status(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    plan = profile.coaching_plan or ""
    return Response({
        "plan":          plan,
        "plan_name":     COACHING_PLANS.get(plan, {}).get("name", "") if plan else "",
        "plan_price":    COACHING_PLANS.get(plan, {}).get("price", "") if plan else "",
        "coaching_since": profile.coaching_since.isoformat() if profile.coaching_since else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def coaching_subscribe(request):
    plan_id = (request.data.get("plan") or "").lower()
    if plan_id not in COACHING_PLANS:
        return Response({"error": "Invalid plan"}, status=400)

    from core.models import Conversation, ChatMessage
    from django.utils import timezone

    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.coaching_plan  = plan_id
    profile.coaching_since = timezone.now()
    profile.save(update_fields=["coaching_plan", "coaching_since"])

    # Create coaching conversation + welcome message from system
    convo = _get_coaching_conversation(request.user)
    if not convo.messages.exists():
        plan_info = COACHING_PLANS[plan_id]
        welcome = (
            "Welcome to your " + plan_info["name"] + " coaching plan!"
            " I am your dedicated coach. I can see your nutrition logs, weight progress, and meal plans."
            " Feel free to ask me anything about your macros, meal ideas, or progress."
            " To get started, tell me a bit about your main goal right now."
        )
        ChatMessage.objects.create(
            conversation=convo,
            role="coach",
            content=welcome,
        )

    return Response({
        "detail":    "Subscribed",
        "plan":      plan_id,
        "plan_name": COACHING_PLANS[plan_id]["name"],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def coaching_messages(request):
    from core.models import ChatMessage
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if not profile.coaching_plan:
        return Response({"error": "No active coaching plan"}, status=403)

    convo = _get_coaching_conversation(request.user)
    msgs  = convo.messages.order_by("created_at")
    return Response({
        "messages": [
            {
                "id":         m.id,
                "role":       m.role,
                "content":    m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in msgs
        ]
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def coaching_send(request):
    from core.models import ChatMessage
    content = (request.data.get("content") or "").strip()
    if not content:
        return Response({"error": "Empty message"}, status=400)

    profile, _ = Profile.objects.get_or_create(user=request.user)
    if not profile.coaching_plan:
        return Response({"error": "No active coaching plan"}, status=403)

    convo = _get_coaching_conversation(request.user)
    msg   = ChatMessage.objects.create(conversation=convo, role="user", content=content)

    return Response({
        "id":         msg.id,
        "role":       msg.role,
        "content":    msg.content,
        "created_at": msg.created_at.isoformat(),
    }, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def coaching_cancel(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.coaching_plan  = ""
    profile.coaching_since = None
    profile.save(update_fields=["coaching_plan", "coaching_since"])
    return Response({"detail": "Plan cancelled"})




@api_view(["GET"])
@permission_classes([IsAuthenticated])
def coaching_admin_inbox(request):
    """Staff only — list all users with active coaching plans + last message."""
    if not request.user.is_staff:
        return Response({"error": "Admin only"}, status=403)
    from core.models import Conversation, ChatMessage
    profiles = Profile.objects.exclude(coaching_plan="").exclude(coaching_plan=None).select_related("user")
    result = []
    for p in profiles:
        title = f"Coaching — {p.user.username}"
        convo = Conversation.objects.filter(user=p.user, title=title).first()
        last_msg = None
        unread = 0
        if convo:
            last = convo.messages.order_by("-created_at").first()
            if last:
                last_msg = {"content": last.content[:120], "role": last.role, "created_at": last.created_at.isoformat()}
            unread = convo.messages.filter(role="user").count()
        result.append({
            "user_id":       p.user.id,
            "username":      p.user.username,
            "email":         p.user.email,
            "coaching_plan": p.coaching_plan,
            "coaching_since": p.coaching_since.isoformat() if p.coaching_since else None,
            "convo_id":      convo.id if convo else None,
            "last_message":  last_msg,
            "message_count": convo.messages.count() if convo else 0,
        })
    return Response({"clients": result})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def coaching_admin_thread(request, convo_id):
    """Staff only — get full message thread for a coaching conversation."""
    if not request.user.is_staff:
        return Response({"error": "Admin only"}, status=403)
    from core.models import Conversation, ChatMessage
    try:
        convo = Conversation.objects.get(id=convo_id)
    except Conversation.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    msgs = convo.messages.order_by("created_at")
    return Response({
        "convo_id": convo.id,
        "user":     convo.user.username,
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in msgs
        ],
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def coaching_admin_reply(request, convo_id):
    """Staff only — post a coach reply into a coaching conversation."""
    if not request.user.is_staff:
        return Response({"error": "Admin only"}, status=403)
    from core.models import Conversation, ChatMessage
    content = (request.data.get("content") or "").strip()
    if not content:
        return Response({"error": "Empty message"}, status=400)
    try:
        convo = Conversation.objects.get(id=convo_id)
    except Conversation.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    msg = ChatMessage.objects.create(conversation=convo, role="coach", content=content)
    return Response({"id": msg.id, "role": msg.role, "content": msg.content, "created_at": msg.created_at.isoformat()}, status=201)


# ─────────────────────────────────────────
# Bayesian Debug
# ─────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def bayes_debug(request):
    from datetime import datetime, timedelta, timezone
    from core.services.bayes import run_weekly_bayes_update

    since = (datetime.now(timezone.utc) - timedelta(days=28)).date()

    weight_logs = list(
        WeightLog.objects.filter(user=request.user, date__gte=since)
        .order_by("date").values("date", "weight_kg")
    )
    intake_logs = list(
        IntakeLog.objects.filter(user=request.user, date__gte=since)
        .order_by("date").values("date", "kcal")
    )

    profile, _ = Profile.objects.get_or_create(user=request.user)
    update_result = run_weekly_bayes_update(request.user.id)
    will_apply = not update_result.get("skipped") and update_result.get("days_used", 0) >= 7

    return Response({
        "status": {
            "will_apply_update": will_apply,
            "days_needed": 7,
            "days_with_intake": update_result.get("days_used", 0),
            "days_remaining": max(0, 7 - update_result.get("days_used", 0)),
            "skipped": update_result.get("skipped", True),
            "skip_reason": update_result.get("reason", None),
        },
        "algorithm_result": update_result,
        "current_targets": {
            "kcal": profile.kcal_target,
            "protein": profile.protein_g,
            "carbs": profile.carbs_g,
            "fat": profile.fat_g,
            "tdee_mu": profile.tdee_mu,
            "tdee_sigma": profile.tdee_sigma,
        },
        "raw_data": {
            "weight_logs_last_28d": [{"date": str(w["date"]), "weight_kg": float(w["weight_kg"])} for w in weight_logs],
            "intake_logs_last_28d": [{"date": str(i["date"]), "kcal": float(i["kcal"])} for i in intake_logs],
            "weight_log_count": len(weight_logs),
            "intake_log_count": len(intake_logs),
        },
    })


# ─────────────────────────────────────────
# Food DB Admin
# ─────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def food_admin_list(request):
    if not request.user.is_staff:
        return Response({"error": "Admin access required"}, status=403)
    from core.models import Food as FoodModel
    from django.db.models import Q, Count

    category = request.query_params.get("category", "")
    q        = (request.query_params.get("q") or "").strip()
    page     = max(1, int(request.query_params.get("page", 1)))
    per_page = 50

    qs = FoodModel.objects.all()
    if category:
        qs = qs.filter(category=category)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(brand__icontains=q))
    qs = qs.order_by("category", "name")

    total = qs.count()
    start = (page - 1) * per_page
    foods = qs[start:start + per_page]

    cats = list(FoodModel.objects.values("category").annotate(n=Count("id")).order_by("-n"))

    return Response({
        "total": total, "page": page, "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "categories": cats,
        "foods": [
            {"id": f.id, "name": f.name, "brand": f.brand or "", "category": f.category,
             "kcal": round(f.kcal_per_100g or 0, 1), "protein": round(f.protein_per_100g or 0, 1),
             "carbs": round(f.carbs_per_100g or 0, 1), "fat": round(f.fat_per_100g or 0, 1),
             "source": f.source or ""}
            for f in foods
        ],
    })


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def food_admin_delete(request, food_id):
    if not request.user.is_staff:
        return Response({"error": "Admin access required"}, status=403)
    from core.models import Food as FoodModel
    try:
        FoodModel.objects.get(id=food_id).delete()
    except FoodModel.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    return Response({"deleted": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def food_admin_bulk_delete(request):
    if not request.user.is_staff:
        return Response({"error": "Admin access required"}, status=403)
    from core.models import Food as FoodModel
    ids          = request.data.get("ids") or []
    category     = request.data.get("category")
    min_name_len = request.data.get("min_name_len")

    if ids:
        qs = FoodModel.objects.filter(id__in=ids)
    elif category:
        qs = FoodModel.objects.filter(category=category)
    elif min_name_len:
        qs = FoodModel.objects.filter(name__regex=r'.{' + str(int(min_name_len)) + r',}')
    else:
        return Response({"error": "Provide ids, category, or min_name_len"}, status=400)

    qs = qs.exclude(source__startswith="user:")
    n, _ = qs.delete()
    return Response({"deleted": n})