import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { RefreshCw, Download } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

type MealItem = { id: number; name: string; grams: number };
type Meal = { name: string; items: MealItem[] };
type Totals = { kcal: number; protein: number; fat: number; carbs: number };
type Targets = { kcal: number; protein: number; fat: number; carbs: number };

type PlanResponse = {
  meals: Meal[];
  totals_from_db: Totals;
  targets: Targets;
  note?: string;
};

type ProfileApiResponse = {
  sex: "M" | "F";
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: string;
  goal: string;
  allergies?: string;
  exclusions?: string;
  targets: {
    kcal: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
  };
};

// -----------------------
// Swap types + options
// -----------------------
type SwapSlot = "protein" | "carb";
type Swap = { meal: "Breakfast" | "Lunch" | "Dinner" | "Snack"; slot: SwapSlot; prefer: string };

// IMPORTANT: match your backend pickers:
// - protein: chicken/turkey/fish/seafood (and for breakfast/snack you can allow whey/yogurt)
// - carb: rice/potato/sweet potato/bagel (and breakfast carbs oats/bread)
const SWAP_OPTIONS = {
  protein: {
    Breakfast: [
      { value: "eggs", label: "Eggs" },
      { value: "dairy", label: "Greek Yogurt" },
      { value: "whey", label: "Whey" },
    ],
    Snack: [] as { value: string; label: string }[],
    Lunch: [
      { value: "chicken", label: "Chicken" },
      { value: "turkey", label: "Turkey" },
      { value: "fish", label: "Fish" },
      { value: "seafood", label: "Shrimp/Seafood" },
    ],
    Dinner: [
      { value: "chicken", label: "Chicken" },
      { value: "turkey", label: "Turkey" },
      { value: "fish", label: "Fish" },
      { value: "seafood", label: "Shrimp/Seafood" },
    ],
  },
  carb: {
    Breakfast: [
      { value: "oats", label: "Oats" },
      { value: "bread", label: "Bread/Wrap" },
      { value: "bagel", label: "Bagel" },
    ],
    Lunch: [
      { value: "rice", label: "Rice" },
      { value: "potato", label: "Potato" },
      { value: "sweet potato", label: "Sweet Potato" },
      { value: "bagel", label: "Bagel" },
    ],
    Dinner: [
      { value: "rice", label: "Rice" },
      { value: "potato", label: "Potato" },
      { value: "sweet potato", label: "Sweet Potato" },
      { value: "bagel", label: "Bagel" },
    ],
    Snack: [
      { value: "fruit", label: "Fruit" }, // backend doesn't have carb slot for snack swaps, but harmless if ignored
      { value: "bread", label: "Bread/Wrap" },
      { value: "oats", label: "Oats" },
    ],
  },
} as const;

