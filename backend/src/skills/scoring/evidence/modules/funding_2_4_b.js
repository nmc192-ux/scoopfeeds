/**
 * 2.4.b — Funding mix transparency (Independence / Ind).
 * Presence detection (B.6.2b-2b): does the source publish a funding / support /
 * how-we're-funded page? ("subscribe" is excluded from the funding nav match in
 * the primitives — paywall ≠ funding transparency.)
 */
import { makePresenceDetector } from "../presenceDetector.js";

export default makePresenceDetector({
  id: "2.4.b",
  component: "Ind",
  pageType: "funding",
  confirmKeywords: ["funded", "funding", "donors", "revenue", "nonprofit", "membership", "grants", "supported by"],
});
