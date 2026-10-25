/**
 * insertQueue.js - the one door through which outside footage reaches the breaking-news insert (#219).
 *
 * Two kinds of item come in:
 *   social-clip     a journalist's or the public's social post, as a clip (route 1, rules from
 *                   socialClips.js: <= 30 s, credited "via @handle on <platform>", the post is the story)
 *   public-footage  a "Send us your video" submission (route 2) that passed verify.js and was approved
 *
 * admit() refuses an item unless ALL of these hold, measured at the moment of admission:
 *   - the file has a valid content-safety clearance (#218) for its exact bytes and the current rule
 *   - the file carries a burned-in credit (credit.js) for its exact bytes, and it is the expected credit
 *   - its measured duration is at most MAX_CLIP_SECONDS
 *   - social-clip: prepareClip() accepts it
 *   - public-footage: the submission is approved by a named approver, after a passing verification,
 *     and its stored licence acceptance is complete
 * take() repeats the file checks before handing an item to the player, so a file changed or a rule
 * bumped after admission does not air. Nothing here plays anything: the breaking-news insert (#201)
 * calls take() at a segment boundary and markAired() after.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { hasValidClearance } from "../safety/contentSafety.js";
import { prepareClip, recordClipPlayed, MAX_CLIP_SECONDS } from "../live/socialClips.js";
import { hasBurnedCredit } from "./credit.js";
import { LICENCE_TERMS } from "./licence.js";
import { isApprover } from "./approval.js";

export class InsertRefused extends Error {
  constructor(reasons, item) {
    super(`insert queue refused ${item?.kind || "item"}: ${reasons.join("; ")}`);
    this.name = "InsertRefused";
    this.reasons = reasons;
  }
}

export function insertQueueDir(env = process.env) {
  return (env.RADIO_INSERT_QUEUE_DIR || "").trim() || path.join(os.homedir(), "scoopfeeds-radio", "insert-queue");
}

/** Is a stored licence acceptance complete? Every current term present and accepted, with a credit. */
export function licenceComplete(lic) {
  if (!lic || !lic.version || !lic.acceptedAt || !lic.onScreenCredit) return false;
  const got = new Map((lic.terms || []).map((t) => [t.key, t]));
  return LICENCE_TERMS.every((t) => got.get(t.key)?.accepted === true && got.get(t.key)?.text);
}

/**
 * @param dir           where queue items live (one JSON file each)
 * @param probe(file)   -> { durationSec } (measured; ffprobe on the Mac)
 * @param intake        intakeStore, for public-footage items
 * @param log           optional (record) => void for every admission, refusal and airing
 * @param liveLog       optional createLiveLog() instance: aired social clips are recorded there too (#202)
 */
