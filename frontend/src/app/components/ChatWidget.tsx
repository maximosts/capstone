import React, { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, History, Pencil, Plus, Send, Trash2, User, X } from "lucide-react";
import { apiFetch, ensureCsrf } from "../../lib/api";

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
];

const PROMPTS = [
  "Am I hitting my protein target this week?",
  "Have I hit a weight plateau?",
  "What should I eat to hit my macros today?",
  "How many calories have I averaged this week?",
  "Am I on track with my goals?",
];

export function ChatWidget() {
  const [open, setOpen]                   = useState(false);
  const [showHistory, setShowHistory]     = useState(false);

  const [convos, setConvos]               = useState<Convo[]>([]);
  const [activeId, setActiveId]           = useState<number | null>(null);
  const [messages, setMessages]           = useState<Message[]>([WELCOME]);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMsgs, setLoadingMsgs]     = useState(false);
  const [editingId, setEditingId]         = useState<number | null>(null);
  const [editTitle, setEditTitle]         = useState("");
  const [nudge, setNudge]                 = useState(false);
  const [nudgePrompt]                     = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const loadConvos = async () => {
    try {
      const res = await apiFetch("/api/conversations/");
      setConvos(res.conversations || []);
    } catch { /* ignore */ }
    finally { setLoadingConvos(false); }
  };

  useEffect(() => { loadConvos(); }, []);

  // Show nudge bubble after 4s if widget hasn't been opened yet (once per session)
  useEffect(() => {
    if (sessionStorage.getItem("chat-nudge-seen")) return;
    const t = setTimeout(() => setNudge(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss nudge after 10s
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 10000);
    return () => clearTimeout(t);
  }, [nudge]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const newConvo = () => {
    setActiveId(null);
    setMessages([WELCOME]);
    setInput("");
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const deleteConvo = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await ensureCsrf();
    await apiFetch(`/api/conversations/${id}/`, { method: "DELETE" });
    if (activeId === id) { setActiveId(null); setMessages([WELCOME]); }
    setConvos(prev => prev.filter(c => c.id !== id));
  };

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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    setMessages(prev => [...prev.filter((m, i) => !(i === 0 && m.id === WELCOME.id)), userMsg]);
    setInput("");
    setLoading(true);

    const history = [...messages, userMsg]
      .filter(m => !m.error && m.id !== WELCOME.id)
      .map(({ role, content }) => ({ role, content }));

    try {
      await ensureCsrf();
      const res = await apiFetch("/api/chat/", {
        method: "POST",
        body: JSON.stringify({ messages: history, conversation_id: activeId }),
      });

      setMessages(prev => [...prev, { id: uid(), role: "assistant", content: res.reply || "No response." }]);

      if (res.conversation_id) {
        const isNew = !activeId;
        setActiveId(res.conversation_id);
        if (isNew) { await loadConvos(); }
        else {
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

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  const grouped: { label: string; items: Convo[] }[] = [];
  const labels: Record<string, Convo[]> = {};
  convos.forEach(c => {
    const label = formatDate(c.updated_at);
    if (!labels[label]) { labels[label] = []; grouped.push({ label, items: labels[label] }); }
    labels[label].push(c);
  });

  const activeTitle = activeId ? (convos.find(c => c.id === activeId)?.title || "Conversation") : "New conversation";

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

      {/* ── Expanded panel ── */}
      {open && (
        <div
          className="flex bg-white border border-border rounded-xl shadow-2xl overflow-hidden"
          style={{ width: showHistory ? 620 : 380, height: 520, transition: "width 0.2s ease" }}
        >

          {/* History sidebar */}
          {showHistory && (
            <div className="flex flex-col border-r border-border bg-slate-50 flex-shrink-0" style={{ width: 220 }}>
              {/* New chat */}
              <div className="p-2 border-b border-border">
                <button
                  onClick={newConvo}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New conversation
                </button>
              </div>

              {/* Convo list */}
              <div className="flex-1 overflow-y-auto p-1.5">
                {loadingConvos ? (
                  <p className="text-xs text-muted-foreground text-center p-4">Loading…</p>
                ) : convos.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center p-4">No conversations yet</p>
                ) : grouped.map(({ label, items }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground font-semibold uppercase px-2 py-1.5 tracking-wide">{label}</p>
                    {items.map(c => (
                      <div
                        key={c.id}
                        onClick={() => { openConvo(c.id); setShowHistory(false); }}
                        className={`group/item px-2 py-1.5 rounded-lg cursor-pointer mb-0.5 ${activeId === c.id ? "bg-slate-200" : "hover:bg-slate-100"}`}
                      >
                        {editingId === c.id ? (
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") setEditingId(null); }}
                              className="flex-1 text-xs px-1.5 py-0.5 border border-border rounded"
                            />
                            <button onClick={() => saveRename(c.id)} className="text-green-500"><Check className="w-3 h-3" /></button>
                            <button onClick={() => setEditingId(null)} className="text-muted-foreground"><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{c.title}</p>
                              {c.preview && <p className="text-xs text-muted-foreground truncate">{c.preview}</p>}
                            </div>
                            {activeId === c.id && (
                              <div className="flex gap-0.5 flex-shrink-0">
                                <button onClick={e => startRename(c, e)} className="text-muted-foreground hover:text-foreground p-0.5"><Pencil className="w-3 h-3" /></button>
                                <button onClick={e => deleteConvo(c.id, e)} className="text-red-400 hover:text-red-500 p-0.5"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

            </div>
          )}

          {/* ── Main chat area ── */}
          <div className="flex flex-col flex-1 min-w-0">

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className={`p-1 rounded-md transition-colors ${showHistory ? "bg-slate-200 text-foreground" : "text-muted-foreground hover:bg-slate-100"}`}
                  title="Conversation history"
                >
                  <History className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm font-medium truncate">{activeTitle}</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-slate-100">
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loadingMsgs ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading messages…</p>
              ) : (
                <>
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${msg.role === "user" ? "bg-slate-800" : msg.error ? "bg-red-400" : "bg-slate-500"}`}>
                        {msg.role === "user"
                          ? <User className="w-3 h-3 text-white" />
                          : <Bot  className="w-3 h-3 text-white" />}
                      </div>
                      <div
                        className="text-sm leading-relaxed whitespace-pre-wrap px-3 py-2"
                        style={{
                          maxWidth: "78%",
                          borderRadius: 12,
                          borderTopRightRadius: msg.role === "user" ? 3 : 12,
                          borderTopLeftRadius:  msg.role === "user" ? 12 : 3,
                          background: msg.role === "user" ? "#1e293b" : msg.error ? "#fef2f2" : "#f1f5f9",
                          color:      msg.role === "user" ? "#fff"    : msg.error ? "#dc2626" : "#0f172a",
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-500 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3 h-3 text-white" />
                      </div>
                      <div className="px-3 py-2.5 rounded-xl rounded-tl-sm bg-slate-100 flex gap-1 items-center">
                        {[0, 150, 300].map(d => (
                          <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "#94a3b8", animation: "bounce 1s infinite", animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.length <= 1 && !loading && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {SUGGESTED.map(q => (
                        <button key={q} onClick={() => sendMessage(q)} disabled={loading}
                          className="text-xs px-3 py-1.5 rounded-full border border-border bg-white hover:bg-slate-50 text-slate-600 transition-colors">
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
            <div className="p-2 border-t border-border flex-shrink-0">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask about nutrition, macros…"
                  disabled={loading}
                  autoComplete="off"
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg outline-none focus:border-slate-400 bg-white"
                />
                <button type="submit" disabled={loading || !input.trim()}
                  className="px-3 py-2 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: loading || !input.trim() ? "#e2e8f0" : "#1e293b", color: "#fff" }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Nudge bubble ── */}
      {nudge && !open && (
        <div className="flex items-end gap-2 animate-in slide-in-from-bottom-2 fade-in duration-300">
          <div className="bg-white border border-border rounded-2xl rounded-br-sm shadow-lg px-4 py-3 max-w-[220px]">
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Nutrition assistant</p>
            <p className="text-sm text-slate-800 leading-snug mb-3">"{nudgePrompt}"</p>
            <button
              onClick={() => { setNudge(false); sessionStorage.setItem("chat-nudge-seen", "1"); setOpen(true); sendMessage(nudgePrompt); }}
              className="text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg w-full transition-colors"
            >
              Ask this →
            </button>
          </div>
          <button
            onClick={() => { setNudge(false); sessionStorage.setItem("chat-nudge-seen", "1"); }}
            className="text-muted-foreground hover:text-foreground mb-1 flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Toggle bubble ── */}
      <div className="relative">
        {!open && nudge && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white animate-pulse z-10" />
        )}
        <button
          onClick={() => { setOpen(v => !v); setNudge(false); sessionStorage.setItem("chat-nudge-seen", "1"); }}
          className="w-14 h-14 rounded-full bg-slate-800 hover:bg-slate-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          title="AI nutrition assistant"
        >
          {open ? <X className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes animate-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: animate-in 0.3s ease forwards; }
      `}</style>
    </div>
  );
}
