/**
 * incidentGrantDraft.js — the permission request the operator sends.
 *
 * DETERMINISTIC TEMPLATE. NO MODEL. This message makes commitments on behalf of
 * a named person — what the channel is, what the use will be, what credit will
 * appear, and what happens if they say no. A model asked to "write a friendly
 * permission request" will, at some nonzero rate, promise something we did not
 * offer or soften a term into ambiguity, and the person reading it will
 * reasonably believe what it said. That is the same reasoning that keeps Rule 0
 * out of prompts: a regex has no failure rate and neither does a template.
 *
 * DRAFT AND QUEUE, NEVER SEND. Nothing in this file has network access and
 * nothing calls a platform API. The operator sends it from his own account
 * because his own name is on every message, and because auto-messaging strangers
 * is what platform anti-spam systems exist to catch — losing the account that
 * publishes is an existential risk, not a cost.
 *
 * WHAT THE MESSAGE MUST CONTAIN, and why each part is not optional:
 *
 *   who is asking      — a named person from a named outlet, not "we"
 *   what they want     — this specific post, quoted back so there is no doubt
 *   what the use is    — the format, the platforms, and the fact it is edited
 *   the credit         — the exact string that will appear on screen
 *   the ask for a file — the poster sending the file is the cleanest route on
 *                        every platform's terms, and it is also better material
 *   how to decline     — an explicit, easy no. A request that makes refusing
 *                        awkward is not consent, it is pressure.
 */

import { creditTextFor } from "./incidentClearance.js";

/** Where a granted asset can end up. Named in the request so the ask is honest. */
export const PUBLISH_SURFACES = Object.freeze([
  "YouTube", "Instagram", "Facebook", "TikTok", "X", "Bluesky", "scoopfeeds.com",
]);

export class GrantDraftError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "GrantDraftError";
    this.code = code;
  }
}

/**
 * Platform-specific notes the operator needs before sending.
 *
 * Not decoration: the practical shape of "ask the poster" differs per platform,
 * and getting it wrong wastes the one approach you get with a stranger.
 */
const PLATFORM_NOTES = Object.freeze({
  x: "DMs are often closed. If so, reply publicly to the post and ask them to DM you — do not @ them repeatedly.",
  instagram: "DM. Instagram rate-limits messages to non-followers heavily; one message, then wait.",
  tiktok: "DM only works if they allow messages from everyone. A comment asking them to DM is the fallback.",
  bluesky: "DMs are open by default. A public reply is also normal and reads as less intrusive.",
  mastodon: "A public mention or a DM both work; instance culture varies, so a polite public reply is safest.",
  reddit: "Reply to their comment or send a chat. Do NOT post a top-level request in the subreddit.",
  youtube: "There is no reliable DM. Comment on the video and check the channel's About tab for a business email.",
});

/**
 * Build the draft.
 *
 * @returns {{ subject, body, creditText, platformNote, termsOffered, checklist }}
 */
export function draftGrantRequest({
  candidate = {},
  operatorName = null,
  outlet = "ScoopFeeds",
  storyTitle = null,
  surfaces = PUBLISH_SURFACES,
} = {}) {
  const who = String(operatorName || "").trim();
  if (!who) {
    throw new GrantDraftError(
      "a permission request needs the name of the person sending it. This message is sent from a real " +
      "account and makes commitments; an unsigned request from an unnamed person is one people are right to ignore.",
      { code: "no-operator-name" }
    );
  }

  const postUrl = String(candidate.post_url || "").trim();
  if (!postUrl) {
    throw new GrantDraftError("no post URL — the request must quote the exact post being asked about", { code: "no-post-url" });
  }

  const creditText = creditTextFor(candidate);
  if (!creditText) {
    throw new GrantDraftError(
      "no credit can be composed: this candidate has neither a poster handle nor a display name. " +
      "The request promises on-screen credit, so it cannot be drafted until we know whose name goes on it.",
      { code: "no-credit" }
    );
  }

  const handle = candidate.poster_handle ? `@${candidate.poster_handle}` : "there";
  const platform = String(candidate.platform || "").toLowerCase();
  const surfaceList = surfaces.join(", ");
  const about = storyTitle ? `our coverage of ${storyTitle}` : "our coverage of this story";

  // The exact terms being offered, kept as data so the ledger can store what the
  // person was actually asked — separately from the prose that asked it.
  const termsOffered = {
    use: "a short excerpt in an edited news video, with commentary and on-screen text",
    credit: creditText,
    creditPlacement: "on screen, for the duration your footage appears",
    surfaces: [...surfaces],
    exclusivity: "none — you keep your copyright and can post or license it anywhere else",
    payment: "none offered",
    revocable: "yes, before publication — tell us and we will not use it",
  };

  const body = [
    `Hi ${handle},`,
    ``,
    `I'm ${who} from ${outlet}. I saw your post and would like to ask permission to use your footage in ${about}.`,
    ``,
    `The post: ${postUrl}`,
    ``,
    `What we'd do with it:`,
    `• Use a short excerpt (a few seconds) inside an edited news video, with our own commentary and on-screen text over it.`,
    `• Credit you on screen as "${creditText}" for as long as your footage is visible.`,
    `• Publish that video on ${surfaceList}.`,
    ``,
    `What we're not asking for: you keep your copyright, this isn't exclusive, and you can still post or license the footage anywhere else. We're not offering payment.`,
    ``,
    `If you're happy with that, a simple "yes, you can use it with credit" is enough — and if you're able to send the original file, that's better quality than anything we can work from otherwise.`,
    ``,
    `Two other things worth saying plainly:`,
    `• If you'd rather we didn't, just say no or ignore this. That's a completely fine answer and I won't follow up.`,
    `• If you say yes and then change your mind before we publish, tell me and we won't use it.`,
    ``,
    `Can you also confirm you filmed this yourself, and roughly where and when? We check that before anything goes out.`,
    ``,
    `Thanks either way,`,
    who,
    outlet,
  ].join("\n");

  return {
    subject: `Permission to use your footage — ${outlet}`,
    body,
    creditText,
    termsOffered,
    platformNote: PLATFORM_NOTES[platform] || null,
    // What the operator has to do, in order. The send is theirs; the recording
    // is the engine's.
    checklist: [
      `Send this from your own ${candidate.platform || "platform"} account — not an automated one.`,
      "One message. Do not follow up if there is no reply.",
      "When they reply, record it with POST /scoop-ops/incident/candidates/:id/grant-reply.",
      "If they say no, or do not reply, the candidate stays uncleared and may still be embedded.",
    ],
  };
}

/**
 * Render the draft for a terminal or an admin page.
 *
 * Kept separate from the draft itself so the message text is never entangled
 * with presentation — the body is what gets pasted into a DM, verbatim.
 */
export function renderGrantDraft(draft) {
  const lines = [
    "─".repeat(72),
    `SUBJECT: ${draft.subject}`,
    "─".repeat(72),
    draft.body,
    "─".repeat(72),
    `CREDIT THAT WILL APPEAR: ${draft.creditText}`,
  ];
  if (draft.platformNote) lines.push(`PLATFORM NOTE: ${draft.platformNote}`);
  lines.push("BEFORE YOU SEND:");
  for (const step of draft.checklist) lines.push(`  • ${step}`);
  lines.push("─".repeat(72));
  return lines.join("\n");
}
