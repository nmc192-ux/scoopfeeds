# Brief v2: "60 ·" — the autonomous viral-film newsroom

Replaces `sixty-films-autopilot.md`. Save as `docs/briefs/sixty-films-autopilot.md`.
Build from the Mac Mini, in phases, stopping at every checkpoint for DrJ's "go" / "fix". Never build ahead of the current phase.

## DrJ's rulings, 30 Sep 2026 (these override anything below that disagrees)
1. **Where it runs.** Agents AND rendering run on the Mac mini. The VPS only publishes, through
   the existing `videoAutopost`. No `sfagent` user, no `setup-token`, no token handling: the
   Mac's existing Claude Max login is used. The job environment still unsets
   `ANTHROPIC_API_KEY` (the runner also refuses to start unless `/usage` reports
   subscription login).
2. **Models by alias only** (`fable`, `opus`, `sonnet`, `haiku`), never full model IDs.
   Measured 30 Sep: the plan offers all four (`fable` → Fable 5.1, `opus` → Opus 5.5,
   `sonnet` → Sonnet 5.5, `haiku` → Haiku 4.5).
3. **Quality first, not cheapest.** Editor-in-chief and Writer-director use the strongest model
   the plan offers (`fable`). Fact-checker, Render engineer, QA, Researcher, Packager and
   Strategist use `opus`. Scout, Publisher and Analyst use `sonnet`. `haiku` only for purely
   mechanical steps (dedupe, reformatting). A role moves to a cheaper model ONLY if DrJ
   cannot tell the difference in a blind A/B. Routing lives in `sixty/config/models.json`.
4. **Degrade ladder reversed.** When headroom is low, make FEWER films that day. Never
   downgrade a model silently, never switch to an API key, never draw paid overage.
5. **Interim cap:** at most 6 films/day (hard-coded ceiling in `sixty/gates/cap.mjs`), and stop
   IMMEDIATELY on any usage-limit or rate-limit signal (runner kills the session, writes
   `~/sixty/STOP`, notifies). The real cap is proposed from the Phase 0 measurement.
6. **Phase 0** makes ONE complete test film end to end, NOT posted, twice: all-top-models and
   a cheaper mix, labelled A and B at random (key sealed in `.ab-key.json`), with real usage
   measured per agent and model for both.
7. **Batch times** stay clear of the existing scheduled posts. Checked 30 Sep: the PW001 and
   People001 cron jobs on the VPS do NOT call Claude (they post finished MP4s via
   `docker run … node`); they post at 17:00 UTC (22:00 PKT) and 15:00 UTC (20:00 PKT).

## DrJ's rulings, 30 Sep 2026 — revision 2 (after the first A/B attempt)
- **Gate wording.** Every agent's instructions now say: never write the Rule 0 country's name or
  any gate word in any file, including notes; refer to "Rule 0". The gate is unchanged (its file
  is renamed `sixty/gates/rule0.mjs` so no agent copies the name from a path). Never edit an
  agent's output to get it past a gate.
- **Footage.** Short, credited clips from OFFICIAL government, agency and company channels are
  allowed, including their YouTube uploads (public-domain government video first); prefer the
  source's own download. Still no logins to, or scraping of, Instagram, TikTok or X. A story is
  pickable only if real event footage is obtainable.
- **Models (supersedes the quality-first table above).** Routing with effort, in
  `sixty/config/models.json`: opus/high — editor, writer, fact-checker, strategist; opus/medium —
  QA; sonnet/medium — researcher, render engineer, packager, scout, producer; haiku — publisher,
  analyst. Fable is not used by default; it returns (writer only) only if DrJ's blind verdict
  shows the Fable film was clearly better. Sonnet never runs at max effort; a sonnet stage that
  fails twice or returns thin output is escalated to opus.
- **Phase 0 blind A/B:** one arm = routing with fable for editor and writer; the other = routing
  exactly. Labels A/B at random, key sealed.

