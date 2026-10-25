/**
 * SendVideoPage — `/send-video` (#219): "Send us your video".
 *
 * Dark by default: the page asks /api/footage/status and shows only a short "not open" note unless the
 * server has RADIO_FOOTAGE_INTAKE_ENABLED=1 (stop-list item 4, DrJ switches it on). The licence terms
 * come from the server, so the page always shows exactly the text that gets stored with the file.
 *
 * Uses fetch rather than the cached axios client: the status must never come from a cache, and the
 * upload is a raw PUT of the file.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Upload, CheckCircle2 } from "lucide-react";

export default function SendVideoPage() {
  const [status, setStatus] = useState(null);
  const [ticks, setTicks] = useState({});
  const [creditMode, setCreditMode] = useState("name");
  const [creditValue, setCreditValue] = useState("");
  const [details, setDetails] = useState({ description: "", place: "", filmedAt: "", contact: "" });
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ phase: "form", error: null });

  useEffect(() => {
    const prev = document.title;
    document.title = "Send us your video — Scoopfeeds";
    fetch("/api/footage/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { open: false }))
      .then(setStatus)
      .catch(() => setStatus({ open: false }));
    return () => { document.title = prev; };
  }, []);

  if (!status) return null;
  if (!status.open) {
    return (
      <article className="max-w-2xl mx-auto py-8">
        <p className="text-sm text-[var(--color-text-secondary)]">This page is not open yet.</p>
      </article>
    );
  }

  const terms = status.licence.terms;
  const allTicked = terms.every((t) => ticks[t.key] === true);
  const creditOk = creditMode === "anonymous" || creditValue.trim().length > 0;
  const tooBig = file && file.size > status.maxBytes;
  const canSend = allTicked && creditOk && file && !tooBig && state.phase === "form";

  async function send(e) {
    e.preventDefault();
    if (!canSend) return;
    setState({ phase: "sending", error: null });
    try {
      const r = await fetch("/api/footage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          licence: { version: status.licence.version, ticks, credit: { mode: creditMode, value: creditMode === "anonymous" ? null : creditValue.trim() } },
          description: details.description || null, place: details.place || null, filmedAt: details.filmedAt || null, contact: details.contact || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not start the upload");
      const up = await fetch(`/api/footage/${j.id}/file`, { method: "PUT", headers: { "content-type": file.type || "video/mp4", "x-upload-token": j.uploadToken }, body: file });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(uj.error || "Upload failed");
      setState({ phase: "done", error: null });
    } catch (err) {
      setState({ phase: "form", error: err.message });
    }
  }

  if (state.phase === "done") {
    return (
      <article className="max-w-2xl mx-auto py-8">
        <div className="flex items-start gap-3 p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CheckCircle2 size={20} className="text-electric-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-[var(--color-text)]">Thank you. We have your video.</p>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              An editor checks every video before anything airs. We may not use it.
            </p>
          </div>
        </div>
      </article>
    );
  }

  const input = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm";
  return (
    <article className="max-w-2xl mx-auto py-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] mb-6">
        <ChevronLeft size={14} /> Back to home
      </Link>
      <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}>
        Send us your video
      </h1>
      <p className="text-sm text-[var(--color-text-secondary)] mt-2 mb-6">
        Filmed something newsworthy yourself? Send it here. Please stay safe: never put yourself in danger to film.
        We check every video and an editor approves it before it can air.
      </p>

      <form onSubmit={send} className="space-y-6">
        <section className="space-y-2">
          <label className="block text-sm font-semibold">Your video</label>
          <input type="file" accept={status.types.join(",")} onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          {tooBig && <p className="text-sm text-red-600">That file is over {Math.round(status.maxBytes / 1048576)} MB.</p>}
        </section>

        <section className="space-y-2">
          <label className="block text-sm font-semibold">About it (optional)</label>
          <textarea className={input} rows={3} maxLength={2000} placeholder="What happened?" value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} />
          <input className={input} maxLength={200} placeholder="Where was it filmed?" value={details.place} onChange={(e) => setDetails({ ...details, place: e.target.value })} />
          <input className={input} maxLength={40} placeholder="When was it filmed?" value={details.filmedAt} onChange={(e) => setDetails({ ...details, filmedAt: e.target.value })} />
          <input className={input} maxLength={200} placeholder="Email, if we may contact you" value={details.contact} onChange={(e) => setDetails({ ...details, contact: e.target.value })} />
        </section>

        <section className="space-y-2">
          <label className="block text-sm font-semibold">How should we credit you?</label>
          <div className="flex gap-4 text-sm">
            {status.licence.creditModes.map((m) => (
              <label key={m} className="inline-flex items-center gap-1.5">
                <input type="radio" name="credit" checked={creditMode === m} onChange={() => setCreditMode(m)} />
                {m === "name" ? "My name" : m === "handle" ? "My @handle" : "Don't name me"}
              </label>
            ))}
          </div>
          {creditMode !== "anonymous" && (
            <input className={input} maxLength={60} placeholder={creditMode === "name" ? "Your name" : "@handle"} value={creditValue} onChange={(e) => setCreditValue(e.target.value)} />
          )}
        </section>

        <section className="space-y-2 p-4 rounded-2xl border border-[var(--color-border)]">
          <p className="text-sm font-semibold">Your permission</p>
          {terms.map((t) => (
            <label key={t.key} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
              <input type="checkbox" className="mt-1" checked={ticks[t.key] === true} onChange={(e) => setTicks({ ...ticks, [t.key]: e.target.checked })} />
              <span>{t.text}</span>
            </label>
          ))}
        </section>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={!canSend} className="inline-flex items-center gap-2 rounded-lg bg-electric-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          <Upload size={16} /> {state.phase === "sending" ? "Sending…" : "Send video"}
        </button>
      </form>
    </article>
  );
}
