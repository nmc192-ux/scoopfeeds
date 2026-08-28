/**
 * /scoop-ops/incident — intake for the incident media ledger (Phase 1).
 *
 * Mounted under the /scoop-ops prefix, which applies adminRouteLimiter +
 * adminAuth + adminAuditLogger centrally in server.js. This router must NOT
 * re-implement auth: adding a router under that prefix inherits it, and a second
 * implementation is how the two drift apart.
 *
 * NO ENV FLAG, AND THAT IS A DELIBERATE DEPARTURE from "new work ships dark".
 * The convention exists to keep unfinished work off reader surfaces, and nothing
 * here is one: every route is admin-authenticated, writes only to tables added by
 * migration 032, and is read by no render or publish path — Phase 1 cannot put a
 * pixel anywhere. Against that, a dark flag has a real cost this repo has already
 * paid: VIDEO_SUBJECT_VISUALS_ENABLED sat off in production while four PRs were
 * built on top of it. Adding a flag whose only job is to be switched on later
 * manufactures that same hazard for no safety. The dark flag belongs at Phase 5,
 * where pixels are at stake, and the brief puts it there
 * (VIDEO_INCIDENT_MEDIA_ENABLED).
 *
 * WHAT IS NOT HERE. There is no endpoint that sets a status. Verification,
 * clearance and construction each own their transitions and arrive with their
 * phases; exposing a general "set status" route now would let the machine be
 * driven around by hand, which is exactly what the machine exists to prevent.
 * Phase 1 records what came in and shows the trail.
 */

import { Router } from "express";
import express from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";
import {
  createCandidate, getCandidate, listCandidates, candidateTrail,
  setEmbedOnly, setAcquisition, createCommission, LedgerError,
} from "../services/incident/incidentLedger.js";
import { IntakeRefusedError, requiresPosterSuppliedFile } from "../services/incident/incidentIntake.js";
import { runVerification, recordHumanVerdict, readHumanVerdicts, HumanVerdictError } from "../services/incident/incidentVerifyRunner.js";
import { makeReverseSearch, reverseSearchConfigured } from "../services/incident/incidentReverseSearch.js";
import { CHECK_NAMES } from "../services/incident/incidentChecks.js";
import {
  beginClearing, recordGrantRequest, recordGrantReply, applyClearance,
  markUncleared, ClearanceLedgerError,
} from "../services/incident/incidentClearanceLedger.js";
import { ClearanceRefusedError, LANES, EXCERPT_MAX_SECS } from "../services/incident/incidentClearance.js";
import { renderGrantDraft, GrantDraftError } from "../services/incident/incidentGrantDraft.js";

const router = Router();
const json = express.json({ limit: "16kb" });

/**
 * Turn a thrown error into a response.
 *
 * A refused intake is a 400 with the reason SHOWN, not a 500 with a stack in the
 * log. The operator pasting a URL is the person who can fix it, and the whole
 * point of naming refusal reasons in the parser is that they reach a human.
 */
