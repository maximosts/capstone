from django.conf import settings
from django.db import models
from django.contrib.auth.models import User


class Food(models.Model):
    name               = models.CharField(max_length=255)
    category           = models.CharField(max_length=255, blank=True, default="")
    brand              = models.CharField(max_length=255, blank=True, default="")
    fdc_id             = models.BigIntegerField(null=True, blank=True, unique=True)
    data_type          = models.CharField(max_length=64, blank=True, default="")
    kcal_per_100g      = models.FloatField(null=True, blank=True)
    protein_per_100g   = models.FloatField(null=True, blank=True)
    carbs_per_100g     = models.FloatField(null=True, blank=True)
    fat_per_100g       = models.FloatField(null=True, blank=True)
    sugars_per_100g    = models.FloatField(null=True, blank=True)
    fiber_per_100g     = models.FloatField(null=True, blank=True)
    sodium_mg_per_100g = models.FloatField(null=True, blank=True)
    lang               = models.CharField(max_length=8, default="en")
    # "user:{username}" for custom foods — protects them from reset_foods bulk deletion
    source             = models.CharField(max_length=64, default="USDA FDC")

    def __str__(self):
        return self.name


class Plan(models.Model):
    """Full generated meal plan stored as JSON for fast retrieval and flexible schema."""
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="plans")
    mode       = models.CharField(max_length=20, default="rule")
    payload    = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class PlanLog(models.Model):
    """Lightweight record of each plan generation event — used for the weekly summary stat."""
    user       = models.ForeignKey(User, on_delete=models.CASCADE)
    mode       = models.CharField(max_length=32, default="template", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Profile(models.Model):
    user      = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    sex       = models.CharField(max_length=1, choices=[('M', 'Male'), ('F', 'Female')])
    age       = models.PositiveIntegerField()
    height_cm = models.FloatField()
    weight_kg = models.FloatField()  # registration weight; current weight tracked via WeightLog

    activity = models.CharField(max_length=16, default="moderate")
    goal     = models.CharField(max_length=32, default="recomp")

    target_weight_kg = models.FloatField(null=True, blank=True)
    allergies        = models.TextField(blank=True, default="")
    exclusions       = models.TextField(blank=True, default="")

    kcal_target = models.IntegerField(null=True, blank=True)
    protein_g   = models.IntegerField(null=True, blank=True)
    fat_g       = models.IntegerField(null=True, blank=True)
    carbs_g     = models.IntegerField(null=True, blank=True)

    # Bayesian TDEE posterior — updated each time the user logs weight
    tdee_mu    = models.FloatField(null=True, blank=True)
    tdee_sigma = models.FloatField(null=True, blank=True)

    # Tracks the most recent Bayesian target adjustment for the dashboard card
    prev_kcal_target       = models.IntegerField(null=True, blank=True)
    last_kcal_delta        = models.IntegerField(null=True, blank=True)
    last_target_updated_at = models.DateTimeField(null=True, blank=True)

    coaching_plan  = models.CharField(max_length=32, blank=True, default="")
    coaching_since = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user} profile"


class WeightLog(models.Model):
    user      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    date      = models.DateField()
    weight_kg = models.FloatField()

    class Meta:
        unique_together = (("user", "date"),)
        ordering        = ["date"]


class IntakeLog(models.Model):
    """Daily calorie total synced from FoodEntry — feeds the Bayesian TDEE algorithm."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    date = models.DateField()
    kcal = models.FloatField()

    class Meta:
        unique_together = (("user", "date"),)
        ordering        = ["date"]


class FoodEntry(models.Model):
    """Individual food items logged by the user for daily calorie tracking."""
    user      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="food_entries")
    date      = models.DateField()
    food      = models.ForeignKey("Food", on_delete=models.CASCADE)
    grams     = models.FloatField()
    meal_slot = models.CharField(
        max_length=20, default="snack",
        choices=[("breakfast", "Breakfast"), ("lunch", "Lunch"), ("dinner", "Dinner"), ("snack", "Snack")],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date", "created_at"]

    # Macros are computed at read time so they always reflect the current food record
    @property
    def kcal(self):
        return round((self.food.kcal_per_100g or 0) * self.grams / 100, 1)

    @property
    def protein(self):
        return round((self.food.protein_per_100g or 0) * self.grams / 100, 1)

    @property
    def carbs(self):
        return round((self.food.carbs_per_100g or 0) * self.grams / 100, 1)

    @property
    def fat(self):
        return round((self.food.fat_per_100g or 0) * self.grams / 100, 1)


class Conversation(models.Model):
    """Stores both AI assistant and coaching chat threads. Coaching threads are
    distinguished by a title prefix of 'Coaching — ' and excluded from the AI list."""
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations")
    title      = models.CharField(max_length=200, default="New conversation")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.user} — {self.title}"


class ChatMessage(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages", null=True, blank=True)
    role         = models.CharField(max_length=16)  # "user", "assistant", or "coach"
    content      = models.TextField()
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
