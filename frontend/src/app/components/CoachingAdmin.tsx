import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Send, Loader2, User, ChevronLeft, MessageCircle } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

const PLAN_COLORS: Record<string, string> = {
  starter: "#3b82f6",
  pro:     "#8b5cf6",
  elite:   "#f59e0b",
};

type Client = {
  user_id: number; username: string; email: string;
  coaching_plan: string; coaching_since: string | null;
  convo_id: number | null; message_count: number;
  last_message: { content: string; role: string; created_at: string } | null;
};
type Message = { id: number; role: string; content: string; created_at: string };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CoachingAdmin() {
  const [clients,    setClients]    = useState<Client[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<Client | null>(null);
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [loadingMsgs,setLoadingMsgs]= useState(false);
  const [input,      setInput]      = useState("");
  const [sending,    setSending]    = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadClients = async () => {
    setLoading(true);
    try {
      await ensureCsrf();
      const res = await apiFetch("/api/coaching/admin/") as { clients: Client[] };
      setClients(res.clients || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadClients(); }, []);

  const openThread = async (client: Client) => {
    setSelected(client);
    setMessages([]);
    if (!client.convo_id) return;
    setLoadingMsgs(true);
    try {
      const res = await apiFetch(`/api/coaching/admin/${client.convo_id}/messages/`) as { messages: Message[] };
      setMessages(res.messages || []);
    } catch {} finally { setLoadingMsgs(false); }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleReply = async () => {
    const text = input.trim();
    if (!text || sending || !selected?.convo_id) return;
    setInput(""); setSending(true);
    try {
      await ensureCsrf();
      const msg = await apiFetch(`/api/coaching/admin/${selected.convo_id}/reply/`, {
        method: "POST", body: JSON.stringify({ content: text }),
      }) as Message;
      setMessages(prev => [...prev, msg]);
    } catch { setInput(text); }
    finally { setSending(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1">Coaching Inbox</h2>
        <p className="text-muted-foreground text-sm">Reply to clients who have an active coaching plan.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ minHeight: 560 }}>

        {/* Client list */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-3">
            Active clients ({clients.length})
          </p>
          {clients.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <MessageCircle className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No active coaching clients yet.</p>
              </CardContent>
            </Card>
          ) : clients.map(client => (
            <button key={client.user_id} onClick={() => openThread(client)} className="w-full text-left">
              <Card className={`transition-colors hover:border-slate-400 ${selected?.user_id === client.user_id ? "border-slate-800 border-2" : ""}`}>
                <CardContent className="py-3 px-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <User className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{client.username}</p>
                        <p className="text-xs text-muted-foreground">{client.email}</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white capitalize flex-shrink-0"
                      style={{ background: PLAN_COLORS[client.coaching_plan] ?? "#64748b" }}>
                      {client.coaching_plan}
                    </span>
                  </div>
                  {client.last_message && (
                    <p className="text-xs text-muted-foreground truncate pl-9">
                      <span className={client.last_message.role === "user" ? "font-medium text-slate-700" : ""}>
                        {client.last_message.role === "user" ? "User: " : "You: "}
                      </span>
                      {client.last_message.content}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground pl-9">{client.message_count} messages</p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="lg:col-span-2">
          {!selected ? (
            <Card className="h-full flex items-center justify-center" style={{ minHeight: 400 }}>
              <CardContent className="text-center py-12">
                <MessageCircle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a client to view their conversation.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex flex-col" style={{ minHeight: 520 }}>
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-3.5 border-b flex-shrink-0">
                <button onClick={() => setSelected(null)} className="lg:hidden mr-1 text-muted-foreground hover:text-slate-800">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{selected.username}</p>
                  <p className="text-xs text-muted-foreground">{selected.email}</p>
                </div>
                <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full text-white capitalize"
                  style={{ background: PLAN_COLORS[selected.coaching_plan] ?? "#64748b" }}>
                  {selected.coaching_plan}
                </span>
              </div>

              {/* Messages */}
              <CardContent className="flex-1 py-4 px-5 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: 400 }}>
                {loadingMsgs ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-sm text-muted-foreground">No messages yet.</p>
                  </div>
                ) : messages.map(msg => {
                  const isCoach = msg.role === "coach";
                  return (
                    <div key={msg.id} className={`flex gap-2.5 items-end ${isCoach ? "flex-row-reverse" : ""}`}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: isCoach ? "#1e293b" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {isCoach
                          ? <span style={{ fontSize: "0.55rem", fontWeight: 800, color: "#fff" }}>YOU</span>
                          : <User className="w-3 h-3 text-slate-400" />}
                      </div>
                      <div style={{ maxWidth: "70%" }}>
                        <div className={`text-sm leading-relaxed px-3.5 py-2.5 whitespace-pre-wrap ${
                          isCoach
                            ? "bg-slate-800 text-white rounded-tl-2xl rounded-tr rounded-bl-2xl rounded-br-sm"
                            : "bg-secondary text-slate-800 rounded-tl rounded-tr-2xl rounded-br-2xl rounded-bl-sm"
                        }`}>
                          {msg.content}
                        </div>
                        <p className={`text-xs text-muted-foreground mt-1 ${isCoach ? "text-right" : "text-left"}`}>
                          {fmtTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </CardContent>

              {/* Reply input */}
              <div className="flex gap-2.5 px-5 py-3.5 border-t flex-shrink-0">
                <input type="text" placeholder="Reply as coach…" value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                  className="flex-1 border border-border rounded-lg px-3.5 py-2 text-sm bg-secondary/30 outline-none text-slate-800 placeholder:text-muted-foreground"
                  style={{ fontFamily: "'DM Sans', sans-serif" }} />
                <button onClick={handleReply} disabled={sending || !input.trim()}
                  className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 hover:bg-slate-700 transition-colors disabled:opacity-40">
                  {sending ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Send className="w-3.5 h-3.5 text-white" />}
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
