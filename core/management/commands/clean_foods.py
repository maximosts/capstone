"""
python manage.py clean_foods            # dry run — shows what would be deleted
python manage.py clean_foods --apply    # actually deletes
python manage.py clean_foods --apply --keep-categories "Baby Foods"  # override

What it removes:
  1. Junk categories  (Baby Foods, American Indian/Alaska Native Foods, Survey (FNDDS))
  2. Hyper-specific SR Legacy entries with very long names (> 80 chars) in already-large categories
  3. Near-duplicate names in the same category (keeps shortest/simplest name)
"""

from django.core.management.base import BaseCommand
from django.db.models import Count
from core.models import Food


# Categories to drop entirely — useless for a meal planner
TRASH_CATEGORIES = {
    "Baby Foods",
    "American Indian/Alaska Native Foods",
    "Survey (FNDDS)",               # duplicates of other categories
}

# Categories where we'll prune long-name duplicates aggressively
PRUNE_CATEGORIES = {
    "Beef Products",
    "Lamb, Veal, and Game Products",
    "Pork Products",
    "Poultry Products",
    "Finfish and Shellfish Products",
    "Sausages and Luncheon Meats",
}


class Command(BaseCommand):
    help = "Clean junk and near-duplicate entries from the food database"

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually delete. Without this flag it's a dry run."
        )
        parser.add_argument(
            "--max-name-len", type=int, default=80,
            help="In prunable categories, delete entries whose name exceeds this length (default 80)."
        )

    def handle(self, *args, **options):
        apply    = options["apply"]
        max_len  = options["max_name_len"]
        dry      = not apply

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — pass --apply to delete for real\n"))

        total_before = Food.objects.count()
        to_delete_ids = set()

        # ── Step 1: Trash categories ────────────────────────────────────
        self.stdout.write("Step 1: Trash categories")
        for cat in sorted(TRASH_CATEGORIES):
            qs = Food.objects.filter(category=cat)
            n  = qs.count()
            self.stdout.write(f"  [{n:5}]  {cat}")
            to_delete_ids.update(qs.values_list("id", flat=True))

        # ── Step 2: Long-name hyper-specific entries in meat categories ─
        self.stdout.write("\nStep 2: Hyper-specific long-name entries in meat/fish categories")
        for cat in sorted(PRUNE_CATEGORIES):
            qs = Food.objects.filter(category=cat, name__regex=r'.{' + str(max_len) + r',}')
            n  = qs.count()
            self.stdout.write(f"  [{n:5}]  {cat}")
            to_delete_ids.update(qs.values_list("id", flat=True))

        # ── Step 3: Near-duplicates (same first 40 chars, same category) ─
        # Keep the entry with the shortest name; delete the rest
        self.stdout.write("\nStep 3: Near-duplicate names (same category, same 40-char prefix)")
        dup_count = 0
        seen: dict[tuple, int] = {}   # (category, prefix40) -> keep_id

        all_foods = Food.objects.exclude(id__in=to_delete_ids).values("id", "name", "category").order_by("category", "name")
        for row in all_foods:
            key = (row["category"], row["name"][:40].lower())
            if key in seen:
                to_delete_ids.add(row["id"])
                dup_count += 1
            else:
                seen[key] = row["id"]

        self.stdout.write(f"  [{dup_count:5}]  near-duplicates across all categories")

        # ── Step 4: User-created foods — never delete ───────────────────
        user_foods = Food.objects.filter(source__startswith="user:").values_list("id", flat=True)
        protected  = set(user_foods)
        to_delete_ids -= protected
        if protected:
            self.stdout.write(f"\n  Protected {len(protected)} user-created foods from deletion")

        # ── Summary ─────────────────────────────────────────────────────
        self.stdout.write(f"\n{'─'*50}")
        self.stdout.write(f"  Total foods before : {total_before}")
        self.stdout.write(f"  Would delete       : {len(to_delete_ids)}")
        self.stdout.write(f"  Would keep         : {total_before - len(to_delete_ids)}")
        self.stdout.write(f"{'─'*50}")

        if dry:
            self.stdout.write(self.style.WARNING("\nDry run complete. Run with --apply to delete."))
            return

        # Delete in batches
        self.stdout.write("\nDeleting…")
        id_list    = list(to_delete_ids)
        batch_size = 500
        deleted    = 0
        for i in range(0, len(id_list), batch_size):
            n, _ = Food.objects.filter(id__in=id_list[i:i + batch_size]).delete()
            deleted += n

        total_after = Food.objects.count()
        self.stdout.write(self.style.SUCCESS(
            f"\nDone! Deleted {deleted} entries. Database now has {total_after} foods."
        ))
