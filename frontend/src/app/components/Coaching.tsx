import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  CheckCircle2, MessageCircle, Star, Send,
  Clock, Shield, Award, User, ChevronRight, Check,
  CreditCard, Lock, X, Loader2, ArrowUpRight,
} from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

interface CoachingProps { onNavigate: (page: string) => void; }

const PLANS = [
  { id: "starter", name: "Starter", price: "€29", period: "/mo", description: "For those just getting started with personalised nutrition.", badge: null, highlight: false, cta: "Get Started",
    features: ["Weekly check-in with your coach", "Personalised macro targets review", "1 meal plan adjustment per month", "Response within 48 hours"] },
  { id: "pro", name: "Pro", price: "€59", period: "/mo", description: "For people serious about reaching their goals faster.", badge: "Most Popular", highlight: true, cta: "Get Pro",
    features: ["Unlimited coach messaging", "Weekly personalised meal plan", "Progress review every 2 weeks", "Priority response within 24 hours", "Custom recipe suggestions"] },
  { id: "elite", name: "Elite", price: "€99", period: "/mo", description: "Full hands-on coaching for athletes and advanced clients.", badge: null, highlight: false, cta: "Go Elite",
    features: ["Everything in Pro", "Monthly 1-on-1 video call (30 min)", "Daily check-ins available", "Body composition analysis", "Competition / event prep support", "Response within 4 hours"] },
];

const COACHES = [
  { name: "Maria K.", title: "Certified Nutritionist", specialty: "Weight loss & body recomp", rating: 4.9, reviews: 142, avatar: "MK", color: "#3b82f6" },
  { name: "Nikos P.", title: "Sports Dietitian",       specialty: "Athletic performance & muscle gain", rating: 4.8, reviews: 98,  avatar: "NP", color: "#16a34a" },
  { name: "Elena V.", title: "Registered Dietitian",   specialty: "Gut health & hormonal balance",     rating: 5.0, reviews: 76,  avatar: "EV", color: "#f59e0b" },
];

const PLAN_COLORS: Record<string, string> = { starter: "#3b82f6", pro: "#8b5cf6", elite: "#f59e0b" };

