# ScoopFeeds Radio: the autonomous newsroom

**Goal (DrJ, 13 Oct 2026):** a newsroom that can go live fully autonomously, built over time.
**Rule for every stage:** ship dark behind a flag, rehearse, watch one live run, then switch it on.

## Where it stands

The first live hour went out on 13 Oct (9 pm PKT). The machine produced it: facts, script, fact checks, voice, mix,
cues and playout. A person still had to start the producer, send "go", create the YouTube broadcast and click
Go live. Problems on air: market prices missing (Yahoo returned HTTP 429), the A-Eye episode stuttered, and phones
started muted. The stutter is fixed: films now play through the encoder, not the page.

## Stage 1: one hour a day runs itself (built; rehearsal next)

| Piece | What it does | Where |
|---|---|---|
| Timer | launchd fires about 45 min before the hour | `playout/deploy/macos/install-autoair.sh 20:14` |
| Orchestrator | produce → air check → YouTube setup → hand over from the 24/7 radio → air → watch → wrap up | `programme/autoair.mjs` |
| Air check | the hour airs only if the files are there, it is the right hour, at least 60 % of written lines passed the fact checks and The Hour has at least 3 checked stories. Anything unmeasured fails | `programme/airCheck.js` |
| YouTube Live | creates the public broadcast, binds the station's stream, sets the thumbnail, goes live once the signal arrives, completes it at the end | `live/youtubeLive.js` |
| Markets | CNBC's quote feed first, Yahoo second | `programme/factPack.js` |
| Unmute line | "No sound? Tap the speaker to unmute" on the countdown | programme screen |
| Alerts | log + Mac notification + email (`RADIO_ALERT_EMAIL`) on any failure, plus a "LIVE" notice with the watch link | `autoair.mjs` |

**Fails safe.** If the producer or the air check fails, nothing airs and the 24/7 music radio keeps the channel.
If YouTube setup fails, the stream still goes out and DrJ is alerted to go live by hand.

**DrJ's one-time steps**
1. Re-authorise YouTube with the live scope: `node backend/scripts/youtube-auth.mjs` on the Mac, then put the
   three `RADIO_YT_*` values in `~/.scoopfeeds-radio.env`. *(Credential use: DrJ only.)*
2. Optional: `RADIO_ALERT_EMAIL` and `SMTP_*` in the same file, for email alerts.
3. `install-autoair.sh 20:14`. Until step 4 every run is a rehearsal: produced and checked, never aired.
4. After one clean rehearsal: `RADIO_AUTOAIR_ENABLED=1`. Kill switch any time: `touch ~/scoopfeeds-radio/PAUSE`.

## Stage 2: every hour, 24/7 (built for #195; rehearsal next, on air only after #208)

| Piece | What it does | Where |
|---|---|---|
| Loop | one long-running process owns the air. At :15 it prepares the next hour (must finish by :45), at :30 it refreshes the hour on air if the top story changed, at :59 it hands over. One job at a time: producers never overlap | `programme/rolling.mjs`, `programme/rollingStation.js` |
| Day clock | 6 am to midnight New York: full produced hours. Midnight to 6 am: the strongest produced hour of the last 18, repeated, with a freshly written The Hour at the top (Middle East morning, then UK/Europe morning). Weather every 2 hours (the half-hour headlines take its slot otherwise). Markets Now leads with the exchanges in session. #200's grid replaces `planHour` | `programme/dayClock.js` |
| Fallback | an hour whose producer or air check fails airs the 24/7 headline screen + music bed; the next hour tries again. DrJ is alerted only when 2 hours in a row fail | `rollingStation.js` |
| Cost guard | every Claude writer call is counted per hour (`status.json`) and per day (`writer-calls/<date>.json`). Over `RADIO_WRITER_DAILY_MAX`, or after a usage limit, produced hours become repeats read from headlines (no Claude) | `rollingStation.js`, `produce.mjs` |
| YouTube | one continuous broadcast (auto-stop off), rolled at a quiet hand-over (4 am / 4 pm New York) before 12 h, so the channel's /live URL always has it | `rollingStation.js`, `live/youtubeLive.js` |
| Mac wrapper | env file, Kokoro, caffeinate, notification hook; stands down the 24/7 music radio agent and the one-hour timer while it runs | `playout/deploy/macos/install-rolling.sh`, `run-rolling.sh` |

