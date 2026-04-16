# core/services/bayes.py
"""
Minimal Bayesian-ish weekly updater.
- Computes a rough TDEE update from the last ~4 weeks of logs.
- Safe to import during Django checks (ORM imports happen inside functions).
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Dict, Any
import math
from datetime import timedelta, datetime


KG_PER_LB = 0.45359237
KCAL_PER_KG = 7700.0  # rough rule-of-thumb


@dataclass
class Posterior:
    mean: float
    sd: float


def _safe_avg(nums):
    nums = [x for x in nums if x is not None]
    return sum(nums) / len(nums) if nums else None


def _weight_trend_kg_per_day(weights) -> Optional[float]:
    """
    Very simple slope: (last - first) / days
    weights: list[(date, kg)] sorted by date
    """
    if len(weights) < 2:
        return None
    weights = sorted(weights, key=lambda x: x[0])
    d_days = (weights[-1][0] - weights[0][0]).days or 1
    delta_kg = (weights[-1][1] - weights[0][1])
    return delta_kg / d_days


def run_weekly_bayes_update(user_id: int) -> Dict[str, Any]:
    """
    Returns a dict you can store on Profile like:
      {"tdee_mean": ..., "tdee_sd": ..., "updated_at": "..."}
    If not enough data, returns {"skipped": True, "reason": "..."}.
    """
    # Import ORM objects here to avoid AppRegistryNotReady during Django checks
    from core.models import Profile, WeightLog, IntakeLog

    profile = Profile.objects.filter(user_id=user_id).first()
    if not profile:
        return {"skipped": True, "reason": "no profile"}

    # Pull last 28 days
    since = datetime.utcnow() - timedelta(days=28)
    wlogs = (
        WeightLog.objects.filter(user_id=user_id, date__gte=since.date())
        .order_by("date")
        .values_list("date", "weight_kg")
    )
    ilogs = (
        IntakeLog.objects.filter(user_id=user_id, date__gte=since.date())
        .order_by("date")
        .values_list("date", "kcal")
    )

    if not wlogs or not ilogs:
        return {"skipped": True, "reason": "not enough logs"}

    # Average daily intake over the period
    daily_intake = [k for (_d, k) in ilogs if k is not None]
    avg_intake = _safe_avg(daily_intake)
    if avg_intake is None:
        return {"skipped": True, "reason": "no kcal in intake logs"}

    # Weight slope (kg/day)
    slope = _weight_trend_kg_per_day(list(wlogs))
    if slope is None:
        return {"skipped": True, "reason": "not enough weight points"}

    # Energy balance equation (approx):
    #   TDEE ≈ AvgIntake - (Δkg/day * 7700 kcal/kg)
    # If weight is going DOWN (negative slope), TDEE > intake; vice versa.
    tdee_point = avg_intake - (slope * KCAL_PER_KG)

    # Super simple uncertainty: wider if fewer data points
    n_days = max(1, len(set(d for (d, _) in ilogs)))
    sd = max(80.0, 400.0 / math.sqrt(n_days))  # arbitrary but reasonable scale

    post = Posterior(mean=float(round(tdee_point, 1)), sd=float(round(sd, 1)))

    # Optionally, write back to profile here (commented so function is side-effect free)
    # profile.tdee_mean = post.mean
    # profile.tdee_sd = post.sd
    # profile.save(update_fields=["tdee_mean", "tdee_sd"])

    return {
        "tdee_mean": post.mean,
        "tdee_sd": post.sd,
        "days_used": n_days,
        "avg_intake": round(avg_intake, 1),
        "slope_kg_per_day": round(slope, 4),
        "skipped": False,
    }
