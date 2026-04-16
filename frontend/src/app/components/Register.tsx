import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Activity, ArrowLeft } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

interface RegisterProps {
  onNavigate: (page: string) => void;
}

type Sex = "M" | "F" | "";
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active" | "";
type Goal = "cut" | "bulk" | "recomp" | "maintenance" | "";

type FormState = {
  email: string; password: string; confirmPassword: string;
  age: string; sex: Sex; height_cm: string; weight_kg: string;
  activityLevel: ActivityLevel; goal: Goal; allergies: string; exclusions: string;
};

const STEPS = ["Account & Body Stats", "Goals & Preferences"] as const;

export function Register({ onNavigate }: RegisterProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormState>({
    email: "", password: "", confirmPassword: "",
    age: "", sex: "", height_cm: "", weight_kg: "",
    activityLevel: "", goal: "", allergies: "", exclusions: "",
  });

  const set = (field: keyof FormState, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const validateStep1 = (): string | null => {
    if (!formData.email.trim()) return "Email is required.";
    if (!formData.password) return "Password is required.";
    if (formData.password !== formData.confirmPassword) return "Passwords do not match.";
    if (!formData.sex) return "Please select your sex.";
    if (!formData.activityLevel) return "Please select an activity level.";
    const age = Number(formData.age);
    if (!Number.isFinite(age) || age < 10 || age > 120) return "Enter a valid age (10–120).";
    const h = Number(formData.height_cm);
    if (!Number.isFinite(h) || h < 120 || h > 230) return "Enter a valid height (120–230 cm).";
    const w = Number(formData.weight_kg);
    if (!Number.isFinite(w) || w < 30 || w > 250) return "Enter a valid weight (30–250 kg).";
    return null;
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep1();
    if (err) { alert(err); return; }
    setStep(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.goal) { alert("Please select a goal."); return; }
    setSubmitting(true);
    try {
      await ensureCsrf();
      await apiFetch("/api/auth/register/", {
        method: "POST",
        body: JSON.stringify({
          email: formData.email, password: formData.password,
          age: Number(formData.age), sex: formData.sex,
          activityLevel: formData.activityLevel,
          height_cm: Number(formData.height_cm), weight_kg: Number(formData.weight_kg),
          goal: formData.goal, allergies: formData.allergies, exclusions: formData.exclusions,
        }),
      });
      onNavigate("dashboard");
    } catch (err: any) {
      alert(err?.detail || err?.error || "Registration failed");
    } finally { setSubmitting(false); }
  };

  const backAction = step === 0 ? () => onNavigate("landing") : () => setStep(0);
  const backLabel  = step === 0 ? "Back to Home" : "Back";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@800&family=DM+Sans:wght@300;400;500&display=swap');`}</style>

      {/* Nav — identical height/style to Landing */}
      <header style={{ height: 64, borderBottom: "1px solid #e2e8f0", background: "#f8fafc", padding: "0 2rem", display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => onNavigate("landing")}>
          <div style={{ width: 36, height: 36, background: "#1e293b", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: "1.05rem", color: "#1e293b", letterSpacing: "0.02em", lineHeight: 1 }}>ANMS</div>
            <div style={{ fontSize: "0.62rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Adaptive Nutrition</div>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 64px)", padding: "2rem 1rem" }}>
        <Card className="w-full shadow-lg" style={{ maxWidth: 440 }}>
          <CardHeader className="space-y-1 text-center pb-2">
            <CardTitle style={{ fontSize: "1.25rem" }}>Create an Account</CardTitle>
            <CardDescription>{STEPS[step]}</CardDescription>
            <div className="flex gap-2 justify-center pt-1">
              {STEPS.map((_, i) => (
                <div key={i} style={{ height: 5, borderRadius: 99, background: i <= step ? "#1e293b" : "#e2e8f0", width: i <= step ? 28 : 16, transition: "all 0.3s" }} />
              ))}
            </div>
          </CardHeader>

          <CardContent className="pt-2">
            {step === 0 && (
              <form onSubmit={handleNext} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="name@example.com"
                    value={formData.email} onChange={(e) => set("email", e.target.value)}
                    required autoComplete="email" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder="Create a password"
                      value={formData.password} onChange={(e) => set("password", e.target.value)}
                      required autoComplete="new-password" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm</Label>
                    <Input id="confirmPassword" type="password" placeholder="Repeat password"
                      value={formData.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)}
                      required autoComplete="new-password" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="age">Age</Label>
                    <Input id="age" type="number" placeholder="25"
                      value={formData.age} onChange={(e) => set("age", e.target.value)}
                      required min={10} max={120} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sex">Sex</Label>
                    <Select value={formData.sex} onValueChange={(v) => set("sex", v)}>
                      <SelectTrigger id="sex"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M">Male</SelectItem>
                        <SelectItem value="F">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="height_cm">Height (cm)</Label>
                    <Input id="height_cm" type="number" placeholder="178"
                      value={formData.height_cm} onChange={(e) => set("height_cm", e.target.value)}
                      required min={120} max={230} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="weight_kg">Weight (kg)</Label>
                    <Input id="weight_kg" type="number" step="0.1" placeholder="81.2"
                      value={formData.weight_kg} onChange={(e) => set("weight_kg", e.target.value)}
                      required min={30} max={250} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="activityLevel">Activity Level</Label>
                  <Select value={formData.activityLevel} onValueChange={(v) => set("activityLevel", v)}>
                    <SelectTrigger id="activityLevel"><SelectValue placeholder="Select activity level" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sedentary">Sedentary (little or no exercise)</SelectItem>
                      <SelectItem value="light">Light (1–3 days/week)</SelectItem>
                      <SelectItem value="moderate">Moderate (3–5 days/week)</SelectItem>
                      <SelectItem value="active">Active (6–7 days/week)</SelectItem>
                      <SelectItem value="very_active">Very Active (intense daily)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button type="submit" className="w-full">Continue →</Button>

                <button type="button" onClick={backAction} disabled={submitting}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 1rem", fontSize: "0.875rem", color: "#64748b", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#94a3b8", e.currentTarget.style.color = "#1e293b")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e8f0", e.currentTarget.style.color = "#64748b")}
                >
                  <ArrowLeft size={14} /> {backLabel}
                </button>

                <div className="text-center text-sm">
                  <span className="text-muted-foreground">Already have an account? </span>
                  <button type="button" onClick={() => onNavigate("login")} className="text-primary hover:underline">Sign in</button>
                </div>
              </form>
            )}

            {step === 1 && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="goal">Your Goal</Label>
                  <Select value={formData.goal} onValueChange={(v) => set("goal", v)}>
                    <SelectTrigger id="goal"><SelectValue placeholder="Select your goal" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cut">Cut — lose body fat</SelectItem>
                      <SelectItem value="bulk">Bulk — gain muscle & weight</SelectItem>
                      <SelectItem value="recomp">Recomp — build muscle, lose fat</SelectItem>
                      <SelectItem value="maintenance">Maintenance — stay at current weight</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Sets your initial calorie target. You can change it later in Profile.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="allergies">Allergies <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea id="allergies" placeholder="e.g., peanuts, shellfish, tree nuts"
                    value={formData.allergies} onChange={(e) => set("allergies", e.target.value)}
                    rows={2} className="resize-none" />
                  <p className="text-xs text-muted-foreground">Comma-separated. These foods will never appear in your meal plans.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exclusions">Food Exclusions <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea id="exclusions" placeholder="e.g., dairy, gluten, red meat"
                    value={formData.exclusions} onChange={(e) => set("exclusions", e.target.value)}
                    rows={2} className="resize-none" />
                  <p className="text-xs text-muted-foreground">Foods you prefer to avoid but aren't allergic to.</p>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Creating Account…" : "Create Account"}
                </Button>

                <button type="button" onClick={backAction} disabled={submitting}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 1rem", fontSize: "0.875rem", color: "#64748b", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#94a3b8", e.currentTarget.style.color = "#1e293b")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e8f0", e.currentTarget.style.color = "#64748b")}
                >
                  <ArrowLeft size={14} /> {backLabel}
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}