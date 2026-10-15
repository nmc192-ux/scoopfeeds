# ScoopFeeds Development Plan v7 — the engine's backlog

**Approved by DrJ, 14 Oct 2026.** The living plan is DrJ's doc "ScoopFeeds Development Plan
v7"; this file is the engine's copy of its backlog, in build order. Rules for building it:
`docs/engine/full-throttle.md`. Design reference: the "ScoopFeeds Redesign" canvas (five
doors, shared tokens with Radio, pencil layer).

`/plan` takes the first `[queued]` items in order and turns each into a `j-loop:spec-ready`
issue with its lane label, then changes the marker to `[spec #N]`. `/build` must ground each
item against the code before changing it; the item text is intent, not a verified diagnosis.

## Decisions that bind every item (DrJ, 14 Oct 2026)

- Five doors: **Today, News, Originals, Markets, Watch & Listen**, plus Search and My Scoop.
- **English only**: language switch and non-English locales removed. **No WhatsApp channel.**
- **Feeds follow the reader's location**: Today and News put the reader's country first.
- **Market odds hidden** on Today and dossiers until the Markets fix (re-enabling = stop list).
- **No automated Shorts** (DrJ, 15 Oct 2026): the automated Shorts loop is off and stays off;
  re-enabling it is on the stop list. Hand-approved `/video-factory` Shorts are unaffected.
- **AI "What we know"** allowed on dossiers with a disclosure line once the coherence gate is live.
- **Coverage Gaps** measured by region, never political leaning.
- Site and Radio share ink `#090706`, paper `#F4EFE6`, live red `#D7261E`, Newsreader and
  Schibsted Grotesk; ScoopFeeds accent lime `#DDE706` with Anton; Radio keeps navy and Bodoni.
- Pencil characters with fixed jobs (Scoop finds, the Intern waits, Clip checks facts), one per
  screen, never on a sensitive story; the hummingbird mascot is retired.
- Morning Scoop: one edited edition plus a "Your topics" block, sent 06:30 New York and
  07:00 London by local time.

## Phase 0 — fix and navigate (15–28 Oct 2026)

Specced directly as issues on 14 Oct; see the GitHub backlog (label `phase:0`).

## Phase 1 — new look (29 Oct–18 Nov 2026)

- [queued] lane:website — Shared design tokens and fonts (site + Radio), new header/footer look across all pages
- [queued] lane:website — New Today page per the canvas: lead story, developing strip, today's stories, Radio card; earn-render throughout
- [queued] lane:website — Location-aware feeds: country from the request (existing geo lookup), menu override, country-first ordering on Today and News, US/UK/Europe first
- [queued] lane:website — News page (all tracked stories: developing, long-running, settled, trackers) replacing /events and the six category pages
- [queued] lane:website — Dossier v2 layout per the canvas, including "Since your last visit" from the timeline
- [queued] lane:graph — "What we know" AI block on dossiers with disclosure line, gated on the coherence gate verdict
- [queued] lane:website — Pencil layer: three characters as SVG components, margin-note component, sensitivity switch reused from editorialSensitivity
- [queued] lane:website — Server-render the first screen of Today and dossiers for crawlers; NewsArticle markup; sitemap-events.xml
- [queued] lane:website — "How we group stories" methodology page and rewritten About (remove claims that are not true)
- [queued] lane:sources — Source step 1: grow to 200 active English-language sources, batches of 50 above the quality floor, list each batch in the daily report

## Phase 2 — new doors (19 Nov–9 Dec 2026)

- [queued] lane:originals — Originals page and shelves (latest analysis, ScoopFeeds Stories, Explained, By the numbers) with the house format
- [queued] lane:website — Watch & Listen: latest episodes from the YouTube channel, per-show rows, Shorts, Live TV, episode pages
- [queued] lane:radio — Radio on the site: "On air now" card and a persistent mini-player with current and next programme
- [queued] lane:website — Social hub: public read of latest posts per platform from social_posts; "On social" box in dossiers; UTM tags
- [queued] lane:website — Markets door with tabs (overview, economy, world map; odds tabs stay off until re-enabled)
- [queued] lane:website — My Scoop: saved, followed stories, alerts, sign-in; Follow button on dossiers
- [queued] lane:website — Remove dead code: the unused components and the redirected pages
- [queued] lane:sources — Source step 2: grow to 400 once the promoter keeps up and snapshot writes are batched
- [queued] lane:website — Switch the new site on for all readers (flag flip) on 9 Dec

## Phase 3 — unique features (10 Dec 2026–6 Jan 2027)

- [queued] lane:graph — Coverage Gaps: stories big in one region and absent in another; daily module + weekly Gap Report
- [queued] lane:website — Same story, different headlines wall on dossiers
- [queued] lane:website — Live mode on developing dossiers (auto-refresh, "N new reports")
- [queued] lane:originals — Morning Scoop redesign: dossier-based, new look, Intern sign-off, US and Europe editions by local time
- [queued] lane:originals — Weekly quiz "Did you scoop it?" built from the week's dossiers
- [queued] lane:originals — By the numbers: one sourced number a day, site card + IG card
- [queued] lane:website — Search answer card with sources
- [queued] lane:website — Embeddable dossier widget
- [queued] lane:website — Receipts and dated corrections log
- [queued] lane:sources — Source step 3: 1,000 sources by 17 Feb 2027 after two stable weeks at 400

## Radio lane (runs alongside)

- [queued] lane:radio — Stage 1: timed unattended hour with the YouTube Live API (agreed 13 Oct), then the reordered phases: launch, voice, news compared, markets/weather, programme clock, always-on
