from django.contrib import admin
from django.urls import path, include
from core import views as core_views
from core.views_auth import register

urlpatterns = [
    path("admin/", admin.site.urls),

    path("accounts/", include("django.contrib.auth.urls")),
    path("accounts/register/", register, name="register"),

    path("", core_views.dashboard, name="dashboard"),
    path("planner/", core_views.planner, name="planner"),
    path("logs/", core_views.logs, name="logs"),
    path("profile/", core_views.profile, name="profile"),
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),

    path("api/", include("core.urls")),
]
