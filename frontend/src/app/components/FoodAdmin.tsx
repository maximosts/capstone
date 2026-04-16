import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, ensureCsrf } from "../../lib/api";

type FoodRow = {
  id: number; name: string; brand: string; category: string;
  kcal: number; protein: number; carbs: number; fat: number; source: string;
};
type CategoryStat = { category: string; n: number };
type ApiResponse = {
  total: number; page: number; per_page: number; pages: number;
  categories: CategoryStat[]; foods: FoodRow[];
};


export function FoodAdmin() {
  const [data, setData]         = useState<ApiResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [query, setQuery]       = useState("");
  const [page, setPage]         = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm]   = useState<{ label: string; action: object } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams({ page: String(page) });
      if (category) p.set("category", category);
      if (query) p.set("q", query);
      const res = await apiFetch(`/api/food-db/?${p}`);
      setData(res); setSelected(new Set());
    } catch (e: any) {
      setErr(e?.error || e?.detail || e?.message || String(e));
    } finally { setLoading(false); }
  }, [page, category, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [category, query]);

  const deleteSingle = async (id: number) => {
    try { await ensureCsrf(); await apiFetch(`/api/food-db/${id}/`, { method: "DELETE" }); showToast("Deleted"); load(); }
    catch (e: any) { setErr(e?.error || e?.detail || "Delete failed"); }
  };

  const bulkAction = async (action: object) => {
    setDeleting(true);
    try {
      await ensureCsrf();
      const res = await apiFetch("/api/food-db/bulk-delete/", { method: "POST", body: JSON.stringify(action) });
      showToast(`Deleted ${res.deleted} entries`);
      setConfirm(null); setCategory(""); setQuery(""); setPage(1); load();
    } catch (e: any) { setErr(e?.error || e?.detail || "Bulk delete failed"); }
    finally { setDeleting(false); }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    if (!data) return;
    const ids = data.foods.map(f => f.id);
    const allOn = ids.every(id => selected.has(id));
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => allOn ? n.delete(id) : n.add(id)); return n; });
  };
  const allSelected = !!data && data.foods.length > 0 && data.foods.every(f => selected.has(f.id));

  const s = (obj: React.CSSProperties) => obj;

  return (
    <div>
      {toast && <div style={{ position:"fixed",top:16,right:16,background:"#1e293b",color:"#fff",padding:"8px 16px",borderRadius:8,zIndex:9999,fontSize:13 }}>{toast}</div>}

      {confirm && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }}>
          <div style={{ background:"#fff",borderRadius:12,padding:24,maxWidth:400,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
            <p style={{ fontWeight:600,marginBottom:8 }}>Delete "{confirm.label}"?</p>
            <p style={{ fontSize:13,color:"#64748b",marginBottom:20 }}>Permanently removes these foods. Cannot be undone.</p>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <button onClick={() => setConfirm(null)} disabled={deleting} style={{ padding:"6px 14px",borderRadius:6,border:"1px solid #e2e8f0",cursor:"pointer",background:"#fff" }}>Cancel</button>
              <button onClick={() => bulkAction(confirm.action)} disabled={deleting} style={{ padding:"6px 14px",borderRadius:6,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer" }}>{deleting ? "Deleting…" : "Yes, Delete"}</button>
            </div>
          </div>
        </div>
      )}

      <h2 style={{ marginBottom:4 }}>Food Database</h2>
      <p style={{ fontSize:13,color:"#64748b",marginBottom:24 }}>{data ? `${data.total.toLocaleString()} foods` : "Loading…"}</p>

      {err && <div style={{ background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626" }}>{err}</div>}

      {/* Browser */}
      <div style={{ display:"grid",gridTemplateColumns:"200px 1fr",gap:16 }}>

        {/* Sidebar */}
        <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,overflow:"auto",maxHeight:600 }}>
          <div style={{ padding:"8px 12px",borderBottom:"1px solid #e2e8f0",fontWeight:600,fontSize:11,color:"#64748b",textTransform:"uppercase" }}>Categories</div>
          <button onClick={() => setCategory("")} style={{ width:"100%",textAlign:"left",padding:"8px 12px",fontSize:12,background:!category?"#f1f5f9":"#fff",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between" }}>
            <span>All</span><span style={{ color:"#94a3b8" }}>{data?.total ?? ""}</span>
          </button>
          {(data?.categories ?? []).map(({ category: cat, n }) => (
            <button key={cat} onClick={() => setCategory(cat)} style={{ width:"100%",textAlign:"left",padding:"6px 12px",fontSize:11,background:category===cat?"#f1f5f9":"#fff",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",gap:4 }}>
              <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{cat || "Uncategorised"}</span>
              <span style={{ color:"#94a3b8",flexShrink:0 }}>{n}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <div style={{ display:"flex",gap:8 }}>
            <input type="text" placeholder="Search name or brand…" value={query} onChange={e => setQuery(e.target.value)}
              style={{ flex:1,padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13 }} />
            {selected.size > 0 && (
              <button onClick={() => bulkAction({ ids: Array.from(selected) })} disabled={deleting}
                style={{ padding:"7px 14px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13 }}>
                🗑 Delete {selected.size}
              </button>
            )}
            {category && (
              <button onClick={() => setConfirm({ label: category, action: { category } })}
                style={{ padding:"7px 14px",borderRadius:8,border:"1px solid #fca5a5",background:"#fff",color:"#dc2626",cursor:"pointer",fontSize:13 }}>
                Delete category
              </button>
            )}
          </div>

          <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden" }}>
            <div style={{ display:"flex",gap:12,padding:"8px 12px",borderBottom:"1px solid #e2e8f0",background:"#f8fafc",fontSize:11,color:"#64748b",fontWeight:600 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span style={{ flex:1 }}>Name</span>
              <span style={{ width:180,textAlign:"right" }}>Macros/100g</span>
              <span style={{ width:24 }} />
            </div>
            <div style={{ maxHeight:500,overflowY:"auto" }}>
              {loading && <p style={{ padding:24,textAlign:"center",color:"#94a3b8",fontSize:13 }}>Loading…</p>}
              {!loading && (data?.foods ?? []).length === 0 && <p style={{ padding:24,textAlign:"center",color:"#94a3b8",fontSize:13 }}>No foods found</p>}
              {!loading && (data?.foods ?? []).map(food => (
                <div key={food.id} style={{ display:"flex",gap:12,padding:"8px 12px",borderBottom:"1px solid #f8fafc",alignItems:"center",fontSize:13 }}>
                  <input type="checkbox" checked={selected.has(food.id)} onChange={() => toggleSelect(food.id)} />
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{food.name}</div>
                    <div style={{ fontSize:11,color:"#94a3b8" }}>{food.brand && `${food.brand} · `}{food.category}{food.source?.startsWith("user:") ? " · custom" : ""}</div>
                  </div>
                  <div style={{ width:180,textAlign:"right",fontSize:11,color:"#64748b" }}>{food.kcal} kcal · P{food.protein} C{food.carbs} F{food.fat}</div>
                  <button onClick={() => deleteSingle(food.id)} style={{ width:24,background:"none",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:15 }} title="Delete">✕</button>
                </div>
              ))}
            </div>
            {data && data.pages > 1 && (
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderTop:"1px solid #e2e8f0",fontSize:13 }}>
                <span style={{ color:"#64748b" }}>Page {data.page} of {data.pages} ({data.total} total)</span>
                <div style={{ display:"flex",gap:4 }}>
                  <button onClick={() => setPage(p => p-1)} disabled={page<=1} style={{ padding:"4px 10px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",cursor:"pointer" }}>‹</button>
                  <button onClick={() => setPage(p => p+1)} disabled={page>=data.pages} style={{ padding:"4px 10px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",cursor:"pointer" }}>›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}