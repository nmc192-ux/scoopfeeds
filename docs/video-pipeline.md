# ScoopFeeds YouTube Automation — Build & Operations Note

Written 3 Aug 2026, the day the loop went live on `@scoopfeedsnews`.
Purpose: so future-me knows what exists, why it's shaped this way, and what to
check when it misbehaves.

---

## 1. What it does

Every hour a cron in the **scheduler** picks a fresh news article, turns it into a
60–100 second explainer video, and uploads it to YouTube. Public, unattended,
up to 4 a day.

The chain: select article → fetch full text → LLM writes a slide spec →
validate → ElevenLabs voices each caption → render keyframes → ffmpeg assembles
→ upload → record in `video_posts`.

Cost is about **1–4 cents per published video**, including the candidates that
get rejected on the way.

---

## 2. The format, and why

Dark slide cards with big Anton type on `#090706`, one acid-lime `#dde706`
accent per frame, code-rendered rather than filmed. Six card types:

| card | role |
|---|---|
| `title` | opener; carries the code-injected source badge, date, and the single spoken credit |
| `stat` | one figure, big |
| `bars` | comparison, 2+ bars |
| `diagram` | the mechanism — ticked rule with directional chevrons |
| `turn` | the hinge where the obvious reading gives way |
| `kicker` | closer; never wraps up, ends forward-looking |

There is **no attribution card** — it was removed because a credit slide at
position 2 is a dead beat where retention is decided.

**Motion is keyframes, not frames.** Each card renders 4 *states* — 5 for
`stat` — (empty → line 1 → line 2 → complete); ffmpeg crossfades between them and applies a slow
drift over the whole slide.

A true 30fps sequence is 1,800 renders for a 60s video — that figure is frames
per second times duration and does not depend on card count. Keyframes are
**27–46 renders**, computed from the real shape rather than assumed: 6–10
slides at 4 states each, 5 for `stat`, with `stat` capped near a third of the
cards by the mix rule (2 of 6, 3 of 10), plus 3 thumbnail variants. The earlier
"~95 renders, ~8s, ~4MB" assumed a 20-card video; the CPU and size figures were
measured against that assumption and scale roughly with render count, so the
real cost is well under them.

**The drift must be supersampled 4×.** At output resolution the crop
coordinates are integers (and yuv420p forces them even), so ~0.3px/frame of
intended motion becomes a 2px snap — visible as shake. 2× was measured and
still fails; 4× passes at ≤0.33px/frame.

---

## 3. Rule 0 — no Pakistan-related video, ever

Absolute, no env flag, three independent layers (selection, post-generation,
publish). `videoPakistanBlock.js`. Pure word-boundary regex, never a prompt
instruction — a prompt is a request with a nonzero ignore rate.

Over-blocking is correct and deliberate: Indian Punjab stories, anything from
ARY/Geo/Dawn regardless of topic, and `pti` (which also catches Press Trust of
India) all block. Roughly 13% of the candidate pool. **Never narrow a term
because it produced a false positive.**

One real bug was fixed here: outlet names were being matched against article
*body text*, so "the nation" and "dawn" in ordinary prose blocked unrelated
stories. Outlet tokens now match source fields only; topical terms stay global.

---

## 4. Sourcing — one story, restated, credited (§3b)

Every video is built from **one** article. This was tested, not assumed: a
sibling-source bundle added 13,488 characters from 8 outlets and produced
**zero** additional beats, while introducing a misattribution risk the
validator couldn't catch.

Five rules:

1. Facts only, never phrasing — no verbatim runs, never mirror the article's
   structure
2. Never the publisher's images (this is the rule that actually prevents claims)
3. Attribute on screen and in narration — **once** per source, not per card
4. Link the original above the fold in the description
5. Add the pipeline's own layer — at least one `diagram` or `turn` card