export function createInsertQueue({ dir = insertQueueDir(), probe, intake = null, log = null, liveLog = null, approvers, now = () => new Date() } = {}) {
  const itemsDir = path.join(dir, "items");
  const itemPath = (qid) => path.join(itemsDir, `${qid}.json`);
  const save = (it) => { fs.mkdirSync(itemsDir, { recursive: true }); fs.writeFileSync(itemPath(it.qid), JSON.stringify(it, null, 1) + "\n"); return it; };
  const emit = (rec) => { try { log?.({ at: now().toISOString(), ...rec }); } catch { /* logging must not change a decision */ } };

  async function fileChecks(file, expectedCredit) {
    const reasons = [];
    const c = hasValidClearance(file);
    if (!c.ok) reasons.push(`content safety: ${c.why}`);
    const b = hasBurnedCredit(file);
    if (!b.ok) reasons.push(`credit: ${b.why}`);
    else if (expectedCredit && b.credit !== expectedCredit) reasons.push(`credit: burned-in credit "${b.credit}" is not the expected "${expectedCredit}"`);
    let durationSec = null;
    if (typeof probe !== "function") reasons.push("duration: no probe configured (unmeasured)");
    else {
      try { durationSec = Number((await probe(file))?.durationSec); } catch (e) { reasons.push(`duration: probe failed: ${e.message}`); }
      if (durationSec !== null && !(durationSec > 0)) reasons.push("duration: unmeasured");
      else if (durationSec > MAX_CLIP_SECONDS + 0.5) reasons.push(`duration: ${durationSec.toFixed(1)} s is over the ${MAX_CLIP_SECONDS} s cap`);
    }
    return { reasons, durationSec, credit: b.credit || null };
  }

  return {
    dir,

    /** A social clip whose air copy (credited with clip.credit) is `file`. clipInput as for prepareClip(). */
    async admitSocialClip(clipInput, file) {
      const reasons = [];
      const prep = prepareClip(clipInput);
      if (!prep.ok) reasons.push(...prep.errors.map((e) => `social clip: ${e}`));
      const fc = await fileChecks(file, prep.ok ? prep.clip.credit : null);
      reasons.push(...fc.reasons);
      const item = { kind: "social-clip", file, credit: prep.clip?.credit || null, durationSec: fc.durationSec, storyId: clipInput.storyId ?? null, source: prep.ok ? { url: prep.clip.url, handle: prep.clip.handle, platform: prep.clip.platform } : null, clip: prep.clip || null };
      return admit(item, reasons);
    },

    /** An approved public submission (by id). Its air copy is the one verify.js made. */
    async admitPublicFootage(id) {
      const reasons = [];
      if (!intake) throw new Error("admitPublicFootage needs the intake store");
      const rec = intake.get(id);
      if (!rec) return admit({ kind: "public-footage", submissionId: id }, ["no such submission"]);
      if (rec.status !== "approved") reasons.push(`submission is ${rec.status}, not approved`);
      if (!rec.checks?.ok) reasons.push("submission has no passing verification");
      if (rec.approval?.decision !== "approved" || !isApprover(rec.approval?.by, approvers)) reasons.push("not approved by a named approver");
      if (!rec.approval?.forCheckedAt || rec.approval.forCheckedAt !== rec.checks?.checkedAt) reasons.push("approval was not given for the current verification");
      if (!licenceComplete(rec.licence)) reasons.push("licence acceptance missing or incomplete");
      const file = intake.airPath(rec);
      const fc = await fileChecks(file, rec.credit);
      reasons.push(...fc.reasons);
      const item = { kind: "public-footage", submissionId: id, file, credit: rec.credit, durationSec: fc.durationSec, storyId: rec.claims?.storyId ?? null, licenceVersion: rec.licence?.version ?? null, approvedBy: rec.approval?.by ?? null };
      const res = await admit(item, reasons);
      intake.markQueued(id, res.qid);
      return res;
    },

    pending() {
      let names = [];
      try { names = fs.readdirSync(itemsDir).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
      return names.map((n) => JSON.parse(fs.readFileSync(path.join(itemsDir, n), "utf8"))).filter((it) => it.state === "queued");
    },

    /**
     * The next item for the insert, oldest first. Re-checks the file; an item that no longer passes is
     * withdrawn (logged) and the next one is tried. Returns null when nothing can air.
     */
    async take() {
      for (const it of this.pending()) {
        const fc = await fileChecks(it.file, it.credit);
        if (fc.reasons.length) {
          it.state = "withdrawn"; it.withdrawnAt = now().toISOString(); it.withdrawnBecause = fc.reasons;
          save(it); emit({ type: "insert-withdrawn", qid: it.qid, kind: it.kind, reasons: fc.reasons });
          continue;
        }
        it.state = "taken"; it.takenAt = now().toISOString();
        save(it); emit({ type: "insert-taken", qid: it.qid, kind: it.kind });
        return it;
      }
      return null;
    },

    /** After the insert played it. Social clips are also recorded in the live log (#202). */
    markAired(qid, { playedSec, segment = null } = {}) {
      const it = JSON.parse(fs.readFileSync(itemPath(qid), "utf8"));
      it.state = "aired"; it.airedAt = now().toISOString(); it.playedSec = playedSec;
      save(it);
      emit({ type: "insert-aired", qid, kind: it.kind, credit: it.credit, playedSec, submissionId: it.submissionId ?? null, source: it.source ?? null });
      if (it.kind === "social-clip" && liveLog && it.clip) recordClipPlayed(liveLog, it.clip, { playedSec, segment });
      return it;
    },
  };

  function admit(item, reasons) {
    if (reasons.length) {
      emit({ type: "insert-refused", kind: item.kind, file: item.file || null, submissionId: item.submissionId ?? null, reasons });
      throw new InsertRefused(reasons, item);
    }
    const qid = `iq-${now().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
    const it = save({ qid, state: "queued", admittedAt: now().toISOString(), ...item });
    emit({ type: "insert-admitted", qid, kind: it.kind, credit: it.credit, submissionId: it.submissionId ?? null });
    return it;
  }
}
