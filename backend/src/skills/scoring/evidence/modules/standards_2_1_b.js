/**
 * 2.1.b — Published editorial standards / ethics (Editorial track record / ET).
 * Presence detection (B.6.2b-2b): does the source publish an ethics /
 * editorial-standards / guidelines page?
 */
import { makePresenceDetector } from "../presenceDetector.js";

export default makePresenceDetector({
  id: "2.1.b",
  component: "ET",
  pageType: "standards",
  confirmKeywords: ["editorial standards", "ethics", "accuracy", "impartiality", "corrections policy", "code of conduct", "editorial guidelines"],
});
