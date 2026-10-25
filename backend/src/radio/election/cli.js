#!/usr/bin/env node
/**
 * cli.js — election map tools (#204). Read-only except `build`, which writes the map
 * state file (radio/election-map.json) and nothing else.
 *
 *   node cli.js render --input items.json [--civic] [--view senate|governor] --out map.html
 *   node cli.js build  --input items.json [--civic]      # writes election-map.json
 *   node cli.js civic  [--race senate|governor]          # prints civicAPI per-state counts
 *
 * items.json: { "projections": [...], "houseReports": [...] } — the election pack's shape
 * (projections.js). --civic adds civicAPI vote counts (numbers only; never colour).
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { buildMapState } from "./mapState.js";
import { renderMapHtml } from "./mapScene.js";
import { createCivicClient } from "./civicApi.js";
import { writeMapState, mapStatePath } from "./mapStore.js";

const { positionals, values: v } = parseArgs({
  allowPositionals: true,
  options: { input: { type: "string" }, out: { type: "string" }, view: { type: "string" }, civic: { type: "boolean" }, race: { type: "string" } },
});
const cmd = positionals[0];

async function input() {
  const items = v.input ? JSON.parse(fs.readFileSync(v.input, "utf8")) : {};
  const counts = {};
  if (v.civic) {
    const client = createCivicClient();
    counts.senate = await client.counts("senate");
    counts.governor = await client.counts("governor");
    if (client.errors.length) console.error(`civicAPI errors: ${JSON.stringify(client.errors)}`);
    if (client.held.length) console.error(`civicAPI counts held: ${JSON.stringify(client.held)}`);
  }
  return { projections: items.projections || [], houseReports: items.houseReports || [], counts };
}

if (cmd === "render") {
  const html = renderMapHtml(buildMapState(await input()), { view: v.view });
  if (v.out) fs.writeFileSync(v.out, html); else process.stdout.write(html);
} else if (cmd === "build") {
  const state = writeMapState(await input());
  console.log(`🗳️ election map written to ${mapStatePath()} (calls: ${state.hasAnyCall}, refused: ${state.refused.length})`);
} else if (cmd === "civic") {
  const client = createCivicClient();
  const counts = await client.counts(v.race === "governor" ? "governor" : "senate");
  for (const [st, c] of counts) console.log(`${st}\t${c.percentReporting ?? "?"}% reporting\t${c.shares.map((s) => `${s.name || s.party} ${s.votes}`).join(" | ")}\tupdated ${c.lastUpdated}`);
  for (const h of client.held) console.log(`HELD ${h.state}: ${h.reason}`);
  console.log(`${counts.size} states; held: ${client.held.length}; errors: ${client.errors.length}`);
} else {
  console.error("usage: cli.js render|build|civic [--input items.json] [--civic] [--view senate|governor] [--out file]");
  process.exit(2);
}