function fail(res, err, where) {
  if (err instanceof IntakeRefusedError) {
    return res.status(400).json({ error: err.message, reason: err.reason, url: err.url });
  }
  if (err instanceof LedgerError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err?.name === "IllegalTransitionError") {
    return res.status(409).json({ error: err.message, from: err.from, to: err.to });
  }
  if (err instanceof HumanVerdictError) {
    // 409, not 400: the request was well-formed and was REFUSED. An operator
    // trying to overturn a machine kill needs to see that as a rule, not a typo.
    return res.status(409).json({ error: err.message, code: err.code, check: err.check });
  }
  if (err?.name === "VerificationError") {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  if (err instanceof ClearanceRefusedError || err instanceof GrantDraftError || err instanceof ClearanceLedgerError) {
    // The messages here are written for the operator and say what to do next,
    // so they are returned rather than logged and replaced with "bad request".
    return res.status(400).json({ error: err.message, code: err.code, lane: err.lane ?? null });
  }
  logger.error(`❌ incident-ops ${where}: ${err?.message}`, { stack: err?.stack });
  return res.status(500).json({ error: "internal error" });
}

/** Decorate a row with what the operator needs to see but we do not store. */
const decorate = (row) => row && ({
  ...row,
  embed_only: Boolean(row.embed_only),
  // Derived, never stored: whether we may fetch the file ourselves is a property
  // of the platform today, not a fact about this candidate frozen at intake. If
  // a platform's terms change, the answer must change with them.
  poster_must_supply_file: requiresPosterSuppliedFile(row.platform),
});

/**
 * POST /scoop-ops/incident/candidates
 * { storyKind, storyId, postUrl, posterDisplay?, claimedAt?, claimedLocation?,
 *   mediaType?, intakeSource?, embedOnly? }
 *
 * The Phase 1 live test: paste three real post URLs against a story and see them
 * land with correct poster/platform metadata.
 */
router.post("/candidates", json, (req, res) => {
  try {
    const { created, candidate } = createCandidate(getDb(), {
      storyKind: req.body?.storyKind,
      storyId: req.body?.storyId,
      postUrl: req.body?.postUrl,
      posterDisplay: req.body?.posterDisplay ?? null,
      claimedAt: Number.isFinite(req.body?.claimedAt) ? req.body.claimedAt : null,
      claimedLocation: req.body?.claimedLocation ?? null,
      mediaType: req.body?.mediaType ?? null,
      intakeSource: req.body?.intakeSource ?? "manual",
      embedOnly: Boolean(req.body?.embedOnly),
      actor: "operator",
    });
    // 200 rather than 201 on a duplicate: the operator did nothing wrong, and
    // "we already had that one" is a useful answer rather than a failure.
    return res.status(created ? 201 : 200).json({ created, candidate: decorate(candidate) });
  } catch (err) {
    return fail(res, err, "POST /candidates");
  }
});

/** GET /scoop-ops/incident/candidates?status=&storyKind=&storyId=&limit= */
router.get("/candidates", (req, res) => {
  try {
    const rows = listCandidates(getDb(), {
      status: req.query.status || null,
      storyKind: req.query.storyKind || null,
      storyId: req.query.storyId || null,
      limit: req.query.limit,
    });
    return res.json({ count: rows.length, candidates: rows.map(decorate) });
  } catch (err) {
    return fail(res, err, "GET /candidates");
  }
});

/** GET /scoop-ops/incident/candidates/:id — the row and its full trail. */
router.get("/candidates/:id", (req, res) => {
  try {
    const db = getDb();
    const candidate = getCandidate(db, req.params.id);
    if (!candidate) return res.status(404).json({ error: `no candidate ${req.params.id}` });
    return res.json({ candidate: decorate(candidate), trail: candidateTrail(db, req.params.id) });
  } catch (err) {
    return fail(res, err, "GET /candidates/:id");
  }
});

/** POST /scoop-ops/incident/candidates/:id/embed-only  { embedOnly: bool } */
router.post("/candidates/:id/embed-only", json, (req, res) => {
  try {
    const row = setEmbedOnly(getDb(), req.params.id, Boolean(req.body?.embedOnly), { actor: "operator" });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/embed-only");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/acquisition  { acquisition }
 * Records whether we hold a file. Says nothing about the right to use it.
 */
router.post("/candidates/:id/acquisition", json, (req, res) => {
  try {
    const row = setAcquisition(getDb(), req.params.id, req.body?.acquisition, { actor: "operator" });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/acquisition");
  }
});

/**
 * POST /scoop-ops/incident/commissions  { topic, outputKind?, notes? }
 * A story stub for commissioned work. Deliberately NOT an events row — see
 * migration 032's header.
 */
router.post("/commissions", json, (req, res) => {
  try {
    const commission = createCommission(getDb(), {
      topic: req.body?.topic,
      outputKind: req.body?.outputKind ?? "short",
      notes: req.body?.notes ?? null,
    });
    return res.status(201).json({ commission });
  } catch (err) {
    return fail(res, err, "POST /commissions");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/verify
 * { posts?, originalityEvidence?, politicallyLive?, imageRef? }
 *
 * Runs the four checks and moves the candidate. Safe to re-run: an unresolved
 * candidate stays in `verifying` and writes no extra trail row.
 *
 * THE VISION PASS IS NOT WIRED IN THIS PHASE. `vision: null` means the context
 * check reports "unmeasured", which is NEEDS_HUMAN everywhere and a KILL on a
 * Pakistan-related or politically live story. That is the honest state of it —
 * a model is not called yet, so nothing pretends one was. Wiring it is a
 * separate change that must be reported as such.
 */
router.post("/candidates/:id/verify", json, async (req, res) => {
  try {
    const out = await runVerification(getDb(), req.params.id, {
      story: req.body?.story ?? null,
      posts: Array.isArray(req.body?.posts) ? req.body.posts : [],
      originalityEvidence: req.body?.originalityEvidence ?? null,
      politicallyLive: Boolean(req.body?.politicallyLive),
      imageRef: req.body?.imageRef ?? null,
      reverseSearch: makeReverseSearch(),
      vision: null,
      actor: "operator",
    });
    return res.json({
      outcome: out.outcome,
      candidate: decorate(out.candidate),
      summary: out.summary,
      // Stated on every response so nobody reads an "unmeasured" as a clean run
      // without seeing why it was unmeasured.
      capabilities: { reverseSearch: reverseSearchConfigured(), vision: false },
    });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/verify");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/human-verdict
 * { check, verdict: "pass"|"kill", note? }
 *
 * Settles a check the machine could not answer. It CANNOT overturn a machine
 * verdict — that is refused with 409 and an explanation. Recording a ruling does
 * not itself move the candidate; re-run /verify to apply it.
 */
router.post("/candidates/:id/human-verdict", json, (req, res) => {
  try {
    const trail = recordHumanVerdict(
      getDb(), req.params.id, req.body?.check, req.body?.verdict,
      { note: req.body?.note ?? null, actor: "operator" }
    );
    return res.json({ recorded: true, checks: CHECK_NAMES, trail });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/human-verdict");
  }
});

/** GET /scoop-ops/incident/candidates/:id/human-verdicts — what has been ruled. */
router.get("/candidates/:id/human-verdicts", (req, res) => {
  try {
    return res.json({ verdicts: readHumanVerdicts(getDb(), req.params.id) });
  } catch (err) {
    return fail(res, err, "GET /candidates/:id/human-verdicts");
  }
});

// ─── Phase 3 — clearance ───────────────────────────────────────────────────

/** POST /scoop-ops/incident/candidates/:id/begin-clearing  { note? } */
router.post("/candidates/:id/begin-clearing", json, (req, res) => {
  try {
    const row = beginClearing(getDb(), req.params.id, { note: req.body?.note ?? null, actor: "operator" });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/begin-clearing");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/grant-draft  { operatorName, storyTitle?, outlet? }
 *
 * DRAFTS AND RECORDS. DOES NOT SEND. The response body is the message to paste
 * into a DM by hand, from the operator's own account — there is no send path in
 * this engine and adding one is a decision, not a convenience.
 */
router.post("/candidates/:id/grant-draft", json, (req, res) => {
  try {
    const { draft, candidate } = recordGrantRequest(getDb(), req.params.id, {
      operatorName: req.body?.operatorName,
      storyTitle: req.body?.storyTitle ?? null,
      outlet: req.body?.outlet ?? "ScoopFeeds",
      actor: "operator",
    });
    return res.json({
      draft, rendered: renderGrantDraft(draft),
      candidate: decorate(candidate),
      sent: false,
      note: "Nothing was sent. Paste `draft.body` from your own account, then record the reply at /grant-reply.",
    });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/grant-draft");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/grant-reply
 * { outcome: "granted"|"refused"|"no_reply", grantReference?, replyText?, fileSuppliedByPoster? }
 */
router.post("/candidates/:id/grant-reply", json, (req, res) => {
  try {
    const row = recordGrantReply(getDb(), req.params.id, req.body?.outcome, {
      grantReference: req.body?.grantReference ?? null,
      replyText: req.body?.replyText ?? null,
      fileSuppliedByPoster: Boolean(req.body?.fileSuppliedByPoster),
      actor: "operator",
    });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/grant-reply");
  }
});

/**
 * POST /scoop-ops/incident/candidates/:id/clear  { lane, ...laneDetail }
 * Lane 0 (owner) and Lane 3 (fair_use). Lane 2 goes through /grant-reply.
 */
router.post("/candidates/:id/clear", json, (req, res) => {
  try {
    const { lane, ...detail } = req.body || {};
    const row = applyClearance(getDb(), req.params.id, lane, detail, { actor: "operator" });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/clear");
  }
});

/** POST /scoop-ops/incident/candidates/:id/uncleared  { reason? } */
router.post("/candidates/:id/uncleared", json, (req, res) => {
  try {
    const row = markUncleared(getDb(), req.params.id, { reason: req.body?.reason ?? null, actor: "operator" });
    return res.json({ candidate: decorate(row) });
  } catch (err) {
    return fail(res, err, "POST /candidates/:id/uncleared");
  }
});

/** GET /scoop-ops/incident/clearance-rules — what the lanes allow, for the queue. */
router.get("/clearance-rules", (req, res) => {
  res.json({
    lanes: LANES,
    excerptMaxSecs: EXCERPT_MAX_SECS,
    note: "The excerpt cap is inherited from the cutaway mechanism, not set here. Treatment never affects rights.",
  });
});

export default router;