function safeNumber(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function parseCommaList(s?: string): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// -----------------------
// Swap helpers
// -----------------------
function getSwap(swaps: Swap[], meal: Swap["meal"], slot: SwapSlot): Swap | undefined {
  return swaps.find((s) => s.meal === meal && s.slot === slot);
}

function upsertSwap(swaps: Swap[], next: Swap): Swap[] {
  const idx = swaps.findIndex((s) => s.meal === next.meal && s.slot === next.slot);
  if (idx === -1) return [...swaps, next];
  const copy = swaps.slice();
  copy[idx] = next;
  return copy;
}

function removeSwap(swaps: Swap[], meal: Swap["meal"], slot: SwapSlot): Swap[] {
  return swaps.filter((s) => !(s.meal === meal && s.slot === slot));
}

// -----------------------
// UI: Meal card with swaps
// -----------------------
function MealCard({
  title,
  items,
  swaps,
  setSwaps,
}: {
  title: Swap["meal"];
  items: MealItem[];
  swaps: Swap[];
  setSwaps: React.Dispatch<React.SetStateAction<Swap[]>>;
}) {
  const proteinSwap = getSwap(swaps, title, "protein")?.prefer ?? "";
  const carbSwap = getSwap(swaps, title, "carb")?.prefer ?? "";

  const proteinOptions = SWAP_OPTIONS.protein[title] ?? [];
  const carbOptions = SWAP_OPTIONS.carb[title] ?? [];

  const showProtein = proteinOptions.length > 0 && title !== "Snack";
  const showCarb = carbOptions.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">{title}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {items.length} items
            </Badge>
          </div>

          {/* Swap controls */}
          <div className="flex flex-wrap gap-2 items-center">
            {showProtein && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden sm:inline">Protein</span>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm min-w-0 max-w-[130px]"
                  value={proteinSwap}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSwaps((prev) => {
                      if (!v) return removeSwap(prev, title, "protein");
                      return upsertSwap(prev, { meal: title, slot: "protein", prefer: v });
                    });
                  }}
                >
                  <option value="">Auto</option>
                  {proteinOptions.map((o) => (
                    <option key={`p-${title}-${o.value}`} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showCarb && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden sm:inline">Carb</span>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={carbSwap}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSwaps((prev) => {
                      if (!v) return removeSwap(prev, title, "carb");
                      return upsertSwap(prev, { meal: title, slot: "carb", prefer: v });
                    });
                  }}
                >
                  <option value="">Auto</option>
                  {carbOptions.map((o) => (
                    <option key={`c-${title}-${o.value}`} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {(proteinSwap || carbSwap) && (
          <p className="text-xs text-muted-foreground mt-2">
            Swaps:{" "}
            {proteinSwap ? <span className="font-medium">protein={proteinSwap}</span> : null}
            {proteinSwap && carbSwap ? <span> • </span> : null}
            {carbSwap ? <span className="font-medium">carb={carbSwap}</span> : null}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={`${title}-${it.id}`}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex-1">
                  <span className="text-sm font-medium">{it.name}</span>
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">{it.grams}g</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PLAN_STORAGE_KEY = "anms_last_meal_plan";

export function MealPlanner() {
  const [plan, setPlan] = useState<PlanResponse | null>(() => {
    try {
      const saved = sessionStorage.getItem(PLAN_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileApiResponse | null>(null);

  // Clear cached plan if it contains allergens from current profile
  useEffect(() => {
    if (!plan || !profile) return;
    const allergyTerms = [
      ...parseCommaList(profile.allergies),
      ...parseCommaList(profile.exclusions),
    ].map(t => t.toLowerCase());
    if (allergyTerms.length === 0) return;
    const hasAllergen = plan.meals.some(m =>
      m.items.some(it => allergyTerms.some(t => it.name.toLowerCase().includes(t)))
    );
    if (hasAllergen) {
      setPlan(null);
      sessionStorage.removeItem(PLAN_STORAGE_KEY);
    }
  }, [profile]);

  // ✅ NEW: swaps state
  const [swaps, setSwaps] = useState<Swap[]>([]);

  const totals = plan?.totals_from_db;
  const targets = plan?.targets;

  const progress = useMemo(() => {
    if (!totals || !targets) return null;

    const kcalPct = (safeNumber(totals.kcal) / Math.max(1, safeNumber(targets.kcal))) * 100;
    const pPct = (safeNumber(totals.protein) / Math.max(1, safeNumber(targets.protein))) * 100;
    const cPct = (safeNumber(totals.carbs) / Math.max(1, safeNumber(targets.carbs))) * 100;
    const fPct = (safeNumber(totals.fat) / Math.max(1, safeNumber(targets.fat))) * 100;

    return { kcalPct, pPct, cPct, fPct };
  }, [totals, targets]);

  const mealsByName = useMemo(() => {
    const map = new Map<string, MealItem[]>();
    (plan?.meals || []).forEach((m) => map.set(m.name, m.items || []));
    return map;
  }, [plan]);

  const loadProfile = async () => {
    try {
      await ensureCsrf();
      const res = (await apiFetch("/api/profile/")) as ProfileApiResponse;
      setProfile(res);
    } catch (e: any) {
      setProfile(null);
      setErr(e?.detail || "Failed to load profile (are you logged in?)");
    } finally {
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setErr(null);

    try {
      if (!profile) {
        await loadProfile();
      }
      if (!profile) {
        throw { detail: "No profile loaded. Please login again." };
      }

      await ensureCsrf();

      const restrictions = {
        allergies: parseCommaList(profile.allergies),
        exclude: parseCommaList(profile.exclusions),
        // ✅ NEW: send swaps to backend
        swaps: swaps.map((s) => ({ meal: s.meal, slot: s.slot, prefer: s.prefer })),
      };

      const profilePayload = {
        sex: profile.sex,
        age: profile.age,
        height_cm: profile.height_cm,
        weight_kg: profile.weight_kg,
        activity: profile.activity,
        goal: profile.goal,
      };

      const res = await apiFetch("/api/generate-plan/", {
        method: "POST",
        body: JSON.stringify({
          mode: "rule",
          profile: profilePayload,
          restrictions,
        }),
      });

      setPlan(res as PlanResponse);
      try { sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(res)); } catch {}


    } catch (e: any) {
      const msg = e?.detail || e?.error || "Failed to generate plan";

      if (
        String(msg).toLowerCase().includes("authentication credentials") ||
        String(msg).toLowerCase().includes("not authenticated") ||
        String(msg).toLowerCase().includes("csrf") ||
        String(msg).toLowerCase().includes("forbidden")
      ) {
        setErr(
          `${msg}\n\nIf you are logged in, this is usually CSRF/session cookie not being sent. (If it happens, paste the network error.)`
        );
      } else {
        setErr(msg);
      }

      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPdf = () => {
    if (!plan) return;
    window.print();
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="mb-1">Meal Planner</h2>
        <p className="text-muted-foreground text-sm">
          Generate a personalised daily meal plan based on your calorie target
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button className="gap-2 flex-1 sm:flex-none" onClick={handleGenerate} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Generating..." : "Generate Plan"}
        </Button>
        <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={handleExportPdf} disabled={!plan}>
          <Download className="w-4 h-4" />
          Export PDF
        </Button>
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setSwaps([])} disabled={swaps.length === 0}>
          Clear swaps
        </Button>
      </div>


      {err && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="py-4">
            <p className="text-sm whitespace-pre-line text-destructive">{err}</p>
          </CardContent>
        </Card>
      )}



      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Meal Cards */}
        <div className="lg:col-span-2 space-y-4">
          <MealCard title="Breakfast" items={mealsByName.get("Breakfast") || []} swaps={swaps} setSwaps={setSwaps} />
          <MealCard title="Lunch" items={mealsByName.get("Lunch") || []} swaps={swaps} setSwaps={setSwaps} />
          <MealCard title="Dinner" items={mealsByName.get("Dinner") || []} swaps={swaps} setSwaps={setSwaps} />
          {(mealsByName.get("Snack")?.length || 0) > 0 && (
            <MealCard title="Snack" items={mealsByName.get("Snack") || []} swaps={swaps} setSwaps={setSwaps} />
          )}
        </div>

        {/* Totals Sidebar */}
        <div className="lg:col-span-1">
          <Card className="sticky top-8">
            <CardHeader>
              <CardTitle>Daily Totals</CardTitle>
            </CardHeader>

            <CardContent className="space-y-6">
              {!plan ? (
                <p className="text-sm text-muted-foreground">No plan loaded.</p>
              ) : (
                <>
                  {/* Calories */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Total Calories</span>
                      <span>
                        <span className="font-semibold text-lg">{Math.round(totals!.kcal)}</span>
                        <span className="text-muted-foreground text-sm"> / {targets!.kcal}</span>
                      </span>
                    </div>
                    <Progress value={progress?.kcalPct ?? 0} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.round(targets!.kcal - totals!.kcal)} kcal remaining
                    </p>
                  </div>

                  {/* Macros */}
                  <div className="pt-4 border-t space-y-4">
                    <div>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Protein</span>
                        <span className="text-sm">
                          <span className="font-medium">{totals!.protein.toFixed(1)}g</span>
                          <span className="text-muted-foreground"> / {targets!.protein}g</span>
                        </span>
                      </div>
                      <Progress value={progress?.pPct ?? 0} className="h-1.5" />
                    </div>

                    <div>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Carbohydrates</span>
                        <span className="text-sm">
                          <span className="font-medium">{totals!.carbs.toFixed(1)}g</span>
                          <span className="text-muted-foreground"> / {targets!.carbs}g</span>
                        </span>
                      </div>
                      <Progress value={progress?.cPct ?? 0} className="h-1.5" />
                    </div>

                    <div>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Fat</span>
                        <span className="text-sm">
                          <span className="font-medium">{totals!.fat.toFixed(1)}g</span>
                          <span className="text-muted-foreground"> / {targets!.fat}g</span>
                        </span>
                      </div>
                      <Progress value={progress?.fPct ?? 0} className="h-1.5" />
                    </div>
                  </div>

                  {plan.note && (
                    <div className="pt-4 border-t">
                      <p className="text-xs text-muted-foreground">Note: {plan.note}</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}