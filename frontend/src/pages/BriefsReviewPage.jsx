/**
 * BriefsReviewPage — /scoop-ops/briefs — admin review queue.
 *
 * Operator approves/rejects LLM-drafted briefs. Approved ones flip to
 * status='published' and appear at /briefs. Rejected ones are kept for
 * audit but never surfaced publicly.
 *
 * Admin key reused from RealityIndexOpsPage (localStorage scoop_admin_key).
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Check, X, FileText, RefreshCw, Play, Key } from "lucide-react";

const KEY_STORAGE = "scoop_admin_key";

function fmtTs(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const STATUSES = [
  { id: "draft",     label: "Drafts" },
  { id: "published", label: "Published" },
  { id: "rejected",  label: "Rejected" },
];

export default function BriefsReviewPage() {
  const [key, setKey]       = useState(() => { try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; } });
  const [status, setStatus] = useState("draft");
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [generating, setGenerating] = useState(false);

  const qs = key ? `?key=${encodeURIComponent(key)}` : "";

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/scoop-ops/ri-ops/briefs${qs}&status=${status}`.replace(/\?&/, '?'));
      if (!r.ok) throw new Error(r.status === 404 ? "Wrong admin key (or endpoint not found)" : `HTTP ${r.status}`);
      const j = await r.json();
      setItems(j.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [qs, status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const act = async (id, action, note) => {
    const url = `/scoop-ops/ri-ops/briefs/${id}/${action}${qs}` + (note ? `&note=${encodeURIComponent(note)}` : '');
    await fetch(url.replace(/\?&/, '?'), { method: "POST" });
    fetchData();
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await fetch(`/scoop-ops/ri-ops/briefs/run${qs}`, { method: "POST" });
      await new Promise(r => setTimeout(r, 1500));
      fetchData();
    } finally { setGenerating(false); }
  };

  const saveKey = (e) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get("key");
    try { localStorage.setItem(KEY_STORAGE, v); } catch {}
    setKey(v);
  };

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="flex items-center gap-2 mb-3"><Key size={16} /><h1 className="font-editorial italic text-xl">Admin key</h1></div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">{error}</p>
        <form onSubmit={saveKey} className="flex gap-2">
          <input name="key" type="password" placeholder="ADMIN_KEY" className="flex-1 px-3 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)]" />
          <button type="submit" className="px-4 py-2 text-sm rounded bg-[var(--color-accent)] text-white font-semibold">Save</button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText size={18} className="text-[var(--color-accent)]" />
            <h1 className="font-editorial italic text-2xl">Briefs review queue</h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Drafts wait here for editor approval before landing on /briefs. Plan §5J — no auto-publish path in v1.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={generate} disabled={generating}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50">
            <Play size={11} className={generating ? "animate-pulse" : ""} /> {generating ? "Generating…" : "Generate now"}
          </button>
          <button onClick={fetchData} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <div className="flex gap-2 mb-4">
        {STATUSES.map(s => (
          <button key={s.id} onClick={() => setStatus(s.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${status === s.id ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 bg-[var(--color-surface-2)] animate-pulse rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">No {status} briefs.</p>
      ) : (
        <div className="space-y-3">
          {items.map(b => (
            <div key={b.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <h2 className="font-semibold text-base text-[var(--color-text)] leading-snug">{b.title}</h2>
                  <p className="text-sm text-[var(--color-text-secondary)] italic mt-1">{b.thesis}</p>
                </div>
                <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums whitespace-nowrap">
                  {fmtTs(b.created_at)}
                </span>
              </div>

              <details className="mt-2">
                <summary className="text-xs text-[var(--color-text-secondary)] cursor-pointer">Body + evidence ({b.evidence?.length ?? 0})</summary>
                <pre className="text-xs bg-[var(--color-surface-2)] p-3 mt-2 rounded whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto">{b.body_md}</pre>
                <ol className="mt-2 list-decimal pl-5 text-xs space-y-1">
                  {(b.evidence || []).map((e, i) => (
                    <li key={i}>
                      <strong>{e.kind}:</strong> {e.claim}{" "}
                      <code className="text-[10px] text-[var(--color-text-tertiary)] font-mono break-all">{e.ref_id}</code>
                    </li>
                  ))}
                </ol>
              </details>

              <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
                <span>Confidence {b.confidence != null ? `${Math.round(b.confidence * 100)}%` : "—"}</span>
                <span>·</span>
                <span>{b.provider || "?"} ({b.model || "?"})</span>
                {b.event_id && <><span>·</span><Link to={`/events/`} className="text-[var(--color-accent)] underline">event ↗</Link></>}
              </div>

              {status === "draft" && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
                  <button onClick={() => act(b.id, "approve")}
                          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-green-600 text-white font-semibold hover:bg-green-700">
                    <Check size={11} /> Approve & publish
                  </button>
                  <button onClick={() => act(b.id, "reject", prompt("Rejection note?") || "")}
                          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-red-400 hover:text-red-600">
                    <X size={11} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
