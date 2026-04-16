"""
Delete all USDA-imported foods so you can do a clean reimport.
User-created foods (source starts with "user:") are always protected.

Usage:
    python manage.py reset_foods           # dry run
    python manage.py reset_foods --apply   # actually deletes
"""

from django.core.management.base import BaseCommand
from core.models import Food


class Command(BaseCommand):
    help = "Delete all non-user foods to allow a clean reimport"

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually delete. Without this flag it's a dry run."
        )

    def handle(self, *args, **options):
        apply = options["apply"]

        total = Food.objects.count()
        user_qs = Food.objects.filter(source__startswith="user:")
        user_count = user_qs.count()
        to_delete = Food.objects.exclude(source__startswith="user:")
        delete_count = to_delete.count()

        self.stdout.write(f"Total foods       : {total}")
        self.stdout.write(f"User-created foods: {user_count}  (protected)")
        self.stdout.write(f"Foods to delete   : {delete_count}")

        if not apply:
            self.stdout.write(self.style.WARNING(
                "\nDry run — pass --apply to actually delete."
            ))
            return

        deleted, _ = to_delete.delete()
        remaining = Food.objects.count()
        self.stdout.write(self.style.SUCCESS(
            f"\nDeleted {deleted} foods. {remaining} foods remaining (user-created)."
        ))
