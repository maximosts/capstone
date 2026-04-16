import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Plus, Search, Trash2, ChevronDown, ChevronUp, PlusCircle } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

type FoodResult = {
  id: number;
  name: string;
  brand: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

type FoodEntry = {
  id: number;
  food_id: number;
  food_name: string;
  brand: string;
  grams: number;
  meal_slot: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

type Targets = {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function MacroBar({ label, value, target, color }: {
  label: string; value: number; target: number | null; color: string;
}) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = target ? value > target : false;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={over ? "text-orange-600 font-medium" : ""}>
          {value.toFixed(1)}{label === "Calories" ? "" : "g"}
          {target ? ` / ${target}${label === "Calories" ? "" : "g"}` : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-orange-500" : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function CalorieTracker() {
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [targets, setTargets] = useState<Targets>({ kcal: null, protein: null, carbs: null, fat: null });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Search state
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFood, setSelectedFood] = useState<FoodResult | null>(null);
  const [grams, setGrams] = useState("100");
  const [mealSlot, setMealSlot] = useState<MealSlot>("snack");
  const [adding, setAdding] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [panelMode, setPanelMode] = useState<"search" | "create">("search");

  // Create food form
  const [createForm, setCreateForm] = useState({
    name: "", brand: "", kcal_per_100g: "", protein_per_100g: "",
    carbs_per_100g: "", fat_per_100g: "", category: "custom",
  });
  const [creating, setCreating] = useState(false);

  // Collapsed meal sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/tracker/?date=${date}`);
      setEntries(res.entries || []);
      setTargets(res.targets || {});
    } catch (e: any) {
      setErr(e?.detail || "Failed to load entries");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/foods/search/?q=${encodeURIComponent(query)}`);
        setSearchResults(res.results || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, [query]);

  const handleCreateFood = async () => {
    if (!createForm.name.trim() || !createForm.kcal_per_100g) return;
    setCreating(true);
    setErr(null);
    try {
      await ensureCsrf();
      const newFood = await apiFetch("/api/foods/create/", {
        method: "POST",
        body: JSON.stringify({
          name:             createForm.name.trim(),
          brand:            createForm.brand.trim(),
          category:         createForm.category,
          kcal_per_100g:    Number(createForm.kcal_per_100g),
          protein_per_100g: Number(createForm.protein_per_100g) || 0,
          carbs_per_100g:   Number(createForm.carbs_per_100g)   || 0,
          fat_per_100g:     Number(createForm.fat_per_100g)     || 0,
        }),
      });
      // Auto-select the newly created food so user can log it straight away
      setSelectedFood(newFood as FoodResult);
      setPanelMode("search");
      setCreateForm({ name: "", brand: "", kcal_per_100g: "", protein_per_100g: "", carbs_per_100g: "", fat_per_100g: "", category: "custom" });
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to create food");
    } finally {
      setCreating(false);
    }
  };

  const handleAddFood = async () => {
    if (!selectedFood) return;
    setAdding(true);
    setErr(null);
    try {
      await ensureCsrf();
      await apiFetch("/api/tracker/", {
        method: "POST",
        body: JSON.stringify({
          food_id: selectedFood.id,
          grams: Number(grams),
          meal_slot: mealSlot,
          date,
        }),
      });
      // Reset
      setSelectedFood(null);
      setQuery("");
      setSearchResults([]);
      setGrams("100");
      setShowSearch(false);
      await fetchEntries();
    } catch (e: any) {
      setErr(e?.detail || "Failed to add food");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await ensureCsrf();
      await apiFetch(`/api/tracker/${id}/`, { method: "DELETE" });
      await fetchEntries();
    } catch (e: any) {
      setErr(e?.detail || "Failed to delete entry");
    }
  };

  // Totals
  const totals = useMemo(() => entries.reduce(
    (acc, e) => ({ kcal: acc.kcal + e.kcal, protein: acc.protein + e.protein, carbs: acc.carbs + e.carbs, fat: acc.fat + e.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  ), [entries]);

  // Group by meal
  const byMeal = useMemo(() => {
    const map: Record<string, FoodEntry[]> = {};
    MEAL_SLOTS.forEach(s => map[s] = []);
    entries.forEach(e => {
      if (map[e.meal_slot]) map[e.meal_slot].push(e);
      else map["snack"].push(e);
    });
    return map;
  }, [entries]);

  // Preview macros for selected food
  const preview = useMemo(() => {
    if (!selectedFood || !grams) return null;
    const g = Number(grams);
    return {
      kcal:    ((selectedFood.kcal_per_100g    * g) / 100).toFixed(0),
      protein: ((selectedFood.protein_per_100g * g) / 100).toFixed(1),
      carbs:   ((selectedFood.carbs_per_100g   * g) / 100).toFixed(1),
      fat:     ((selectedFood.fat_per_100g     * g) / 100).toFixed(1),
    };
  }, [selectedFood, grams]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="mb-1">Calorie Tracker</h2>
          <p className="text-muted-foreground text-sm">Log what you eat and track your daily macros</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
          <Button onClick={() => { setShowSearch(v => !v); setSelectedFood(null); setQuery(""); setPanelMode("search"); }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Food
          </Button>
        </div>
      </div>

      {err && (
        <Card className="border-destructive/40">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{err}</p>
          </CardContent>
        </Card>
      )}

      {/* Add Food Panel */}
      {showSearch && (
        <Card className="border-2 border-slate-200">
          <CardHeader className="pb-0">
            {/* Tab switcher */}
            <div className="flex gap-1 border-b">
              <button
                type="button"
                onClick={() => setPanelMode("search")}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  panelMode === "search"
                    ? "border-slate-800 text-slate-900"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Search className="w-3.5 h-3.5 inline mr-1.5" />
                Search Foods
              </button>
              <button
                type="button"
                onClick={() => setPanelMode("create")}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  panelMode === "create"
                    ? "border-slate-800 text-slate-900"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5 inline mr-1.5" />
                Create New Food
              </button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {/* ── SEARCH TAB ── */}
            {panelMode === "search" && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search foods (e.g. chicken breast, oats…)"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSelectedFood(null); }}
                    autoFocus
                  />
                  {searching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching…</span>
                  )}
                </div>

                {/* No results hint */}
                {query.length >= 2 && !searching && searchResults.length === 0 && !selectedFood && (
                  <div className="text-center py-3">
                    <p className="text-sm text-muted-foreground mb-2">No foods found for "{query}"</p>
                    <button
                      type="button"
                      className="text-sm text-slate-800 underline hover:no-underline"
                      onClick={() => {
                        setCreateForm(f => ({ ...f, name: query }));
                        setPanelMode("create");
                      }}
                    >
                      + Create "{query}" as a new food
                    </button>
                  </div>
                )}

                {/* Results dropdown */}
                {searchResults.length > 0 && !selectedFood && (
                  <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                    {searchResults.map((food) => (
                      <button
                        key={food.id}
                        type="button"
                        className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors"
                        onClick={() => { setSelectedFood(food); setSearchResults([]); }}
                      >
                        <div className="font-medium text-sm">{food.name}</div>
                        <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                          {food.brand && <span>{food.brand}</span>}
                          <span>{food.kcal_per_100g} kcal</span>
                          <span>P {food.protein_per_100g}g</span>
                          <span>C {food.carbs_per_100g}g</span>
                          <span>F {food.fat_per_100g}g</span>
                          <span className="text-muted-foreground">per 100g</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected food — configure grams + slot */}
                {selectedFood && (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between p-3 bg-secondary/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{selectedFood.name}</p>
                        {selectedFood.brand && <p className="text-xs text-muted-foreground">{selectedFood.brand}</p>}
                      </div>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => { setSelectedFood(null); setQuery(""); }}
                      >
                        ✕ Change
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Amount (grams)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="2000"
                          value={grams}
                          onChange={(e) => setGrams(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Meal</Label>
                        <Select value={mealSlot} onValueChange={(v) => setMealSlot(v as MealSlot)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MEAL_SLOTS.map(s => (
                              <SelectItem key={s} value={s}>{SLOT_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {preview && (
                      <div className="grid grid-cols-4 gap-2 text-center">
                        {[
                          { label: "Calories", value: preview.kcal, unit: "kcal" },
                          { label: "Protein",  value: preview.protein, unit: "g" },
                          { label: "Carbs",    value: preview.carbs,   unit: "g" },
                          { label: "Fat",      value: preview.fat,     unit: "g" },
                        ].map(({ label, value, unit }) => (
                          <div key={label} className="bg-secondary/30 rounded-lg py-2">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="font-semibold text-sm">{value}<span className="text-xs font-normal ml-0.5">{unit}</span></p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setShowSearch(false)}>Cancel</Button>
                      <Button onClick={handleAddFood} disabled={adding || !grams}>
                        {adding ? "Adding…" : "Add to Tracker"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── CREATE TAB ── */}
            {panelMode === "create" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Fill in the nutritional info per 100g. The food will be saved to the database and selected automatically.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label>Food Name <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="e.g. Homemade Protein Bar"
                      value={createForm.name}
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Brand <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      placeholder="e.g. Homemade"
                      value={createForm.brand}
                      onChange={e => setCreateForm(f => ({ ...f, brand: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <select
                      value={createForm.category}
                      onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="custom">Custom</option>
                      <option value="Proteins">Proteins</option>
                      <option value="Carbohydrates">Carbohydrates</option>
                      <option value="Fats and Oils">Fats and Oils</option>
                      <option value="Vegetables">Vegetables</option>
                      <option value="Fruits">Fruits</option>
                      <option value="Dairy">Dairy</option>
                      <option value="Snacks">Snacks</option>
                      <option value="Beverages">Beverages</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Macros per 100g</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "kcal_per_100g",    label: "Calories (kcal)", required: true },
                      { key: "protein_per_100g",  label: "Protein (g)" },
                      { key: "carbs_per_100g",    label: "Carbohydrates (g)" },
                      { key: "fat_per_100g",      label: "Fat (g)" },
                    ].map(({ key, label, required }) => (
                      <div key={key} className="space-y-1.5">
                        <Label>
                          {label}
                          {required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="0"
                          value={createForm[key as keyof typeof createForm]}
                          onChange={e => setCreateForm(f => ({ ...f, [key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" onClick={() => setShowSearch(false)}>Cancel</Button>
                  <Button
                    onClick={handleCreateFood}
                    disabled={creating || !createForm.name.trim() || !createForm.kcal_per_100g}
                  >
                    {creating ? "Saving…" : "Save & Select Food"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Daily Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MacroBar label="Calories" value={totals.kcal} target={targets.kcal} color="bg-slate-800" />
          <MacroBar label="Protein"  value={totals.protein} target={targets.protein} color="bg-blue-500" />
          <MacroBar label="Carbs"    value={totals.carbs}   target={targets.carbs}   color="bg-amber-500" />
          <MacroBar label="Fat"      value={totals.fat}     target={targets.fat}     color="bg-rose-400" />
        </CardContent>
      </Card>

      {/* Meals */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {MEAL_SLOTS.map((slot) => {
            const slotEntries = byMeal[slot] || [];
            const slotKcal = slotEntries.reduce((s, e) => s + e.kcal, 0);
            const isCollapsed = collapsed[slot];

            return (
              <Card key={slot}>
                <CardHeader className="pb-2">
                  <button
                    type="button"
                    className="flex items-center justify-between w-full"
                    onClick={() => setCollapsed(p => ({ ...p, [slot]: !p[slot] }))}
                  >
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">{SLOT_LABELS[slot]}</CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {slotEntries.length} items
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{slotKcal.toFixed(0)} kcal</span>
                      {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </div>
                  </button>
                </CardHeader>

                {!isCollapsed && (
                  <CardContent>
                    {slotEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">No foods logged yet.</p>
                    ) : (
                      <div className="divide-y">
                        {slotEntries.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{entry.food_name}</p>
                              <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{entry.grams}g</span>
                                <span>{entry.kcal} kcal</span>
                                <span>P {entry.protein}g</span>
                                <span>C {entry.carbs}g</span>
                                <span>F {entry.fat}g</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive transition-colors ml-3 flex-shrink-0"
                              onClick={() => handleDelete(entry.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}