/**
 * footage.test.js (routes) - #219 "Send us your video" endpoints: dark unless the flag is literally "1",
 * licence required in full, the file stored with its licence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createFootageRouter, createFootageOpsRouter } from "./footage.js";
import { createIntakeStore } from "../radio/footage/intakeStore.js";
import { LICENCE_TERMS, LICENCE_VERSION } from "../radio/footage/licence.js";

async function serve(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "footage-route-"));
  const store = createIntakeStore({ dir });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api/footage", createFootageRouter({ store, env }));
  app.use("/ops/footage", createFootageOpsRouter({ store, env }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, store, close: () => new Promise((r) => server.close(r)) };
}

const licence = (over = {}) => ({ version: LICENCE_VERSION, ticks: Object.fromEntries(LICENCE_TERMS.map((t) => [t.key, true])), credit: { mode: "handle", value: "cam1" }, ...over });

test("intake is dark unless RADIO_FOOTAGE_INTAKE_ENABLED is literally 1", async () => {
  for (const v of [undefined, "", "0", "true", "yes", " 1"]) {
    const s = await serve({ RADIO_FOOTAGE_INTAKE_ENABLED: v });
    try {
      const st = await (await fetch(`${s.base}/api/footage/status`)).json();
      assert.deepEqual(st, { open: false }, `flag ${JSON.stringify(v)}`);
      const r = await fetch(`${s.base}/api/footage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ licence: licence() }) });
      assert.equal(r.status, 404);
      assert.equal(s.store.list().length, 0);
    } finally { await s.close(); }
  }
});

test("submit + upload: licence in full, file stored beside it; partial licences refused", async () => {
  const s = await serve({ RADIO_FOOTAGE_INTAKE_ENABLED: "1" });
  try {
    const st = await (await fetch(`${s.base}/api/footage/status`)).json();
    assert.equal(st.open, true);
    assert.equal(st.licence.terms.length, LICENCE_TERMS.length);

    const ticks = Object.fromEntries(LICENCE_TERMS.map((t) => [t.key, true])); ticks.filmedIt = false;
    let r = await fetch(`${s.base}/api/footage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ licence: licence({ ticks }) }) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "licence_not_accepted");

    r = await fetch(`${s.base}/api/footage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ licence: licence(), description: "the bridge", storyId: "ev-9", contact: "me@example.com" }) });
    assert.equal(r.status, 201);
    const { id, uploadToken } = await r.json();

    r = await fetch(`${s.base}/api/footage/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4", "x-upload-token": "wrong" }, body: Buffer.from("abc") });
    assert.equal(r.status, 403);
    r = await fetch(`${s.base}/api/footage/${id}/file`, { method: "PUT", headers: { "content-type": "text/html", "x-upload-token": uploadToken }, body: Buffer.from("abc") });
    assert.equal(r.status, 415);
    r = await fetch(`${s.base}/api/footage/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4", "x-upload-token": uploadToken }, body: Buffer.from("fake mp4 bytes") });
    assert.equal(r.status, 200, await r.clone().text());
    r = await fetch(`${s.base}/api/footage/${id}/file`, { method: "PUT", headers: { "content-type": "video/mp4", "x-upload-token": uploadToken }, body: Buffer.from("again") });
    assert.equal(r.status, 409);

    const rec = s.store.get(id);
    assert.equal(rec.status, "received");
    assert.equal(rec.credit, "Video: @cam1, sent to ScoopFeeds");
    assert.equal(rec.licence.terms.every((t) => t.accepted), true);
    assert.equal(fs.readFileSync(path.join(s.store.folder(id), "original.mp4"), "utf8"), "fake mp4 bytes");

    const ops = await (await fetch(`${s.base}/ops/footage/${id}`)).json();
    assert.equal(ops.id, id);
    assert.equal("uploadTokenSha256" in ops, false);
    const orig = await fetch(`${s.base}/ops/footage/${id}/original`);
    assert.equal(await orig.text(), "fake mp4 bytes");
    assert.equal((await fetch(`${s.base}/ops/footage/../../etc/original`)).status, 404);
  } finally { await s.close(); }
});
