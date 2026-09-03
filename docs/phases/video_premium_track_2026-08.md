# Video premium track and editorial gates — decision record, August 2026

**Document type:** Design-rationale record (not a changelog — git has that)
**Covers:** 2026-08-11 → 2026-08-15
**Owner:** DrJ (Founder) + Claude Code
**Status:** Active. Sections marked ⚠️ are unfinished as of the last update.

> **Why this file exists.** Everything below is visible in git as a diff. What is not
> visible is why each call went the way it did, and several of them could reasonably have
> gone the other way. Those are the ones a future reader will want to reverse without
> knowing what they cost to arrive at. §3 is the part that matters; §1 and §2 are context
> for it.
>
> **See also:** [`docs/video-pipeline.md`](../video-pipeline.md) (how the pipeline works),
> [`docs/reference/env_reference.md`](../reference/env_reference.md) (every flag and its
> prod value).

---

## 1. What was built

Grouped by workstream, with the reason each existed. Detail lives in the commits.

**Voice direction.** `VIDEO_VOICE_ID / _MODEL / _SPEED / _STABILITY / _SIMILARITY` and
`VIDEO_VOICE_GAP_MS` became env-tunable with every default unchanged, so a voice can be
retuned by `.env` rather than by a commit. The gap is applied where `SLIDE_TAIL_SECS`
already is and is deliberately **not** in the TTS cache key — re-pacing the channel is
therefore free. Measured: `eleven_v3` accepts `speed` and ignores it, which would silently
disable pacing control on that tier.

**Script arc.** Cold open (B1), connective tissue (B2) and closer (B3): the opener may not
restate the headline, adjacent captions must connect, and the closer may not restate the
headline or the opening caption. B1 and B3 reject; B2 only warns, because there is no
threshold separating "monotonous" from "three captions legitimately begin with the
subject's name" and a false rejection costs a whole video.

**Static slides.** The slide pan was removed (`VIDEO_SLIDE_DRIFT_ENABLED`, default off).
Measured: 587 of 735 duplicate frames static against 157 with the pan — the motion was
defeating inter-frame compression for an effect nobody asked for. The 2% overscan stays.

**The vertical pivot.** 9:16 became the default (`VIDEO_ORIENTATION`). Geometry moved into
`videoGeometry.js` as data; layouts fork per orientation because a vertical diagram is a
different composition, not a narrower one. 16:9 is frozen and its freeze is *proved* on
every change by `backend/_stateHashes.mjs` — 29 state PNGs, hashed, compared.

**Display-type autofit.** A live Short rendered "14,000" with its last glyph clipped.
Vertical is 1080 wide against 16:9's 1920 and the figure size was a fixed 400px carried
over. Now width-driven from a measured per-glyph advance table.

**Safe-area margins**, verified against real platform chrome from full-resolution Instagram
Reels and YouTube Shorts screenshots: `safeBottom` 320, `safeRight` 168, `safeTop` 140 all
hold. `marginX` did not — see §3.3.

**Multi-platform publishing.** Facebook Reels, Instagram Reels, Threads and Bluesky, each
behind its own dark flag with its own rolling-24h cap, each asserting Rule 0 for itself
rather than relying on running after the one gate that existed. Bluesky reuses the existing
`blueskyClient` (session persistence, 429 circuit breaker, ExpiredToken recovery — all of it
earned by outages) rather than adding a second client.

**Selection.** The candidate pool was `MAX_ATTEMPTS × 6` = 48 and is now an independent
`VIDEO_CANDIDATE_POOL` = 200; the single attempt cap became three budgets; the publisher
cooldown moved out of the attempt loop. See §3.5.

**Social card imagery.** The og:image cascade; Pexels dropped; the `media:group` parser fix;
og:image recovery inside enrichment. See §3.6.

**The premium visual track.** Film grain, the mount library, the locator map, the ground
contract, the gesture budget. See §3.1–3.4.

**The editorial gates.** Spoken register, questions, motive, intensifiers, and the
beats/kicker arithmetic. See §3.7–3.10.

**The spec dry run** (`backend/scripts/spec-dry-run.mjs`). `writeVideoSpec` had exactly one
caller and it was inside the render cycle, so the only way to see what the model emits was
to make a video out of it. Generation is now inspectable without rendering.

