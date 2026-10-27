# Developing and breaking stories on ScoopFeeds Radio (#201)

DrJ, 22 Oct 2026: cover new and emerging stories like a TV newsroom. This page says how it works as built, what is
measured and what is not. It ships **dark**: nothing changes on air until `RADIO_DEVELOPING_ENABLED` is set.

## How it works

1. **Detect (the VPS, every ~5 minutes).** The radio cycle on the worker (`backend/src/radio/developing.js`) looks at
   every active event in the event graph that gained articles recently. An event **fires** when, in the last 30
   minutes, it gained at least 4 articles from at least 3 different outlets, and that is at least 3 times its own rate
   over the 6 hours before. A brand-new event has no "before", so the 4-from-3 floor decides. A long story with a
   steady trickle does not fire; the same story suddenly surging does.
   - Every article passes the radio's Rule 0 layer first (D1, Pakistan politics, Indian outlet on Pakistan, critical
     of Pakistan, soft news). Opinion pieces and duplicates do not count.
   - The radio's LLM judge does not run here, so an event with **any** Pakistan signal is dropped whole (fail closed).
   - Machine events (USGS/NOAA) count only once they have articles.
   - The list is served at `GET /api/radio/developing.json`. Its headline for each event is an outlet's own title,
     never the event graph's title.
2. **Air (the Mac, the rolling loop).** The developing desk (`programme/developingDesk.js`) reads the list every 2
   minutes. For a firing event it finds the next segment boundary in the hour on air (or the next hour, if it is
   already produced) that is at most **15 minutes after the event was first seen**, and at least 4 minutes away so
   the bulletin can be produced. `programme/bulletin.mjs` writes, checks, voices and mixes a ~75-second bulletin and
   splices it into `programme.json`; the playout picks it up on its own. The slot that starts at that boundary gives
   way: the bulletin, then headlines and music, and the grid resumes at the next segment (the grid's override rule).
   - On screen: the story card with a red **BREAKING** banner, the kicker "Developing story", the outlets' own
     headline and lede, and the outlets that report it.
   - Words: "This is a developing story on ScoopFeeds Radio.", then 2-4 lines, then "We will follow this story in our
     headlines." The opening and closing are fixed, never the model's. A line counts as **confirmed** only when it
     names two or more of the outlets that report the story; every other line must say it is unconfirmed. A line
     that names no outlet, or states a one-outlet fact without saying so, is dropped (`checkBulletin`), as is any
     line that fails the hour's own checks (Rule 0, figures, quotes, the election rules). If nothing survives, no
     bulletin airs.
   - Writer: Claude when the hour's producer is not using it and the day's writer budget allows; otherwise the
     mechanical headline writer (each outlet's own headline, attributed and labelled unconfirmed).
3. **Follow up.** A story that aired keeps leading the next hours' headlines (`produce.mjs --developing`) for up to 6
   hours, while it still gains at least 2 articles an hour.
4. **Limits.** Never two interruptions less than 20 minutes apart (by air time, across hours and restarts). One
   bulletin per event per 6 hours. A **sensitive** story (the radio's existing sensitivity switch,
   `isRadioSensitive`) is read with **no music bed and no sting**. Nothing airs when the 24/7 headline screen is on
   (a failed hour); a story that cannot make its 15-minute window is not aired late, and is recorded as missed in
   `~/scoopfeeds-radio/developing/state.json`.

A refresh of the hour at :30 (`produce.mjs --from`) keeps any bulletin already spliced in. `programme.json` is written
under a short lock (`programme.lock`) by both the producer and the bulletin.

## Switching it on

| Where | Setting |
|---|---|
| VPS | `RADIO_DEVELOPING_ENABLED=1` (with `RADIO_ENABLED=true`) |
| Mac mini | `RADIO_DEVELOPING_ENABLED=1` in `~/.scoopfeeds-radio.env`, then restart the rolling loop |

Turning it on airs a new segment format automatically. The auto-air exception (#193) does not cover new formats,
so that switch is DrJ's.

## Rehearsal: a fake fast-growing event

```bash
cat > ~/scoopfeeds-radio/fake-developing.json <<'EOF'
{ "events": [ { "id": "rehearsal-1", "fires": true, "follow": true, "sensitive": false, "kind": "new",
  "headline": "Rehearsal: large fire at a port warehouse, roads closed",
  "recent": { "articles": 6, "outlets": 3 },
  "outlets": [ { "source": "Outlet A", "title": "Rehearsal: large fire at a port warehouse, roads closed", "description": "Rehearsal text." },
               { "source": "Outlet B", "title": "Rehearsal: port fire closes roads", "description": "Rehearsal text." } ] } ] }
EOF
node backend/src/radio/programme/rolling.mjs --hours 2 --developing-file ~/scoopfeeds-radio/fake-developing.json
grep developing ~/scoopfeeds-radio/logs/rolling.log      # detected -> slot and time; "inserted"
```
The file has no `updatedAt`, so it counts as fresh on every read and the event is first seen when the loop starts.
The bulletin's folder record is `~/scoopfeeds-radio/air/<hour>/developing-<time>.json`; the recording is in
`rehearsal-seg/`.

## GROUND: the thresholds (to run on a prod snapshot)

The defaults above are a starting point, **not measured on prod data**. To set them:

```bash
cd backend && node scripts/pull-prod-db.mjs            # a subset copy; never the live file
node src/radio/developingReplay.mjs --db <copy>.db --day 2026-10-26 --json /tmp/dev-replay.json
node src/radio/developingReplay.mjs --db <copy>.db --day 2026-10-26 --min-outlets 4 --growth 4   # try others
```
The replay opens the database read-only and prints, for that day, every bulletin that would have fired: when it was
detected, when it would have aired, which segment it displaces, its articles and outlets in the window, its growth
over the baseline, and its headline. It assumes a produced hour is on air every hour and uses each hour's base
clock. Paste the table into the PR; pick the thresholds that fire on the day's real breaking stories and not on
steady ones.
