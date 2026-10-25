/**
 * socialInsert.js - route 1 of #219: a journalist's or the public's social post, as a short clip in the
 * breaking-news insert.
 *
 * DrJ's rules (23 Oct, from #202/socialClips.js): at most 30 s, credited "via @handle on <platform>",
 * and only when the post itself is the story. DrJ's content rule (#218) applies to every clip.
 *
 *   prepareClip (rules)  ->  renderAirCopy (credit burned in, cut to <= 30 s)
 *                        ->  assertMediaSafe on the air copy (#218)
 *                        ->  insertQueue.admitSocialClip (re-checks all of it)
 *
 * The source file must already be on disk (downloaded by an editor or a tool); this module does not
 * fetch anything from the platforms.
 */
import { prepareClip } from "../live/socialClips.js";
import { assertMediaSafe } from "../safety/contentSafety.js";
import { renderAirCopy } from "./credit.js";

/**
 * @returns the admitted queue item. Throws (with `reasons`) when any step refuses; a refused clip never
 * reaches the queue.
 */
export async function queueSocialClip(clipInput, srcFile, airFile, { queue, safetyCheckers = {}, safetyLog = null, render = renderAirCopy, hasAudio = true, startSec = 0 } = {}) {
  const prep = prepareClip(clipInput);
  if (!prep.ok) throw Object.assign(new Error(`social clip refused: ${prep.errors.join("; ")}`), { reasons: prep.errors });
  await render(srcFile, airFile, prep.clip.credit, { playSec: prep.clip.playSec, startSec, hasAudio });
  await assertMediaSafe({ id: clipInput.url, file: airFile, kind: "social-clip" }, safetyCheckers, { log: safetyLog });
  return queue.admitSocialClip(clipInput, airFile);
}
