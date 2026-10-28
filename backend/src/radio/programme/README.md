# ScoopFeeds Radio — produced programme hours

A **programme** is one produced hour of ScoopFeeds Radio: a fixed clock (`clock.js`), scripts written from the live
feed, voiced by Kokoro "George", mixed with the beds and the Signal idents into one audio file, plus a cue sheet the
programme screen (`../screen/scoopfeeds-radio-programme.html`, Signal identity) plays by its own clock.
The 24/7 playout is unchanged unless it is started with `--programme`.

```
produce.mjs   facts (factPack.js) -> scripts (writer.js, claude -p sonnet) -> checks.js -> voice + mix + cues (assemble.js)
              writes <out>/programme.json + part-<slot>.wav (+ film.webm, feature.webm)
playout       cli.js --programme <out>: serves the programme screen, swaps its audio feeder onto each part at its start
              (seeking to "now"), and stops at the programme's end (60:30)
```

**Facts.** Only what is in `pack.json` may be said: top stories from the radio feed with every outlet that covered
them, four desks, markets (Yahoo chart API + CoinGecko) and weather (scoopfeeds.com). Every article passes the
radio's Rule 0 layer before the writer sees it. `checks.js` then drops any line with a figure, outlet or quote not
in the pack, any Pakistan-politics line, and any sentence about our own sourcing. Dropped lines are listed in
`checks.json`. On-screen text (headlines, outlet names, ledes) is always taken verbatim from articles, never from
the model.

## The channel grid (#200)

`grid.js` is the 24-hour grid as data (dayparts, the fixed 9 pm ET film slot, the segment catalogue, the screen
elements, the exchange sessions); `docs/radio/channel-grid.md` is the same grid in plain English, and `grid.test.js`
fails when they disagree. `clock.js buildGridClock()` builds an hour as an instance of the grid; `produce.mjs --grid`
(or `RADIO_GRID_ENABLED=1`) uses it, otherwise the running order above is unchanged. `grid.applyOverride()` cuts the
segment on air for breaking news or a live event and resumes at the next segment boundary.
`../screen/fontFloor.mjs --shots <dir>` measures every scene of both screens (26 px floor) and takes the screenshots.

## Unattended hours (auto-air)

`autoair.mjs` runs a whole hour with nobody at the desk: produce, air check (`airCheck.js`), YouTube broadcast
(`../live/youtubeLive.js`), hand-over from the 24/7 radio, playout, stream watch, wrap-up. Fired by launchd:
```bash
backend/src/radio/playout/deploy/macos/install-autoair.sh 20:14     # 8:14 pm Mac time -> the 9 pm hour
tail -f ~/scoopfeeds-radio/air/<hour>/autoair.log                   # each hour has its own folder + status.json
touch ~/scoopfeeds-radio/PAUSE                                      # skip hours until removed
```
Rehearsal unless `RADIO_AUTOAIR_ENABLED=1`. Settings: `docs/reference/env_reference.md` (RADIO_AUTOAIR_*, RADIO_YT_*,
RADIO_ALERT_EMAIL). Plan and the standing-approval draft: `docs/radio/autonomous-newsroom.md`.

## 24/7: every hour (rolling.mjs, #195)

