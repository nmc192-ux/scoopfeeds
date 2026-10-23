/**
 * mapScene.js — renders the election map state (mapState.js) as a self-contained
 * 1920×1080 page for the playout's Chromium (#204). Pure: state in, HTML out.
 *
 * Signal identity (backend/src/radio/brand/README.md): navy ground, paper ink,
 * Bodoni Moda for titles, Schibsted Grotesk for labels and data. Party colours are the
 * standard US ones (DrJ, 22 Oct): blue = Democratic, red = Republican, grey = not
 * called, hatched = no race. Source, "Projected by" and "% reporting" lines are ≥ 26 px
 * (DrJ: phone-first, ≥ 26 px at 1080p).
 *
 * Earn-render: the Senate/House bars and the calls list render only when they have
 * data. The tile grid always renders (an all-grey map on the night is a true picture).
 */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const COLOURS = Object.freeze({
  D: "#2A62C9", R: "#C8302B", other: "#8A6FB8", uncalled: "#4A5566", ground: "#0F2238", paper: "#F4EFE6", line: "#2A3D57",
});
export const MIN_SOURCE_PX = 26;

const TILE = 88, GAP = 6;

function timeET(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  } catch { return ""; }
}

const outletsOf = (t) => [...new Set((t.projections || []).map((p) => p.outlet))];

function tileHtml(t) {
  const x = t.col * (TILE + GAP), y = t.row * (TILE + GAP);
  let cls = `tile ${t.status}`, style = `left:${x}px;top:${y}px;`, sub = "";
  if (t.status === "called") {
    style += `background:${COLOURS[t.party] || COLOURS.other};`;
    sub = `<span class="by">${esc(outletsOf(t).join(" · "))}</span>`;
  } else if (t.status === "conflict") {
    sub = `<span class="by">${t.projections.length} calls</span>`;
  } else if (t.status === "uncalled" && t.count?.percentReporting != null) {
    sub = `<span class="by">${esc(Math.round(t.count.percentReporting))}%</span>`;
  }
  return `<div class="${cls}" style="${style}" data-state="${esc(t.state)}" title="${esc(t.name)}"><span class="ab">${esc(t.state)}</span>${sub}</div>`;
}

function senateBarHtml(bar) {
  const seg = (n, c) => (n > 0 ? `<div class="seg" style="flex:${n};background:${c}"><span>${n}</span></div>` : "");
  const open = bar.seats - bar.D - bar.R - bar.I - bar.other;
  return `<section class="ctl">
  <h2>Senate</h2>
  <div class="bar">${seg(bar.D, COLOURS.D)}${seg(bar.I, "#6F86A8")}${seg(open, COLOURS.uncalled)}${seg(bar.other, COLOURS.other)}${seg(bar.R, COLOURS.R)}<i class="maj" style="left:${(bar.majority / bar.seats) * 100}%"></i></div>
  <p class="legend"><b style="color:#8FB0F0">Democrats ${bar.D}</b>${bar.I ? ` · Independents ${bar.I}` : ""} · <b style="color:#F0928D">Republicans ${bar.R}</b> · ${bar.uncalled} not yet called</p>
  <p class="src">Seats not up this year + seats projected by a named outlet. ${bar.majority} for a majority.</p>
</section>`;
}

function houseBarHtml(house) {
  if (!house.reports.length) return "";
  const rows = house.reports.slice(0, 2).map((r) => {
    const d = r.seats.D || 0, rep = r.seats.R || 0, open = Math.max(0, house.seats - d - rep);
    return `<div class="bar sm"><div class="seg" style="flex:${d};background:${COLOURS.D}"><span>${d}</span></div><div class="seg" style="flex:${open};background:${COLOURS.uncalled}"></div><div class="seg" style="flex:${rep};background:${COLOURS.R}"><span>${rep}</span></div><i class="maj" style="left:${(house.majority / house.seats) * 100}%"></i></div>
<p class="src">Projected by ${esc(r.outlet)} · ${esc(timeET(r.at))}</p>`;
  }).join("");
  const more = house.reports.length > 2 ? `<p class="src">+${house.reports.length - 2} more outlets reporting</p>` : "";
  return `<section class="ctl"><h2>House</h2>${rows}${more}<p class="src">${house.majority} for a majority</p></section>`;
}

function callsHtml(tiles, max = 6) {
  const called = tiles.filter((t) => t.status === "called" || t.status === "conflict")
    .map((t) => ({ t, at: (t.projections || []).map((p) => p.at).sort().pop() || "" }))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!called.length) return "";
  const lines = called.slice(0, max).map(({ t }) => {
    if (t.status === "conflict") {
      const parts = t.projections.map((p) => `${esc(p.outlet)}: ${esc(p.candidate || p.party)}`).join(" · ");
      return `<li><b>${esc(t.name)}</b> <span class="flag">outlets disagree</span><br><span class="src">${parts}</span></li>`;
    }
    const p = t.projections[t.projections.length - 1];
    return `<li><b style="color:${t.party === "D" ? "#8FB0F0" : t.party === "R" ? "#F0928D" : "#C9B7E8"}">${esc(t.name)}</b> ${esc(p.candidate || "")}<br><span class="src">Projected by ${esc(outletsOf(t).join(", "))} · ${esc(timeET(p.at))}</span></li>`;
  }).join("");
  const more = called.length > max ? `<li class="src">+${called.length - max} more called: each tile shows its outlet</li>` : "";
  return `<section class="calls"><h2>Latest calls</h2><ul>${lines}${more}</ul></section>`;
}

