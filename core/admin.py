from django.contrib import admin
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured

def _register(model_name, admin_class):
    try:
        model = apps.get_model("core", model_name)
    except (LookupError, ImproperlyConfigured):
        # Model not ready or not defined yet – skip silently
        return
    if not model:
        return
    try:
        admin.site.register(model, admin_class)
    except admin.sites.AlreadyRegistered:
        pass

class FoodAdmin(admin.ModelAdmin):
    list_display = ("name","category","kcal_per_100g","protein_per_100g","carbs_per_100g","fat_per_100g","source")
    search_fields = ("name","category","brand")
    list_filter = ("source","data_type","category")

class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user","sex","age","height_cm","weight_kg","activity","goal","kcal_target")

class WeightLogAdmin(admin.ModelAdmin):
    list_display = ("user","date","weight_kg")
    list_filter = ("user",)

class IntakeLogAdmin(admin.ModelAdmin):
    list_display = ("user","date","kcal")
    list_filter = ("user",)

_register("Food", FoodAdmin)
_register("Profile", ProfileAdmin)
_register("WeightLog", WeightLogAdmin)
_register("IntakeLog", IntakeLogAdmin)