**Attribution resolves to the real publisher, not the feed name.**
`videoAttribution.js` derives the registrable domain from the article URL and
cross-checks `source_name`. Caught live: a personal blog (`seanhelvey.com`)
arriving under "Hacker News", and Yahoo Finance syndicating WSJ and Barron's.
Measured override rate 1–4% across 57k articles.

---

## 5. Length is emergent — the thing that took longest to learn

Four independent levers were tried and **all came back flat**:

| lever | result |
|---|---|
| prompt framing (4 versions: target / floor / no-count / worked example) | 26 → 6 → 5 → 5 slides |
| model tier (flash-lite → flash → pro-preview) | 5 → 5.5 → 6.5 beats |
| article length (full-text fetch, 2.3–2.9× more chars) | no consistent gain |
| source breadth (8 sibling outlets) | Δ 0.00 beats |

**Conclusion: most news stories genuinely contain 4–8 distinct verifiable
facts.** The 6–20 slide target was wrong for this corpus. Observed typical
output is 6–10 slides, 60–100 seconds — that is what the corpus produces, **not
a floor**. The floor is `MIN_SLIDES = 5`, below which the article is skipped as
too thin rather than padded up to it. Density matters, not length — an analysis feature
yields 8 beats, a wire update yields 4, regardless of word count.

The spec emits `beats` as data first (`{kind, beat, evidence}`), and content
cards must equal `beats.length` exactly. The prompt contains **no slide number
in any form**; `MIN_SLIDES`/`MAX_SLIDES` are validation gates the model never
sees. Anything the model is shown, it anchors on.

---

## 6. Selection gates — every one earned by a live failure

- **Rule 0** (above)
- **Sport** and **live blogs** — rolling updates have no stable narrative
- **Stock commentary** — requires *both* ticker focus (title or body) *and*
  rating vocabulary (price target, analyst rating, buy/hold). Either alone
  passes, so Fed/Nvidia/Tesla stories survive.

  Caught by a **dry run, before the loop was armed** — nothing reached the
  channel. The article was:

  > "SoundHound AI's Next Earnings Report on Aug. 5 Could Send the Stock
  > Soaring. Here's Why."

  **That headline is the whole lesson.** It names the company at the start and
  calls it "the Stock" later, so the company and the word are never *adjacent* —
  and every `<Company> stock` pattern needs the two touching. The adjacency rule
  could not see it at all; `THE_STOCK_RE` exists precisely for this shape (a
  bare definite-article reference to a single security in a title that also
  carries a proper noun, excluding "the stock market"). Body dominance caught it
  independently, but only because the piece named SoundHound five times — a
  shorter one would have gone through.
- **Publisher diversity** — max 2 candidates per publisher per cycle, then
  **round-robin interleave**. Capping alone wasn't enough: length-first
  ordering still put both Yahoo Finance articles at attempts 1 and 2.

**The ordering fix was the single biggest yield change.** The accessor sorted
by `credibility DESC, published_at DESC` — but credibility is a coarse 4-value
tier, so recency decided inside the top bucket, and the freshest rows are the
ones `contentEnricher` hasn't filled yet. The old top-8 were 66–194 character
stubs against a pool median of 2,219. Now: `LENGTH(content) DESC` → event
breadth → credibility → recency. Yield went from 0-in-8 to 1-in-2.

⚠️ **Four other accessors still share the old ORDER BY**, including
`findFreshUnpostedArticles` which feeds Instagram. Unmeasured. This plausibly
explains the July IG defect where bullets repeated the headline — there may
simply have been almost nothing to extract from.

---

## 7. Publishing

- `video_posts`, `UNIQUE(article_id)`, **no foreign key at all** (a `REFERENCES`
  clause invites a future `ON DELETE`). `source_name` and `title` denormalised
  so cooldowns survive the 7-day article prune. Rows are **permanent**.
- **Insert pending → upload → update.** A crash between upload and insert would
  otherwise orphan a published video.
- **Stale-pending rule**: one failure leaves the article selectable, two retire
  it. Without this, a failed upload permanently retires an article.