`rolling.mjs` is one process that owns the air around the clock: it prepares hour N+1 while hour N airs, refreshes
hour N at :30 when the top story changed, and hands over at :59. The day clock (`dayClock.js`) decides produced vs
overnight repeat; `repeat.js` retimes the strongest recent hour and `produce.mjs --from the-hour --to markets-1` splices
a fresh top of the hour into it. The repeated hour's own Markets Now is re-checked at the repeat's air time (#249): a slot
with a line that would read a closed market as today's move, or whose lines cannot be read, is cut to that hour's own
music bed, and `airCheck` re-checks every Markets slot left on air from `repeat-source-*.json`. A failed hour airs the 24/7 headline screen; `PAUSE` takes the stream off air within
30 s (#208), never onto the headline screen. Films go through `pickClearedFilm()`, the title through `factualTitle()`,
and the broadcast description and `~/scoopfeeds-radio/x-broadcast.txt` carry the music credits, as in autoair. Writer calls are counted in each hour's
`writer.json` and `status.json` and in `~/scoopfeeds-radio/writer-calls/<date>.json`.
```bash
backend/src/radio/playout/deploy/macos/install-rolling.sh         # kept alive by launchd; rehearsal until both flags are 1
tail -f ~/scoopfeeds-radio/logs/rolling.log
```
Gates, flags and the plan: `docs/radio/autonomous-newsroom.md` (Stage 2), `docs/reference/env_reference.md` (RADIO_ROLLING_*).

## Developing stories (#201)

With `RADIO_DEVELOPING_ENABLED=1` (VPS and Mac), the rolling loop's developing desk (`developingDesk.js`) reads
`/api/radio/developing.json` (events new or surging in the event graph, `../developing.js`) every 2 minutes and
splices a "Developing" bulletin (`bulletin.mjs`: BREAKING banner, confirmed vs unconfirmed lines) into the hour on air
at the next segment boundary within 15 minutes; never two inside 20 minutes; no bed under a sensitive story. Aired
stories that keep growing lead the next hours' headlines (`produce.mjs --developing`). Rehearsal:
`rolling.mjs --developing-file FILE`. Replay of a recorded day: `../developingReplay.mjs`. Plain English:
`docs/radio/developing.md`.

## Tuesday 13 October 2026 — test hour, 9:00 to 10:00 pm PKT (H = 16:00 UTC)

All on the Mac Mini, in `~/work/scoopfeeds` on branch `feat/radio-test-hour`.

**Once:**
```bash
cd ~/work/scoopfeeds && git fetch && git checkout feat/radio-test-hour && git pull
cd backend/src/radio/playout && npm ci && cd ../../..          # playwright-core for the playout
~/sixty/kokoro-start.sh &                                        # Kokoro on 127.0.0.1:8880 (leave running)
```
Put the A-Eye #003 episode (the published 4K or 1080p file) in `~/scoopfeeds-radio/feature/`. The film slot
(#216) takes only a Short cut from a published long-form film, imported into the film library with its parent
(`node src/radio/filmCli.mjs import --file <short.mp4> --series a-eye --parent a-eye/<ep> ...`); ScoopFeeds 60
never airs while `RADIO_ALLOW_SF60` is off, and with no eligible Short the slot is headlines and music. The A-Eye file was hand-published from the VPS:
`ssh scoopfeeds-vps 'ls ~/publish'` to find it.

**Rehearsal (10:00 am, for an 11:00 am hour, H = 06:00 UTC):**
```bash
launchctl bootout gui/$(id -u)/com.scoopfeeds.radio 2>/dev/null   # the 24/7 agent must not run at the same time
export VIDEO_TTS_PROVIDER=kokoro VIDEO_TTS_KOKORO_URL=http://127.0.0.1:8880
node src/radio/programme/produce.mjs --hour 2026-10-13T06:00:00Z --out ~/scoopfeeds-radio/rehearsal \
  --music-dir ~/scoopfeeds-radio/music --film ~/scoopfeeds-radio/film/<film>.mp4 \
  --feature ~/scoopfeeds-radio/feature/<a-eye-003>.mp4 --feature-title "A-Eye #003: The AI boom is running on borrowed money"
# start the playout before 10:45 (the countdown); it records the whole hour and stops itself at 12:00:30
RADIO_PLAYOUT_CHROME=system node src/radio/playout/cli.js --programme ~/scoopfeeds-radio/rehearsal \
  --segments-dir ~/scoopfeeds-radio/rehearsal-seg --segment-keep 80 --music-dir ~/scoopfeeds-radio/music
```
Check: `checks.json` (what was dropped), the ping on 11:00:00 in the recording, speech above the bed, A/V sync in an
ident (set `RADIO_PROGRAMME_AV_DELAY_MS` to the measured picture lag, default 300).

**Air (Tuesday evening):**
```bash
# 8:30 pm — produce (takes ~10 min)
node src/radio/programme/produce.mjs --hour 2026-10-13T16:00:00Z --out ~/scoopfeeds-radio/air ...same flags...
# 8:40 pm — check ~/scoopfeeds-radio/air/checks.json and programme.json exist
# 8:45 pm, on DrJ's "go" — RTMP needs BOTH gates from ~/.scoopfeeds-radio.env (never print the key)
set -a; . ~/.scoopfeeds-radio.env; set +a
RADIO_PLAYOUT_CHROME=system node src/radio/playout/cli.js --programme ~/scoopfeeds-radio/air --music-dir ~/scoopfeeds-radio/music
# 9:20 pm (optional refresh of the second half; switches at the 9:27 music block)
node src/radio/programme/produce.mjs --hour 2026-10-13T16:00:00Z --out ~/scoopfeeds-radio/air --from series ...same flags...
```
The playout stops by itself at 10:00:30 pm. Afterwards, reload the 24/7 agent:
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.scoopfeeds.radio.plist`.

**Fallbacks.** No programme audio yet at a part's start: the bed keeps playing. A segment whose lines were all
dropped: headlines and music. Producer failure: run it again (it is idempotent); if it cannot finish by 8:55 pm, run
the 24/7 playout instead (visual radio, no voice).

## The Midterms desk (#197)

`RADIO_ELECTION_DESK=1` adds "The Midterms" (180 s at 14:00, the first half of music-1) to every produced hour from
26 Oct to 6 Nov, New York time. `electionPack.js` reads tracked articles of the last 6 hours and keeps, sentence by
sentence, only projections a NAMED organisation made ("AP projects ..."), withdrawn calls, projected House tallies,
and counted shares the article states; polls, leads and unattributed "X won" are never items. Conflicting
projections stay side by side. `checks.js` drops any line, in any segment, that says someone won without the
organisation that projected it (and a matching item in the pack), reads a poll as a result, or gives a partial
count without how much is in ("counting continues" otherwise). Until the first polls close on 3 Nov the desk also
reads a mechanical "what's on the ballot" line set (Senate / governors / House, rotating by hour) from
`../election/races2026.js` (shared with the #204 map). The board (`election` scene) shows only when the pack has
at least one attributed item: control bars count projected races only, every called race says "Projected by
<outlet>", the rest "Not yet called", and the latest projections are quoted verbatim with their outlet. At the
26 px screen floor a full night cannot fit one screen, so the board is paged (`boardPages()` in `electionDesk.js`):
an overview (Senate bar, House), the latest projections, then the called races three columns at a time with the
uncalled ones listed by name. The pages share the desk from the first projection line to the slot's end, at least
8 s each, and nothing else interrupts them. `screen/fontFloor.test.js` renders a worst-case full board
(`screen/fixtures/sampleElection.mjs`) and fails on any text under 26 px or past the frame.

## Election night (#198)

With `RADIO_ELECTION_NIGHT=1` (Mac, dark by default) the rolling loop switches by the clock to the election night
special, 3 Nov 18:00 ET to 4 Nov 03:00 ET (`electionNight.js` `stationPlan`, `buildSpecialClock`): a round-up at the
top of the hour, "The News, Compared" on the biggest race, race-by-race blocks, music beds of 3 minutes at most, and
an update slot at :00, :15, :30 and :45. Each update is produced with the hour as a mechanical placeholder (poll
closings due in that quarter, the newest projections, "counting continues"), then re-produced 6 minutes before it airs
by `update.mjs` from a fresh election pack and spliced over the placeholder (`insertUpdate`). One that fails its
checks or misses its window is skipped: the placeholder airs. Poll closings come from `../election/races2026.js`
`LAST_POLLS_CLOSE_ET`. Until the end of 6 Nov (New York), produced hours carry a "Counting continues" desk in place
of the Midterms desk. The dress rehearsal is `rolling.mjs --election-rehearsal` (wrapper:
`../playout/deploy/macos/run-election-rehearsal.sh`): the same night moved to the next hour, fixture projections
(`fixtures/electionNight.fixture.json`), disk only, then `report.md` (`electionReport.js`). Plain English:
`docs/radio/election-night.md`.

