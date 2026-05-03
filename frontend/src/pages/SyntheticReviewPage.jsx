/**
 * SyntheticReviewPage — /scoop-ops/synthetic — editor review queue.
 *
 * Lists all synthetic markets with their LLM-proposed outcomes (when the
 * outcomeResolver cron has fired), severity-coded by confidence. Admin can:
 *   - one-click confirm a proposal (POSTs to /scoop-ops/ri-ops/synthetic/:id/resolve)
 *   - manually pick a different outcome
 *   - trigger the question extractor or outcome resolver on demand
 *   - create a new market from scratch via inline form
 *
 * Admin key reused from RealityIndexOpsPage (localStorage scoop_admin_key).
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Check, RefreshCw, Play, Key, PlusCircle, Bot, ShieldCheck } from "lucide-react";

const KEY_STORAGE = "scoop_admin_key";

function fmtTs(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}
function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }

function confidenceBadge(c) {
  if (c == null) return { label: "no proposal yet", color: "bg-gray-100 dark:bg-gray-800 text-gray-600" };
  if (c >= 0.8)  return { label: `${fmtPct(c)} confident`, color: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300" };
  if (c >= 0.5)  return { label: `${fmtPct(c)} confident`, color: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" };
  return { label: `${fmtPct(c)} — escalate`, color: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" };
}

export default function SyntheticReviewPage() {
  const [adminKey, setAdminKey] = useState(() => {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [newQ, setNewQ] = useState("");

  const k = (encodeURIComponent(adminKey || ""));
  const auth = adminKey ? `?key=${k}` : "";

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/scoop-ops/ri-ops/synthetic/queue${auth}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setItems(j.items || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [auth]);

  useEffect(() => {
    if (adminKey) { try { localStorage.setItem(KEY_STORAGE, adminKey); } catch {} }
    refresh();
  }, [adminKey, refresh]);

  const callOp = async (path, body = {}) => {
    setErr(null);
    const r = await fetch(`/scoop-ops/ri-ops/${path}${auth}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      setErr(j.error || `HTTP ${r.status}`);
      return null;
    }
    return j;
  };

  const onConfirm   = async (id, outcome) => { if (await callOp(`synthetic/${id}/resolve`, { outcome })) refresh(); };
  const onExtract   = async () => { await callOp("synthetic/extract", { limit: 3 }); refresh(); };
  const onPropose   = async () => { await callOp("synthetic/propose-outcomes", { limit: 5 }); refresh(); };
  const onCreate    = async () => {
    if (!newQ.trim()) return;
    if (await callOp("synthetic/create", { question: newQ.trim(), initial_liquidity: 100 })) {
      setNewQ("");
      refresh();
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-editorial italic text-[var(--color-text)] flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--color-accent)]" /> Synthetic Markets — Editor
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Review LLM-proposed outcomes before they settle. Drafts only.
          </p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)]">
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {/* Admin key */}
      <div className="flex items-center gap-2 mb-4 p-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <Key size={13} className="text-[var(--color-text-secondary)]" />
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder="ADMIN_KEY"
          className="flex-1 bg-transparent text-xs outline-none tabular-nums"
        />
        <span className="text-[10px] text-[var(--color-text-tertiary)]">Stored locally</span>
      </div>

      {/* Inline create + on-demand triggers */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={newQ}
          onChange={e => setNewQ(e.target.value)}
          placeholder="Will X happen by Y date?"
          className="flex-1 min-w-[16rem] px-3 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
        />
        <button onClick={onCreate} disabled={!adminKey || !newQ.trim()} className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-full bg-[var(--color-accent)] text-white font-semibold disabled:opacity-50">
          <PlusCircle size={11} /> Create
        </button>
        <button onClick={onExtract} disabled={!adminKey} className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-full border border-[var(--color-border)] disabled:opacity-50">
          <Bot size={11} /> Extract from events
        </button>
        <button onClick={onPropose} disabled={!adminKey} className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-full border border-[var(--color-border)] disabled:opacity-50">
          <Play size={11} /> Propose outcomes
        </button>
      </div>

      {err && <div className="mb-3 text-xs text-red-500 px-2">⚠ {err}</div>}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No synthetic markets yet. Use Create or Extract from events to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map(m => {
            const cb = confidenceBadge(m.proposed_confidence);
            const dueIn = m.end_date ? Math.round((m.end_date - Date.now()) / 86400000) : null;
            return (
              <div key={m.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {m.resolved
                    ? <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-800">Resolved · {m.outcome}</span>
                    : <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Open</span>}
                  {!m.resolved && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cb.color}`}>{cb.label}</span>}
                  <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">
                    Ends {fmtDate(m.end_date)}
                    {Number.isFinite(dueIn) && (dueIn <= 0 ? " · past due" : ` · ${dueIn}d`)}
                  </span>
                </div>
                <p className="text-sm font-medium text-[var(--color-text)] leading-snug mb-1">
                  <Link to={`/synthetic/${m.id}`} className="hover:text-[var(--color-accent)]" target="_blank">{m.question}</Link>
                </p>
                {m.description && <p className="text-xs text-[var(--color-text-secondary)] mb-2">{m.description}</p>}
                <div className="flex gap-3 text-[10px] text-[var(--color-text-tertiary)] tabular-nums mb-2">
                  <span>YES <b>{fmtPct(m.yes_price)}</b></span>
                  <span>Vol ${Math.round(m.total_volume)}</span>
                  {m.proposed_at && <span>Proposed {fmtTs(m.proposed_at)}</span>}
                </div>
                {m.proposed_outcome && !m.resolved && (
                  <div className="text-xs bg-[var(--color-surface-2)] p-2 rounded mb-2">
                    <div className="font-semibold mb-1">
                      LLM proposes: <span className="uppercase tabular-nums">{m.proposed_outcome}</span>
                    </div>
                    <p className="text-[var(--color-text-secondary)] italic">{m.proposed_reasoning}</p>
                    {m.proposed_sources && (
                      <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">Sources weighted: {m.proposed_sources}</p>
                    )}
                  </div>
                )}
                {!m.resolved && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {["yes", "no", "cancel"].map(o => (
                      <button
                        key={o}
                        onClick={() => onConfirm(m.id, o)}
                        disabled={!adminKey}
                        className={`text-xs px-3 py-1 rounded-full font-semibold border disabled:opacity-50 transition-colors ${
                          m.proposed_outcome === o
                            ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                            : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
                        }`}
                      >
                        <Check size={11} className="inline mr-0.5" /> Resolve {o.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
