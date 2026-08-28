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

export default router;
