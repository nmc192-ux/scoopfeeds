/**
 * 2.1.a — Named, documented editorial leadership (Editorial track record / ET).
 * Presence detection (B.6.2b-2b): does the source have an about/masthead/team
 * page naming editorial leadership? confirmKeywords supply the strict-confirm
 * positive signal; navKeywords + conventionPaths live in the primitives.
 */
import { makePresenceDetector } from "../presenceDetector.js";

export default makePresenceDetector({
  id: "2.1.a",
  component: "ET",
  pageType: "leadership",
  confirmKeywords: ["editor", "editor-in-chief", "editorial team", "masthead", "our team", "reporters", "founded"],
});
