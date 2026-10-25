/**
 * election.routes.test.js — the election map routes are dark unless BOTH
 * RADIO_ENABLED=true and RADIO_ELECTION_MAP_ENABLED=true (#204).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elmap-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;
const { radioApiRouter, radioScreenRouter } = await import("../../routes/radio.js");
const { writeMapState } = await import("./mapStore.js");

async function withServer(fn) {
  const app = express();
  app.use("/api/radio", radioApiRouter);
  app.use("/radio", radioScreenRouter);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

test("election map routes: 404 when dark, 503 before a build, served after", async () => {
  await withServer(async (base) => {
    process.env.RADIO_ENABLED = "true";
    delete process.env.RADIO_ELECTION_MAP_ENABLED;
    assert.equal((await fetch(`${base}/radio/election-map`)).status, 404);
    assert.equal((await fetch(`${base}/api/radio/election-map.json`)).status, 404);

    process.env.RADIO_ELECTION_MAP_ENABLED = "true";
    assert.equal((await fetch(`${base}/radio/election-map`)).status, 503);

    writeMapState({ projections: [{ kind: "projection", race: "senate", state: "NC", party: "D", outlet: "AP", at: "2026-11-04T02:10:00Z" }] });
    const j = await (await fetch(`${base}/api/radio/election-map.json`)).json();
    assert.equal(j.senate.tiles.find((t) => t.state === "NC").status, "called");
    const html = await (await fetch(`${base}/radio/election-map?view=governor`)).text();
    assert.match(html, /Governors: projected winners/);

    process.env.RADIO_ENABLED = "false";
    assert.equal((await fetch(`${base}/radio/election-map`)).status, 404);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
