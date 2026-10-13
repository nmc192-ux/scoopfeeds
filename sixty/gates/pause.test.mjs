import test from "node:test";
import assert from "node:assert/strict";
import { pauseStatus } from "./pause.mjs";

const w = (from, to = null, reason = "radio rehearsal") => ({ from, to, reason, fromMs: Date.parse(from), toMs: to ? Date.parse(to) : Infinity });
const T = (s) => Date.parse(s);

test("no windows: never paused", () => assert.equal(pauseStatus([], T("2026-10-14T11:00:00+05:00")).paused, false));

test("open-ended window pauses from its start until cleared", () => {
  const ws = [w("2026-10-14T10:00:00+05:00")];
  assert.equal(pauseStatus(ws, T("2026-10-14T09:59:00+05:00")).paused, false);
  assert.equal(pauseStatus(ws, T("2026-10-14T10:00:00+05:00")).paused, true);
  assert.equal(pauseStatus(ws, T("2026-10-20T03:00:00+05:00")).paused, true);
  assert.match(pauseStatus(ws, T("2026-10-14T12:00:00+05:00")).why, /radio rehearsal.*until cleared/);
});

test("a closed window ends", () => {
  const ws = [w("2026-10-14T10:00:00+05:00", "2026-10-14T11:30:00+05:00")];
  assert.equal(pauseStatus(ws, T("2026-10-14T11:29:00+05:00")).paused, true);
  assert.equal(pauseStatus(ws, T("2026-10-14T11:30:00+05:00")).paused, false);
});

test("a film that would run into an upcoming window is not started", () => {
  const ws = [w("2026-10-14T10:00:00+05:00")];
  const need = 150 * 60000;   // a film needs about an hour; 2.5 h is the margin
  assert.equal(pauseStatus(ws, T("2026-10-14T06:00:00+05:00"), need).paused, false, "06:00 + 2.5 h = 08:30, before the window");
  assert.equal(pauseStatus(ws, T("2026-10-14T07:30:00+05:00"), need).paused, false, "07:30 is exactly 2.5 h before: enough");
  assert.equal(pauseStatus(ws, T("2026-10-14T07:31:00+05:00"), need).paused, true, "07:31 is under 2.5 h before the window");
  assert.match(pauseStatus(ws, T("2026-10-14T08:30:00+05:00"), need).why, /would run into it/);
});

test("an unreadable window fails closed (paused)", () => {
  assert.equal(pauseStatus([{ from: "tomorrow-ish", to: null, fromMs: NaN, toMs: Infinity }], Date.now()).paused, true);
});