**Gates.** Streams only when `RADIO_AUTOAIR_ENABLED=1` AND `RADIO_ROLLING_ENABLED=1`; otherwise each hour plays to
`~/scoopfeeds-radio/rehearsal-seg/`. `PAUSE` takes the stream **off air** within 30 s, mid-hour included (#208): the
playout stops, the YouTube broadcast is completed and the loop exits; on restart it holds until PAUSE is removed by
hand (the standing watchdog also unloads `com.scoopfeeds.radio.rolling`, so after an incident re-run
`install-rolling.sh`). The #208 layer applies as in autoair: films only through `pickClearedFilm()` (none cleared:
music fills the slot; a repeat whose film is no longer cleared falls back), `factualTitle()` on the title, and the
music credits of every track that may air, or the `RADIO_MUSIC_CREDITS_URL` link, in the description and in
`~/scoopfeeds-radio/x-broadcast.txt` (`xBroadcastText`). Credits that cannot be published complete keep the loop in
rehearsal, with an alert. The standing
approval below names `autoair.mjs` only, and DrJ gated 24/7 airing on #208: switching the 24/7 loop on air is DrJ's call.

**Rehearsal (6 hours, nothing streamed):** `bash backend/src/radio/playout/deploy/macos/install-rolling.sh`, or by hand
`node src/radio/programme/rolling.mjs --hours 6 --force-fail <one hour, e.g. 2026-10-27T17>` (add `--force-top-change`
if the news is quiet, to see the :30 refresh). Read `~/scoopfeeds-radio/logs/rolling.log`, each hour's `status.json`, and
the recordings under `rehearsal-seg/`.

Still open from the old Stage 2 list: prepare film/feature lists automatically from the published shorts and series (#203).

## Stage 3: an editor and a quality gate
- An editor step that sets the running order and can hold a story.
- A stricter pre-air gate: listen-back checks (speech level above the bed, silence, clipping) on the mixed audio.
- An automatic post-air review of each hour: what was cut, sync, levels, viewers. Plus a corrections log.

## Stage 4: the full newsroom
- 60-second films, A-Eye and explainers slot into the schedule automatically.
- Two presenter voices and live data graphics.
- An always-on wired host with backup power, or a cloud playout, so air never depends on home Wi-Fi.

## Standing approval: IN FORCE (DrJ, 22 Oct 2026)

CLAUDE.md says DrJ approves every irreversible action, with scoped exceptions (the long-form autopost loop, and this one).
Going on air unattended is an external post, so it has an explicit, scoped exception, recorded in CLAUDE.md. **Scope:**

- **Covers only** `programme/autoair.mjs` airing a programme hour produced by `produce.mjs` that passed `airCheck`,
  on the main ScoopFeeds YouTube channel and the ScoopFeeds X account (X Live), at times installed on the Mac
  with `install-autoair.sh`. `autoair.mjs` drives YouTube only until #196/#207 add X.
- **Off** unless `RADIO_AUTOAIR_ENABLED` is literally `1`; `~/scoopfeeds-radio/PAUSE` stops it without editing anything.
- **Never covered:** code merges outside the engine's normal gates, prod deploys of the web app outside autodeploy,
  new formats, changing the clock or the Rule 0 layer, credentials, or any other channel. Those stay human-approved.
- **Playout host:** the Mac mini now; the design must allow a cloud host later.

Platform safety (music provenance, film clearance, the standing watchdog, election claims): `docs/radio/safety.md` (#208).