- Two independent rate gates: rolling-24h count (`VIDEO_MAX_PER_DAY`, 4) and
  spacing (`24h / max × 0.8` ≈ 4.8h). The 0.8 slack gives five slots for four
  videos, so a failure costs time rather than a video.
- `403 quotaExceeded` ends the cycle rather than burning a spec+render+TTS per
  remaining candidate. Uploads cost 1,600 units of 10,000/day, **shared with
  YouTube ingestion**.

---

## 8. Operations

**Where things live**

- Repo on VPS: `/opt/scoopfeeds` (deploy@72.62.196.97)
- Config: `backend/.env` — gitignored, single copy, back it up before edits
- Volume: `/var/lib/docker/volumes/scoopfeeds_scoop_data/_data` (root-owned)
- MP4s kept 48h, frames in container tmpdir, TTS cache 7 days — all swept at
  **startup**, not on a cron (a cron that stops firing is invisible)

**Deploy rules learned the hard way**

- `build` and `up -d` with **no service filter** — the worker once ran
  month-old code for a week because deploys filtered to web+scheduler
- `restart` does **not** re-read `.env`; only `up -d` recreates
- `Started` in the output means recreated; `Running 0.0s` means nothing happened
- Check the site returns 200 after any recreate (Caddy port drift once caused a
  45-minute outage on a deploy that was otherwise fine)

**Switches**

- `VIDEO_AUTOPOST_ENABLED` — master switch, the only thing between built and live
- `VIDEO_SPEC_ENABLED=1` — required, or every candidate skips
- `YOUTUBE_PRIVACY` defaults to `public`
- Dry run without publishing — inline, so it works on a fresh checkout
  (`backend/_*.mjs` is gitignored, so any local harness must be recreated):

  ```bash
  docker compose -f docker-compose.production.yml run --rm -T -w /app/backend \
    -e VIDEO_AUTOPOST_ENABLED=1 -e VIDEO_SPEC_ENABLED=1 web \
    node -e "import('./src/services/videoAutopost.js').then(m=>m.runVideoRenderCycle({dryRun:true})).then(r=>console.log(JSON.stringify(r,null,2)))"
  ```

  `dryRun: true` renders and stops: it never claims a `video_posts` row and
  never uploads.

**YouTube auth**

Channel is **ScoopFeeds / @scoopfeedsnews**, owned by `info.scoopfeeds@gmail.com`.
The OAuth app lives in the `scoopfeeds-video` Cloud project owned by
`nmc192@gmail.com` — that mismatch is fine and expected.

The app **must stay "In production"** on the Google Auth Platform → Audience
page. In Testing mode Google expires refresh tokens every 7 days. Uploading a
logo under Branding is what triggers the verification requirement — don't.

To renew: OAuth Playground with your own credentials, scopes
`youtube.upload` + `youtube.readonly`, signed in as **info.scoopfeeds@gmail.com**,
tick both permission boxes, exchange for tokens, replace
`YOUTUBE_REFRESH_TOKEN`. Verify with `getChannelInfo` — it prints the channel
name, which is the only reliable way to confirm *where* it will publish.

---

## 9. Method notes worth keeping

Patterns that repeated often enough to be worth naming:

- **Every gate needed a second pass after meeting real data**, and the fix was
  always to move the signal from a surface that's easy to rewrite to one that
  isn't: title → body, predicted → measured, count → position.
- **Rendering found bugs that reading could not** — chevrons rendered as
  squares, the progress line cropped away, two lime elements in one frame.
- **Validators must be validated against known-bad input**, or they pass
  vacuously. A featureless window measured 0.000px drift and "passed".
- **Config presence is not config correctness.** `publishConfigured: youtube
  true` was logged at boot for weeks while the token was dead.
- **The dry run earned its keep twice** — it caught a crash on the first thin
  candidate, and a stock tip about to publish under the brand.
