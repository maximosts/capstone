# core/api_auth.py
from datetime import date

from django.contrib.auth import authenticate, login as dj_login, logout as dj_logout
from django.contrib.auth.models import User
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import Profile, WeightLog


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf(request):
    token = get_token(request)
    return Response({"detail": "CSRF cookie set", "csrfToken": token})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    u = request.user
    return Response({"id": u.id, "username": u.username, "email": u.email, "is_staff": u.is_staff})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    email = (request.data.get("email") or "").strip()
    password = request.data.get("password") or ""

    user = authenticate(request, username=email, password=password)
    if not user:
        return Response({"detail": "Invalid credentials"}, status=400)

    dj_login(request, user)
    return Response({"detail": "ok"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    dj_logout(request)
    return Response({"detail": "ok"})


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    email      = (request.data.get("email") or "").strip()
    password   = request.data.get("password") or ""
    age        = request.data.get("age")
    sex        = request.data.get("sex")           # "M" or "F"
    activity   = request.data.get("activityLevel")
    height_cm  = request.data.get("height_cm")
    weight_kg  = request.data.get("weight_kg")
    goal       = request.data.get("goal") or "recomp"

    # Allergies/exclusions accepted as comma-separated strings or lists
    def _to_csv(val):
        if not val:
            return ""
        if isinstance(val, list):
            return ",".join(str(v).strip() for v in val if v)
        return str(val).strip()

    allergies  = _to_csv(request.data.get("allergies"))
    exclusions = _to_csv(request.data.get("exclusions"))

    if not email or not password:
        return Response({"detail": "Email and password required"}, status=400)

    if User.objects.filter(username=email).exists():
        return Response({"detail": "User already exists"}, status=400)

    user = User.objects.create_user(username=email, email=email, password=password)

    weight = float(weight_kg) if weight_kg else 75.0

    Profile.objects.get_or_create(
        user=user,
        defaults={
            "age":        int(age) if age else 25,
            "sex":        sex if sex in ("M", "F") else "M",
            "activity":   activity or "moderate",
            "height_cm":  float(height_cm) if height_cm else 175.0,
            "weight_kg":  weight,
            "goal":       goal if goal in ("cut", "bulk", "recomp", "maintenance") else "recomp",
            "allergies":  allergies,
            "exclusions": exclusions,
        },
    )

    # Seed the first weight log so Bayesian updates have a starting point
    WeightLog.objects.get_or_create(
        user=user, date=date.today(), defaults={"weight_kg": weight}
    )

    dj_login(request, user)
    return Response({"detail": "ok"})