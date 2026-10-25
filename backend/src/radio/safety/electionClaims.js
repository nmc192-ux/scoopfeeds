/**
 * electionClaims.js — #208 item 10 (with #197's rules): a spoken line that asserts election FRAUD or
 * RIGGING, or that someone WON an election, airs only when it is attributed to a named outlet or an
 * official. Otherwise the line is dropped (checks.js: on air, silence beats a wrong fact).
 *
 * "Attributed" means BOTH an attribution verb ("reports", "projects", "according to", "called", "says"...)
 * AND a named source: an outlet that covered the story (from the fact pack), the line's own `outlet`, a
 * wire or decision desk, or an election official. "Officials say" with no office is not enough for a
 * winner call, because a projection is only as good as who made it.
 */

const FRAUD = /\b(fraud(ulent)?|rigg(ed|ing)|stolen election|steal(ing)? the election|ballot[- ]stuffing|vote[- ]rigging|election (was |is )?(stolen|fixed))\b/i;
const WIN = /\b(won|wins|has won|have won|winning|winner|victory|victorious|defeat(ed|s)?|beat|beats|unseat(ed|s)?|flip(ped|s)?|will win|is set to win|clinch(ed|es)?|declared the winner|elected)\b/i;
const ELECTION = /\b(election|elections|race|races|seat|seats|governor|governorship|senate|senator|house|congress|congressional|midterms?|primary|runoff|ballot|ballots|vote|votes|voters|polls?|electoral|district|mayor(al)?|state legislature|majority|control of)\b/i;
const VERB = /\b(reports?|reported|reporting|projects?|projected|projection|calls?|called|according to|says|said|declared|declares|announced|announces|certified|certifies|estimates?|estimated|alleges?|alleged|claims?|claimed|accused|accuses)\b/i;
// Sources that may be named for a call even when they are not in the story's outlet list.
const NAMED_SOURCE = /\b(the )?(associated press|AP|reuters|decision desk( hq)?|DDHQ|NBC News|CBS News|ABC News|CNN|Fox News|Edison Research|the New York Times|the Washington Post|election officials? in [A-Z][a-z]+|(state|county) election (officials?|board)|secretary of state|board of elections|election commission|electoral commission|the (state|county) canvass(ing board)?)\b/i;

/** Which claim, if any, the line makes: "fraud" | "winner" | null. */
export function electionClaim(text) {
  const t = String(text || "");
  if (FRAUD.test(t)) return "fraud";
  if (WIN.test(t) && ELECTION.test(t)) return "winner";
  return null;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the line name who says it? `outlets` = source names that covered the story (from the pack). */
export function isAttributed(text, { outlets = [], outlet = null } = {}) {
  const t = String(text || "");
  if (!VERB.test(t)) return false;
  if (NAMED_SOURCE.test(t)) return true;
  const names = [outlet, ...outlets].filter(Boolean);
  return names.some((n) => new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(t));
}

/** null when the line may air, else the reason it is dropped. */
export function electionClaimVerdict(text, ctx = {}) {
  const claim = electionClaim(text);
  if (!claim) return null;
  if (isAttributed(text, ctx)) return null;
  return claim === "fraud" ? "election: fraud or rigging asserted without a named outlet or official" : "election: a winner asserted without a named outlet or official";
}
