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
| Air check | the hour airs only if the files are there, it is the right hour, at least 60 % of written lines passed the fact checks, The Hour has at least 3 checked stories, and any film or feature has a content-safety clearance (#218, `docs/radio/content-safety.md`). Anything unmeasured fails | `programme/airCheck.js` |
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

## X (X Live Studio)

X is the second live output beside YouTube (#207), dark until the D4 rehearsal (`RADIO_X_ENABLED` unset). The Mac
has `RADIO_X_RTMP_URL` and `RADIO_X_STREAM_KEY` from a Live Studio **source** on the ScoopFeeds account (Plus plan).

**The 24-hour cap (#220).** X Live Studio replaced Media Studio Producer on 1 Jul 2026. Its help page says
"Livestreams have a maximum duration of 24hours" ([help.x.com/en/using-x/live-studio](https://help.x.com/en/using-x/live-studio),
read 24 Oct 2026). So `live/destinations.js` gives X `maxDurationSec: 86400` (YouTube stays `null`). The fan-out marks
the X relay due for a restart 10 minutes before the cap, restarts it at the next programme-part or daypart boundary,
and forces it 60 seconds before the cap if no boundary comes. YouTube is never touched by an X restart.

**What X does after a restart: a new livestream has to be created by hand, as far as X's own pages say.**
The relay restart only reconnects to the same source. X's help page says:

- a source is reusable ("A single source can be reused across multiple livestreams"), but carries one livestream at a time;
- a livestream ends by itself when its source stops sending ("Your livestream ended automatically because the source
  stopped sending video");
- an ended or timed-out livestream cannot be restarted ("Timed-out livestreams cannot be restarted and must be recreated");
- a livestream is created in Live Studio with **New Livestream → (pick the source) → Now / Go Live**, or scheduled with
  **Later**, which has auto-start settings. Creating it does not post it; pressing Go Live posts it.

Nothing on those pages says X starts a new livestream on its own when a source starts sending again. So, until the
rehearsal shows otherwise, plan on this: **once a day someone must create a new X livestream in Live Studio**
(New Livestream → the ScoopFeeds source → Now → Go Live), after the X relay restart. Between the cap and that click, the
relay keeps sending to the source, but nothing is on X. Two things follow from X's wording, both unverified:

- a planned restart is a short disconnect; if X ends the livestream as soon as the source goes quiet, the restart itself
  ends that day's X livestream (at a programme boundary rather than at a random point, which is the point of #220);
- an unplanned relay reconnect (a dropped link) may end the X livestream the same way.

A scheduled livestream (**Later**, auto-start on) on the same source may let the next day's stream be set up in advance,
but a source carries one livestream at a time, so whether that works while today's is still live is also unverified.

**Not automated, on purpose.** Nothing in the code creates, schedules or posts an X livestream. Doing that through any
route DrJ has not approved is a new automated post type, which is on the stop list (`docs/engine/full-throttle.md`).

**To verify on the Mac (D4 rehearsal), and record here:**
1. With a livestream live, stop the X relay for ~5 s and let it reconnect: does the livestream stay live, or end?
2. After a livestream has ended, start sending to the same source: does X start a new livestream by itself? (Expected: no.)
3. Can a **Later** livestream with auto-start be created on the source while another livestream on it is live?
4. Watch the first real 24 h cap: when did the restart happen, and was the old livestream ended by X or by the restart?

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