---

## 2. How to re-derive the numbers

Every measurement quoted below came from a disposable harness under `backend/_*.mjs`
(gitignored on purpose — they reuse production functions verbatim and never write). The
method matters more than the figures: **render through the real path and measure pixels**,
rather than reasoning about what the code should produce. Three separate conclusions in this
record reversed once measured.

---

## 3. Decisions that could have gone the other way

### 3.1 Static grain beat temporal grain — and then grain lost altogether

> **REVERSED 2026-09-03 (DrJ).** There is no film grain in any format any more. The
> comparison below is preserved because it is a correct measurement, and because the
> *reasoning* about temporal vs static compression still holds for anything that ever
> reaches for `noise` again — but the shipped answer is now **clean**. Two things the
> table below could not show:
>
> - **It reads as the paper texture that had already been ruled out.** That is the
>   whole reason it went; the cost was a bonus, not the argument.
> - **The cost was understated.** These numbers were taken on a clip with footage in
>   it, where inter-frame compression had other things to fail at. On the format as it
>   actually ships — static type on a flat ground — grain is the *only* thing standing
>   between the encoder and a nearly free file. Re-measured 2026-09-03 on a 6-slide
>   fixture, same binary, both orientations:
>
>   | | encode | size | background stdev |
>   |---|---|---|---|
>   | 9:16 static 14 | 26.4s | 15.9 MB | 6.49 / 5.08 / 6.40 |
>   | 9:16 none | **17.4s** | **0.47 MB** | **0 / 0 / 0** |
>   | 16:9 static 14 | 30.6s | 20.1 MB | 6.48 / 5.06 / 6.35 |
>   | 16:9 none | **20.4s** | **0.47 MB** | **0 / 0 / 0** |
>
>   34x and 43x the bytes, and a third of the encode wall time, on a 2-core box.
>
> `VIDEO_GRAIN_STRENGTH` is deleted, not defaulted to 0, and `videoContrast.test.js`
> fails if a `noise=` node returns to any render graph.

**Decision:** film grain is applied static (`allf=u`) at strength 14 with a fixed seed, not
temporal.

Measured on a 43s vertical render, final encode from clean masters:

| variant | encode | size |
|---|---|---|
| clean | 2.0s | 1.7MB |
| static 9 | 7.0s | 7.7MB |
| **static 14** | **7.6s** | **8.9MB** |
| temporal 5 | 15.0s | 9.0MB |
| temporal 9 | 33.4s | 31.6MB |

Grain is unique per pixel per frame, so **temporal grain defeats inter-frame compression
entirely** — that is the 31.6MB. Static at 14 costs about what temporal costs at 5 and looks
considerably stronger, because the strength is what reads, not the movement.

**The seed is fixed** because slides are encoded separately and concatenated. An unseeded
`noise` generates a different still field per slide and the texture jumps at every cut,
which is worse than no texture.

**Do not "improve" this to temporal.** It is roughly 4× the bytes and 4× the encode for a
worse fit with the paper texture the design is after.

### 3.2 The paper body must be light — the shadow is not what does the work

**Decision:** every mount lifts the photograph's blacks to ~20% and prints onto bone
(`#efe7d6`). The silhouette shadow ships on every mount but is not load-bearing.

In prototype 1 a torn edge on the near-black ground read as a **hole punched through the
frame**. The intuition — and the initial instruction — was that a drop shadow fixes that.
It does not, and the arithmetic is unarguable:

- the ground sits at **9/255**
- a dark shadow can only push it toward 0, so its maximum possible contribution is **9 levels**
- the bone body sits at ~236 — **227 levels** of separation

In an A/B at a real object edge the shadow contributed **0.0 levels**. Verified end-to-end
through the real assembler on a real publisher photograph: brightest pixel in the object
band 255, 42.2% of the band clearly lighter than the ground.

**The rule to carry forward is "the body must be light", not "the mount must cast a
shadow".** If real separation on black is ever needed, it has to come from a *light* rim,
not a dark one. The shadow stays because it earns its place where objects overlap and costs
nothing.

### 3.3 The ground stays black; photographs are objects on it

**Decision:** one ground, always. A photograph arrives as an object placed on it — news
cutting, polaroid or pinned print.

