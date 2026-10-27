// #201: GET /api/radio/developing.json is dark unless BOTH RADIO_ENABLED=true and RADIO_DEVELOPING_ENABLED.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devroute-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;
const { radioApiRouter } = await import("../routes/radio.js");
const { developingPath } = await import("./developing.js");
const { writeJsonAtomic } = await import("./radioState.js");

test("developing.json: 404 when dark, 503 before a build, served (no-store) after", async () => {
  const app = express();
  app.use("/api/radio", radioApiRouter);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const url = `http://127.0.0.1:${srv.address().port}/api/radio/developing.json`;
  try {
    process.env.RADIO_ENABLED = "true";
    delete process.env.RADIO_DEVELOPING_ENABLED;
    assert.equal((await fetch(url)).status, 404);
    process.env.RADIO_DEVELOPING_ENABLED = "1";
    assert.equal((await fetch(url)).status, 503);
    writeJsonAtomic(developingPath(), { updatedAt: 1, events: [] });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { updatedAt: 1, events: [] });
    process.env.RADIO_ENABLED = "false";
    assert.equal((await fetch(url)).status, 404, "the radio gate still applies");
  } finally { srv.close(); delete process.env.RADIO_DEVELOPING_ENABLED; delete process.env.RADIO_ENABLED; }
});