## DrJ's A/B verdict and editorial playbook, 1 Oct 2026
**Verdict:** film A (routing: Opus writer) was better on story construction, animation and
presentation. Fable stays out; the routing stands. Both films shared the same flaw: one
presentation style, too text-heavy, and no real voices. Rulings: change the narrator to a
fresher FREE voice (candidates from local Kokoro sent to DrJ); use original photos and video of
the event, and let the decision-maker's own recorded words be HEARD (soundbites) — screen-written
remarks only when no recording exists; visuals must improve.

**Editorial playbook** (from BBC, 60 Minutes and Al Jazeera benchmark reels). It is in the
Editor, Writer-director, Render engineer and QA instructions (`sixty/agents/_playbook.md`,
prepended by the runner), and QA checks each rule and flags misses:

1. **Hook.** The first sentence = the news + a twist or the stakes. The promise may be a
   question or a twist. Do NOT open every film with "In 60 seconds…" — vary it.
2. **Real voices first.** Where a primary clip of the decision-maker or an expert exists, let
   them speak: soundbites with their own audio and a name/title lower-third. Narration only
   bridges between voices. Text-on-screen quotes only when no recording exists.
3. **Pin a one-line headline or question card** on screen for the whole film (plan `pin`).
4. **Every big number gets a comparison that makes it felt** — time, an everyday object, a
   rival figure ("170 generals: more than every four-star in NATO combined" — only if verified).
5. **Structure = the viewer's questions, answered in order.** Pre-empt the obvious objection.
6. **Balance.** Give the other side or the sceptic at least one line.
7. **Pace.** Numbers appear on screen the moment they are spoken; a visual change every
   2–3 s; captions highlight the key word (plan `keywords`).
8. **Ending.** Close on "what happens next", or loop back to the opening line so a rewatch
   flows.
Comparisons, sceptic lines and soundbites are facts like any other: they need register
claim ids and pass the fact-check. QA checks every rule and flags each miss.

**Built for it (1 Oct):** soundbites with original audio (`sixty/tools/transcribe.mjs` —
whisper.cpp small.en, free and local; `voice.mjs` leaves the narration silent under a soundbite
and takes captions from the speaker's word timings; `mix.mjs` lays the speaker's audio into the
voice stem so the bed ducks under it); a pinned headline/question card (`plan.pin`) and key-word
caption highlighting (`plan.keywords`) in `render60.py`; measured playbook flags in
`sixty/gates/qa.mjs` (`gate-qa.json → playbook`, reported, not blocking — including real-footage
share and text-only share; on the Phase 0 films: A 10% real / 90% text-only, B 38% / 53%).
The runner refuses to start below 8 GB free disk, and agents download only the clip sections
they need.

## Implementation notes (Phase 0, as built)
- Code: `sixty/` in the repo (runner `sixty/bin/run.mjs`, agent prompts `sixty/agents/*.md`,
  hard gates `sixty/gates/`, tools `sixty/tools/`, 60 · chrome `sixty/render/render60.py`).
  Runtime data: `~/sixty/` on the Mac (films, logs, ledger, render venv, local Kokoro, beds).
- Subagents are passed to `claude -p` with `--agents` (built from `sixty/agents/*.md` + the
  model map) rather than living in `.claude/agents/`, so a model change is one config line
  and the A/B variants can run from the same prompts.
- Gates are called, never edited: the runner hashes `sixty/{gates,tools,render,config,agents,bin}`
  before and after every run and voids the film if anything changed. Session permissions
  are an allowlist; the repo is read-only to agents; no git/ssh/posting commands.
- Voice: local Kokoro-FastAPI v0.9.0 (same as prod), `bm_george`, through prod `videoVoice.js`.
  Beds: the 8 approved library beds copied from the worker. Render: prod shot engine
  (`backend/shotengine`) + the 60 · chrome.
- Usage: attributed per agent and model from the session stream (exact tokens), plus the
  5-hour and 7-day window utilization from the stream's rate-limit events and `/usage`
  before/after. API-list-price equivalent is recorded but is NOT a bill.
