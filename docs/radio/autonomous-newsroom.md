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

## Stage 2: several hours a day
- More timed hours (`install-autoair.sh 08:14 14:14 20:14`), the 24/7 music radio between them.
- A half-hour script refresh, so breaking news gets in (the `--from` refresh, run by the orchestrator).
- Prepare film/feature lists automatically from the published shorts and series.

## Stage 3: an editor and a quality gate
- An editor step that sets the running order and can hold a story.
- A stricter pre-air gate: listen-back checks (speech level above the bed, silence, clipping) on the mixed audio.
- An automatic post-air review of each hour: what was cut, sync, levels, viewers. Plus a corrections log.

## Stage 4: the full newsroom
- 60-second films, A-Eye and explainers slot into the schedule automatically.
- Two presenter voices and live data graphics.
- An always-on wired host with backup power, or a cloud playout, so air never depends on home Wi-Fi.

## Standing approval: DRAFT for DrJ

CLAUDE.md says DrJ approves every irreversible action, with one exception (the long-form autopost loop). Going on
air unattended is an external post, so it needs the same kind of explicit, scoped exception. **Proposed scope:**

- **Covers only** `programme/autoair.mjs` airing a programme hour produced by `produce.mjs` that passed `airCheck`,
  on the ScoopFeeds YouTube channel, at times DrJ installed with `install-autoair.sh`.
- **Off** unless `RADIO_AUTOAIR_ENABLED` is literally `1`; `~/scoopfeeds-radio/PAUSE` stops it without editing anything.
- **Never covered:** code merges, prod deploys, new formats or segments, changing the clock or the Rule 0 layer,
  credentials, or any other channel. Those stay human-approved.

*Not in force until DrJ approves it and it is added to CLAUDE.md.*
