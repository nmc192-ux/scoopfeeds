/**
 * corrections-presence — does the source have a corrections / clarifications
 * page? (Q7: ONE evidence row, id "corrections-presence", which 2.1.d
 * [functioning corrections, ET], 2.5.b [correction rate, HA], and 2.5.e
 * [retraction history, HA] will CONSUME later. Recency / count / severity are
 * deferred — this is PRESENCE only; we do NOT write three rows.)
 *
 * component tagged "ET" as its primary 2.1.d home; it also feeds the HA
 * sub-criteria noted above.
 */
import { makePresenceDetector } from "../presenceDetector.js";

export default makePresenceDetector({
  id: "corrections-presence",
  component: "ET",
  pageType: "corrections",
  confirmKeywords: ["correction", "corrected", "clarification", "we regret", "errata", "accuracy"],
});
