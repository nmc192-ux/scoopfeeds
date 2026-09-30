# Brief v2: "60 ·" — the autonomous viral-film newsroom

Replaces `sixty-films-autopilot.md`. Save as `docs/briefs/sixty-films-autopilot.md`.
Build from the Mac Mini, in phases, stopping at every checkpoint for DrJ's "go" / "fix". Never build ahead of the current phase.

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
- `SIXTY_FILMS_AUTH=subscription`. Auth only from `CLAUDE_CODE_OAUTH_TOKEN` (made once with `claude setup-token` on the Mac, stored mode 600 for user `sfagent`). The job environment explicitly unsets `ANTHROPIC_API_KEY`. Verify before the first run that the session is on subscription login, not an API key.
- The subscription pool is shared with DrJ's own chats and Claude Code. Two limits apply: a rolling 5-hour window and a weekly cap. Opus uses the pool much faster than Sonnet, and Haiku is cheapest.
- **DrJ's ruling (Sep 30): Claude does the entire workload, not just the thinking.** Claude agents operate every stage themselves with tools: they search and fetch trends, download and clear footage, write the per-film animation code, drive the renderer and ffmpeg, check their own output, fix failures, package, schedule and post, and pull analytics. Existing proven code (shot engine, incident media engine, `videoAutopost`) becomes tools the agents call, not a fixed pipeline that runs around them.
- **Per-film usage is therefore much higher** than a thinking-only design, because every tool step is a Claude turn. Cheap models do the tool-heavy legwork; Opus is reserved for judgment and writing.
- **Schedule:** 6 films in 3 batches of 2 (e.g. 02:00, 10:00, 18:00 PKT, tuned in Phase 0), so each batch sits in its own 5-hour window. Keep a quiet window during DrJ's working hours for his own Claude use.
- **Hard gates stay outside the agents** (an agent must not police itself): Pakistan filter, the Standing rules check, the daily post cap, the budget meter and the posting lock run as fixed checks the agents cannot edit or bypass. Agents may call them, never change them.
- **Budget meter:** count calls and tokens per model per day/week; show headroom in the daily digest. Degrade ladder when headroom is low: Writer Opus → Sonnet first; then Render engineer Sonnet → Haiku for routine assembly; then drop to 4 films; never switch to an API key. On a limit error: stop, email DrJ, reschedule the slot to the next window.
- **Phase 0 must measure** the real usage of one full film, then tell DrJ which plan sustains 6/day (expect Max 20x for a fully agentic workload) and whether turning on the plan's opt-in extra usage as a safety net is worth it.

## The agents and their models
Route every call to the cheapest model that does the job well. Log tokens and cost per agent per film.

| Agent | Job | Model |
|---|---|---|
| Scout | Pull trends every 2 h; dedupe; Pakistan filter; cluster into candidate stories | `claude-haiku-4-5-20251001` |
| Editor-in-chief | Pick the day's stories; write the promise; choose series (Makers, AI, Leaders, War, Borders, DemocraZy, Tech, Entertainment) | `claude-opus-5-5` |
| Researcher | Gather facts, figures, primary footage, quotes; build the fact register | `claude-sonnet-5-5` |
| Fact-checker | Independently re-verify every register line; kill or fix | `claude-sonnet-5-5` (fresh context, never sees the script's reasoning) |
| Writer-director | 60 s script, beat sheet, shot list, on-screen numbers, music tone | `claude-opus-5-5` |
| Render engineer | Writes each film's animation/graphics code, drives the shot engine and ffmpeg, fixes render errors | `claude-sonnet-5-5` |
| QA | Technical and editorial gate (see below) | `claude-sonnet-5-5` + deterministic checks |
| Packager | Title, thumbnail brief, description, hashtags, per-platform variants | `claude-haiku-4-5-20251001` drafts → `claude-sonnet-5-5` picks |
| Publisher | Schedule and post; verify each post went live; retry or report | `claude-haiku-4-5-20251001` (calls `videoAutopost`) |
| Analyst | Pulls metrics via the platform APIs itself; daily summary | `claude-haiku-4-5-20251001` |
| Strategist | Weekly: rewrite the playbook from results | `claude-opus-5-5` |

**How it runs:** a systemd timer starts one headless Claude Code session per batch: the **Producer** (`claude -p --model sonnet`). The Producer runs the whole film end to end and delegates each stage to a Claude Code **subagent** defined in `.claude/agents/*.md`, each with its own model (per the table), its own instructions and only the tools it needs. Subagents work in fresh contexts and hand results back as files in the film's folder. The Producer retries or reroutes a failed stage (e.g. no usable footage → Researcher finds another source; render fails → Render engineer fixes the code) up to a set limit, then drops the story and takes a reserve pick. The Publisher and Analyst are subagents too (Haiku), calling the existing autopost and analytics code as tools.

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
0. **Ground:** billing switch, spend cap, orchestrator skeleton, cost logging, Pakistan filter test. Checkpoint: cost estimate per film per model.
1. **Scout + Editor:** 3 days of dry-run picks emailed to DrJ, nothing rendered. Checkpoint: DrJ rates the picks.
2. **Research + Fact-check:** registers for the approved picks. Checkpoint: DrJ spot-checks 2 registers.
3. **Writer-director + Render + QA:** 3 films rendered, not posted. Checkpoint: DrJ watches them.
4. **Packager + Publisher, approval mode:** one-tap approve on phone before each post. Run 1 week.
5. **Analyst + Strategist:** first weekly playbook. Checkpoint: DrJ reviews it.
6. **Full auto:** `SIXTY_FILMS_AUTOPOST=auto` on DrJ's word; post-upload daily digest; rollback flag `off`.
