# CC Brief — Stock Library Builder (acquisition + treatment, no render-loop integration)

**Repo:** scoop-news · **Date:** 27 Aug 2026 · **Author:** DrJ (drafted with Claude)
**Reference implementation:** https://github.com/harry0703/MoneyPrinterTurbo (`app/services/material.py`, MIT)

CC sessions share no memory. This brief is self-contained; do not assume knowledge of prior sessions.

---

## 1. Context — why this exists

ScoopFeeds videos are moving toward a Vox-style premium look. The agreed architecture for stock
footage (decided Aug 14) is:

- **A curated, pre-treated local library** of a few hundred hand-tagged subject-class assets —
  downloaded once, graded to the house palette, treated once, stored locally.
- **Selection at render time is a lookup against known-good assets, never a live search.**
  Live keyword search is explicitly rejected: it is the mechanism that produced the
  globe-on-a-gold-story and bar-chart-on-a-displacement-story mismatches.
  > **SUPERSEDED 2026-08-30 — see §7a.** The local library is abandoned and render-time
  > search is now permitted, under a named replacement for the human eye. What this
  > bullet was actually protecting against was *unreviewed relevance*, which is a
  > different property from *local storage*; the two were welded together here.
- **The editorial rule:** stock illustrates the **SUBJECT**, never the **EVENT**. A flag, a
  building, a category texture, a locator map. Never a scene a viewer could mistake for what
  actually happened; never an unnamed human face standing in for real people; never anything on
  a beat the sensitivity guard flags.

This brief builds only the **acquisition and treatment tooling** that populates the library.
Render-time selection (the per-beat `visual` field in the spec, the lookup, the cutaway
assembly) is a **separate, later brief**. Nothing here touches the render loop.

MoneyPrinterTurbo (MIT-licensed) contains mature Python clients for exactly the providers we
want — Pexels, Pixabay, Coverr — with the provider quirks already solved. **Port the logic to
Node** (this repo is Node; do not vendor Python). Use `material.py` as the reference for:

- best-quality rendition selection among each result's multiple video URLs
- aspect-ratio filtering (`_matches_video_aspect`, `_filter_materials_by_aspect`)
- Pixabay Cloudflare-challenge detection (`_is_cloudflare_challenge`) and rate-limit handling
- multi-key rotation (`get_api_key` cycles through a key list)
- response caching (`_search_videos_with_cache`)
- per-clip provenance recording (`_material_source_record`: provider, creator, source URL)

Where logic is ported closely, keep a header comment in the ported file crediting
MoneyPrinterTurbo and noting the MIT licence.

---

## 2. Security constraints — read before writing any code

MoneyPrinterTurbo is a **reference to read, not a dependency to install**. No MPT code — Python
or otherwise — runs on any machine of ours, and nothing from that repo enters `package.json`.
The rules below are what make that true in practice rather than in intention.

**2a. Verify every endpoint against the provider's own documentation.**
When you port code you also copy its URLs. Before writing a request, confirm each host and path
against the official docs (pexels.com/api, pixabay.com/api/docs), **not** against `material.py`.
Any endpoint that does not match the official docs exactly — including a near-miss hostname —
is a stop-and-report, not a judgement call. Cite the doc URL in a comment beside each endpoint
constant.

**2b. Zero new runtime dependencies.**
Node 18+ has native `fetch`; ffmpeg is already available. Do not add npm packages for HTTP,
file handling, image work, or convenience. If you believe a dependency is genuinely
unavoidable, **stop and name it with a justification** rather than adding it. Dev-only test
helpers already in the repo are fine. This is the single largest supply-chain surface in this
work and it stays closed.

**2c. The tools must be unreachable from the runtime, and a test must prove it.**
Nothing in `workerProcess.js`, `scheduler.js`, any queue handler, or any render-path module may
import these scripts, directly or transitively. Write a guard test asserting that
non-reachability from the process entry points. Precedent to follow: the `sweepAtStartup`
reachability guard, which was verified by stashing the wiring and watching the test fail —
do the equivalent here (temporarily add an import, confirm the test fails, remove it).

**2d. Provider keys are Mac-local and never reach production.**
`PEXELS_API_KEY` and `PIXABAY_API_KEY` go in the Mac `backend/.env` only. Do not add them to
the VPS `.env`, to `docker-compose*.yml`, to any container environment, or to
`env_reference.md`'s production tables — if they are documented there at all, mark them
explicitly as local tooling, not production configuration. These are free-tier read-only search
keys; keeping them off the server means a leak has no adjacency to the ElevenLabs, Gemini,
Meta or YouTube credentials.

