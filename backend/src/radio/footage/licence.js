/**
 * licence.js - the licence a member of the public grants when they send us footage (#219 route 2).
 *
 * The grant (issue #219): non-exclusive, worldwide, broadcast and online, credited as the sender
 * chooses, and the sender confirms they filmed it themselves. Every box must be ticked: a missing or
 * false tick is a refusal, never a default. The exact text and its version are stored WITH the file
 * (intakeStore writes them into the submission record), so we can always show what was agreed.
 *
 * This wording is a DRAFT for DrJ (stop-list items 4 and 5: a new public page and a legal text).
 * Change LICENCE_VERSION whenever the text changes; acceptances keep the version they were given under.
 */
export const LICENCE_VERSION = "2026-10-23.draft-1";

export const LICENCE_TERMS = Object.freeze([
  { key: "filmedIt", text: "I filmed this video myself, and nobody else owns it." },
  { key: "nonExclusive", text: "I give ScoopFeeds a non-exclusive licence: I keep my copyright and can still use, sell or license the video elsewhere." },
  { key: "worldwideBroadcastOnline", text: "ScoopFeeds may show the video worldwide, on its broadcasts and live streams (including YouTube and X) and online, edited for length, with no fee." },
  { key: "credit", text: "ScoopFeeds will credit the video the way I choose below, on screen for the whole time it plays." },
  { key: "noGuarantee", text: "ScoopFeeds may decide not to use the video. Nothing airs before it has been checked and approved by an editor." },
]);

export const CREDIT_MODES = Object.freeze(["name", "handle", "anonymous"]);

/** What goes on screen for each credit choice. */
export function creditText({ mode, value } = {}) {
  if (mode === "anonymous") return "Video: viewer footage, sent to ScoopFeeds";
  const v = String(value || "").trim();
  if (mode === "handle") {
    const h = v.replace(/^@+/, "");
    return /^[A-Za-z0-9._-]{1,60}$/.test(h) ? `Video: @${h}, sent to ScoopFeeds` : null;
  }
  if (mode === "name") {
    // Letters (any script), spaces, dots, apostrophes and hyphens; nothing that could carry a link.
    return /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u.test(v) ? `Video: ${v}, sent to ScoopFeeds` : null;
  }
  return null;
}

/**
 * Validate an acceptance from the form. Returns { ok, errors, acceptance }.
 * `acceptance` is what gets stored with the file: the version, the full text of every term, each
 * tick, the credit choice and the on-screen credit it produces.
 */
export function validateLicence(input = {}, { now = () => new Date() } = {}) {
  const errors = [];
  const ticks = input.ticks && typeof input.ticks === "object" ? input.ticks : {};
  for (const t of LICENCE_TERMS) if (ticks[t.key] !== true) errors.push(`term not accepted: ${t.key}`);
  if (input.version !== LICENCE_VERSION) errors.push(`licence version ${JSON.stringify(input.version)} is not the current ${LICENCE_VERSION}`);
  const credit = input.credit && typeof input.credit === "object" ? input.credit : {};
  if (!CREDIT_MODES.includes(credit.mode)) errors.push("choose how you want to be credited");
  const onScreen = creditText(credit);
  if (CREDIT_MODES.includes(credit.mode) && !onScreen) errors.push("the credit name or handle is not valid");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    acceptance: {
      version: LICENCE_VERSION,
      acceptedAt: now().toISOString(),
      terms: LICENCE_TERMS.map((t) => ({ key: t.key, text: t.text, accepted: true })),
      credit: { mode: credit.mode, value: credit.mode === "anonymous" ? null : String(credit.value).trim() },
      onScreenCredit: onScreen,
    },
  };
}
