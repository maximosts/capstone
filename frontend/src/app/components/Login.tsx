import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Activity, ArrowLeft } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

interface LoginProps {
  onNavigate: (page: string) => void;
}

export function Login({ onNavigate }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await ensureCsrf();
        await apiFetch("/api/auth/me/");
        if (mounted) onNavigate("dashboard");
      } catch {}
      finally { if (mounted) setCheckingSession(false); }
    })();
    return () => { mounted = false; };
  }, [onNavigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await ensureCsrf();
      await apiFetch("/api/auth/login/", { method: "POST", body: JSON.stringify({ email, password }) });
      await apiFetch("/api/auth/me/");
      onNavigate("dashboard");
    } catch (err: any) {
      setError(err?.detail || err?.error || "Login failed. Please try again.");
    } finally { setSubmitting(false); }
  };

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

      {/* Centered form */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 64px)", padding: "2rem 1rem" }}>
        <Card className="w-full shadow-lg" style={{ maxWidth: 420 }}>
          <CardHeader className="space-y-1 text-center pb-2">
            <CardTitle style={{ fontSize: "1.25rem" }}>Welcome back</CardTitle>
            <CardDescription>
              {checkingSession ? "Checking session…" : "Sign in to your account"}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2">
            {error && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="name@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email" disabled={checkingSession || submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Enter your password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="current-password" disabled={checkingSession || submitting} />
              </div>

              <Button type="submit" className="w-full" disabled={checkingSession || submitting}>
                {submitting ? "Signing in…" : "Sign In"}
              </Button>

              {/* Back button inside form */}
              <button
                type="button"
                onClick={() => onNavigate("landing")}
                disabled={checkingSession || submitting}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 1rem", fontSize: "0.875rem", color: "#64748b", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "#94a3b8", e.currentTarget.style.color = "#1e293b")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e8f0", e.currentTarget.style.color = "#64748b")}
              >
                <ArrowLeft size={14} /> Back to Home
              </button>
            </form>

            <div className="mt-4 text-center text-sm">
              <span className="text-muted-foreground">Don't have an account? </span>
              <button type="button" onClick={() => onNavigate("register")}
                className="text-primary hover:underline" disabled={checkingSession || submitting}>
                Create one
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}