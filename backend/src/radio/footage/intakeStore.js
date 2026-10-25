/**
 * intakeStore.js - footage the public sends us, stored one folder per submission (#219 route 2).
 *
 *   <dir>/<id>/submission.json   the record: who sent it, what they said about it, the licence
 *                                acceptance (full text + ticks + version), checks, approval, history
 *   <dir>/<id>/original<.ext>    the file exactly as uploaded (never altered)
 *   <dir>/<id>/air.mp4           the credited, length-capped copy that can air (made by credit.js)
 *   <dir>/<id>/air.mp4.safety.json  its content-safety clearance (#218)
 *
 * The licence acceptance lives in the same folder as the file and is written before the file is
 * accepted, so a file without its licence cannot exist here (acceptance criterion 3).
 *
 * Status moves only forward through the states below; every move is appended to `history`.
 * Nothing in this module decides that something may air: that is verify.js + approve() + insertQueue.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export const STATES = Object.freeze(["awaiting-file", "received", "verified", "verify-failed", "approved", "rejected", "queued"]);
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const ALLOWED_TYPES = Object.freeze({ "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv", "video/3gpp": ".3gp" });

/** RADIO_FOOTAGE_DIR, else <SCOOP_PERSISTENT_DATA_DIR>/footage-intake, else ~/scoopfeeds-radio/footage-intake. */
export function footageDir(env = process.env) {
  if ((env.RADIO_FOOTAGE_DIR || "").trim()) return path.resolve(env.RADIO_FOOTAGE_DIR.trim());
  if ((env.SCOOP_PERSISTENT_DATA_DIR || "").trim()) return path.join(path.resolve(env.SCOOP_PERSISTENT_DATA_DIR.trim()), "footage-intake");
  return path.join(os.homedir(), "scoopfeeds-radio", "footage-intake");
}

const ID_RE = /^ft-\d{8}-[0-9a-f]{12}$/;

