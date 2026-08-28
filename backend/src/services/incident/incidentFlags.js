/**
 * incidentFlags.js — the engine's env flags, and nothing else.
 *
 * WHY THIS FILE EXISTS, which is a better reason than "tidiness".
 *
 * `incidentMediaEnabled` used to live in `incidentCutaways.js`, beside the
 * selector that reads it. When the ops router was gated on the flag (Gate F) it
 * imported the function from there — and that one import gave the WEB process a
 * path it had never had:
 *
 *     server.js → incident-ops.js → incidentCutaways.js → incidentFiles.js
 *                                                       → the house-grade module
 *
 * `stockLibraryBoundary.test.js` caught it immediately, on the rule that no
 * runtime module may so much as NAME the stock tooling — the house-grade module
 * cites the operator-side treatment script in its header, which is correct and
 * useful documentation and had simply never been reachable from a production
 * entry point before.
 *
 * (This header names no path either, for the same reason. The first draft of
 * this file spelled the script out while EXPLAINING the rule, and the guard
 * caught that too — which is the guard behaving exactly as intended.)
 *
 * The right fix is not to reword that comment. It is that a router asking "is
 * this feature on?" has no business importing the cutaway selector, the
 * quarantine filesystem layer and the house grade to find out. A flag read is a
 * flag read.
 *
 * ONE DEFINITION, TWO CONSUMERS. The router (web) and the selector (worker) both
 * read it from here; `incidentCutaways` re-exports it so existing callers and
 * tests are unaffected. Two copies of the `=== "1"` check would be two places to
 * get the dark-flag semantics wrong, which is the thing the strict-equality test
 * in incidentCutaways.test.js exists to pin.
 */

/**
 * Dark until switched on, in the established shape (brief §2 Phase 5).
 *
 * THE LITERAL STRING "1", not truthiness. `"0"`, `"true"`, `"yes"` and `" 1"`
 * are all off — a flag that turns on for anything non-empty turns on by
 * accident, and this one gates footage reaching a channel.
 */
export const incidentMediaEnabled = () => process.env.VIDEO_INCIDENT_MEDIA_ENABLED === "1";