**2e. Acquisition runs on the Mac only.**
Downloaded media is foreign content parsed by ffmpeg. It stays on the Mac through acquisition
and treatment; how the treated library reaches the VPS is the later selection brief's problem.
Do not add a VPS acquisition path, a cron, or a container service for any of this.

**2f. Licence hygiene.**
MIT permits commercial use and modification and asks that the copyright notice travel with
substantial copied code. Any file whose logic follows `material.py` closely carries a header
naming MoneyPrinterTurbo, its repo URL, and its MIT licence.

**2g. Reviewability is a requirement, not an outcome.**
This should land as a few hundred lines of new JavaScript readable in one sitting. If the diff
is growing past that, say so and stop — a port that cannot be read in full has lost the
property that makes it safe.

---

## 3. What to build

Two CLI tools plus a manifest. Home: `backend/scripts/` (durable tooling, committed — this is
NOT a disposable `backend/_*.mjs` harness).

### 3a. `stock-acquire`

```
node backend/scripts/stock-acquire.mjs --classes ports,ships --per-class 12 [--providers pexels,pixabay] [--dry-run]
```

- Reads the subject-class taxonomy (§4) from a committed JSON file
  (`backend/scripts/stock-taxonomy.json`), each class carrying its provider search queries.
- Queries Pexels and Pixabay (Coverr behind an off-by-default flag — see open question Q2).
  **Prefer native portrait**: Pexels supports `orientation=portrait`; request it first and fall
  back to landscape. Pixabay video search has no orientation filter — filter on returned
  dimensions.
- Applies the quality/crop gate (§5) and downloads the best rendition of each accepted clip to
  the staging area with a provenance entry in the manifest (§6).
- Skips anything already in the manifest (dedupe on provider + provider ID). Re-running is safe.
- Rate-limit polite: serial requests, provider backoff honoured, and stop-and-report on 429
  rather than hammering. Multi-key rotation supported but single free-tier keys are the
  expected case.
- `--dry-run` prints what would be downloaded (provider, id, resolution, crop grade) and
  touches nothing.

### 3b. `stock-treat`

```
node backend/scripts/stock-treat.mjs [--only <assetId>] [--grain static14|none]
```

- Runs over manifest entries with `status: "kept"` (set by DrJ during curation, §8) and
  produces the treated asset: graded to the house palette via the existing duotone/grade
  approach from the Aug 14 prototype (note: the prototype's mixer read strongly olive and the
  cooling fix was identified as a one-line coefficient change — apply it here).
- Grain is a flag, default **none** (see open question Q1). If enabled, use the static-14
  treatment measured in the prototype.
- Writes treated output alongside the original (`treatedPath` in the manifest), never
  overwriting the source download. Idempotent: skips entries already treated unless `--only`
  forces one.

### 3c. Storage

- Everything under `backend/data/stock-library/` — **gitignored**. Assets are binaries and never
  enter git; only the taxonomy, the scripts, the tests, and the manifest **schema** are
  committed. The manifest itself (`backend/data/stock-library/manifest.json`) lives with the
  assets, uncommitted.
- Mac-local for now. Syncing the treated library to the VPS is part of the later selection
  brief, not this one.

---

## 4. Initial taxonomy

Priority order — the first two classes unblock Prototype 2 (China–Africa tariffs story):

1. **ports** — container port, harbour cranes, container yard
2. **ships** — cargo ship at sea, container ship
3. **flags** — one class per country, starting: China, US, Russia, India, Pakistan*, Ukraine,
   Israel, Iran, EU, UK (*Pakistan flag assets are acquired like any other; Rule 0 gating
   happens at publish, not in the library)
4. **datacentre** — server racks, cooling aisles
5. **chip-fab** — cleanroom, wafer handling
6. **trading-floor / markets** — screens, tickers (no identifiable faces)
7. **launch** — rocket launch, launchpad
8. **parliament / government-buildings** — exteriors, chambers (empty or wide)
9. **courtroom** — exteriors, gavel/bench details, no identifiable people
10. **construction** — cranes, sites
11. **abstract-beds** — slow texture loops usable behind type

Per class: target ~10–15 staged candidates so curation can reject half and keep 5–8.
Taxonomy file is data, not code — adding a class later must not require a code change.