type CoachingStatus = { plan: string; plan_name: string; plan_price: string; coaching_since: string | null };
type Message = { id: number; role: string; content: string; created_at: string };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Payment modal ─────────────────────────────────────────────────────────────
function PaymentModal({ plan, onSuccess, onClose, isUpgrade }: { plan: typeof PLANS[0]; onSuccess: () => void; onClose: () => void; isUpgrade?: boolean }) {
  const [step,    setStep]    = useState<"form" | "processing" | "done">("form");
  const [cardNum, setCardNum] = useState("");
  const [expiry,  setExpiry]  = useState("");
  const [cvv,     setCvv]     = useState("");
  const [name,    setName]    = useState("");
  const [err,     setErr]     = useState("");

  const fmtCard   = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const fmtExpiry = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? d.slice(0,2) + "/" + d.slice(2) : d; };

  const handlePay = async () => {
    if (!name.trim() || cardNum.replace(/\s/g,"").length < 16 || expiry.length < 5 || cvv.length < 3) {
      setErr("Please fill in all card details."); return;
    }
    setErr(""); setStep("processing");
    await new Promise(r => setTimeout(r, 2000));
    try {
      await ensureCsrf();
      await apiFetch("/api/coaching/subscribe/", { method: "POST", body: JSON.stringify({ plan: plan.id }) });
      setStep("done");
      setTimeout(onSuccess, 1500);
    } catch (e: any) {
      setStep("form"); setErr(e?.detail || "Payment failed. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Coloured top strip */}
        <div style={{ height: 4, background: `linear-gradient(90deg, #1e293b, ${PLAN_COLORS[plan.id] ?? "#64748b"})` }} />

        <div className="px-6 pt-5 pb-3 flex items-start justify-between">
          <div>
            <p className="font-bold text-slate-900 text-lg">{isUpgrade ? `Upgrade to ${plan.name}` : plan.name} Plan</p>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-2xl font-bold text-slate-900">{plan.price}</span>
              <span className="text-sm text-muted-foreground">{plan.period} · billed monthly</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* What's included — compact */}
        <div className="px-6 pb-4">
          <div className="bg-slate-50 rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1">
            {plan.features.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                <span className="text-xs text-slate-600">{f}</span>
              </div>
            ))}
            {plan.features.length > 3 && (
              <span className="text-xs text-muted-foreground">+{plan.features.length - 3} more</span>
            )}
          </div>
        </div>

        <div className="border-t" />

        <div className="p-6 space-y-4">
          {step === "form" && (<>
            <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              Capstone demo — no real payment is processed
            </div>

            {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Cardholder Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="John Doe"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Card Number</label>
              <div className="relative">
                <input value={cardNum} onChange={e => setCardNum(fmtCard(e.target.value))} placeholder="1234 5678 9012 3456"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 pr-11 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                  style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.05em" }} />
                <CreditCard className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Expiry</label>
                <input value={expiry} onChange={e => setExpiry(fmtExpiry(e.target.value))} placeholder="MM / YY"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                  style={{ fontFamily: "'DM Sans', sans-serif" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">CVV</label>
                <input value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g,"").slice(0,3))} placeholder="•••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
                  style={{ fontFamily: "'DM Sans', sans-serif" }} />
              </div>
            </div>

            <button onClick={handlePay}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #1e293b, #334155)" }}>
              <Lock className="w-3.5 h-3.5" /> Pay {plan.price}/mo
            </button>

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span>Cancel anytime</span><span>·</span><span>No hidden fees</span><span>·</span><span>Secure checkout</span>
            </div>
          </>)}

          {step === "processing" && (
            <div className="py-10 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-full border-4 border-slate-100 border-t-slate-800 animate-spin" />
              <div className="text-center">
                <p className="font-semibold text-slate-800">Processing payment…</p>
                <p className="text-sm text-muted-foreground mt-1">Please wait</p>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="py-10 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-slate-800 text-lg">You're all set!</p>
                <p className="text-sm text-muted-foreground mt-1">Setting up your coaching session…</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Active coaching chat ──────────────────────────────────────────────────────
function CoachingChat({ status, onCancel, onUpgrade }: { status: CoachingStatus; onCancel: () => void; onUpgrade: (plan: typeof PLANS[0]) => void }) {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = async () => {
    try {
      const res = await apiFetch("/api/coaching/messages/") as { messages: Message[] };
      setMessages(res.messages || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadMessages(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(""); setSending(true);
    try {
      await ensureCsrf();
      const msg = await apiFetch("/api/coaching/send/", { method: "POST", body: JSON.stringify({ content: text }) }) as Message;
      setMessages(prev => [...prev, msg]);
    } catch { setInput(text); } finally { setSending(false); }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await ensureCsrf();
      await apiFetch("/api/coaching/cancel/", { method: "POST" });
      onCancel();
    } catch {} finally { setCancelling(false); setShowCancel(false); }
  };

  const planInfo  = PLANS.find(p => p.id === status.plan);
  const upgrades  = PLANS.filter(p => PLANS.indexOf(p) > PLANS.findIndex(p2 => p2.id === status.plan));
  const planColor = PLAN_COLORS[status.plan] ?? "#64748b";

  return (
    <div className="space-y-5">

      {/* Cancel confirm */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCancel(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-800">Cancel coaching plan?</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You'll lose access to your coach and messaging. Your conversation history will be kept.
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setShowCancel(false)}>Keep plan</Button>
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Yes, cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Plan + upgrade banner */}
      <div className="rounded-2xl overflow-hidden border border-slate-200">
        {/* Coloured top bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg, #1e293b, ${planColor})` }} />
        <div className="bg-white px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: `linear-gradient(135deg, #1e293b, ${planColor})` }}>
              {status.plan[0].toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-800">{planInfo?.name} Plan</p>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: planColor }}>
                  Active
                </span>
              </div>
              {status.coaching_since && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Member since {new Date(status.coaching_since).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · {planInfo?.price}/mo
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {upgrades.map(p => (
              <button key={p.id} onClick={() => onUpgrade(p)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-all">
                <ArrowUpRight className="w-3 h-3" /> Upgrade to {p.name}
              </button>
            ))}
            <button onClick={() => setShowCancel(true)}
              className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors px-2 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Chat card */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" style={{ minHeight: 540 }}>
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b bg-slate-50">
          <div className="relative">
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#3b82f615", border: "2px solid #3b82f625",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.8rem", color: "#3b82f6" }}>
              MK
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">Maria K.</p>
            <p className="text-xs text-muted-foreground">
              Certified Nutritionist · replies within {planInfo?.id === "elite" ? "4 hrs" : planInfo?.id === "pro" ? "24 hrs" : "48 hrs"}
            </p>
          </div>
          <Badge variant="secondary" className="ml-auto text-xs">Live</Badge>
        </div>

        {/* Messages */}
        <div className="flex flex-col gap-4 px-5 py-5 overflow-y-auto" style={{ minHeight: 360, maxHeight: 420 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">No messages yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Say hello to your coach!</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isCoach = msg.role === "coach";
              return (
                <div key={msg.id} className={`flex gap-2.5 ${isCoach ? "items-end" : "items-end flex-row-reverse"}`}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: isCoach ? "#3b82f612" : "#f1f5f9",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {isCoach
                      ? <span style={{ fontSize: "0.55rem", fontWeight: 800, color: "#3b82f6" }}>MK</span>
                      : <User className="w-3 h-3 text-slate-400" />}
                  </div>
                  <div style={{ maxWidth: "68%" }}>
                    <div className={`text-sm leading-relaxed px-4 py-2.5 whitespace-pre-wrap ${
                      isCoach
                        ? "bg-slate-100 text-slate-800 rounded-2xl rounded-bl-md"
                        : "bg-slate-800 text-white rounded-2xl rounded-br-md"
                    }`}>
                      {msg.content}
                    </div>
                    <p className={`text-xs text-muted-foreground mt-1 ${isCoach ? "" : "text-right"}`}>
                      {fmtDate(msg.created_at)} · {fmtTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t bg-slate-50 px-4 py-3 flex gap-3 items-center">
          <input type="text" placeholder="Message your coach…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all"
            style={{ fontFamily: "'DM Sans', sans-serif" }} />
          <button onClick={handleSend} disabled={sending || !input.trim()}
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30"
            style={{ background: "linear-gradient(135deg, #1e293b, #334155)" }}>
            {sending ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
          </button>
        </div>
        <div className="bg-slate-50 pb-3 px-5">
          <p className="text-xs text-muted-foreground text-center">
            Messages are stored and visible to your coach · Admins reply through the coach panel
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function Coaching({ onNavigate }: CoachingProps) {
  const [status,        setStatus]        = useState<CoachingStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [payPlan,       setPayPlan]       = useState<typeof PLANS[0] | null>(null);

  const loadStatus = async () => {
    try {
      await ensureCsrf();
      const res = await apiFetch("/api/coaching/status/") as CoachingStatus;
      setStatus(res);
    } catch {} finally { setLoadingStatus(false); }
  };

  useEffect(() => { loadStatus(); }, []);

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasActivePlan = !!(status?.plan);

  return (
    <div className="space-y-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {payPlan && (
        <PaymentModal plan={payPlan} isUpgrade={hasActivePlan}
          onClose={() => setPayPlan(null)}
          onSuccess={() => { setPayPlan(null); loadStatus(); }} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1">Personal Coaching</h2>
          <p className="text-muted-foreground text-sm">
            Work 1-on-1 with a certified coach for fully personalised nutrition and accountability.
          </p>
        </div>
        {hasActivePlan && (
          <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white flex-shrink-0 flex items-center gap-1.5"
            style={{ background: PLAN_COLORS[status!.plan] ?? "#64748b" }}>
            <Check className="w-3 h-3" /> {status!.plan_name} Active
          </span>
        )}
      </div>

      {hasActivePlan && status ? (
        <CoachingChat status={status} onCancel={() => { setStatus(null); loadStatus(); }} onUpgrade={(plan) => setPayPlan(plan)} />
      ) : (<>

        {/* Why coaching */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: <MessageCircle className="w-5 h-5" />, label: "Human guidance",    sub: "Chat with a real coach, not a bot" },
            { icon: <Award         className="w-5 h-5" />, label: "Certified coaches", sub: "Nutritionists & registered dietitians" },
            { icon: <Clock         className="w-5 h-5" />, label: "Message anytime",   sub: "Async — no scheduled calls needed" },
            { icon: <Shield        className="w-5 h-5" />, label: "Cancel anytime",    sub: "No lock-in, switch plans freely" },
          ].map((f, i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-4 flex flex-col gap-2">
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-slate-600">{f.icon}</div>
                <p className="font-semibold text-sm text-slate-800">{f.label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Pricing */}
        <div>
          <div className="mb-1 text-xs uppercase tracking-widest font-semibold text-muted-foreground">Pricing</div>
          <h3 className="text-xl font-bold text-slate-900 mb-5">Choose your plan</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(plan => (
              <div key={plan.id} className={`relative rounded-2xl flex flex-col overflow-hidden transition-shadow hover:shadow-md ${
                plan.highlight ? "border-2 border-slate-800 shadow-lg" : "border border-slate-200"
              } bg-white`}>
                {/* Top colour stripe */}
                <div style={{ height: 3, background: `linear-gradient(90deg, #1e293b, ${PLAN_COLORS[plan.id] ?? "#64748b"})` }} />

                {plan.badge && (
                  <div className="absolute top-3 right-3 bg-slate-800 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    {plan.badge}
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1 gap-5">
                  <div>
                    <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{plan.name}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-slate-900">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">{plan.period}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{plan.description}</p>
                  </div>

                  <div className="space-y-2.5 flex-1">
                    {plan.features.map((f, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <div className="w-4 h-4 rounded-full bg-green-50 border border-green-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check className="w-2.5 h-2.5 text-green-600" />
                        </div>
                        <span className="text-sm text-slate-600 leading-snug">{f}</span>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => setPayPlan(plan)}
                    className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                    style={{
                      background: plan.highlight ? "linear-gradient(135deg, #1e293b, #334155)" : "transparent",
                      color: plan.highlight ? "#fff" : "#1e293b",
                      border: plan.highlight ? "none" : "2px solid #e2e8f0",
                    }}
                    onMouseEnter={e => { if (!plan.highlight) (e.currentTarget as HTMLElement).style.borderColor = "#94a3b8"; }}
                    onMouseLeave={e => { if (!plan.highlight) (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; }}>
                    {plan.cta}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coaches */}
        <div>
          <div className="mb-1 text-xs uppercase tracking-widest font-semibold text-muted-foreground">Team</div>
          <h3 className="text-xl font-bold text-slate-900 mb-5">Meet your coaches</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COACHES.map((c, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-3">
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: c.color + "15",
                    border: `2px solid ${c.color}25`, display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: "0.85rem", color: c.color, flexShrink: 0 }}>
                    {c.avatar}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.title}</p>
                  </div>
                </div>

                <div className="rounded-xl px-3 py-2 text-xs text-slate-600" style={{ background: c.color + "08", border: `1px solid ${c.color}18` }}>
                  Specialises in <span className="font-semibold text-slate-800">{c.specialty}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  {[...Array(5)].map((_, si) => (
                    <Star key={si} className="w-3.5 h-3.5" style={{ fill: "#f59e0b", color: "#f59e0b" }} />
                  ))}
                  <span className="text-xs font-bold text-slate-700 ml-1">{c.rating}</span>
                  <span className="text-xs text-muted-foreground">({c.reviews} reviews)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="rounded-2xl overflow-hidden">
          <div style={{ height: 3, background: "linear-gradient(90deg, #1e293b, #475569)" }} />
          <div className="bg-slate-800 px-6 py-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-bold text-lg text-white mb-1">Ready to get started?</p>
              <p className="text-sm text-slate-400">Pick a plan and your coach will reach out within 24 hours.</p>
            </div>
            <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex items-center gap-2 bg-white text-slate-800 font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-slate-100 transition-colors flex-shrink-0">
              View Plans <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </>)}
    </div>
  );
}