Prototype 3 tried two grounds: near-black for data and type, cream for collage. The
hypothesis was right about the *treatment* — a torn edge on cream genuinely reads as paper —
but it produced four separate palette conflicts, and every one came from the ground moving
rather than from the treatment:

1. lime is unusable as type on cream (`#dde706` on `#e6ddc8` is a yellow-on-yellow collision)
2. the lime progress bar all but disappears on cream — brand chrome silently going missing
3. the faint chrome grey (`#6b675e`) is invisible on cream, so the mark and counter needed re-inking
4. the caption band had to invert, because a black scrim on cream is a hole

Keeping one ground and varying the **mount** gives variety without inconsistency, and
dissolves all four at once.

`marginX` rose 72 → 104 in the same area of work, and that one is worth recording because
it looks like a taste decision and is not. Measured in three places:

| stage | left inset |
|---|---|
| as rendered | 72 (every card type measured 72–75 — no layout was misbehaving) |
| published frame | 65 (the 2% overscan costs a fixed ~9px) |
| on the device | ~13 |

The last step is the player: **Shorts and Reels crop the SIDES** to fill a screen taller
than 9:16, by an amount set by the handset. Confirmed on a device — the top edge is intact
while the horizontal inset has collapsed, which is also why `safeTop` survives at 140 while
`marginX` had to rise. The margin absorbs a crop we cannot measure or detect.

`taped` is deliberately **absent** from the mount library: no border, so the print's dark
edges meet the ground with nothing between them. It needs a bone border before it belongs.

### 3.4 The diagram carries no source line

**Decision:** `stat` and `bars` carry a `SOURCE:` credit. `diagram` does not, and this is
not an oversight.

`diagram` is an `OWN_LAYER_TYPES` card — one of the two types that exist to say something
the source did not say in that form. It is our synthesis. Printing an outlet's name under it
would attribute our analysis to them, which is the opposite of what a credit is for.

Related, and the reason it came up: `sourceCredit` is a **shared primitive** bound to both
geometries. Restyling it for cosmetic parity with a prototype would have moved 16:9, which
is frozen.

### 3.5 Selection: three budgets, and the cooldown left the loop

**Decision:** one cap became three, and the publisher cooldown became a set-level prefilter.

The reported symptom was `tried 8, produced 0 · spec spend $0.00000` — the entire budget
consumed without a single Gemini call. `MAX_ATTEMPTS` was doing three jobs at three
altitudes:

- **the money** — `VIDEO_MAX_SPEC_CALLS_PER_CYCLE`, incremented only at the model call
- **the work** — `VIDEO_MAX_SCAN_PER_CYCLE`, a backstop, since free refusals otherwise have no bound
- **the sample** — `VIDEO_CANDIDATE_POOL`, previously `MAX_ATTEMPTS × 6`, so the spend budget silently sized the editorial pool

`publisherPublishedSince(source, now − 24h)` cannot vary within a cycle: `now` is fixed and
the loop breaks on publish. Asked per article it spent **7 of 8 attempts to learn at most 4
facts**. It is now evaluated once per publisher, before the loop.

**The pool widening is the part that changes what gets published.** `findFreshUnvideoedArticles`
orders by `LENGTH(content) DESC`, so the `LIMIT` does not sample the window — it takes the
longest-bodied articles, and body length correlates with masthead:

| | articles | publishers |
|---|---|---|
| pool, unlimited | 449 | **45** |
| `LIMIT 48` | 48 | **11** |
| `LIMIT 200` | 200 | 31 |

"Yahoo Finance ×25 of 48 fresh" was this, not thin ingestion — 48 *was* the limit. **The
ordering is deliberately kept**: a 5,000-char body caps the beat count. What was wrong was
sampling 48 from it.

### 3.6 Social card imagery: the parser fix was not the same problem as og:image

**Decision:** two separate fixes, in that order, because they address different failures.

ABC Australia shipped `media:content` on **25 of 25** items and we recorded `image_url` on
**zero**. Media RSS allows `media:content` to be wrapped in `<media:group>`, and
`rss-parser`'s item-level `customFields` only match *direct* children of `<item>`. The field
was never absent — it was one level down and invisible. **No amount of page-fetching would
have fixed it**, because the bytes were already in the response.