**Not in the taxonomy:** locator maps and flags-as-graphics for the map opener. Those are
rendered SVG (region + highlighted country fill from the spec's subject), a different
workstream. Video flag footage (class 3) is for cutaways only.

---

## 5. Quality and crop gate

The vertical frame is 1080×1920 and most stock is 16:9, so a 9:16 centre crop from a 16:9
source uses only `height × 9/16` of the width. Resolution therefore decides crispness:

- **native-portrait** — accept if ≥1080 wide. Best case.
- **crisp-4k-crop** — landscape source with height ≥ 2160 (UHD): centre crop ≈1215×2160,
  downscales cleanly to 1080×1920. Accept.
- **soft-hd-crop** — landscape 1080p: centre crop is 607×1080 and must upscale ~1.78×. Accept
  only when the class has fewer than 5 better candidates, and tag it so curation sees the grade.
- Reject below 1080p, and reject durations under 2s (cutaways run 1.5–3s and need trim room)
  or over 120s (bloat; these are cutaways, not scenes).

Record the grade in the manifest. Automated checks stop at resolution/duration — whether the
**subject survives the centre crop** is a human judgement made during curation, which is one
reason curation exists.

---

## 6. Manifest schema

One `manifest.json`, an array of entries:

```json
{
  "id": "ports-0003",
  "subjectClass": "ports",
  "tags": ["container port", "cranes", "night"],
  "provider": "pexels",
  "providerId": "857195",
  "creator": "…",
  "sourceUrl": "https://www.pexels.com/video/…",
  "license": "Pexels License",
  "width": 3840, "height": 2160, "durationSec": 14.0,
  "orientation": "landscape",
  "cropGrade": "crisp-4k-crop",
  "filePath": "staging/ports-0003.mp4",
  "treatedPath": null,
  "status": "staged",
  "addedAt": "2026-08-27T…"
}
```

`status` lifecycle: `staged` → (`kept` | `rejected`, set by DrJ) → `treated` (set by
stock-treat). Provenance fields are mandatory — the attribution discipline that applies to
charts applies to footage.

---

## 7. Non-goals — do not build

- No render-loop, videoAssembler, videoSpecWriter or videoSpecSchema changes. **Zero.**
- No render-time selection logic, no `visual` field consumption. Later brief.
- ~~No live search at render time under any framing.~~ **Superseded 2026-08-30 — see §7a.**
- No publishing surface of any kind; nothing here needs `assertPublishAllowed` because nothing
  here publishes.
- No committing of media binaries or the live manifest.
- No music. (MoneyPrinterTurbo bundles music with unresolved rights — take nothing from
  `resource/songs`.)
- No Upload-Post or any other MPT distribution code.
- No new npm dependencies (§2b), no VPS acquisition path or container service (§2e), and no
  provider keys in any production environment or compose file (§2d).
- No MPT source vendored, copied wholesale, or added to the dependency tree in any language.

---

## 7a. What replaced the human eye (2026-08-30)

This section exists because §7 forbade live search at render time "under any framing",
and we now do it. Rewriting a non-goal quietly is how a rule becomes folklore, so this
records what changed, what it cost, and what stands in the place of the thing removed.

**What changed, and why the original rule could not simply be kept.** The curated local
library is abandoned by decision (DrJ, 2026-08-30): no hours of footage on the box, no
tons of storage. Storage and CPU there are already spoken for. That deletes the thing
render-time lookup was looking *up*. Separately, the editorial target inverted — cards
are punctuation and imagery is the default — and a library of a few hundred hand-tagged
subject-class assets cannot answer most beats of most stories.

**What §7 was really protecting.** Not local storage. The failures it cites —
globe-on-a-gold-story, bar-chart-on-a-displacement-story — are failures of *unreviewed
relevance*: a keyword search returned something plausible and nobody checked it against
the story. The brief welded that concern to the storage model because, at the time, the
human curator was the only available answer to it. The concern survives the model; the
mechanism had to be replaced rather than dropped.

**What replaced the curator, concretely.** Four things, none of which is a scorer judging
an image against an intent:

1. **A trust-ordered source cascade** (`videoBeatImagery.js`). Body-mined images come
   first — a picture editor chose them for *this* story, which is the curator's judgement
   inherited rather than simulated. Then an entity's own portrait by exact identifier
   (QID → Wikidata P18), which cannot return a picture of something else. Stock is third
   and last before a card.

2. **Stock is confined to beats where any plausible image is correct by construction** —
   "winter landscape", "gas pipeline". A named subject has a right answer, so a plausible
   wrong one is refused: a named subject with no exact image falls to a card and never to
   stock. That single rule is what the globe-on-a-gold-story would have failed.

3. **A conjunctive relevance gate** (`videoImageRelevance.js`), replacing the token-overlap
   gate in `videoFootage.js`, which was *measured wrong in production*: it matched a USAF
   exercise named "Polar Bear Charge" to the query "a polar bear on ice" — one of three
   cached hits. Every content token of a query must now appear in the candidate. It is
   deliberately conservative and rejects true matches; a miss falls to a card, which is
   always a correct video. That case is a named test and the acceptance bar for any
   future relevance model.

4. **Confidence that is not a judgement.** It falls out of which tier answered — body and
   entity mean "we found *this* thing", stock means "we found something matching the
   words". There is no scorer, because the scorer is what produced the polar bear.

**What is genuinely lost.** A person no longer looks at every frame before it can be
selected. Nothing above recovers that; they are guards, not a curator. The trade is
stated rather than hidden: at twelve unattended renders a day a human gate was never
going to run, so the honest comparison is not *curated vs searched* but *searched with
these guards vs the one article photo reused on rotated mounts*.

**What did NOT change.** The operator/runtime boundary
(`stockLibraryBoundary.test.js`) stands untouched — the plan was to cross it and reuse
the existing provider client, but that client searches videos, and this path needs
photos. There was nothing to cross for. Provider keys stay out of the acquisition
tooling's reach on the server, and the editorial subject-never-event rule of §1 is
unchanged and now enforced in code rather than by review.

---

## 8. Where automation stops — DrJ's curation workflow

1. Run `stock-acquire` for a class batch.
2. DrJ reviews the staging folder (QuickLook is fine) and marks each entry `kept` or
   `rejected` — provide the smallest possible tool for this: a
   `stock-curate.mjs --keep id1,id2 --reject id3` that edits the manifest, or a generated
   review HTML with per-clip keep/reject that writes back. Whichever is less code; no UI
   ambition.
3. Run `stock-treat` over the kept set.
4. Rejected entries keep their manifest row (so re-acquire won't re-download them) but the
   file is deleted.

Judgement stays human: crop survival, "subject not event" compliance, and general quality are
DrJ's call per clip, made once, recorded in the manifest.

---

## 9. Tests and acceptance

- Repo conventions apply: run the full suite and report the **test count against the current
  main baseline**, not just "0 fail". Never create test files with a truncating `cat >` — check
  for an existing file first.
- Unit-test with stubbed fetch: rendition selection picks the highest-quality URL from a real
  captured Pexels/Pixabay response shape; the crop gate classifies the three grades and both
  rejects; Cloudflare-challenge and 429 responses stop cleanly with a named reason; dedupe
  skips a manifest-present providerId; `stock-treat` is idempotent and never overwrites a
  source file.
- A test asserts the taxonomy file parses and every class has ≥1 query.
- **A guard test asserts the §2c non-reachability** — no process entry point reaches these
  scripts. Verify it the way the `sweepAtStartup` guard was verified: add an import
  temporarily, confirm the test fails, remove it. Report that you did this.
- Acceptance run (real network, real keys): `--classes ports,ships --per-class 12`, then a
  dry-run repeat proving full dedupe, then one clip through `stock-treat`. Report counts,
  grades distribution, and total bytes.
- **In the PR description, state plainly:** every endpoint constant with the official doc URL it
  was checked against (§2a), and `git diff package.json package-lock.json` — which must be
  empty (§2b). These two lines are what make the diff reviewable in one sitting.

---

## 10. DrJ's prerequisites (before CC can do the acceptance run)

- Register free API keys and put them in the **Mac** `backend/.env` — not the VPS, per §2d:
  `PEXELS_API_KEY` (https://www.pexels.com/api/) and `PIXABAY_API_KEY`
  (https://pixabay.com/api/docs/). Coverr key only if Q2 says yes.
- Keys are read via env with the repo's `envNumber`/loud-fallback conventions where numeric;
  never the `parseFloat(x) || default` idiom.
- Confirm the Mac's ffmpeg is current before the first treat run. Downloaded media is the only
  foreign content this work introduces, and ffmpeg is what parses it.

---

## 11. Open questions (answer before or during build)

- **Q1 — grain in the library or at final render?** The prototype measured grain's encode cost
  on the *final* video; pre-graining library clips means the grain is re-encoded again at
  assembly. Default is grade-only in the library, grain decided at render. CC may measure if
  cheap; otherwise leave the flag off.
- **Q2 — include Coverr?** Its licence terms differ from Pexels/Pixabay and it needs a third
  key. Default: skip, keep the client port behind a flag, revisit if the two main providers
  leave classes thin.
- **Q3 — review tool shape:** manifest-editing CLI vs. generated review HTML (§8.2). CC picks
  the smaller one.
