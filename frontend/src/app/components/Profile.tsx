import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";

import { apiFetch, ensureCsrf } from "../../lib/api";

const COACHING_PLAN_LABELS: Record<string, { name: string; price: string; color: string }> = {
  starter: { name: "Starter",  price: "€29/mo", color: "#3b82f6" },
  pro:     { name: "Pro",      price: "€59/mo", color: "#8b5cf6" },
  elite:   { name: "Elite",    price: "€99/mo", color: "#f59e0b" },
};

type Sex = "M" | "F";
type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";

type LatestWeight = { date: string; weight_kg: number } | null;

type ProfileResponse = {
  email: string;
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;          // registration weight (read-only)
  latest_weight: LatestWeight; // most recent weight log
  activity: Activity;
  goal: string;
  allergies: string;
  exclusions: string;
  targets: {
    kcal: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
  };
};

const GOAL_LABELS: Record<string, string> = {
  cut: "Cut — lose body fat",
  bulk: "Bulk — gain muscle & weight",
  recomp: "Recomp — build muscle, lose fat",
  maintenance: "Maintenance — stay at current weight",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  active: "Active",
  very_active: "Very Active",
};

export function Profile() {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Read-only body stats from server
  const [bodyStats, setBodyStats] = useState({
    email: "",
    sex: "M" as Sex,
    age: 0,
    height_cm: 0,
    weight_kg: 0,
    latest_weight: null as LatestWeight,
  });

  // Editable settings
  const [settings, setSettings] = useState({
    activity: "moderate" as Activity,
    goal: "recomp",
    allergies: "",
    exclusions: "",
    age: 0,
    height_cm: 0,
  });

  // Pending edits (what user has typed but not yet saved)
  const [draft, setDraft] = useState({ ...settings });

  const [targets, setTargets] = useState({
    kcal: null as number | null,
    protein: null as number | null,
    carbs: null as number | null,
    fat: null as number | null,
  });

  // Coaching plan
  const [coachingPlan, setCoachingPlan] = useState("");

  // Goal change warning dialog
  const [showGoalWarning, setShowGoalWarning] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);

  // BMI uses latest logged weight if available, else registration weight
  const bmi = useMemo(() => {
    const h = bodyStats.height_cm;
    const w = bodyStats.latest_weight?.weight_kg ?? bodyStats.weight_kg;
    if (!h || !w) return null;
    const m = h / 100;
    return w / (m * m);
  }, [bodyStats]);

  const bmiLabel = useMemo(() => {
    if (bmi == null) return { text: "—", color: "text-muted-foreground" };
    if (bmi < 18.5) return { text: "Underweight", color: "text-blue-600" };
    if (bmi < 25)   return { text: "Normal", color: "text-green-600" };
    if (bmi < 30)   return { text: "Overweight", color: "text-orange-600" };
    return           { text: "Obese", color: "text-red-600" };
  }, [bmi]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      await ensureCsrf();
      const res = (await apiFetch("/api/profile/")) as ProfileResponse;

      setBodyStats({
        email: res.email ?? "",
        sex: res.sex ?? "M",
        age: res.age ?? 0,
        height_cm: res.height_cm ?? 0,
        weight_kg: res.weight_kg ?? 0,
        latest_weight: res.latest_weight ?? null,
      });

      const s = {
        activity: (res.activity ?? "moderate") as Activity,
        goal: res.goal ?? "recomp",
        allergies: res.allergies ?? "",
        exclusions: res.exclusions ?? "",
        age: res.age ?? 0,
        height_cm: res.height_cm ?? 0,
      };
      setSettings(s);
      setDraft(s);

      setTargets({
        kcal: res.targets?.kcal ?? null,
        protein: res.targets?.protein ?? null,
        fat: res.targets?.fat ?? null,
        carbs: res.targets?.carbs ?? null,
      });

      // Load coaching status
      try {
        const cr = await apiFetch("/api/coaching/status/") as { plan: string };
        setCoachingPlan(cr.plan || "");
      } catch {}

    } catch (e: any) {
      alert(e?.detail || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goalChanged = draft.goal !== settings.goal;

  const handleSaveClick = () => {
    // If goal is being changed, show warning first
    if (goalChanged) {
      setShowGoalWarning(true);
    } else {
      doSave();
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await ensureCsrf();
      await apiFetch("/api/profile/", {
        method: "PUT",
        body: JSON.stringify({
          activity: draft.activity,
          goal: draft.goal,
          allergies: draft.allergies,
          exclusions: draft.exclusions,
          age: draft.age,
          height_cm: draft.height_cm,
        }),
      });
      setIsEditing(false);
      await loadProfile();
    } catch (e: any) {
      alert(e?.detail || "Failed to save profile");
    } finally {
      setSaving(false);
      setPendingSave(false);
    }
  };

  const handleCancel = () => {
    setDraft({ ...settings });
    setIsEditing(false);
  };

  const currentWeight = bodyStats.latest_weight?.weight_kg ?? bodyStats.weight_kg;

  return (
    <div className="space-y-6">

      {/* Goal change warning dialog */}
      {showGoalWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowGoalWarning(false)} />
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <h3 className="text-base font-semibold">⚠️ Changing your goal resets the algorithm</h3>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Switching from <strong className="text-foreground">{GOAL_LABELS[settings.goal] ?? settings.goal}</strong> to{" "}
                <strong className="text-foreground">{GOAL_LABELS[draft.goal] ?? draft.goal}</strong> will:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Reset the Bayesian TDEE estimate back to a formula-based calculation</li>
                <li>Immediately recalculate your calorie and macro targets</li>
                <li>Take 2–4 weeks of weight logging to re-learn your true TDEE</li>
              </ul>
              <p>Are you sure you want to continue?</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowGoalWarning(false)}>
                Cancel
              </Button>
              <Button
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={() => { setShowGoalWarning(false); doSave(); }}
              >
                Yes, change goal
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="mb-1">Profile</h2>
          <p className="text-muted-foreground text-sm">
            Manage your nutrition goals and dietary preferences
          </p>
        </div>

        {!isEditing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadProfile} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button onClick={() => setIsEditing(true)}>Edit Settings</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* ── Body Stats (always read-only) ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Body Stats</CardTitle>
                <Badge variant="secondary" className="text-xs">Mostly locked</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <strong>Note:</strong> Sex and weight are locked after registration — weight is tracked automatically via Logs.
                You can update age and height, but doing so will reset your TDEE estimate and recalculate your targets.
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={bodyStats.email} disabled />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">
                    Age
                    {isEditing && draft.age !== settings.age && (
                      <span className="ml-1 text-xs text-amber-600 font-normal">⚠️ will reset TDEE</span>
                    )}
                  </Label>
                  <Input
                    id="age"
                    type="number"
                    min={10}
                    max={120}
                    value={isEditing ? draft.age : bodyStats.age}
                    onChange={(e) => setDraft((p) => ({ ...p, age: Number(e.target.value) }))}
                    disabled={!isEditing}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sex</Label>
                  <Input value={bodyStats.sex === "M" ? "Male" : "Female"} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height_cm">
                    Height (cm)
                    {isEditing && draft.height_cm !== settings.height_cm && (
                      <span className="ml-1 text-xs text-amber-600 font-normal">⚠️ will reset TDEE</span>
                    )}
                  </Label>
                  <Input
                    id="height_cm"
                    type="number"
                    min={120}
                    max={230}
                    value={isEditing ? draft.height_cm : bodyStats.height_cm}
                    onChange={(e) => setDraft((p) => ({ ...p, height_cm: Number(e.target.value) }))}
                    disabled={!isEditing}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Registration Weight (kg)</Label>
                  <Input value={bodyStats.weight_kg || "—"} disabled />
                </div>
                <div className="space-y-2">
                  <Label>
                    Latest Logged Weight
                    {bodyStats.latest_weight && (
                      <span className="text-xs text-muted-foreground ml-2 font-normal">
                        {bodyStats.latest_weight.date}
                      </span>
                    )}
                  </Label>
                  <Input
                    value={
                      bodyStats.latest_weight
                        ? `${bodyStats.latest_weight.weight_kg} kg`
                        : "No logs yet"
                    }
                    disabled
                    className={bodyStats.latest_weight ? "font-medium" : "text-muted-foreground"}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Editable Settings ── */}
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="activity">Activity Level</Label>
                  <Select
                    value={draft.activity}
                    onValueChange={(v) => setDraft((p) => ({ ...p, activity: v as Activity }))}
                    disabled={!isEditing}
                  >
                    <SelectTrigger id="activity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sedentary">Sedentary</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="very_active">Very Active</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="goal">
                    Goal
                    {isEditing && goalChanged && (
                      <span className="ml-2 text-xs text-orange-600 font-normal">
                        ⚠️ Will reset algorithm
                      </span>
                    )}
                  </Label>
                  <Select
                    value={draft.goal}
                    onValueChange={(v) => setDraft((p) => ({ ...p, goal: v }))}
                    disabled={!isEditing}
                  >
                    <SelectTrigger id="goal">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cut">Cut — lose body fat</SelectItem>
                      <SelectItem value="bulk">Bulk — gain muscle & weight</SelectItem>
                      <SelectItem value="recomp">Recomp — build muscle, lose fat</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                  {isEditing && goalChanged && (
                    <p className="text-xs text-orange-600">
                      Changing your goal will reset the Bayesian TDEE estimate. You'll be asked to confirm before saving.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Dietary Preferences ── */}
          <Card>
            <CardHeader>
              <CardTitle>Dietary Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="allergies">Allergies</Label>
                <Textarea
                  id="allergies"
                  placeholder="e.g., peanuts, shellfish, tree nuts"
                  value={draft.allergies}
                  onChange={(e) => setDraft((p) => ({ ...p, allergies: e.target.value }))}
                  disabled={!isEditing}
                  rows={3}
                  className="max-h-36 overflow-y-auto resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated. These foods will never appear in your meal plans.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="exclusions">Food Exclusions</Label>
                <Textarea
                  id="exclusions"
                  placeholder="e.g., dairy, gluten, red meat"
                  value={draft.exclusions}
                  onChange={(e) => setDraft((p) => ({ ...p, exclusions: e.target.value }))}
                  disabled={!isEditing}
                  rows={3}
                  className="max-h-36 overflow-y-auto resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Foods you prefer to avoid (not allergies).
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Sidebar ── */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="sticky top-8">
            <CardHeader>
              <CardTitle>Current Targets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Daily Calories</span>
                  <span className="font-semibold">{targets.kcal != null ? `${targets.kcal} kcal` : "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Protein</span>
                  <span className="font-semibold">{targets.protein != null ? `${targets.protein}g` : "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Carbohydrates</span>
                  <span className="font-semibold">{targets.carbs != null ? `${targets.carbs}g` : "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Fat</span>
                  <span className="font-semibold">{targets.fat != null ? `${targets.fat}g` : "—"}</span>
                </div>
              </div>

              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">BMI</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-2xl">{bmi ? bmi.toFixed(1) : "—"}</span>
                  <span className={`text-sm font-medium ${bmiLabel.color}`}>{bmiLabel.text}</span>
                </div>
                {bodyStats.latest_weight && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Based on latest logged weight ({bodyStats.latest_weight.weight_kg} kg)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Current Goal</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium text-sm">
                {GOAL_LABELS[settings.goal] ?? settings.goal}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Activity: {ACTIVITY_LABELS[settings.activity] ?? settings.activity}
              </p>
              {(settings.allergies || settings.exclusions) && (
                <div className="mt-3 pt-3 border-t space-y-1">
                  {settings.allergies && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Allergies:</span> {settings.allergies}
                    </p>
                  )}
                  {settings.exclusions && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Exclusions:</span> {settings.exclusions}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Coaching Plan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Coaching Plan</CardTitle>
            </CardHeader>
            <CardContent>
              {coachingPlan && COACHING_PLAN_LABELS[coachingPlan] ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
                      style={{ background: COACHING_PLAN_LABELS[coachingPlan].color }}
                    >
                      {COACHING_PLAN_LABELS[coachingPlan].name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {COACHING_PLAN_LABELS[coachingPlan].price}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Active — go to Coaching to message your coach.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">No coaching plan active.</p>
                  <button
                    className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                    onClick={() => {
                      // trigger navigation — Profile doesn't have onNavigate so we use window event
                      window.dispatchEvent(new CustomEvent("navigate", { detail: "coaching" }));
                    }}
                  >
                    View plans →
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}