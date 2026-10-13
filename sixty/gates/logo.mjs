/**
 * logo.mjs — the source-logo rule of the QA gate (footage ruling 2 Oct + DrJ 13 Oct 2026). Hard gate.
 *
 * A source's own logo/watermark is never cropped off. Every footage shot (a plan shot with `path` and
 * `cams`) must say where the source's logo sits: `logo` = a corner code ("tl"|"tr"|"bl"|"br"), a box
 * [x0,y0,x1,y1] normalised 0-1 in the source frame, or "none" (the Researcher looked and there is none).
 * sixty/render/render60.py then shows the footage as a full-width 16:9 band whenever the 9:16 crop would
 * cut that logo, and records every decision in layout.json. This check reads both.
 *
 *   logoProblems(plan, layout) -> string[]   (empty = pass)
 */
const CORNERS = ["tl", "tr", "bl", "br"];

export function validLogo(v) {
  if (v === "none" || v === null) return true;
  if (typeof v === "string") return CORNERS.includes(v.toLowerCase());
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const [x0, y0, x1, y1] = v;
  return x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1;
}

export const isFootage = (s) => typeof s?.path === "string" && Array.isArray(s?.cams);

export function logoProblems(plan, layout) {
  const problems = [];
  const entries = Array.isArray(layout?.shots) ? layout.shots : null;
  (plan?.shots || []).forEach((s, i) => {
    if (!isFootage(s)) return;
    if (!("logo" in s)) { problems.push(`shot ${i} (${s.t0}s): footage does not say where the source logo is (add "logo": corner, box or "none")`); return; }
    if (!validLogo(s.logo)) { problems.push(`shot ${i} (${s.t0}s): logo ${JSON.stringify(s.logo)} is not tl|tr|bl|br, a [x0,y0,x1,y1] box in 0-1, or "none"`); return; }
    if (s.logo === "none" || s.logo === null) return;                      // attested: no logo (the QA agent still looks)
    if (!entries) { problems.push(`shot ${i} (${s.t0}s): declares a logo but layout.json is missing — the renderer did not record the layout`); return; }
    const e = entries.find((x) => Math.abs(x.t0 - s.t0) < 0.01 && x.path === s.path);
    if (!e) problems.push(`shot ${i} (${s.t0}s): no layout record for this footage`);
    else if (e.layout === "band") { /* logo shown whole */ }
    else if (e.layout === "crop" && e.logo_in_crop === true) { /* the crop window contains the logo at every sampled moment */ }
    else if (e.layout === "custom") problems.push(`shot ${i} (${s.t0}s): per-film code draws this footage with its own frame(); its logo handling cannot be verified — build it with E.Clip(..., overlay=fn) so render60.py lays it out`);
    else problems.push(`shot ${i} (${s.t0}s): layout ${e.layout} did not keep the logo (logo_in_crop=${e.logo_in_crop})`);
  });
  return problems;
}
