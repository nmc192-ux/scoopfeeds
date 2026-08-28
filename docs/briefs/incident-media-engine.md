# CC Brief — Incident Media Engine (scoop → verify → clear → construct)

**Repo:** scoop-news · **Date:** 28 Aug 2026 · **Author:** DrJ (drafted with Claude)
**Predecessors:** `docs/briefs/stock-library-builder.md` (#119, #122),
`docs/briefs/stock-cutaways-render.md` (#121)

CC sessions share no memory. This brief is self-contained. Where it says a decision was
made, treat it as settled.

---

## 0. What this is

ScoopFeeds scoops news text. This engine scoops the MEDIA of news — incident videos and
photos posted by the people who witnessed them — verifies that the media is what it claims
to be, clears the rights to use it, and feeds cleared assets into the video renderer.

The mission constraint, in the operator's words: a real news and video curator, not a fake
video production machine. Two consequences bind every phase:

- **No unverified frame renders.** Verification failure is a kill, not a warning.
- **No uncleared frame renders.** Rights come from a grant or a fair-use-shaped excerpt
  with mandatory on-screen credit — never from treatment. Grading/cropping/motion does not
  affect rights and must never be reasoned about as if it does.

The operator publishes under his own name while serving as a Deputy Commissioner in
Punjab, Pakistan. A relabelled clip or a wrongly-attributed crowd is a professional crisis,
not an embarrassment. That is why verify comes before clear, and both before construct.

**Build discipline (operator's instruction):** phased. Each phase = build → automated
tests → a live verification the operator runs and rules on → only then the next phase.
Do not build ahead of the current phase. Each phase is its own branch and PR; the PR
description states what the operator must run/see to verify the phase live.

---

## 1. Ground before Phase 1 (report, no code)

Measure and report, with file:line evidence:

- Both suite baselines on current main, counted yourself.
- The ingestion path: where scooped articles/events land, and what hook exists for
  attaching candidate media to a story/event. (The event-graph and social-post paths
  exist; find the seam.)
- What the repo already has that this engine must REUSE, not duplicate:
  - `backend/src/services/longform/engine/footage-search.mjs` — multi-source search with
    provenance (Wikimedia, NASA, DVIDS, Archive.org, YouTube, Pexels)
  - `longformFootageRelevance.js` — LLM relevance judgment on footage
  - `longformGroundedness.js` — the fiction-cannot-pass-a-figure-check gate
  - `longformMediaGate.js` — asset authenticity checks
  - the source-scoring service (evidence layer + LLM judgment)
  - the card photo cascade and its attribution plumbing
  - the sensitivity gate (`editorialSensitivity.js`) and Rule 0 (`assertPublishAllowed`)
  - migration 031's stock_asset_usage table and the stock manifest reader
- Platform access facts, stated honestly: what X/Twitter media access costs at the API
  tier we'd need (do not scrape); what YouTube's ToS permits for third-party download
  (assume: nothing outside their own tools — verify); what Instagram/TikTok permit.
  Where a platform's lane is closed, the engine's answer is Lane 2 (ask the poster to
  send the file), not a workaround. No scraping anywhere in this engine — losing platform
  access to the account that publishes is an existential risk, not a cost.
- Whether ffmpeg + available tooling in this environment can do perceptual hashing /
  keyframe extraction for reverse search (Phase 2 depends on this — report what is
  actually installable within the no-new-runtime-deps-without-naming-them rule).

Deliver as a grounding report. Stop for rulings before Phase 1 code.

---

## 2. The phases

### Phase 1 — Candidate intake and the media ledger

The spine everything else hangs on.

- A `media_candidates` store (DB migration, following 031's conventions): candidate id,
  story/event linkage, platform, canonical post URL, poster handle + display name,
  claimed date/location (as claimed — not yet verified), media type, our acquisition
  status, and a status machine:
  `candidate → verifying → verified | killed(reason)`
  `verified → clearing → cleared(grant | fair_use | owner) | uncleared`
  `cleared → constructed(video id)`
  Every transition writes an audit row: when, by what check, with what evidence. This
  ledger IS the editorial defence if a use is ever challenged; treat it as the product.
- Intake sources for v1: (a) manual — the operator pastes a post URL against a story;
  (b) automatic — candidate URLs surfaced from the existing ingestion/event path where
  posts already flow; (c) **commissioned** — the operator supplies a TOPIC (with or
  without a story already in the system) plus optional resources: post URLs, his own
  photos/videos, files he holds rights to, and the desired output (short vs long-form).
  A commissioned topic creates a story stub and runs the SAME pipeline — supplied URLs
  become candidates like any other and still pass verification; supplied own media is
  marked `cleared(owner)` with a recorded declaration (see Phase 3). Commissioning
  changes where candidates come from, never which gates they pass.
  No new platform crawlers in Phase 1.
- Embed-only lane (Lane 1) handled here: a candidate can be marked `embed_only`, usable
  by the site/cards, never by the renderer. That gives immediate utility before any
  clearance machinery exists.
- **Phase 1 live test (operator):** paste three real post URLs from a current story;
  see them land as candidates with correct poster/platform metadata; see the ledger rows.

### Phase 2 — Verification (the kill gate)

The engine's reason to exist. A candidate may not leave `verifying` as `verified` unless
it passes ALL of:

1. **Prior-appearance check.** Keyframes (video) or the image itself are reverse-searched
   for earlier appearances. An appearance predating the claimed incident = `killed(stale)`.
   Ground which reverse-search routes are actually available to us (API terms, cost) and
   propose; do not scrape. If no automated route is available at acceptable cost, this
   check becomes a structured HUMAN step with the queue UI from Phase 4 — say so plainly
   rather than shipping a vacuous check.
2. **Corroboration.** ≥2 independent posts of the same incident (not reposts of the same
   file — perceptual-hash them) OR the poster is the established original with direct
   evidence of presence. Independence is the point; define it concretely.
3. **Location/context sanity.** LLM vision pass against visible cues (signage, language,
   terrain, weather) vs the claimed location/date. Contradiction = kill; "cannot confirm"
   on a Pakistan-related or politically live story = kill; "cannot confirm" elsewhere =
   flag for the human queue.
4. **Sensitivity routing.** A story flagged by the sensitivity gate gets NO third-party
   incident media at all — typography-only, matching how cards already behave. Wire to
   the existing gate; do not build a new classifier.
- Kills are terminal per candidate and logged with reasons. Over-killing is correct.
- **Phase 2 live test (operator):** feed it (a) a genuine current-incident clip, (b) an
  old clip relabelled as current (construct this test case deliberately), (c) a
  same-file repost chain. Verify: (a) passes, (b) killed as stale, (c) collapses to one
  candidate. The operator rules on the kill messages' clarity.

### Phase 3 — Clearance

Two lanes into `cleared`, one honest dead end:

- **Lane 0 — owner media.** The operator supplies media he shot or holds rights to
  (commissioned mode, or district/official material he is authorised to release). Marked
  `cleared(owner)` with a one-line recorded declaration of the basis ("shot by me",
  "official release, authorised"). No verification skip: owner media still passes Phase 2
  — provenance is about rights, and verification is about truth, and owning a clip does
  not make its claimed date or location correct.
- **Lane 2 — the grant (primary lane for third-party media).** Draft-and-queue, not auto-send: the engine
  drafts a permission request to the ORIGINAL poster (identified in Phase 2 — asking the
  original is itself verification), naming the channel, the use, and the on-screen
  credit. The operator sends it from his own account and records the reply; the ledger
  stores the grant text/screenshot reference and unlocks `cleared(grant)`. Auto-send is
  out of scope for v1 — platform anti-spam rules and the operator's own name on every
  message argue for human send at this volume. Revisit only after volume proves the
  bottleneck. The file itself is ideally supplied by the poster (cleanest on every
  platform's ToS); the request template asks for it.
- **Lane 3 — fair-use-shaped excerpt.** Only where Lane 2 failed or is impractical, and
  only within hard limits enforced in code, not prompt: excerpt ≤ N seconds (ground a
  default; operator rules), must render with the commentary/typography layer over or
  around it (never full-frame alone for its full duration), mandatory credit chip with
  poster handle + platform, never music content, never broadcaster/network or sports
  footage (blocklist by source type in the ledger). Mark `cleared(fair_use)` with the
  limits recorded. State in code comments what this is: a defence posture, not a licence
  — claims are a cost, not a surprise.
- Everything else: `uncleared`, terminal for rendering, still available as `embed_only`.
- **Credit is structural.** A cleared asset carries `creditText`; the renderer refuses a
  third-party asset without it. The stock-cutaway credit chip is the mechanism — reuse it.
- **Phase 3 live test (operator):** run one real grant end-to-end on a genuine candidate
  (draft → send → reply → ledger). Render nothing yet.

### Phase 4 — The review queue

The operator's control surface, sized to his time budget (~1 minute/day):

- A single view (site admin or CLI — ground which is cheaper; the site has an admin
  surface) listing candidates by status, showing: thumbnail, claim, verification
  evidence, kill reasons, clearance state. One-tap approve/kill on anything flagged
  "cannot confirm".
- **The render gate for v1 is human:** nothing reaches the renderer without one operator
  tap per asset, even when fully verified+cleared. Full automation of that tap is a
  LATER decision made on the queue's track record, not a default. This is the tiering
  the operator accepted: official/verified media flows to the queue automatically;
  the queue's tap is what lets it render.
- **Phase 4 live test (operator):** clear a real asset through the queue in under a
  minute; kill one; confirm both ledger trails.

### Phase 5 — Construct

Only now does a pixel render.

- Cleared assets become render-ready: house treatment for STYLE (grade to palette — and
  the comment says style, not rights), stills get the Ken Burns/cutout motion path,
  video excerpts get the Lane 3 limits enforced at the filter-graph level (duration cap,
  commentary layer present, credit chip burned).
- Feed the same assembly path as stock cutaways (#121's stream-that-ends mechanism) — an
  incident asset is a cutaway with a different provenance. Do not build a second
  compositing path.
- **No AI motion on real news imagery.** Ken Burns pan/zoom on a real photo: yes.
  Generative animation of a real photo (fabricated motion attached to a real event): no,
  enforced, commented.
- The fingerprint rule from #121 applies: any new file that changes pixels joins
  VIDEO_BUILDER_FINGERPRINT, with the geometry test updated.
- Dark flag (`VIDEO_INCIDENT_MEDIA_ENABLED`), default off, documented in env_reference.
- **Phase 5 live test (operator):** one full end-to-end — real incident, real grant,
  queue tap, rendered short reviewed by eye before any publish. This is the acceptance
  test for the whole engine.

### Phase 6 — The segmenter (long video → usable clips)

A long video with a clean lane (owner media, a granted file, or openly-licensed archive
footage) is worth many shorts-scale clips. This phase turns one into candidates.

- Input: one CLEARED long video (the lane must exist BEFORE segmentation — segmenting an
  uncleared video produces uncleared segments, enforced by inheriting the parent's ledger
  state; a fair_use parent additionally caps total excerpted seconds across ALL its
  segments, not per segment).
- Mechanics: scene detection (ffmpeg scene-change scoring) + transcript alignment
  (the audio through the existing transcription path if one exists — ground it) to
  produce candidate segments with start/end, a thumbnail, and the transcript slice.
  Rank by a cheap heuristic first (speech density, scene stability); LLM ranking only if
  the heuristic proves insufficient — report rather than assume.
- Each accepted segment becomes a `media_candidates` row linked to its parent, entering
  the normal queue. The operator picks segments in the Phase 4 queue like any candidate.
- Out of scope: auto-publishing clips as their own shorts. Segments feed the renderer as
  material; a "clips channel" is a separate product decision.
- **Phase 6 live test (operator):** supply one real long video you hold rights to;
  receive ranked segments with thumbnails; pick two through the queue; see them render
  as cutaways in a test video.

---

## 2b. Relationship to the other tracks (so nothing is rebuilt or orphaned)

- **The MPT-derived stock library (#119/#122):** absorbed and demoted, not discarded. It
  is the bottom rung of the source ladder — the fallback when no true-to-story media
  clears — and its render path (#121's cutaway mechanism, credit chip, fingerprint
  discipline) is the ONE compositing path this engine feeds. Library expansion stays
  frozen; the unresolved-`visual` log lines remain the signal for whether it ever grows.
- **The reference-video lesson (the "founded" Reel):** this engine is the imagery half
  only. The typography half — word-synced kinetic type on ElevenLabs timestamps, the
  three-surface background alternation, count-up numbers, collage multiplication — is a
  SEPARATE brief, not yet written, and is expected to contribute more to the perceived
  quality of the output than this engine does. Do not attempt to fold it in here; the
  two meet at the renderer.
- **Website imagery retrieval:** the source ladder already covers the legitimate version
  — official newsrooms, press kits, government releases, and openly-licensed archives,
  each with stated terms recorded in the ledger. Arbitrary retrieval from websites
  without stated terms is scraping and stays out, per §3.



- Reuse the longform footage/relevance/groundedness/media-gate modules where they fit;
  extending them is better than duplicating them. Flag if extension would disturb the
  longform track and propose the seam.
- No scraping; no ToS-violating downloads; where a platform's lane is closed, Lane 2 is
  the answer. Any acquisition that can't name its lane doesn't happen.
- No new npm dependencies without stopping and naming them (the phash/keyframe question
  from grounding is the expected exception — argue it there).
- Boundary guard, Rule 0, sensitivity gate all keep passing untouched unless a phase
  explicitly and reportedly wires to them.
- Suites reported by count against self-measured baselines, every PR.
- Never create a test file with a truncating `cat >`.
- Deploy notes per repo convention: full no-filter build + up -d --force-recreate;
  `restart` does not re-read env_file on this box.

## 4. Open questions for grounding to answer

- Q1: Reverse-search route and cost (the Phase 2 linchpin).
- Q2: Lane 3 excerpt cap default — ground what comparable commentary formats sustain and
  propose a number for the operator to rule on.
- Q3: Queue surface — admin page vs CLI for v1.
- Q4: Where candidate media FILES live pre-clearance (they may be killed — a quarantine
  dir with its own sweeper, per the no-artifact-class-without-a-sweeper rule).