export function createIntakeStore({ dir = footageDir(), now = () => new Date() } = {}) {
  const folder = (id) => {
    if (!ID_RE.test(String(id))) throw new Error(`bad submission id ${JSON.stringify(id)}`);
    return path.join(dir, id);
  };
  const recPath = (id) => path.join(folder(id), "submission.json");

  function read(id) {
    const p = recPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  function write(rec) {
    const p = recPath(rec.id);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 1) + "\n");
    fs.renameSync(tmp, p);
    return rec;
  }
  function move(rec, status, note = {}) {
    rec.status = status;
    rec.history.push({ at: now().toISOString(), status, ...note });
    return write(rec);
  }

  return {
    dir,
    folder,

    /**
     * A new submission: the sender's details and the validated licence acceptance (licence.js).
     * Returns { id, uploadToken }. The token is needed to send the file; only its hash is stored.
     */
    create({ acceptance, sender = {}, claims = {} }) {
      if (!acceptance || !acceptance.version || !Array.isArray(acceptance.terms) || !acceptance.onScreenCredit) {
        throw new Error("a submission needs a validated licence acceptance");
      }
      const d = now();
      const id = `ft-${d.toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(6).toString("hex")}`;
      const uploadToken = crypto.randomBytes(24).toString("hex");
      fs.mkdirSync(folder(id), { recursive: true });
      const rec = {
        id,
        createdAt: d.toISOString(),
        status: "awaiting-file",
        licence: acceptance,
        credit: acceptance.onScreenCredit,
        // Privacy: we keep only what the sender typed. No IP address, no device id.
        sender: { contact: sender.contact ? String(sender.contact).slice(0, 200) : null },
        claims: {
          storyId: claims.storyId ? String(claims.storyId).slice(0, 120) : null,
          description: claims.description ? String(claims.description).slice(0, 2000) : null,
          filmedAt: claims.filmedAt ? String(claims.filmedAt).slice(0, 40) : null,
          place: claims.place ? String(claims.place).slice(0, 200) : null,
          lat: Number.isFinite(Number(claims.lat)) && claims.lat !== null && claims.lat !== "" ? Number(claims.lat) : null,
          lon: Number.isFinite(Number(claims.lon)) && claims.lon !== null && claims.lon !== "" ? Number(claims.lon) : null,
        },
        uploadTokenSha256: crypto.createHash("sha256").update(uploadToken).digest("hex"),
        file: null,
        checks: null,
        approval: null,
        history: [{ at: d.toISOString(), status: "awaiting-file", licenceVersion: acceptance.version }],
      };
      write(rec);
      return { id, uploadToken };
    },

    /**
     * Store the uploaded bytes. Refuses a wrong token, a second upload, a type we do not take, or
     * anything over maxBytes (the partial file is deleted). Returns the updated record.
     */
    async receiveFile(id, token, stream, { contentType, maxBytes = MAX_UPLOAD_BYTES } = {}) {
      const rec = read(id);
      if (!rec) throw Object.assign(new Error("no such submission"), { status: 404 });
      if (rec.status !== "awaiting-file") throw Object.assign(new Error("this submission already has its file"), { status: 409 });
      const h = Buffer.from(crypto.createHash("sha256").update(String(token || "")).digest("hex"));
      const want = Buffer.from(String(rec.uploadTokenSha256));
      if (h.length !== want.length || !crypto.timingSafeEqual(h, want)) throw Object.assign(new Error("bad upload token"), { status: 403 });
      const type = String(contentType || "").split(";")[0].trim().toLowerCase();
      const ext = ALLOWED_TYPES[type];
      if (!ext) throw Object.assign(new Error(`file type ${type || "unknown"} is not accepted`), { status: 415 });
      const dest = path.join(folder(id), `original${ext}`);
      const sha = crypto.createHash("sha256");
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length;
          if (bytes > maxBytes) return cb(Object.assign(new Error(`file is over ${Math.round(maxBytes / 1048576)} MB`), { status: 413 }));
          sha.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, counter, fs.createWriteStream(dest, { flags: "wx" }));
      } catch (e) {
        fs.rmSync(dest, { force: true });
        throw e;
      }
      if (bytes === 0) { fs.rmSync(dest, { force: true }); throw Object.assign(new Error("empty file"), { status: 400 }); }
      rec.file = { name: path.basename(dest), type, bytes, sha256: sha.digest("hex"), receivedAt: now().toISOString() };
      rec.uploadTokenSha256 = "used";
      return move(rec, "received");
    },

    get: read,
    list() {
      let ids = [];
      try { ids = fs.readdirSync(dir).filter((n) => ID_RE.test(n)).sort(); } catch { return []; }
      return ids.map(read).filter(Boolean);
    },
    originalPath(rec) { return rec?.file?.name ? path.join(folder(rec.id), rec.file.name) : null; },
    airPath(rec) { return path.join(folder(rec.id), "air.mp4"); },

    /** Record a verification result (verify.js). ok -> verified, otherwise verify-failed. */
    setChecks(id, checks) {
      const rec = read(id);
      if (!rec) throw new Error("no such submission");
      if (!["received", "verified", "verify-failed", "approved"].includes(rec.status)) throw new Error(`cannot verify a submission that is ${rec.status}`);
      rec.checks = checks;
      rec.approval = null; // a re-verification needs a fresh approval
      return move(rec, checks.ok ? "verified" : "verify-failed", { reasons: checks.ok ? [] : checks.reasons });
    },
    setApproval(id, approval) {
      const rec = read(id);
      if (!rec) throw new Error("no such submission");
      rec.approval = approval;
      return move(rec, approval.decision === "approved" ? "approved" : "rejected", { by: approval.by });
    },
    markQueued(id, queueId) {
      const rec = read(id);
      if (!rec) throw new Error("no such submission");
      return move(rec, "queued", { queueId });
    },
  };
}
