/**
 * vision.js — the vision checks the shot resolver runs on real frames.
 *
 * IN-POINT PICKING IS THE HARD PART (brief, Phase 3): a contact sheet of the
 * clip (1 frame per 3–12 s) goes to the vision model, which picks the frames
 * that match the shot's subject — and the SENSITIVITY CHECK RUNS ON THE SAME
 * FRAMES in the same call. No casualties, bodies or violence against people in
 * any selected footage or frame, ever.
 *
 * PHOTOS get the same treatment plus two rules (DrJ, 24 Sep 2026): never a
 * private individual's personal photo, and never a social-media screenshot —
 * especially in crime stories.
 *
 * FAILS CLOSED. No key, a failed call or an unparseable answer all mean "not
 * verified", and the resolver treats not-verified as a refusal: an unmeasured
 * check is a failure, never a pass (agentic-workflow §5).
 */

import { logger } from "../logger.js";

// A frame or photo must show the NAMED subject specifically, not something like
// it. Measured 24 Sep: "Himalayas" accepted a hazy town view in Dehradun, and
// "Joint Base Andrews" accepted a close-up of the President speaking there.
export const MIN_MATCH = 7;

export const VISION_MODEL = () => process.env.VIDEO_VISION_MODEL || "gemini-3.5-flash";
const ENDPOINT = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

async function ask({ prompt, images, deps = {} }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "GEMINI_API_KEY unset" };
  const fetchImpl = deps.fetchImpl || fetch;
  const model = VISION_MODEL();
  const parts = [{ text: prompt }];
  for (const img of images) parts.push({ inline_data: { mime_type: "image/jpeg", data: Buffer.from(img).toString("base64") } });
  try {
    const res = await fetchImpl(ENDPOINT(model, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return { ok: false, reason: `vision HTTP ${res.status}` };
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const usage = j?.usageMetadata || {};
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()); }
    catch { return { ok: false, reason: "vision answer was not JSON", usage }; }
    return { ok: true, parsed, usage, model };
  } catch (err) {
    return { ok: false, reason: `vision call failed: ${String(err.message).slice(0, 80)}` };
  }
}

/**
 * Pick in-points in a clip for one shot, and screen the same frames.
 *
 * @param {object} p
 * @param {Array<{t:number, jpeg:Buffer}>} p.frames  — in time order
 * @param {string} p.subject   — what the shot must show
 * @param {string} p.caption   — the narration it sits under
 * @param {string} p.clipTitle — the Commons title, for context only
 * @returns {Promise<{ok, picks:[{t, score, note}], sensitive:boolean, bannerAt:number|null, reason, usage}>}
 */