A sweep of all 110 configured feeds found ABC was the only *confirmed* nested feed among the
75 reachable; 35 could not be checked (DNS-blocked or 403/404 from the sandbox) and are
recorded as **unchecked, not clean**.

Separately, 16 feeds ship no image element of any kind. For those the article page is the
only source, and `contentEnricher` was **already fetching that page** for its text — so
og:image is a second read of a string already in memory. Measured: **88% of images recovered
cost nothing**; only articles with good content but no image need a new fetch.

The image criterion is time-boxed at 48h (`ENRICH_IMAGE_MAX_AGE_MS`) and the content
criterion is not. An image is only read by the social card, and both posting queries use a
**12h** window, so an image fetched for a three-day-old article can never be used. The window
also stops the widened selection eating itself: a page with genuinely no og:image can never
be satisfied and would otherwise be re-picked every 15 minutes forever.

Pexels was dropped because it requires an API key that does not exist in this deployment;
Wikimedia Commons was tried as a rights-clean fallback and is DNS-blocked. **Cutaway footage
remains unbuilt for that reason alone** — the slots are designed and timed.

### 3.7 The motive gate is attribution, not verification

**Decision:** the gate asks *whose claim is this*, not *is this true*.

Verifying a motive would mean deciding whether someone really intended something, which is
not checkable from an article and not a machine's job. Attribution is checkable: either the
caption says whose claim it is, or it asserts the motive on the pipeline's own authority.

**This gate was wrong once, live, and the correction is the important part.** Its first
version fired on the verb regardless of whose intent it was, and killed an article over two
false positives — both of which were the BBC's *own filed position*, stated in the filing the
article reported:

> "The broadcaster wants to use certified mail"
> "To prove what Trump actually intended that day, the broadcaster…"

Reporting a party's own stated purpose is not asserting a hidden motive. The distinction
that turned out to be checkable is not "who is the grammatical subject" — that needs parsing
this codebase has no business attempting — but **does the source itself put this intent on
the record**: a passage that states a purpose or a speech/filing act *and* is about the same
thing the caption is about.

Two details, both forced by the real case:

- **a two-sentence window**, because a filing is routinely reported across a pair. The
  single-sentence version scored the real caption at 1 against a bar of 2 and killed the
  same article again.
- **without a source there is no case.** The gate accuses the script of inventing an intent;
  with nothing to compare against, that accusation cannot be made fairly. It returns null.
  Firing on absent evidence is the general form of the original bug.

**The asymmetry is deliberate and now runs toward permissiveness.** A false positive kills an
article; a false negative leaves one motive claim for the prompt rule and a human. Given the
failure that produced it, that is the correct direction — but it is a live, unflagged gate on
a system publishing under a named public official, and reversing the asymmetry is a decision,
not a tuning.

⚠️ **The metaphor case is prompt-only and unproven.** "THE SECRET SERVICE SHIELD" contains no
motive verb and no intensifier, and still reframes a protective detail as an instrument of
obstruction. It is not mechanically separable from a compressed paraphrase — "ZERO TARIFFS"
is the same operation done honestly. The prompt names it explicitly and it recurred anyway —
**four runs of the same article as of 2026-08-16**, on the title each time.

