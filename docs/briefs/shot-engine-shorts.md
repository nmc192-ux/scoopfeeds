# CC brief — Shot engine for the daily shorts (replace the slideshow)

Owner: DrJ · Written: 23 Sep 2026

## 0. Why this exists
The daily autoposted shorts read as slideshows: one text card per beat, cut on slide boundaries, with at most the article's single image_url. On 23 Sep 2026 DrJ approved a sample short built in claude.ai, "Greenland pact: signed, not sold" (61 s, 1080x1920). That sample is the target format. It measured:
- Real imagery (footage, photos, satellite, maps, real headlines): ~93% of screen time. Bar for the loop: >= 70%.
- Real video: ~41%. Bar: >= 25% where the resolver finds any.
- Average shot length: 2.9 s. Bar: <= 3.0 s.
- Paragraph captions: 0. Bar: 0 (word-by-word only).
- Loudness: -14.1 LUFS. Bar: -14 LUFS +/-1, true peak <= -1 dBFS after AAC.
The sample was rendered by a Python/OpenCV engine (the longform film engine re-set for 1080x1920). DrJ will supply that reference code (short.py, vengine.py, mix_short.py) at Phase 1; Phase 0 does not need it.

## 1. The format, stated as rules
1. The unit is a shot, not a card. Each beat becomes 1-3 shots, each starting on a specific spoken word. An anchor is an assertion: if the phrase isn't in the narration, fail loudly.
2. Source ladder per shot, stop at the first real fit: real video of the actual thing -> real photo -> satellite / map / data -> stock (abstract beats only, never a named subject) -> text card as a last resort. Deliberate text-only punctuation cards ("NOT A SALE.") are allowed, at most two per short.
3. Stitch sources: at least two outlets on screen (recreated headline clipping, quotes with attribution, source lines on data). Every figure carries its source on the shot.
4. Motion is purposeful only. Allowed: satellite zoom to the subject; map camera moves with pins and fills timed to words; a crop window moving across wide footage to each person as they are named; slow push-ins on photos (approved in the sample). Not allowed: ambient drift on text.
5. Captions are word-by-word: chunks of up to 3 words, active word lime, Anton with a heavy black stroke. Suppress them where big type already says the words (punctuation cards, quote shots).
6. Safe zones at 1080x1920: margin 54 px; kicker tag top-left at y 250; brand top-right at y 250; captions start at y 1190; source line baseline y 1432; credit line baseline y 1474; keep content off x > 950 between y 1000 and 1700 (platform buttons).
7. Structure: hook text over the opening place shot for ~4 s; a turn ("Here's the turn") mid-way; a closing question the viewer answers in the comments (existing closer rules apply); end card with CTA plus a compact sources list.
8. Editorial gates unchanged and applied to every shot: motive gate, intensifier gate, sensitivity tiers, the Pakistan/politically-live KILL, Rule 0 (assertPublishAllowed). No casualties, bodies or violence against people in any selected footage or frame.

## 2. Phases
Build -> test -> verify each phase before the next. Everything ships dark behind VIDEO_SHOT_ENGINE_ENABLED (default off). Branch fresh from origin/main for every PR.

Phase 0 — Ground and choose the renderer (no code changes). Report:
(a) current prod values of VIDEO_BEAT_IMAGERY_ENABLED, VIDEO_SUBJECT_VISUALS_ENABLED, VIDEO_THUMBNAIL_ENABLED, VIDEO_VOICE_ID, VIDEO_VOICE_MODEL, and whether the incident media engine has produced any candidates;
(b) render budget: in the worker container, time a throwaway benchmark that warps a 1920x1080 frame into 1080x1920 with OpenCV (warpAffine), composites two text patches, and pipes 240 frames to ffmpeg libx264 crf 18 medium. The sandbox reference was ~0.1 s per frame on one CPU (61 s short in ~2.5 min). Report seconds per frame, with and without the promoter running;
(c) a map of where the current pipeline would change: spec writer, schema, resolver, assembler, TTS call, music bed, captions;
(d) a recommendation, with numbers: run the Python engine as a render step in the worker image, or port the shot classes to Node/ffmpeg. The default leaning is Python, since it is proven and shared with the longform skill. DrJ rules before any port.

