import React, { useEffect, useRef, useState } from "react";
import { apiFetch, ensureCsrf } from "../../lib/api";
import { Send, Plus, Trash2, Pencil, Check, X, Bot, User } from "lucide-react";

type Role = "user" | "assistant";
type Message = { id: number; role: Role; content: string; error?: boolean };
type Convo = { id: number; title: string; updated_at: string; preview: string };

let _id = 0;
const uid = () => ++_id;

const WELCOME: Message = {
  id: uid(), role: "assistant",
  content: "Hi! I'm your nutrition assistant. I have access to your profile, weight history, calorie logs, and today's food entries. Ask me anything!",
};

const SUGGESTED = [
  "Have I hit a weight plateau?",
  "Am I hitting my protein target?",
  "What should I eat to hit my macros today?",
  "How has my calorie intake been this week?",
  "What's a good high-protein snack for my goal?",
];

export function Chatbot() {
  const [convos, setConvos]             = useState<Convo[]>([]);
  const [activeId, setActiveId]         = useState<number | null>(null);
  const [messages, setMessages]         = useState<Message[]>([WELCOME]);
  const [input, setInput]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [model, setModel]               = useState("llama3.1:8b-instruct-q4_0");
  const [editingId, setEditingId]       = useState<number | null>(null);
  const [editTitle, setEditTitle]       = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Load conversations list ──────────────────────────────────────────
  const loadConvos = async () => {
    try {
      const res = await apiFetch("/api/conversations/");
      setConvos(res.conversations || []);
    } catch { /* ignore */ }
    finally { setLoadingConvos(false); }
  };

  useEffect(() => { loadConvos(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Switch to a conversation ─────────────────────────────────────────
  const openConvo = async (id: number) => {
    setActiveId(id);
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await apiFetch(`/api/conversations/${id}/messages/`);
      const msgs: Message[] = (res.messages || []).map((m: any) => ({
        id: uid(), role: m.role as Role, content: m.content,
      }));
      setMessages(msgs.length > 0 ? msgs : [WELCOME]);
    } catch {
      setMessages([WELCOME]);
    } finally {
      setLoadingMsgs(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // ── New conversation ─────────────────────────────────────────────────
  const newConvo = async () => {
    setActiveId(null);
    setMessages([WELCOME]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // ── Delete conversation ──────────────────────────────────────────────
  const deleteConvo = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await ensureCsrf();
    await apiFetch(`/api/conversations/${id}/`, { method: "DELETE" });
    if (activeId === id) { setActiveId(null); setMessages([WELCOME]); }
    setConvos(prev => prev.filter(c => c.id !== id));
  };

  // ── Rename conversation ──────────────────────────────────────────────
  const startRename = (c: Convo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title);
  };
  const saveRename = async (id: number) => {
    if (!editTitle.trim()) { setEditingId(null); return; }
    await ensureCsrf();
    await apiFetch(`/api/conversations/${id}/rename/`, { method: "PATCH", body: JSON.stringify({ title: editTitle }) });
    setConvos(prev => prev.map(c => c.id === id ? { ...c, title: editTitle } : c));
    setEditingId(null);
  };

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    setMessages(prev => [...prev.filter(m => m.content !== WELCOME.content || m.role !== "assistant" || prev.indexOf(m) !== 0), userMsg]);
    setInput("");
    setLoading(true);

    const history = [...messages, userMsg]
      .filter(m => !m.error && m.id !== WELCOME.id)
      .map(({ role, content }) => ({ role, content }));

    try {
      await ensureCsrf();
      const res = await apiFetch("/api/chat/", {
        method: "POST",
        body: JSON.stringify({ messages: history, model, conversation_id: activeId }),
      });

      const assistantMsg: Message = { id: uid(), role: "assistant", content: res.reply || "No response." };
      setMessages(prev => [...prev, assistantMsg]);

      // Update conversation id + title
      if (res.conversation_id) {
        const isNew = !activeId;
        setActiveId(res.conversation_id);
        if (isNew) {
          await loadConvos();
        } else {
          setConvos(prev => prev.map(c =>
            c.id === res.conversation_id
              ? { ...c, title: res.conversation_title || c.title, updated_at: new Date().toISOString(), preview: res.reply?.slice(0, 80) || "" }
              : c
          ));
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: uid(), role: "assistant",
        content: e?.error || e?.detail || "Failed to reach the AI. Is Ollama running?",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  // ── Helpers ──────────────────────────────────────────────────────────
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7)  return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  // Group convos by date
  const grouped: { label: string; items: Convo[] }[] = [];
  const labels: Record<string, Convo[]> = {};
  convos.forEach(c => {
    const label = formatDate(c.updated_at);
    if (!labels[label]) { labels[label] = []; grouped.push({ label, items: labels[label] }); }
    labels[label].push(c);
  });

  return (
    <div style={{ display: "flex", height: "calc(100vh - 8rem)", gap: 0, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#fff" }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 260, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#f8fafc", flexShrink: 0 }}>

        {/* New chat button */}
        <div style={{ padding: "12px 10px", borderBottom: "1px solid #e2e8f0" }}>
          <button onClick={newConvo} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            <Plus style={{ width: 15, height: 15 }} /> New conversation
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {loadingConvos ? (
            <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 16 }}>Loading…</p>
          ) : convos.length === 0 ? (
            <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 16 }}>No conversations yet</p>
          ) : (
            grouped.map(({ label, items }) => (
              <div key={label}>
                <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", padding: "8px 8px 4px", letterSpacing: "0.05em" }}>{label}</p>
                {items.map(c => (
                  <div
                    key={c.id}
                    onClick={() => openConvo(c.id)}
                    style={{
                      padding: "8px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
                      background: activeId === c.id ? "#e2e8f0" : "transparent",
                      position: "relative",
                    }}
                    onMouseEnter={e => { if (activeId !== c.id) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                    onMouseLeave={e => { if (activeId !== c.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    {editingId === c.id ? (
                      <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") setEditingId(null); }}
                          style={{ flex: 1, fontSize: 12, padding: "2px 6px", border: "1px solid #94a3b8", borderRadius: 4 }}
                        />
                        <button onClick={() => saveRename(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#22c55e" }}><Check style={{ width: 14, height: 14 }} /></button>
                        <button onClick={() => setEditingId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><X style={{ width: 14, height: 14 }} /></button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{c.title}</p>
                          {c.preview && <p style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{c.preview}</p>}
                        </div>
                        {activeId === c.id && (
                          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                            <button onClick={e => startRename(c, e)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: 2 }} title="Rename"><Pencil style={{ width: 12, height: 12 }} /></button>
                            <button onClick={e => deleteConvo(c.id, e)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 2 }} title="Delete"><Trash2 style={{ width: 12, height: 12 }} /></button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Model picker */}
        <div style={{ padding: "10px 10px", borderTop: "1px solid #e2e8f0" }}>
          <p style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Model</p>
          <input
            value={model}
            onChange={e => setModel(e.target.value)}
            style={{ width: "100%", fontSize: 11, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* ── Chat area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>
            {activeId ? (convos.find(c => c.id === activeId)?.title || "Conversation") : "New conversation"}
          </p>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {loadingMsgs ? (
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading messages…</p>
          ) : (
            <>
              {messages.map(msg => (
                <div key={msg.id} style={{ display: "flex", gap: 12, marginBottom: 20, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                  {/* Avatar */}
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    background: msg.role === "user" ? "#1e293b" : msg.error ? "#ef4444" : "#64748b",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {msg.role === "user"
                      ? <User style={{ width: 14, height: 14, color: "#fff" }} />
                      : <Bot  style={{ width: 14, height: 14, color: "#fff" }} />}
                  </div>
                  {/* Bubble */}
                  <div style={{
                    maxWidth: "72%", padding: "10px 14px", borderRadius: 16, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                    borderTopRightRadius: msg.role === "user" ? 4 : 16,
                    borderTopLeftRadius:  msg.role === "user" ? 16 : 4,
                    background: msg.role === "user" ? "#1e293b" : msg.error ? "#fef2f2" : "#f1f5f9",
                    color:      msg.role === "user" ? "#fff"    : msg.error ? "#dc2626" : "#0f172a",
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Bot style={{ width: 14, height: 14, color: "#fff" }} />
                  </div>
                  <div style={{ padding: "12px 16px", borderRadius: 16, borderTopLeftRadius: 4, background: "#f1f5f9", display: "flex", gap: 4, alignItems: "center" }}>
                    {[0, 150, 300].map(delay => (
                      <div key={delay} style={{ width: 6, height: 6, borderRadius: "50%", background: "#94a3b8", animation: "bounce 1s infinite", animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested questions */}
              {messages.length <= 1 && !loading && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {SUGGESTED.map(q => (
                    <button key={q} onClick={() => sendMessage(q)} disabled={loading}
                      style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#475569" }}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about nutrition, macros, your progress…"
              disabled={loading}
              autoComplete="off"
              style={{ flex: 1, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none" }}
            />
            <button type="submit" disabled={loading || !input.trim()}
              style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: loading || !input.trim() ? "#e2e8f0" : "#1e293b", color: "#fff", cursor: loading || !input.trim() ? "default" : "pointer", display: "flex", alignItems: "center" }}>
              <Send style={{ width: 16, height: 16 }} />
            </button>
          </form>
        </div>
      </div>

      <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }`}</style>
    </div>
  );
}