**Four recurrences are not yet evidence for a gate**, and the discipline here is worth stating
because the temptation runs the other way: every one of those four is the *same article*, so
what they establish is that this story pulls hard toward that phrase, not that the model
reaches for metaphor generally. A gate built on a single article's evidence would be fitted to
that article. `VIDEO_SPEC_LOG_JSON` is collecting across *different* articles, and that is what
decides whether this becomes mechanical or stays a prompt rule (DrJ's ruling: hold).

### 3.8 The equality check stayed; the kicker was exempted instead

**Decision:** `contentCards === beats.length` remains a hard rejection. The wrappers were
made explicitly exempt.

The mismatch had hit every spec observed and survived the retry — two model calls and a lost
video each time, always `enumerated N beats but emitted N−1 content cards`, off by one in the
same direction.

The cause was one word meaning two things. Rule 8's `consequence` **beat kind** is something
the source states; rule 16b's CONSEQUENCE **closer** is derived — what this means for someone
outside the story, which the source never asserts. Rule 8 also said "no card without a beat"
without exempting the wrappers, so enumerating the closer's line as a beat was the natural
reading, and it put the count off by exactly one.

Four options were on the table. **Downgrading the equality to a warning was rejected** on the
grounds that it is the only check that catches *"the model ignored the enumeration process
entirely"* — a different and worse failure than being off by one. Instead:

1. rule 8 states the wrappers carry no beat and are not counted
2. both rules disambiguate `consequence`, each naming the other — fixing one side would have
   left the collision intact from the other direction
3. the worked example now shows its kicker, with an explicit note that the closer is absent
   from the beat list. It previously ended on a `consequence` beat and never showed the
   closer, which taught the failure.

Result on the next run: `beats 6 vs content cards 6`.

### 3.9 Questions are permitted, except on the closer

**Decision (DrJ):** *"A question is only clickbait when the answer is withheld."*

Permitted on the opener and mid-beats where the next beat answers them; rejected on the
closer, where nothing follows and the answer can never arrive.

The detection is **trailing-only**, and that is the whole subtlety: "So who pays? Households
do." on a closer is a question asked and answered in one breath — the legitimate shape — and
its `?` is not at the end. Matching anywhere in the string would reject the good version
along with the bad.

Three shipped positions disagreed on this before the ruling: rule 10 banned the device,
`BRIDGE_PUNCT` rewarded a trailing `?` as a valid bridge, and the kicker's own error message
told the model the closer "must end on the forward implication **or an open question**" — the
failure being rejected, recommended one line from where the gate fires.

### 3.10 `MAX_SLIDES` is deliberately absent from the prompt

**Decision:** the model is never told a slide count, a target duration, or anything it can
divide into slides.

Stating a count is what produced flat specs: every article came back at the same beat count
regardless of how much the source held. Length is an **outcome** of the beat rubric, never an
instruction. `MIN_SLIDES` / `MAX_SLIDES` exist as validation bounds only — the floor discards
a spec too thin to carry a video, the ceiling catches a runaway.

**This is the one place where "enforced but not named" is correct.** The audit in §4 flags it;
it must not be "fixed". `videoPromptCoverage.test.js` now asserts the number stays *out* of
the prompt, so a later sweep closing §4's gap cannot helpfully add it.

**But the ceiling does belong in the retry note** (DrJ, 2026-08-16), and the distinction is
between a floor and a ceiling rather than between naming and silence:

- a **floor** is target-shaped. Told "you need 6", the model emits exactly 6. That is the
  flat-spec failure, and it is why no count appears in the prompt.
- a **ceiling** is not. Told "34" *after emitting 41*, there is nothing to pad toward — a real
  story sits far below it, and the note says so in the same sentence.

What the old phrasing did instead was strip the bound entirely and tell the model it had
emitted "far more cards than the source establishes". That is a rejection it cannot act on:
the same prompt-silence failure as §4, in its retry form. The number is now stated in
`stripCounts` and nowhere else. The floor is still stripped.

---

## 4. The general form: a validator that checks what the prompt never names

A validator rejecting something the prompt never mentions is a **rejection loop by
construction**. The model cannot learn the rule from the outside, so it reaches for the same
word again, and every occurrence costs a spec call and a video.

This was found the expensive way. `massive` is in `INTENSIFIER_STEMS`, the gate caught it
correctly on four consecutive runs, and the prompt's rule listed *indefinite, unprecedented,
sweeping, devastating* — not `massive`. The gate was doing its job and the prompt was silent.

**Then it escalated, which is what settled the fix.** Naming `massive` worked exactly as
intended — the next run dropped it — and the model **reached one word to the left** for
`completely`, also on the stem list, also unnamed. A fifth rejection on the same article.

That is the argument against patching a word list one incident at a time: the model is not
attached to the specific word, it is reaching for a register, and every near neighbour it
reaches for is on the same list for the same reason. Naming the word that happened to recur
just moves the rejection along the list. **The whole list has to be named, or none of it
means anything.**

A sweep of every mechanical check against the prompt text found **95 enforced things, 32 not
named**:

| group | named | unnamed |
|---|---|---|
| `INTENSIFIER_STEMS` | 8/22 | 14 |
| `KICKER_BANNED_PHRASES` | 11/28 | 17 |
| numeric bounds | 15/16 | 1 (`MAX_SLIDES`, correctly — §3.10) |
| card types, beat kinds, accent colours, own-layer types | 16/16 | 0 |
| behavioural gates | 13/13 | 0 |

**The shape of the gap is the finding.** Checks written as *rules* are all named; the two
that drifted are both *word lists* — because adding a word to a list is a one-line change
that never prompts anyone to touch the prompt.

### 4.1 What shipped (2026-08-16)

All 30 remaining words named — 14 stems in rule 10c, 16 phrases in rule 16 — plus
`videoPromptCoverage.test.js`, which fails when a check lands without prompt text.

The word lists are named **grouped by what they do** (scale / duration / harm / movement /
totality; closing-register / final-verdict / backward-looking / sign-off) rather than as a flat
dump. A grouped list is readable at the length these have reached, and it teaches the
*category* — which is the thing the model is actually reaching for.

Three details the build turned up, each worth more than the list itself:

**Coverage is asserted inside the block that owns the rule, not anywhere in the prompt.** The
first draft of the test checked the whole string and reported `entirely` as already named. It
was — in an unrelated sentence about beat counting. An incidental occurrence in neighbouring
prose teaches the model nothing, and a whole-prompt check would have let a real gap ship
green, which is the exact failure the test exists to prevent. Each list now has a marker line
(`THE CHECKED WORDS, IN FULL`) and coverage is checked from that marker to the next numbered
rule.

**The guard compares stems by prefix, and phrases by containment.** The list holds `massiv`,
`catastroph` — a test demanding the literal stem appear would force the prompt to print
truncated fragments at the model. So a prompt *word* must start with the stem, which is the
same containment the gate applies. For phrases the rule is looser in one specific way: naming
`there you have it` already covers `so there you have it`, because any text tripping the
longer phrase trips the shorter one too. That is why 16 phrases needed new text rather than
17 — one of the audit's unnamed phrases was already covered. `key takeaway` is *not* covered
by `the takeaway`, since neither contains the other.

**`INTENSIFIER_STEMS` is exported for the test and for nothing else in production.**

A test that cannot fail is worth nothing, so the guard was verified by adding a stem
(`seismic`) with no prompt text and confirming the suite went red, before reverting it.

### 4.2 One more of the same class, found on the way

Rule 16 still ended *"End on the FORWARD implication or an OPEN QUESTION"* while the closer
gate (§3.9) rejects a trailing question outright. **A prompt that recommends the rejected
thing is worse than one that is silent** — silence leaves the model guessing; this actively
pointed at the failure. Now removed, with an explicit cross-reference to rule 10b.

This was the third shipped position to disagree about closer questions and the last one
standing. It survived the §3.9 ruling because that work fixed the *gate* and the two rules
that stated the policy, and nobody re-read rule 16's closing clause.

A related instance, same shape: rule 3 described `PRIMARY SOURCE` / `ADDITIONAL COVERAGE`
labelled sections that **nothing has ever built** — 1,031 characters of instruction about
attribution, the highest-stakes topic in the prompt, describing a structure the model could
not see. Now conditional on `allowedSources.length > 1`, so the same fact that would produce
the sections governs whether they are described. Kept rather than deleted: the reasoning is
worth having the day a multi-outlet bundle exists, and the event graph already links the
other outlets covering a story.

---

## 5. Operational lessons

These cost real time. The largest of them — a validator enforcing what the prompt never
names — is §4 above, because it is a design rule and not just a habit.

**`--force-recreate` destroys the container**, so `docker compose logs --since` can only ever
show logs since boot. Time-based log windows silently return less than asked for after any
env change. Check uptime before trusting a `--since` window.

**…and that was the small half of it. It is a RETENTION problem, not a reading problem**
(2026-08-16). We wrote the lesson above as a log-*reading* gotcha — be careful what `--since`
returns — and filed it. The same fact was quietly destroying data we had not read yet.

`logger.js` wrote to `<repo>/backend/data/logs`, which in production is
`/app/backend/data/logs` — the container's own filesystem. The only mounted volume is
`scoop_data:/var/lib/scoop`. So **both** log destinations were ephemeral: docker's stdout log
resets on recreate, and the winston files were deleted with the container. `VIDEO_SPEC_LOG_JSON`
was turned on specifically to collect SHIELD evidence across days; three deploys in one day
erased it, and the loss was only discovered when the harvest was attempted.

**The distinction is the lesson.** A reading problem inconveniences you at the moment you
read, and you find out immediately. A retention problem destroys data you have not read yet,
and you find out when you go looking — which, for evidence being gathered to answer a
question, is exactly too late. When a fact touches where data *lives* rather than how it is
*queried*, it is worth asking the second question explicitly.

Two corollaries worth keeping:

- **"Collect evidence over days" and "deploy several times a day" were mutually exclusive**
  and nobody noticed, because each was reasonable alone. Any decision gated on accumulated
  data needs someone to check that the accumulation actually outlives the release cadence.
- **Persisting was not sufficient on its own.** `combined.log` is a 10MB × 10 ring shared with
  every other line the system writes, so its retention is set by ingestion chatter, not by the
  corpus. The spec corpus therefore got its own file and its own rotation — otherwise a busy
  ingestion day evicts the evidence regardless of how little the evidence costs.

**Squash merges leave child branches carrying phantom duplicates.** This repo squash-merges,
so a merged branch's commits are *not* ancestors of `main`. Pushing a follow-up commit to
that branch updates a **closed** PR: the commit is on GitHub, looks pushed, and never
deploys. This happened **five times** in one week, and the fifth cost a live prod dry-run
that tested old code.

The recovery, when it has already happened:

```
git checkout -b <new-branch> <sha>
git rebase --onto origin/main <merged-sha>
git diff origin/main HEAD --stat    # verify the delta before pushing
```

It is now enforced by a `pre-commit` hook in the working clone, which refuses a commit when
`gh pr view <branch> --json state` reports `MERGED`. Deliberately **not**
`git merge-base --is-ancestor HEAD origin/main` — that is also true for the first commit on a
legitimately fresh branch and would block the correct workflow every time.

**Confirm a prompt change deployed by reading the emitted prompt, not a line count.** The
count is a fast negative signal — unchanged means it certainly did not ship — but it is
article-dependent and two different edits can produce the same total. `spec-dry-run.mjs
--prompt-only` prints the exact prompt, costs nothing, and is built by the same function the
real call uses, so it cannot drift from what is actually sent.

**Measure through the real path.** Three conclusions reversed once measured: the shadow
contributes nothing on a near-black ground; the drift pan was defeating compression; and
`statesForCard` takes its orientation from `ctx`, not a third argument — which meant two
early "vertical" measurement runs were silently horizontal, and their numbers were wrong.

---

## 6. Unfinished

⚠️ **The voice is "better but not there."** Stability 0.45 and the spoken-register prompt
improved it and did not finish it. Register reads better on narrative stories than on
statistical ones, which is worth pursuing — it suggests the remaining gap is in how figures
are phrased rather than in the voice settings.

⚠️ **The metaphor rule is prompt-only and unproven** — see §3.7. It recurred after being
named explicitly as a counter-example. Evidence collecting via `VIDEO_SPEC_LOG_JSON`.

⚠️ **Cutaway footage is blocked on a Pexels API key.** Nothing else blocks it: the slots are
designed, timed at 2–3s, full-bleed with no chrome, and drop in as a file swap.

⚠️ **`VIDEO_SUBJECT_VISUALS_ENABLED` has never been switched on in a live cycle.** The schema
and both renderers know `photo` and `map` unconditionally — which is what makes the flag safe
— but the whole path has only ever run in a dry run. The mount and map builders have never
produced a published frame.

**The generation half is doing better than expected, though** (DrJ, 2026-08-16). A dry run
picked *"Trump Tower in New York City"* as a photo subject rather than a person, because the
beat was about a place. That is the taxonomy working as designed and it was not the obvious
outcome — the pull on a political story is toward a face, and the subject rule had to be
stated explicitly in the prompt to resist it. Nothing to change; recorded because the next
person to touch `SUBJECT_VISUAL` should know the place/person branch earns its place. **The
render half remains unproven.**

✅ **The prompt/validator naming fix and its guard test** — shipped 2026-08-16, §4.1.

⚠️ **Multi-outlet sourcing is feasible and unbuilt.** The cycle already resolves an `eventId`
per article and `event_articles` holds the other outlets covering the same story. It would
strengthen figure grounding considerably: two outlets agreeing is much better evidence than
one.