export async function pickInPoints({ frames, subject, caption, clipTitle, deps = {} }) {
  const prompt = `You are selecting footage for a news short. The frames below are sampled from ONE video, in order, numbered 0 to ${frames.length - 1}; frame i is at the time listed.
${frames.map((f, i) => `  frame ${i}: t=${f.t.toFixed(1)}s`).join("\n")}
Video title: ${JSON.stringify(String(clipTitle || "").slice(0, 160))}
The shot must show: ${JSON.stringify(subject)}
It plays under the narration: ${JSON.stringify(String(caption || "").slice(0, 240))}

Answer ONLY JSON:
{"frames":[{"i":0,"shows_subject":true|false,"match":0-10,"score":0-10,"sensitive":true|false,"banner":true|false,"note":"<=12 words"}],
 "sensitive_any": true|false,
 "reason":"<=20 words"}
- "shows_subject": the frame plainly shows the subject named above (not just something similar).
- "match": how SPECIFICALLY the frame shows the named subject. 9-10: unmistakably that thing (the named person's face, the named place's recognisable landmark or landscape). 5-6: plausibly related but generic. 0-4: something else that merely resembles it — e.g. an ordinary town with hills for "Himalayas", a person speaking at a place for the place itself.
- "score": how good an opening frame for this shot it is — clear, well composed, the subject prominent.
- "sensitive": the frame shows casualties, bodies, injured people, blood, or violence against people. Be strict.
- "banner": burned-in text or a broadcast banner covers part of the picture.
Judge only what is visible. Do not guess.`;
  const r = await ask({ prompt, images: frames.map((f) => f.jpeg), deps });
  if (!r.ok) return { ok: false, picks: [], sensitive: true, bannerAt: null, reason: r.reason, usage: r.usage };
  const rows = Array.isArray(r.parsed?.frames) ? r.parsed.frames : [];
  const sensitive = Boolean(r.parsed?.sensitive_any) || rows.some((x) => x?.sensitive);
  const picks = rows
    .filter((x) => x && x.shows_subject && (Number(x.match) || 0) >= MIN_MATCH && !x.sensitive && Number.isInteger(x.i) && frames[x.i])
    .sort((a, b) => ((b.match || 0) + (b.score || 0)) - ((a.match || 0) + (a.score || 0)))
    .slice(0, 3)
    .map((x) => ({ t: frames[x.i].t, match: Number(x.match) || 0, score: Number(x.score) || 0, note: String(x.note || "").slice(0, 80), banner: Boolean(x.banner) }));
  const bannerRow = rows.find((x) => x?.banner && Number.isInteger(x.i) && frames[x.i]);
  logger.info(`👁 in-points "${String(subject).slice(0, 40)}" ← ${String(clipTitle).slice(0, 50)}: ${picks.length} pick(s)` +
    `${sensitive ? " · SENSITIVE" : ""} · ${r.usage?.promptTokenCount ?? "?"} in / ${r.usage?.candidatesTokenCount ?? "?"} out tok (${r.model})`);
  return { ok: true, picks, sensitive, bannerAt: bannerRow ? frames[bannerRow.i].t : null, reason: String(r.parsed?.reason || ""), usage: r.usage };
}

/**
 * Judge one still photograph for one shot.
 * @returns {Promise<{ok, usable:boolean, matches, sensitive, screenshot, privatePerson, reason, usage}>}
 *   usable is the conjunction the resolver acts on; ok:false means unverified → refuse.
 */
export async function judgePhoto({ jpeg, subject, caption, crimeStory = false, deps = {} }) {
  const prompt = `You are checking one photograph for a news short.
The shot must show: ${JSON.stringify(subject)}
It plays under: ${JSON.stringify(String(caption || "").slice(0, 240))}
${crimeStory ? "This is a CRIME story: be strict about anyone who could be a private individual.\n" : ""}
Answer ONLY JSON:
{"matches":true|false,"match":0-10,"sensitive":true|false,"screenshot":true|false,"private_person":true|false,"reason":"<=20 words"}
- "matches": the photo plainly shows the subject named above.
- "match": how SPECIFICALLY it shows the named subject. 9-10 unmistakably that thing; 5-6 plausibly related but generic; 0-4 something that merely resembles it.
- "sensitive": casualties, bodies, injured people, blood, or violence against people.
- "screenshot": a screenshot of a social-media post, profile, app, website or chat, or a phone screen capture.
- "private_person": the photo's focus is an identifiable private individual (not a public official, politician, celebrity or other public figure acting publicly), e.g. a personal photo, selfie or family picture.
Judge only what is visible.`;
  const r = await ask({ prompt, images: [jpeg], deps });
  if (!r.ok) return { ok: false, usable: false, reason: r.reason, usage: r.usage };
  const p = r.parsed || {};
  const match = Number(p.match) || 0;
  const usable = Boolean(p.matches) && match >= MIN_MATCH && !p.sensitive && !p.screenshot && !p.private_person;
  return { ok: true, usable, match, matches: Boolean(p.matches) && match >= MIN_MATCH, sensitive: Boolean(p.sensitive), screenshot: Boolean(p.screenshot),
    privatePerson: Boolean(p.private_person), reason: String(p.reason || ""), usage: r.usage };
}
