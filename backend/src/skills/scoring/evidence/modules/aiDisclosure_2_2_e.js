/**
 * 2.2.e — AI / automation disclosure (Methodology transparency / MT).
 * Presence detection (B.6.2b-2b): does the source publish an AI-use / AI-policy
 * page? (The "ai" keyword/path matching is word-boundary in the primitives —
 * never the substring in email/available.)
 */
import { makePresenceDetector } from "../presenceDetector.js";

export default makePresenceDetector({
  id: "2.2.e",
  component: "MT",
  pageType: "ai",
  confirmKeywords: ["artificial intelligence", "ai", "automation", "machine-generated", "generative"],
});
