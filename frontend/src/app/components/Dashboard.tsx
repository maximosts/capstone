import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  TrendingDown, TrendingUp, Activity, Utensils, Scale,
  CheckCircle2, Circle, ChevronRight, ChevronDown, Flame, Beef, Wheat, Droplets,
} from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

interface DashboardProps {
  onNavigate: (page: string) => void;
}

type WeightPoint      = { date: string; weight_kg: number };
type WeightLog        = { id: number; date: string; weight_kg: number };
type IntakeLog        = { id: number; date: string; kcal: number };
type WeeklySummary    = { avg_daily_kcal: number | null; weight_change_kg: number | null; plans_generated: number };
type LatestAdjustment = { previous_target: number | null; new_target: number | null; delta: number | null; updated_at: string | null };
type TodayIntake      = { kcal: number; protein: number; carbs: number; fat: number };
type Targets          = { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

type DashboardResponse = {
  weight_progress_14d:       WeightPoint[];
  weekly_summary:            WeeklySummary;
  latest_calorie_adjustment: LatestAdjustment;
  today_intake:              TodayIntake;
  targets:                   Targets;
  profile?:                  { goal: string; weight_kg: number; height_cm: number; tdee_mu: number | null };
};

function formatShortDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function formatLongDateTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
function goalLabel(goal: string) {
  return { cut: "Weight Loss", bulk: "Muscle Gain", recomp: "Body Recomposition", maintenance: "Maintenance" }[goal] ?? goal;
}
function goalColor(goal: string) {
  return { cut: "#3b82f6", bulk: "#22c55e", recomp: "#f59e0b", maintenance: "#8b5cf6" }[goal] ?? "#64748b";
}
function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}
function linSlope(vals: number[]) {
  if (vals.length < 2) return 0;
  const n = vals.length, mx = (n - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / n;
  const num = vals.reduce((s, v, i) => s + (i - mx) * (v - my), 0);
  const den = vals.reduce((s, _, i) => s + (i - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, unit = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="font-bold text-foreground">{Number(payload[0].value).toFixed(1)}{unit}</div>
    </div>
  );
}

// ── Streak calendar ───────────────────────────────────────────────────────────
function StreakCalendar({ intakeDates, weightDates }: { intakeDates: Set<string>; weightDates: Set<string> }) {
  const days  = lastNDays(35);
  const today = new Date().toISOString().slice(0, 10);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <div key={i} style={{ fontSize: "0.6rem", color: "#94a3b8", textAlign: "center", textTransform: "uppercase" }}>{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
          {week.map(date => {
            const hasI = intakeDates.has(date), hasW = weightDates.has(date);
            const future = date > today;
            const bg = future ? "transparent" : (hasI && hasW) ? "#1e293b" : hasI ? "#94a3b8" : hasW ? "#e2e8f0" : "#f8fafc";
            return (
              <div key={date}
                title={`${formatShortDate(date)}${hasI ? " · intake" : ""}${hasW ? " · weight" : ""}`}
                style={{ aspectRatio: "1", borderRadius: 4, background: bg, border: date === today ? "2px solid #475569" : "2px solid transparent", opacity: future ? 0.2 : 1, transition: "transform 0.1s" }}
                onMouseEnter={e => { if (!future) (e.currentTarget as HTMLElement).style.transform = "scale(1.2)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
              />
            );
          })}
        </div>
      ))}
      <div className="flex gap-3 mt-2 flex-wrap">
        {[
          { cls: "bg-slate-800",                       label: "Both"   },
          { cls: "bg-slate-400",                       label: "Intake" },
          { cls: "bg-slate-200",                       label: "Weight" },
          { cls: "bg-slate-50 border border-slate-200", label: "None"   },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className={`w-2.5 h-2.5 rounded-sm ${l.cls}`} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Getting Started ───────────────────────────────────────────────────────────
function GettingStarted({ data, onNavigate }: { data: DashboardResponse; onNavigate: (p: string) => void }) {
  const [open, setOpen] = useState(true);

  const hasWeighedIn  = data.weight_progress_14d.length > 0;
  const hasLoggedFood = data.today_intake.kcal > 0 || (data.weekly_summary.avg_daily_kcal ?? 0) > 0;
  const hasPlan       = data.weekly_summary.plans_generated > 0;
  const hasBayesian   = !!data.latest_calorie_adjustment.updated_at;

  const steps = [
    { done: true,          label: "Create your account",          sub: "Profile set up ✓" },
    { done: hasWeighedIn,  label: "Log your first weight",        sub: "Track progress over time",        action: () => onNavigate("logs"),    cta: "Log Weight" },
    { done: hasLoggedFood, label: "Log your first meal",          sub: "Start tracking calories",         action: () => onNavigate("tracker"), cta: "Open Tracker" },
    { done: hasPlan,       label: "Generate a meal plan",         sub: "Get a personalised day of meals", action: () => onNavigate("planner"), cta: "Go to Planner" },
    { done: hasBayesian,   label: "Get your first AI adjustment", sub: "Log 7 days to unlock Bayesian calorie tuning", action: undefined, cta: undefined },
  ];

  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Card className="border-2 border-slate-200">
      <CardHeader className="pb-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Getting Started</CardTitle>
            <Badge variant="secondary">{doneCount}/{steps.length} complete</Badge>
          </div>
          <ChevronDown
            className="w-4 h-4 text-muted-foreground transition-transform duration-200"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>
        <Progress value={(doneCount / steps.length) * 100} className="h-1.5 mt-3" />
      </CardHeader>
      {open && (
      <CardContent className="space-y-2 pt-0">
        {steps.map((step, i) => (
          <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg ${step.done ? "opacity-60" : "bg-secondary/30"}`}>
            {step.done
              ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              : <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : ""}`}>{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.sub}</p>
            </div>
            {!step.done && step.action && (
              <Button size="sm" variant="outline" className="flex-shrink-0 text-xs" onClick={step.action}>
                {step.cta} <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      )}
    </Card>
  );
}

// ── Targets card ──────────────────────────────────────────────────────────────
function TargetsCard({ targets, profile }: { targets: Targets; profile?: DashboardResponse["profile"] }) {
  const bmi = useMemo(() => {
    if (!profile?.weight_kg || !profile?.height_cm) return null;
    const h = profile.height_cm / 100;
    return (profile.weight_kg / (h * h)).toFixed(1);
  }, [profile]);

  const bmiLabel = (b: number) => {
    if (b < 18.5) return { label: "Underweight", color: "#3b82f6" };
    if (b < 25)   return { label: "Healthy",     color: "#22c55e" };
    if (b < 30)   return { label: "Overweight",  color: "#f59e0b" };
    return             { label: "Obese",         color: "#ef4444" };
  };

  const macros = [
    { label: "Calories", value: targets.kcal,    unit: "kcal", icon: <Flame className="w-4 h-4" />,    color: "#f59e0b" },
    { label: "Protein",  value: targets.protein, unit: "g",    icon: <Beef className="w-4 h-4" />,     color: "#3b82f6" },
    { label: "Carbs",    value: targets.carbs,   unit: "g",    icon: <Wheat className="w-4 h-4" />,    color: "#f97316" },
    { label: "Fat",      value: targets.fat,     unit: "g",    icon: <Droplets className="w-4 h-4" />, color: "#a855f7" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          Your Daily Targets
          {profile?.goal && (
            <span className="text-xs font-normal px-2 py-1 rounded-full text-white" style={{ background: goalColor(profile.goal) }}>
              {goalLabel(profile.goal)}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {profile?.tdee_mu ? `Estimated TDEE: ${Math.round(profile.tdee_mu)} kcal/day` : "Based on your profile — refines with more data"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {macros.map(({ label, value, unit, icon, color }) => (
            <div key={label} className="bg-secondary/30 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + "20", color }}>
                {icon}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-sm">{value ?? "—"}<span className="text-xs font-normal ml-0.5">{value != null ? unit : ""}</span></p>
              </div>
            </div>
          ))}
        </div>
        {bmi && (() => {
          const { label, color } = bmiLabel(Number(bmi));
          return (
            <div className="border rounded-lg p-3 flex items-center justify-between">
              <div><p className="text-xs text-muted-foreground">BMI</p><p className="font-semibold">{bmi}</p></div>
              <span className="text-xs font-medium px-2 py-1 rounded-full text-white" style={{ background: color }}>{label}</span>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function Dashboard({ onNavigate }: DashboardProps) {
  const [data,    setData]    = useState<DashboardResponse | null>(null);
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [intakes, setIntakes] = useState<IntakeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [range,   setRange]   = useState<30 | 60 | 90>(30);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        await ensureCsrf();
        const [dash, w, i] = await Promise.all([
          apiFetch("/api/dashboard/") as Promise<DashboardResponse>,
          apiFetch("/api/weights/")   as Promise<{ weights: WeightLog[] }>,
          apiFetch("/api/intakes/")   as Promise<{ intakes: IntakeLog[] }>,
        ]);
        setData(dash);
        setWeights(w.weights || []);
        setIntakes(i.intakes || []);
      } catch (e: any) {
        setErr(e?.detail || e?.error || "Failed to load dashboard data");
      } finally { setLoading(false); }
    })();
  }, []);

  // 14-day weight chart (original style)
  const weightData14 = useMemo(() =>
    (data?.weight_progress_14d || []).map(p => ({ date: formatShortDate(p.date), weight: p.weight_kg })),
    [data]);

  const yDomain = useMemo((): [number, number] => {
    if (!weightData14.length) return [60, 100];
    const ws = weightData14.map(x => x.weight);
    const pad = Math.max(0.5, (Math.max(...ws) - Math.min(...ws)) * 0.3);
    return [Math.floor((Math.min(...ws) - pad) * 10) / 10, Math.ceil((Math.max(...ws) + pad) * 10) / 10];
  }, [weightData14]);

  const sinceText = useMemo(() => {
    if (weightData14.length < 2) return null;
    const delta = weightData14.at(-1)!.weight - weightData14[0].weight;
    return { delta, firstDate: weightData14[0].date };
  }, [weightData14]);

  // Range-filtered data for trend charts
  const cutoff = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - range);
    return d.toISOString().slice(0, 10);
  }, [range]);

  const intakeDateSet = useMemo(() => new Set(intakes.map(i => i.date)), [intakes]);
  const weightDateSet = useMemo(() => new Set(weights.map(w => w.date)), [weights]);

  const intakeData = useMemo(() => {
    const sorted = [...intakes].filter(i => i.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((item, idx, arr) => {
      const win = arr.slice(Math.max(0, idx - 6), idx + 1);
      return { date: formatShortDate(item.date), kcal: Math.round(item.kcal), avg: Math.round(win.reduce((s, x) => s + x.kcal, 0) / win.length) };
    });
  }, [intakes, cutoff]);

  const streak = useMemo(() => {
    const toLocalISO = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    let s = 0;
    const t = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(t); d.setDate(d.getDate() - i);
      if (intakeDateSet.has(toLocalISO(d))) s++; else break;
    }
    return s;
  }, [intakeDateSet]);

  const avgKcal = intakeData.length ? Math.round(intakeData.reduce((s, i) => s + i.kcal, 0) / intakeData.length) : null;
  const kcalGap = avgKcal != null && data?.targets?.kcal ? avgKcal - data.targets.kcal : null;

  const intake  = data?.today_intake  ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const targets = data?.targets       ?? { kcal: null, protein: null, carbs: null, fat: null };
  const weekly  = data?.weekly_summary;
  const adj     = data?.latest_calorie_adjustment;
  const pct     = (v: number, t: number | null) => t ? Math.min(100, (v / t) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="mb-1">Dashboard</h2>
          <p className="text-muted-foreground text-sm">Overview of your nutrition goals and progress</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onNavigate("planner")} className="gap-2 flex-1 sm:flex-none">
            <Utensils className="w-4 h-4" /> Generate Meal Plan
          </Button>
          <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={() => onNavigate("logs")}>
            <Scale className="w-4 h-4" /> Log Weight
          </Button>
        </div>
      </div>

      {err && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      {/* Getting Started checklist */}
      {data && <GettingStarted data={data} onNavigate={onNavigate} />}

      {/* ── Row 1: Today + Right sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Today's Calories */}
          <Card>
            <CardHeader>
              <CardTitle>Today's Calories</CardTitle>
              <CardDescription>
                {intake.kcal === 0 ? "Nothing logged yet — head to the Tracker to add your meals" : "Based on your food log today"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {intake.kcal === 0 && !loading ? (
                <div className="flex flex-col items-center py-6 gap-3 text-center">
                  <Utensils className="w-10 h-10 text-slate-200" />
                  <p className="text-sm text-muted-foreground">No foods logged today</p>
                  <Button size="sm" onClick={() => onNavigate("tracker")}>
                    Open Tracker <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-muted-foreground text-sm">Calories</span>
                      <span>
                        <span className="font-semibold text-lg">{Math.round(intake.kcal)}</span>
                        <span className="text-muted-foreground"> / {targets.kcal ?? "—"} kcal</span>
                      </span>
                    </div>
                    <Progress value={pct(intake.kcal, targets.kcal)} className="h-2" />
                  </div>
                  <div className="pt-2 border-t space-y-3">
                    <p className="text-sm text-muted-foreground">Macronutrients</p>
                    {[
                      { label: "Protein",       value: intake.protein, target: targets.protein },
                      { label: "Carbohydrates", value: intake.carbs,   target: targets.carbs },
                      { label: "Fat",           value: intake.fat,     target: targets.fat },
                    ].map(({ label, value, target }) => (
                      <div key={label}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-sm text-muted-foreground">{label}</span>
                          <span className="text-sm">
                            <span className="font-medium">{value.toFixed(1)}g</span>
                            <span className="text-muted-foreground"> / {target ?? "—"}g</span>
                          </span>
                        </div>
                        <Progress value={pct(value, target)} className="h-1.5" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Weight Chart — original style, 14 days */}
          <Card>
            <CardHeader>
              <CardTitle>Weight Progress</CardTitle>
              <CardDescription>Last 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
                : weightData14.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-3 text-center">
                    <Scale className="w-10 h-10 text-slate-200" />
                    <p className="text-sm text-muted-foreground">No weight logs yet</p>
                    <p className="text-xs text-muted-foreground max-w-xs">Log your weight daily to track progress and unlock Bayesian calorie adjustment</p>
                    <Button size="sm" variant="outline" onClick={() => onNavigate("logs")}>
                      Log Weight <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                ) : weightData14.length === 1 ? (
                  <div className="flex flex-col items-center py-8 gap-2 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                      <Scale className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="font-semibold text-2xl">{weightData14[0].weight} kg</p>
                    <p className="text-sm text-muted-foreground">Starting weight logged ✓</p>
                    <p className="text-xs text-muted-foreground">Keep logging daily — the chart appears once you have 2+ entries</p>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={weightData14}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 12 }} tickLine={{ stroke: "#e5e7eb" }} />
                        <YAxis domain={yDomain} tick={{ fill: "#6b7280", fontSize: 12 }} tickLine={{ stroke: "#e5e7eb" }}
                          label={{ value: "kg", angle: -90, position: "insideLeft", style: { fill: "#6b7280", fontSize: 12 } }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, color: "var(--foreground)" }}
                          formatter={(val: any) => [`${Number(val).toFixed(1)} kg`, "Weight"]}
                        />
                        <Line type="monotone" dataKey="weight" stroke="#1e293b" strokeWidth={2} dot={{ fill: "#1e293b", r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {sinceText && (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        {sinceText.delta < 0
                          ? <TrendingDown className="w-4 h-4 text-green-500" />
                          : <TrendingUp className="w-4 h-4 text-orange-500" />}
                        <span className={`font-medium ${sinceText.delta < 0 ? "text-green-600" : "text-orange-600"}`}>
                          {sinceText.delta > 0 ? "+" : ""}{sinceText.delta.toFixed(1)} kg
                        </span>
                        <span className="text-muted-foreground">since {sinceText.firstDate}</span>
                      </div>
                    )}
                  </>
                )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <TargetsCard targets={targets} profile={data?.profile} />

          <Card>
            <CardHeader>
              <CardTitle>Weekly Summary</CardTitle>
              <CardDescription>Last 7 days</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {[
                { label: "Avg Daily Calories", value: weekly?.avg_daily_kcal == null ? null : `${Math.round(weekly.avg_daily_kcal).toLocaleString()} kcal`, empty: "Start logging food", action: () => onNavigate("tracker"), color: "" },
                { label: "Weight Change", value: weekly?.weight_change_kg == null ? null : `${weekly.weight_change_kg > 0 ? "+" : ""}${weekly.weight_change_kg.toFixed(2)} kg`, color: weekly?.weight_change_kg != null ? (weekly.weight_change_kg < 0 ? "text-green-600" : "text-orange-600") : "", empty: "Log weight daily", action: () => onNavigate("logs") },
                { label: "Meal Plans", value: weekly?.plans_generated != null ? `${weekly.plans_generated} generated` : null, empty: "Generate your first plan", action: () => onNavigate("planner"), color: "" },
              ].map(({ label, value, color, empty, action }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b last:border-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  {value
                    ? <span className={`font-medium text-sm ${color ?? ""}`}>{value}</span>
                    : <button className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1" onClick={action}>
                        {empty} <ChevronRight className="w-3 h-3" />
                      </button>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="w-4 h-4" /> Calorie Adjustment
              </CardTitle>
              <CardDescription>Bayesian weekly update</CardDescription>
            </CardHeader>
            <CardContent>
              {adj?.updated_at ? (
                <div className="space-y-3">
                  <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                    {[{ label: "Previous", value: adj.previous_target }, { label: "New Target", value: adj.new_target }].map(({ label, value }) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{value ?? "—"}{value != null ? " kcal" : ""}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm pt-1 border-t">
                      <span className="text-muted-foreground">Adjustment</span>
                      <span className={`font-medium ${(adj.delta ?? 0) < 0 ? "text-green-600" : "text-orange-600"}`}>
                        {(adj.delta ?? 0) > 0 ? "+" : ""}{adj.delta ?? "—"} kcal
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Updated {formatLongDateTime(adj.updated_at)}</p>
                </div>
              ) : (
                <div className="text-center py-4 space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                    <Activity className="w-5 h-5 text-slate-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">Not active yet</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Log your weight and meals for 7 days — the algorithm will then auto-adjust your targets based on real progress.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Row 2: Trends (range-filtered) ── */}
      <div className="flex items-center gap-3 pt-2">
        <span className="text-sm font-medium text-muted-foreground">Trend range</span>
        <div className="flex gap-2">
          {([30, 60, 90] as const).map(r => (
            <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
              {r}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intake trend — 2 cols */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div>
                  <CardTitle>Calorie Intake Trend</CardTitle>
                  <CardDescription>Daily intake with 7-day rolling average · last {range} days</CardDescription>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {avgKcal != null && <span>Avg: <span className="font-semibold text-slate-700">{avgKcal.toLocaleString()} kcal</span></span>}
                  {kcalGap != null && (
                    <span className={Math.abs(kcalGap) < 100 ? "text-green-600" : "text-orange-500"}>
                      {kcalGap > 0 ? "+" : ""}{kcalGap} vs target
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
                : intakeData.length < 2 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">Log at least 2 days of intake to see trends.</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={intakeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="iGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} tickCount={5} />
                        <Tooltip content={<ChartTip unit=" kcal" />} />
                        {targets?.kcal && <ReferenceLine y={targets.kcal} stroke="#cbd5e1" strokeDasharray="4 4" strokeWidth={1.5} />}
                        <Area type="monotone" dataKey="kcal" stroke="#cbd5e1" strokeWidth={1.5} fill="url(#iGrad)" dot={false} activeDot={{ r: 3, fill: "#64748b" }} />
                        <Line type="monotone" dataKey="avg"  stroke="#1e293b" strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: "#1e293b" }} />
                      </AreaChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-3">
                      {[
                        { cls: "bg-slate-300",  label: "Daily intake", dashed: false },
                        { cls: "bg-slate-800",  label: "7-day avg",    dashed: false },
                        { cls: "",             label: "Target",       dashed: true  },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <div className={`w-4 h-0.5 rounded ${l.dashed ? "border-t-2 border-dashed border-slate-300" : l.cls}`} />
                          {l.label}
                        </div>
                      ))}
                    </div>
                  </>
                )}
            </CardContent>
          </Card>
        </div>

        {/* Streak calendar — 1 col */}
        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between">
              <div>
                <CardTitle>Consistency</CardTitle>
                <CardDescription>Last 5 weeks</CardDescription>
              </div>
              <div className="text-right">
                <div className="font-bold text-xl text-slate-900">{streak}</div>
                <div className="text-xs text-muted-foreground">day streak</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
              : <StreakCalendar intakeDates={intakeDateSet} weightDates={weightDateSet} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}