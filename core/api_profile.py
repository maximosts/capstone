# core/api_profile.py
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Profile


def _profile_to_json(p: Profile):
    return {
        "sex": p.sex,
        "age": p.age,
        "height_cm": p.height_cm,
        "weight_kg": p.weight_kg,
        "activity": p.activity,
        "goal": p.goal,
        "targets": {
            "kcal": p.kcal_target,
            "protein": p.protein_g,
            "fat": p.fat_g,
            "carbs": p.carbs_g,
        },
    }


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def profile_view(request):
    p, _ = Profile.objects.get_or_create(
        user=request.user,
        defaults={
            "sex": "M",
            "age": 25,
            "height_cm": 175,
            "weight_kg": 75,
            "activity": "moderate",
            "goal": "recomp",
        },
    )

    if request.method == "GET":
        return Response(_profile_to_json(p), status=200)

    # PUT (update)
    data = request.data or {}

    # only update if provided
    if "sex" in data: p.sex = data["sex"]
    if "age" in data: p.age = int(data["age"])
    if "height_cm" in data: p.height_cm = float(data["height_cm"])
    if "weight_kg" in data: p.weight_kg = float(data["weight_kg"])
    if "activity" in data: p.activity = data["activity"]
    if "goal" in data: p.goal = data["goal"]

    targets = data.get("targets") or {}
    if "kcal" in targets: p.kcal_target = int(targets["kcal"])
    if "protein" in targets: p.protein_g = int(targets["protein"])
    if "fat" in targets: p.fat_g = int(targets["fat"])
    if "carbs" in targets: p.carbs_g = int(targets["carbs"])

    p.save()
    return Response(_profile_to_json(p), status=200)
