/**
 * /api/footage — "Send us your video" intake (#219 route 2), and /scoop-ops/footage for the Mac to
 * collect submissions.
 *
 * DARK BY DEFAULT: every public endpoint answers 404 unless RADIO_FOOTAGE_INTAKE_ENABLED is literally
 * "1". A new public page is stop-list item 4 (docs/engine/full-throttle.md): DrJ switches it on.
 *
 *   GET  /api/footage/status         { open } and, when open, the licence text to show and the limits
 *   POST /api/footage                licence acceptance + optional details -> { id, uploadToken }
 *   PUT  /api/footage/:id/file       the raw video bytes (header X-Upload-Token), one upload per id
 *
 * Nothing received here can air. Verification, the content-safety gate (#218) and the approval tap
 * happen on the Mac (src/radio/footage/footageCli.mjs), and the insert queue re-checks all of it.
 * Privacy: no IP address, user agent or device id is stored with a submission; only what the sender typed.
 */
import { Router } from "express";
import fs from "node:fs";
import { z } from "zod";
import { validateLicence, LICENCE_TERMS, LICENCE_VERSION, CREDIT_MODES } from "../radio/footage/licence.js";
import { createIntakeStore, footageDir, MAX_UPLOAD_BYTES, ALLOWED_TYPES } from "../radio/footage/intakeStore.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { logger } from "../services/logger.js";

export const intakeOpen = (env = process.env) => env.RADIO_FOOTAGE_INTAKE_ENABLED === "1";

const submitSchema = z.object({
  licence: z.object({
    version: z.string().max(64),
    ticks: z.record(z.string().max(64), z.boolean()),
    credit: z.object({ mode: z.enum(CREDIT_MODES), value: z.string().max(80).optional().nullable() }),
  }),
  contact: z.string().trim().max(200).optional().nullable(),
  storyId: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  filmedAt: z.string().trim().max(40).optional().nullable(),
  place: z.string().trim().max(200).optional().nullable(),
});

export function createFootageRouter({ store = null, env = process.env } = {}) {
  const router = Router();
  const getStore = () => store || (store = createIntakeStore({ dir: footageDir(env) }));
  const closed = (req, res) => sendError(res, req, { status: 404, error: "Not found", code: "not_found" });

  router.get("/status", (req, res) => {
    if (!intakeOpen(env)) return sendSuccess(res, { open: false });
    return sendSuccess(res, {
      open: true,
      licence: { version: LICENCE_VERSION, terms: LICENCE_TERMS, creditModes: CREDIT_MODES },
      maxBytes: MAX_UPLOAD_BYTES,
      types: Object.keys(ALLOWED_TYPES),
    });
  });

  router.post("/", (req, res) => {
    if (!intakeOpen(env)) return closed(req, res);
    const parsed = submitSchema.safeParse(req.body || {});
    if (!parsed.success) return sendError(res, req, { status: 400, error: "Invalid submission", code: "invalid", details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const b = parsed.data;
    const lic = validateLicence(b.licence);
    if (!lic.ok) return sendError(res, req, { status: 400, error: "The licence must be accepted in full", code: "licence_not_accepted", details: lic.errors });
    const { id, uploadToken } = getStore().create({
      acceptance: lic.acceptance,
      sender: { contact: b.contact || null },
      claims: { storyId: b.storyId, description: b.description, filmedAt: b.filmedAt, place: b.place },
    });
    logger.info?.(`[footage] submission ${id} created (licence ${lic.acceptance.version})`);
    return sendSuccess(res, { id, uploadToken, maxBytes: MAX_UPLOAD_BYTES }, 201);
  });

  router.put("/:id/file", async (req, res) => {
    if (!intakeOpen(env)) return closed(req, res);
    const declared = Number(req.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return sendError(res, req, { status: 413, error: "File too large", code: "too_large" });
    try {
      const rec = await getStore().receiveFile(req.params.id, req.get("x-upload-token"), req, { contentType: req.get("content-type") });
      return sendSuccess(res, { id: rec.id, status: rec.status, bytes: rec.file.bytes });
    } catch (e) {
      const status = e.status || (/bad submission id/.test(e.message) ? 404 : 500);
      if (status >= 500) logger.error?.(`[footage] upload failed: ${e.message}`);
      return sendError(res, req, { status, error: status >= 500 ? "Upload failed" : e.message, code: "upload_refused" });
    }
  });

  return router;
}

/** Admin side (mounted under /scoop-ops, which applies adminAuth + audit): the Mac pulls from here. */
export function createFootageOpsRouter({ store = null, env = process.env } = {}) {
  const router = Router();
  const getStore = () => store || (store = createIntakeStore({ dir: footageDir(env) }));
  const strip = (r) => { const { uploadTokenSha256, ...rest } = r; return rest; };

  router.get("/", (req, res) => sendSuccess(res, { submissions: getStore().list().map(strip) }));
  router.get("/:id", (req, res) => {
    let rec = null;
    try { rec = getStore().get(req.params.id); } catch { /* bad id */ }
    if (!rec) return sendError(res, req, { status: 404, error: "Not found", code: "not_found" });
    return sendSuccess(res, strip(rec));
  });
  router.get("/:id/original", (req, res) => {
    let rec = null;
    try { rec = getStore().get(req.params.id); } catch { /* bad id */ }
    const p = rec && getStore().originalPath(rec);
    if (!p || !fs.existsSync(p)) return sendError(res, req, { status: 404, error: "Not found", code: "not_found" });
    return res.sendFile(p);
  });
  return router;
}

export default createFootageRouter();