function countingHtml(tiles, max = 3) {
  const rows = tiles.filter((t) => t.status !== "called" && t.status !== "no-race" && t.count?.shares?.length)
    .sort((a, b) => (b.count.percentReporting ?? 0) - (a.count.percentReporting ?? 0)).slice(0, max);
  if (!rows.length) return "";
  return `<section class="calls"><h2>Counting · not called</h2><ul>${rows.map((t) => {
    const s = t.count.shares.slice(0, 2).map((c) => `${esc(c.name || c.party)} ${c.percent == null ? "" : esc(c.percent.toFixed(1)) + "%"}`).join(" · ");
    const pr = t.count.percentReporting == null ? "counting continues" : `${esc(Math.round(t.count.percentReporting))}% reporting`;
    return `<li><b>${esc(t.name)}</b> ${s}<br><span class="src">${pr} · Source: ${esc(t.count.source)} · ${esc(timeET(t.count.at))}</span></li>`;
  }).join("")}</ul></section>`;
}

/** @param {object} state  buildMapState() output   @param {"senate"|"governor"} view */
export function renderMapHtml(state, { view = "senate" } = {}) {
  const v = view === "governor" ? "governor" : "senate";
  const tiles = state[v].tiles;
  const title = v === "senate" ? "Senate: projected winners" : "Governors: projected winners";
  const gridW = 12 * TILE + 11 * GAP, gridH = 8 * TILE + 7 * GAP;
  // Footer names only the sources on THIS view.
  const projOutlets = new Set(tiles.flatMap((t) => (t.projections || []).map((p) => p.outlet)));
  if (v === "senate") for (const r of state.house.reports) projOutlets.add(r.outlet);
  const countSrc = [...new Set(tiles.map((t) => t.count?.source).filter(Boolean))].sort();
  const sources = projOutlets.size ? [...projOutlets].sort().join(" · ") : "none yet";
  const counts = countSrc.length
    ? ` · Vote counts: ${countSrc.map((s) => (s === "civicAPI" ? "civicAPI (civicapi.org)" : s)).join(" · ")}`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ScoopFeeds Radio · Election map</title>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;1,500&family=Schibsted+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;background:${COLOURS.ground};}
.frame{width:1920px;height:1080px;background:${COLOURS.ground};color:${COLOURS.paper};font-family:'Schibsted Grotesk',Arial,sans-serif;position:relative;overflow:hidden;}
header{position:absolute;left:64px;top:40px;right:64px;display:flex;justify-content:space-between;align-items:baseline;}
h1{font-family:'Bodoni Moda',Georgia,serif;font-weight:500;font-size:56px;margin:0;}
h1 em{color:#FF4A3D;font-style:italic;}
.stamp{font-size:28px;opacity:.85;}
.grid{position:absolute;left:64px;top:150px;width:${gridW}px;height:${gridH}px;}
.tile{position:absolute;width:${TILE}px;height:${TILE}px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${COLOURS.uncalled};}
.tile .ab{font-weight:700;font-size:30px;letter-spacing:.02em;}
.tile .by{font-size:16px;font-weight:600;margin-top:2px;max-width:${TILE - 6}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.tile.no-race{background:repeating-linear-gradient(45deg,#1A2E48 0 8px,#24395A 8px 16px);color:#7F90A8;}
.tile.conflict{outline:4px dashed #F2C14E;outline-offset:-4px;}
aside{position:absolute;left:${64 + gridW + 48}px;right:64px;top:150px;bottom:150px;display:flex;flex-direction:column;gap:18px;overflow:hidden;}
h2{font-family:'Bodoni Moda',Georgia,serif;font-weight:500;font-size:34px;margin:0 0 8px;}
.bar{position:relative;display:flex;height:48px;border-radius:6px;overflow:hidden;}
.bar.sm{height:36px;}
.seg{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:24px;min-width:0;}
.maj{position:absolute;top:-4px;bottom:-4px;width:3px;background:${COLOURS.paper};}
.legend{font-size:26px;margin:8px 0 0;}
.src{font-size:${MIN_SOURCE_PX}px;opacity:.9;margin:6px 0 0;}
.calls ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;font-size:28px;}
.flag{color:#F2C14E;font-size:26px;}
footer{position:absolute;left:64px;right:64px;bottom:36px;font-size:${MIN_SOURCE_PX}px;opacity:.9;}
</style></head><body><div class="frame" data-view="${v}">
<header><h1>Midterms <em>2026</em> · ${esc(title)}</h1><span class="stamp">Updated ${esc(timeET(state.updatedAt))}</span></header>
<div class="grid">${tiles.map(tileHtml).join("")}</div>
<aside>${v === "senate" ? senateBarHtml(state.senate.bar) + houseBarHtml(state.house) : ""}${callsHtml(tiles, v === "senate" ? (state.house.reports.length ? 2 : 3) : 6)}${countingHtml(tiles, v === "senate" ? 1 : 3)}</aside>
<footer>Colour = projected by a named outlet; ScoopFeeds does not call races. Grey: not called · hatched: no race. Projections: ${esc(sources)}${esc(counts)}</footer>
</div></body></html>`;
}