- **Known gaps at Phase 0** (stated, not hidden): the approved "60 ·" template was never
  committed, so the chrome is a DRAFT for DrJ to rule on; Wikimedia Commons is unreachable
  from the Mac (the router's DNS refuses `commons.wikimedia.org`); YouTube Data API, Reddit
  API, TikTok Creative Center and X are not wired into the Scout yet; the stop notification
  is a local log/notification — emailing DrJ needs the mail credential on the Mac (DrJ's call).

## Mission
ScoopFeeds competes with WSJ, Al Jazeera, NYT and TIME on short-form. Every film is exactly 60 seconds, makes a clear promise in the first 2 seconds (MrBeast-style: "In 60 seconds you'll know why…"), pays it off before the stopwatch ends, and every fact on screen is sourced. Goal: maximum views and the fastest route to monetization with minimum cost.

## Standing rules (never changed by any agent, including the Strategist)
1. **No Pakistan.** Hard-exclude Pakistan and Pakistani internal politics at the Scout stage, and again at QA. Reuse the incident engine's existing Pakistan/politically-live KILL list.
2. **Facts.** Every number, quote and claim is matched to at least two independent sources, or one primary source (official record, filing, transcript, the original video). Anything unverifiable is cut, not softened. Every film ships with a fact register.
3. **Promise = payoff.** The title and thumbnail may only promise what the film actually delivers. No fake urgency, no invented stakes.
4. **Original work, not reposts.** Third-party clips appear only as short, credited excerpts inside ScoopFeeds' own narrative (evidence, perspectives, a hook montage), never as whole or near-whole reposts. Meta demotes and demonetizes accounts that reuse others' videos, and YouTube's inauthentic-content policy targets mass-produced uploads. Primary footage first: White House and other government channels, company newsrooms and press kits, UN/agency feeds, the original uploader.
5. **Acquisition only through sanctioned routes:** official APIs, public official channels, and the incident media engine's scoop → verify → clear ledger. No scraper logins to IG, TikTok or X with ScoopFeeds accounts (bans on the posting accounts would kill distribution).
6. **Generated visuals** (Higgsfield or code-rendered) only for data, maps, explainers and abstract scenes. Never fabricate footage of real people or real events.
7. **Brand:** approved 60 · template — black + acid-lime, full-screen 9:16, stopwatch with a faintly audible tick, fast word-anchored cuts, word-by-word captions, approved ElevenLabs bed library, Kokoro voice (or no voice where the film works without it). DrJ is never credited on screen.
8. **Budget:** hard monthly spend cap. If a limit is hit, stop, email DrJ, skip the slot. No silent fallback between billing methods.

## Billing — DrJ's decision (Sep 30): Claude subscription, 6 films/day
- `SIXTY_FILMS_AUTH=subscription`. ~~Auth from `CLAUDE_CODE_OAUTH_TOKEN` for user `sfagent`~~ — superseded 30 Sep: the Mac mini's existing Claude Max login is used. The job environment explicitly unsets `ANTHROPIC_API_KEY`, and the runner checks `/usage` reports subscription login before every run.
- The subscription pool is shared with DrJ's own chats and Claude Code. Two limits apply: a rolling 5-hour window and a weekly cap. Opus uses the pool much faster than Sonnet, and Haiku is cheapest.
- **DrJ's ruling (Sep 30): Claude does the entire workload, not just the thinking.** Claude agents operate every stage themselves with tools: they search and fetch trends, download and clear footage, write the per-film animation code, drive the renderer and ffmpeg, check their own output, fix failures, package, schedule and post, and pull analytics. Existing proven code (shot engine, incident media engine, `videoAutopost`) becomes tools the agents call, not a fixed pipeline that runs around them.
- **Per-film usage is therefore much higher** than a thinking-only design, because every tool step is a Claude turn. ~~Cheap models do the legwork~~ — superseded 30 Sep: quality first (see rulings).
- **Schedule:** 6 films in 3 batches of 2 (e.g. 02:00, 10:00, 18:00 PKT, tuned in Phase 0), so each batch sits in its own 5-hour window. Keep a quiet window during DrJ's working hours for his own Claude use.
- **Hard gates stay outside the agents** (an agent must not police itself): Pakistan filter, the Standing rules check, the daily post cap, the budget meter and the posting lock run as fixed checks the agents cannot edit or bypass. Agents may call them, never change them.
- **Budget meter:** count calls and tokens per model per day/week; show headroom in the daily digest. ~~Degrade ladder: downgrade models~~ — REVERSED 30 Sep: when headroom is low, make fewer films that day; never downgrade a model silently; never switch to an API key. On a limit signal: stop immediately, notify DrJ, reschedule the slot to the next window.
- **Phase 0 must measure** the real usage of one full film, then tell DrJ which plan sustains 6/day (expect Max 20x for a fully agentic workload) and whether turning on the plan's opt-in extra usage as a safety net is worth it.

## The agents and their models
~~Route every call to the cheapest model.~~ Quality first (DrJ, 30 Sep): the table below is the ruling; a role moves down only after a blind A/B DrJ cannot tell apart. Aliases only. Log tokens per agent per model per film.

| Agent | Job | Model |
|---|---|---|
| Scout | Pull trends every 2 h; dedupe; Pakistan filter; cluster into candidate stories | `sonnet` (dedupe is code) |
| Editor-in-chief | Pick the day's stories; write the promise; choose series (Makers, AI, Leaders, War, Borders, DemocraZy, Tech, Entertainment) | `fable` |
| Researcher | Gather facts, figures, primary footage, quotes; build the fact register | `opus` |
| Fact-checker | Independently re-verify every register line; kill or fix | `opus` (fresh context, never sees the script's reasoning) |
| Writer-director | 60 s script, beat sheet, shot list, on-screen numbers, music tone | `fable` |
| Render engineer | Writes each film's animation/graphics code, drives the shot engine and ffmpeg, fixes render errors | `opus` |
| QA | Technical and editorial gate (see below) | `opus` + deterministic checks (`sixty/gates/qa.mjs`) |
| Packager | Title, thumbnail brief, description, hashtags, per-platform variants | `opus` |
| Publisher | Schedule and post; verify each post went live; retry or report | `sonnet` (calls `videoAutopost` on the VPS) |
| Analyst | Pulls metrics via the platform APIs itself; daily summary | `sonnet` |
| Strategist | Weekly: rewrite the playbook from results | `opus` |

**How it runs:** on the Mac mini, a scheduled job (launchd, the Mac equivalent of a systemd timer — added when scheduling is approved) runs `sixty/bin/run.mjs`, which starts one headless Claude Code session per job: the **Producer** (`claude -p --model sonnet`, orchestration only). The Producer runs the whole film end to end and delegates each stage to a Claude Code **subagent** defined in `sixty/agents/*.md` and passed with `--agents`, each with its own model (per the table), its own instructions and only the tools it needs. Subagents work in fresh contexts and hand results back as files in the film's folder. The Producer retries or reroutes a failed stage (e.g. no usable footage → Researcher finds another source; render fails → Render engineer fixes the code) up to a set limit, then drops the story and takes a reserve pick. The Publisher and Analyst are subagents too (`sonnet`), calling the existing autopost (on the VPS) and analytics code as tools.

## Stage detail
**Scout sources:** ScoopFeeds top-story scorer (primary); Google Trends trending feeds (US, UK, IN, global); YouTube Data API most-popular charts and Shorts search, ranked by view velocity; TikTok Creative Center public trend pages (hashtags, songs); Reddit API (worldnews, technology, business); X API only if a paid tier is enabled; existing ScoopFeeds RSS/wires. Output: ranked candidates with a virality score (velocity × breadth × ScoopFeeds fit) and a "why now" line.

**Editor rules:** 6 films/day (`SIXTY_FILMS_PER_DAY=6`), picked in 3 batches of 2; hold 2 reserve picks in case a film fails QA. Prefer stories with a person, a number, a conflict or a surprise. Mix series across the week. Log the reasons for each pick and each rejection.

**Research:** primary sources first; direct quotes only from the original video or transcript; capture timestamps for every clip used; incident engine clears every third-party asset.

**Writer-director:** hook (0–2 s) states the promise; one idea per beat; a number or visual change every 2–3 s; payoff by 55 s; last 5 s = the takeaway plus follow prompt. No filler.

**Render:** reuse the live shot engine and the approved 60 · template; animated charts, maps and counters; real footage full-bleed; 1080×1920, 24 fps, exactly 60.0 s.

**QA gate (blocks posting):** duration, resolution, black/frozen frames, caption safe zones, loudness, bed under voice, every on-screen claim traced to the register, promise paid off, Pakistan filter re-run, originality check (our own narrative and edit dominate the runtime), credits present.

**Packager:** title = the promise, under 60 characters; custom thumbnail frame from the strongest shot plus a large number or face; description = 2-line summary + sources; 3–5 hashtags chosen for relevance and current search volume (YouTube Search Insights where available, trend data otherwise); per-platform captions.

**Publisher:** YouTube Shorts, Instagram Reels (+ Facebook), Threads, Bluesky via existing autopost. TikTok only after the 403 is resolved (Upload-Post decision still pending with DrJ). Slots start at data-driven defaults per platform/audience, then the Strategist tunes them.

**Analyst + Strategist loop:** daily pulls from YouTube Analytics (views, average % viewed, viewed-vs-swiped-away, subscribers gained), Instagram/Facebook Insights (plays, reach, average watch time, shares, saves). Weekly, the Strategist writes `playbook.md`: what worked (topics, hook patterns, title patterns, thumbnails, times), what to stop, and 1–2 controlled experiments for next week. The Strategist may only change a whitelisted config (topic weights, series mix, slot times, title/hook templates, hashtags). It can never change the Standing rules. Its weekly report goes to DrJ's digest.

**Monetization tracker:** shows progress toward YPP each week. Current bar: 1,000 subscribers plus 10M Shorts views in 90 days or 4,000 long-form watch hours. New applicants from 1 Feb 2027 need 20M Shorts views or 8,000 hours, so flag whether either path can be cleared before then and use the Shorts to funnel viewers to the weekly longforms.

## Phases and checkpoints
0. **Ground:** billing check (subscription login), interim cap (6/day, stop on any limit), orchestrator skeleton, per-agent usage logging, Pakistan filter test, and ONE complete test film rendered twice (A/B: top models vs a cheaper mix), not posted. Checkpoint: the two films, usage per film per agent/model for both, and which plan sustains 6/day.
1. **Scout + Editor:** 3 days of dry-run picks emailed to DrJ, nothing rendered. Checkpoint: DrJ rates the picks.
2. **Research + Fact-check:** registers for the approved picks. Checkpoint: DrJ spot-checks 2 registers.
3. **Writer-director + Render + QA:** 3 films rendered, not posted. Checkpoint: DrJ watches them.
4. **Packager + Publisher, approval mode:** one-tap approve on phone before each post. Run 1 week.
5. **Analyst + Strategist:** first weekly playbook. Checkpoint: DrJ reviews it.
6. **Full auto:** `SIXTY_FILMS_AUTOPOST=auto` on DrJ's word; post-upload daily digest; rollback flag `off`.

---

## HANDOVER — state at 2 Oct 2026 (for a fresh session; read this first)

**Where things are.** Branch `feat/sixty-phase0` (local only, never pushed, not merged). Code in
`sixty/`; runtime on the Mac mini in `~/sixty/` (films, logs, ledger, render venv `shotengine/`,
local Kokoro `kokoro/` + `kokoro-start.sh`, models `models/` (whisper small.en, YuNet), beds
`data/music-library/`). The VPS is untouched (publishing only, later phases).

**Phase:** 0, not closed. Done: subscription-only runner with per-agent usage accounting, hard
gates (Rule 0 + 7 tests, QA, daily cap 6, STOP switch, gate-hash integrity), blind A/B (verdict:
A = routing/Opus writer was better; Fable stays out), playbook, soundbites, pin card, keyword
captions, new stopwatch pill. NEXT: DrJ approves the stopwatch stills
(`~/sixty/review/stopwatch-stills.jpg`) → ONE test film on the routing, Hegseth "1 in 5
generals" story WITH his recorded voice, balance rule applies, not posted → checkpoint.

**How to run** (from the repo root, on the Mac mini; start Kokoro first):
```
~/sixty/kokoro-start.sh &                       # local Kokoro on 127.0.0.1:8880
node sixty/bin/run.mjs film --pick <pick.json> --dir ~/sixty/films/<day>/<name>   # one film, routing
node sixty/bin/run.mjs pick --day ~/sixty/films/<day> --films 2                   # Scout + Editor
node sixty/bin/run.mjs repick --day <dir> --films 1 --exclude "..."               # Editor only
node sixty/bin/run.mjs ab --pick <pick.json> --dir <dir>                          # blind A/B
node --test sixty/gates/rule0.test.mjs
```
The Hegseth pick: `~/sixty/films/2026-09-30-phase0/pick2.json`. The runner refuses to start if:
not on subscription login, `~/sixty/STOP` exists, daily cap reached, Kokoro down, < 8 GB free
(Mac or the films location).

**Decisions in force (DrJ).** Mac mini runs agents+render; VPS publishes only. Aliases only;
routing+effort in `sixty/config/models.json` (opus/high editor, writer, fact-checker,
strategist; opus/medium QA; sonnet/medium researcher, render, packager, scout, producer; haiku
publisher, analyst; sonnet never at max; sonnet stage failing twice → opus). Never downgrade;
low headroom = fewer films; no API key; no paid overage. Interim cap 6/day; stop on any limit
signal. Rule 0 wording: agents never write the country or any gate word anywhere. Footage:
official government/agency/company channels incl. their YouTube uploads (public-domain gov first,
own download preferred); no logins/scraping of Instagram/TikTok/X; no re-uploads or aggregator
channels. Text-only screen time > 15% = HARD FAIL (charts/counters/maps are visuals); < 60% real
footage = flag. Playbook rules 1–8 flagged by QA. Voice stays `bm_george` until DrJ picks from
the samples in `~/sixty/films/2026-09-30-phase0/film2/review/voices/`.

**Measured (Phase 0 A/B, Hegseth story).** Per film ≈ 22–31 points of the 5-hour window and
2–3 points of the weekly cap; story pick ≈ 3–7 window points. 6/day does not fit the weekly cap
on the current plan (≈ 85–125% of a week); ≈ 3–4/day does. Proposed real cap: 4/day. Plan tier
not yet stated by DrJ. Extra usage is OFF (org_level_disabled).

**Open items.**
1. Stopwatch stills — awaiting DrJ's approval (gates the test film).
2. Voice choice (DrJ listening).
3. Plan tier → final daily cap.
4. Disk: Mac mini at ~8 GB free; cleanup list proposed to DrJ (synapse logs, caches) — awaiting
   approval. Moving films to an external SSD: see below.
5. Commons unreachable from the Mac (router DNS refuses commons.wikimedia.org) — DrJ's network call.
6. Scout sources not wired: YouTube Data API (key on Mac = credential decision), Reddit API, TikTok
   Creative Center, X.
7. Stop notification is local only; emailing DrJ needs the mail credential on the Mac (DrJ).
8. A "news-network/social footage ruling" DrJ referred to on 2 Oct was not found in this session —
   only the official-channels ruling above is applied. Re-send if there was another.
9. `.claude/settings.json` still has the ssh/scp/merge deny rules removed (from the shot-engine
   build) — restore with `git checkout .claude/settings.json` when DrJ says.
10. Phase 0 scratch films are kept in `~/sixty/films/2026-09-30-phase0/` (~0.7 GB) for reference.

**Moving films to an external SSD** (when plugged in, e.g. `/Volumes/SSD`; with no run active):
```
mkdir -p /Volumes/SSD/sixty-films
rsync -a ~/sixty/films/ /Volumes/SSD/sixty-films/ && mv ~/sixty/films ~/sixty/films.old
ln -s /Volumes/SSD/sixty-films ~/sixty/films
# check a film plays from the SSD, then: rm -rf ~/sixty/films.old
```
If the SSD is unplugged the runner refuses to start (the films path is checked).
