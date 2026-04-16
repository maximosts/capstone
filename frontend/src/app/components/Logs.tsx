import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

type WeightLogRow = {
  id: number;
  date: string;
  weight: number;
  notes?: string;
};

type IntakeLogRow = {
  id: number;
  date: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function Logs() {
  // ✅ Start empty; load from DB
  const [weightLogs, setWeightLogs] = useState<WeightLogRow[]>([]);
  const [intakeLogs, setIntakeLogs] = useState<IntakeLogRow[]>([]);

  const [showWeightForm, setShowWeightForm] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);

  const [weightDate, setWeightDate] = useState(todayISO());
  const [weightKg, setWeightKg] = useState<string>("");
  const [weightNotes, setWeightNotes] = useState("");

  const [intakeDate, setIntakeDate] = useState(todayISO());
  const [intakeKcal, setIntakeKcal] = useState<string>("");

  const [saving, setSaving] = useState<"weight" | "intake" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingWeight, setEditingWeight] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [editingIntakeId, setEditingIntakeId] = useState<number | null>(null);
  const [editingKcal, setEditingKcal] = useState<string>("");
  const [confirmDeleteIntakeId, setConfirmDeleteIntakeId] = useState<number | null>(null);

  // ✅ Fetchers
  const fetchWeights = async () => {
    const data = await apiFetch("/api/weights/", { method: "GET" });
    const rows: WeightLogRow[] = (data.weights || []).map((w: any) => ({
      id: w.id,
      date: w.date,
      weight: Number(w.weight_kg),
      notes: w.notes || "",
    }));
    // Sort newest first for your table logic
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    setWeightLogs(rows);
  };

  const fetchIntakes = async () => {
    const data = await apiFetch("/api/intakes/", { method: "GET" });
    const rows: IntakeLogRow[] = (data.intakes || []).map((i: any) => ({
      id: i.id,
      date: i.date,
      calories: Number(i.kcal),
    }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    setIntakeLogs(rows);
  };

  const fetchAll = async () => {
    setErr(null);
    setLoading(true);
    try {
      await Promise.all([fetchWeights(), fetchIntakes()]);
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Load real logs on mount
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEdit = async (id: number) => {
    if (!editingWeight) return;
    setErr(null);
    try {
      await ensureCsrf();
      await apiFetch(`/api/weights/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ weight_kg: Number(editingWeight) }),
      });
      await fetchWeights();
      setEditingId(null);
      setEditingWeight("");
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to update weight log");
    }
  };

  const handleDelete = async (id: number) => {
    setErr(null);
    try {
      await ensureCsrf();
      await apiFetch(`/api/weights/${id}/`, { method: "DELETE" });
      await fetchWeights();
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to delete weight log");
    }
  };

  const handleSaveIntakeEdit = async (id: number) => {
    if (!editingKcal) return;
    setErr(null);
    try {
      await ensureCsrf();
      await apiFetch(`/api/intakes/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ kcal: Number(editingKcal) }),
      });
      await fetchIntakes();
      setEditingIntakeId(null);
      setEditingKcal("");
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to update intake log");
    }
  };

  const handleDeleteIntake = async (id: number) => {
    setErr(null);
    try {
      await ensureCsrf();
      await apiFetch(`/api/intakes/${id}/`, { method: "DELETE" });
      await fetchIntakes();
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to delete intake log");
    }
  };

  const submitWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving("weight");

    try {
      await ensureCsrf();

      const payload = {
        date: weightDate,
        weight_kg: Number(weightKg),
        // notes: weightNotes, // only if backend supports it
        auto_update: true,
      };

      await apiFetch("/api/log-weight/", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // ✅ refresh from DB (no fake IDs)
      await fetchWeights();

      setWeightKg("");
      setWeightNotes("");
      setShowWeightForm(false);
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to save weight log");
    } finally {
      setSaving(null);
    }
  };

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving("intake");

    try {
      await ensureCsrf();

      const payload = {
        date: intakeDate,
        kcal: Number(intakeKcal),
        auto_update: true,
      };

      await apiFetch("/api/log-intake/", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // ✅ refresh from DB
      await fetchIntakes();

      setIntakeKcal("");
      setShowIntakeForm(false);
    } catch (e: any) {
      setErr(e?.detail || e?.error || "Failed to save intake log");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1">Logs</h2>
        <p className="text-muted-foreground text-sm">Track your weight and calorie intake over time</p>
      </div>

      {err && (
        <Card className="border-destructive/40">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{err}</p>
          </CardContent>
        </Card>
      )}

      {/* Weight Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Weight Logs</CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setShowWeightForm((v) => !v)}>
              <Plus className="w-4 h-4" />
              Add Entry
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {showWeightForm && (
            <form onSubmit={submitWeight} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 border rounded-lg">
              <div className="space-y-1">
                <Label htmlFor="w-date">Date</Label>
                <Input id="w-date" type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="w-kg">Weight (kg)</Label>
                <Input
                  id="w-kg"
                  type="number"
                  step="0.1"
                  placeholder="81.2"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="w-notes">Notes (optional)</Label>
                <Input
                  id="w-notes"
                  placeholder="Morning weigh-in"
                  value={weightNotes}
                  onChange={(e) => setWeightNotes(e.target.value)}
                />
              </div>

              <div className="md:col-span-4 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowWeightForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving === "weight"}>
                  {saving === "weight" ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>

              <TableBody>
                {weightLogs.map((log, index) => {
                  const previousWeight = weightLogs[index + 1]?.weight;
                  const change = previousWeight ? log.weight - previousWeight : null;
                  const isEditing = editingId === log.id;

                  return (
                    <TableRow key={log.id} className="group">
                      <TableCell className="font-medium">{log.date}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.1"
                            value={editingWeight}
                            onChange={(e) => setEditingWeight(e.target.value)}
                            className="w-24 h-7 text-sm"
                            autoFocus
                          />
                        ) : (
                          log.weight.toFixed(1)
                        )}
                      </TableCell>
                      <TableCell>
                        {change !== null ? (
                          <span className={change < 0 ? "text-green-600" : "text-orange-600"}>
                            {change > 0 ? "+" : ""}
                            {change.toFixed(1)} kg
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{log.notes || "—"}</TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleSaveEdit(log.id)}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : confirmDeleteId === log.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">Deleting may pause calorie target updates.</span>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { setConfirmDeleteId(null); handleDelete(log.id); }}>
                              Delete
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(log.id); setEditingWeight(log.weight.toFixed(1)); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteId(log.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Calorie Intake Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Calorie Intake Logs</CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setShowIntakeForm((v) => !v)}>
              <Plus className="w-4 h-4" />
              Add Entry
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {showIntakeForm && (
            <form onSubmit={submitIntake} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border rounded-lg">
              <div className="space-y-1">
                <Label htmlFor="i-date">Date</Label>
                <Input id="i-date" type="date" value={intakeDate} onChange={(e) => setIntakeDate(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="i-kcal">Calories (kcal)</Label>
                <Input
                  id="i-kcal"
                  type="number"
                  step="1"
                  placeholder="2200"
                  value={intakeKcal}
                  onChange={(e) => setIntakeKcal(e.target.value)}
                  required
                />
              </div>

              <div className="flex items-end justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowIntakeForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving === "intake"}>
                  {saving === "intake" ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Calories (kcal)</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>

              <TableBody>
                {intakeLogs.map((log) => {
                  const isEditing = editingIntakeId === log.id;
                  return (
                    <TableRow key={log.id} className="group">
                      <TableCell className="font-medium">{log.date}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="1"
                            value={editingKcal}
                            onChange={(e) => setEditingKcal(e.target.value)}
                            className="w-28 h-7 text-sm"
                            autoFocus
                          />
                        ) : (
                          log.calories.toLocaleString()
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleSaveIntakeEdit(log.id)}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingIntakeId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : confirmDeleteIntakeId === log.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">This will affect Bayesian updates.</span>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { setConfirmDeleteIntakeId(null); handleDeleteIntake(log.id); }}>
                              Delete
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteIntakeId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingIntakeId(log.id); setEditingKcal(String(log.calories)); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteIntakeId(log.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}