# core/management/commands/seed_staples.py
from django.core.management.base import BaseCommand
from core.models import Food


STAPLES = [
    # Fats
    dict(name="Olive oil, extra virgin",         kcal_per_100g=884, protein_per_100g=0,   fat_per_100g=100,  carbs_per_100g=0,   category="Fats and Oils", source="seed"),
    dict(name="Coconut oil",                     kcal_per_100g=862, protein_per_100g=0,   fat_per_100g=100,  carbs_per_100g=0,   category="Fats and Oils", source="seed"),
    # Vegetables
    dict(name="Broccoli, raw",                   kcal_per_100g=34,  protein_per_100g=2.8, fat_per_100g=0.4,  carbs_per_100g=6.6, category="Vegetables",    source="seed"),
    dict(name="Spinach, raw",                    kcal_per_100g=23,  protein_per_100g=2.9, fat_per_100g=0.4,  carbs_per_100g=3.6, category="Vegetables",    source="seed"),
    dict(name="Zucchini, raw",                   kcal_per_100g=17,  protein_per_100g=1.2, fat_per_100g=0.3,  carbs_per_100g=3.1, category="Vegetables",    source="seed"),
    dict(name="Bell pepper, red, raw",           kcal_per_100g=31,  protein_per_100g=1.0, fat_per_100g=0.3,  carbs_per_100g=6.0, category="Vegetables",    source="seed"),
    dict(name="Carrots, raw",                    kcal_per_100g=41,  protein_per_100g=0.9, fat_per_100g=0.2,  carbs_per_100g=9.6, category="Vegetables",    source="seed"),
    dict(name="Asparagus, raw",                  kcal_per_100g=20,  protein_per_100g=2.2, fat_per_100g=0.1,  carbs_per_100g=3.9, category="Vegetables",    source="seed"),
    dict(name="Green beans, raw",                kcal_per_100g=31,  protein_per_100g=1.8, fat_per_100g=0.2,  carbs_per_100g=7.0, category="Vegetables",    source="seed"),
    # Fruits
    dict(name="Banana, raw",                     kcal_per_100g=89,  protein_per_100g=1.1, fat_per_100g=0.3,  carbs_per_100g=23,  category="Fruits",        source="seed"),
    dict(name="Apple, raw, with skin",           kcal_per_100g=52,  protein_per_100g=0.3, fat_per_100g=0.2,  carbs_per_100g=14,  category="Fruits",        source="seed"),
    dict(name="Strawberries, raw",               kcal_per_100g=32,  protein_per_100g=0.7, fat_per_100g=0.3,  carbs_per_100g=7.7, category="Fruits",        source="seed"),
    dict(name="Blueberries, raw",                kcal_per_100g=57,  protein_per_100g=0.7, fat_per_100g=0.3,  carbs_per_100g=14,  category="Fruits",        source="seed"),
    dict(name="Orange, raw",                     kcal_per_100g=47,  protein_per_100g=0.9, fat_per_100g=0.1,  carbs_per_100g=12,  category="Fruits",        source="seed"),
    dict(name="Mango, raw",                      kcal_per_100g=60,  protein_per_100g=0.8, fat_per_100g=0.4,  carbs_per_100g=15,  category="Fruits",        source="seed"),
]


class Command(BaseCommand):
    help = "Seed essential staple foods missing from USDA DB (olive oil, veg, fruit)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Preview without saving")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        created = 0
        skipped = 0
        for s in STAPLES:
            if Food.objects.filter(name=s["name"]).exists():
                self.stdout.write(f"  SKIP  {s['name']}")
                skipped += 1
            else:
                if not dry:
                    Food.objects.create(**s)
                self.stdout.write(self.style.SUCCESS(f"  ADD   {s['name']}"))
                created += 1

        self.stdout.write(f"\n{'[DRY RUN] ' if dry else ''}Done: {created} added, {skipped} already existed.")