Phase 1 — Word timings. Switch narration to ElevenLabs' with-timestamps endpoint so every word has a start and end time. Build word-by-word captions from them. VOICE DECIDED by DrJ 23 Sep 2026: his cloned "Dr J" voice CD9jldcGVbcDmJckCEwY on eleven_multilingual_v2, replacing Daniel. Make it env-only (VIDEO_VOICE_ID, VIDEO_VOICE_MODEL) so reverting is one line plus a recreate. Land it in the same deploy as this phase so the TTS cache refills once. Note multilingual_v2 bills 1 credit per character against turbo's 0.5. After the flip, confirm a short actually publishes (the heartbeat stays green on zero output). Acceptance: one offline short whose captions land on the words.

Phase 2 — Spec writer emits a shot list. Per beat, 1-3 shots, each with: anchor (verbatim phrase from that beat's caption), kind (from the Phase 4 vocabulary), subject (photographable noun phrase), source_intent. The schema rejects an anchor not verbatim in its caption, more than two punctuation cards, and average shot length over 3 s. Gate every prompt change with scripts/spec-dry-run.mjs on the VPS (prompt diff plus raw JSON). Beat and caption counts must stay unchanged; a leaked length signal has burned this pipeline four times.

Phase 3 — Resolver, the full ladder. Order: incident media candidates -> Wikimedia Commons video (filemime:video/webm; White House, NASA, DVIDS, VOA and CC-BY uploads; official events appear within a day) -> open-web news photos date-restricted to the story (authorised by DrJ 30 Aug) -> Commons/Wikidata photos -> Esri satellite -> Natural Earth map -> stock for abstract beats -> card.
Hard-won facts:
- Commons returns 429 on original files. Fetch transcodes instead: upload.wikimedia.org/wikipedia/commons/transcoded/{h0}/{h0h1}/{name}/{name}.1080p.vp9.webm, where h is the md5 of the underscored filename. One request at a time, 1.5-4 s apart, descriptive User-Agent.
- Verify every download with file/ffprobe; error pages arrive as HTML saved under the media filename.
- Keep a per-source crop registry for burned-in banners. White House videos need the visible height capped at 0.80 of the frame.
- In-point picking is the hard part. Extract a contact sheet (1 frame per 3-12 s), have the vision model pick in-points matching each shot's subject, log the pick beside the frames, and run the sensitivity check on the same frames.
- Reuse is required (DrJ 20 Sep): store asset RECORDS (URL, licence, credit, in-points, coordinates, data series, quotes) in a manifest table and look them up first. Fetch media at render time and keep only the finished MP4 (DrJ 29 Aug: no large in-house library). Longform film asset_manifest.json files feed the same table.

Phase 4 — Vertical shot vocabulary:
- SatZoom.
- MapShot: camera, pins, fills timed to words, labelled neighbours; frame the subject above the caption band. Include the open 18 Sep marine-polygon follow-up (straits and seas).
- Photo: cover, or contain for group and portrait photos.
- Clip: moving 9:16 crop over 16:9 footage, ymax banner crop, and a name label that REPLACES the previous one as the camera arrives.
- Headline clipping card with highlight sweep: under 15 words, outlet and date, never article bodies.
- Punctuation card.
- Quote over the speaker's own footage: serif italic, bottom of the frame darkened all the way down.
- Count-up number, simple graphic, and end card.
Acceptance: a preview contact sheet per short before any full render.

Phase 5 — Sound.
- Bed: ElevenLabs Music (instrumental, ~110 BPM, verify no vocals) or DrJ's licensed tracks; the synth stays as fallback.
- Envelope ducking under speech.
- SFX: a whoosh on every cut; a low impact on punctuation and turn shots.
- Loudness: two-pass loudnorm to -14 LUFS with TP -2 before AAC (the sample reached -0.8 dBFS after encode at TP -1.5).

Phase 6 — Metrics, digest, rollout.
- Log per short: real-imagery share, real-video share, average shot length, card fallbacks, outlets shown.
- Daily digest: a 12-frame contact sheet per published short.
- If a short misses the bars in §0, it still publishes, but the digest flags it.
- Rollout: 3 complete offline MP4s from real current articles (one geographic, one named person, one abstract/economic). DrJ watches them on his phone and rules, then the flag flips.

## 3. Open decisions for DrJ (flag them; do not decide)
1. Renderer (from Phase 0).
2. Cost ceiling per short. The sample cost ~$0.32 in ElevenLabs credits, of which ~$0.15 is the generated bed.

## 4. Deploy reminders
- Start with cd /opt/scoopfeeds and confirm the prompt shows /opt/scoopfeeds$.
- Run build with no service filter, then up -d --force-recreate.
- Verify with git log -1 --oneline, not build output.
- Renderer changes move VIDEO_BUILDER_FINGERPRINT, so batch visual changes into few deploys.
