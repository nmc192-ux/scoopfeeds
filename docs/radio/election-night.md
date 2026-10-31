# Election night on ScoopFeeds Radio (#198)

What the radio does on the night of the US midterms, Tuesday 3 November 2026, in the days after, and in the dress
rehearsal on Sunday 1 November. Code: `backend/src/radio/programme/electionNight.js` (the clock, poll closings, the
updates), `update.mjs` (one 15-minute update), `electionReport.js` (the rehearsal report), wired into the 24/7 loop
(`rollingStation.js`, `rolling.mjs`).

**It is dark until DrJ switches it on**: `RADIO_ELECTION_NIGHT=1` in `~/.scoopfeeds-radio.env`, then restart the
rolling loop. That is step D7 (go / no-go, Mon 2 Nov) in #209. With the flag unset nothing below happens and every
hour is exactly what it was.

## The special: Tue 3 Nov, 6 pm to 3 am New York

That is 23:00 to 08:00 UTC, or Wed 4 Nov 4 am to 1 pm in Karachi. Nine hours. The loop switches to it by the
clock, on its own, and back at 3 am. Each hour of the special runs to its own clock instead of the normal one:

| Time in the hour | What airs |
|---|---|
| :00 | Election update (3 min) |
| :03 | The round-up: the state of the night, the biggest stories, every projection so far |
| :10 | The News, Compared: the biggest race |
| :14 | Music (1 min) |
| :15 | Election update (3 min) |
| :18 | Race by race: the Senate |
| :25 | The rest of the news |
| :28 | Music, then the half-hour ident |
| :30 | Election update (3 min) |
| :33 | Race by race: governors |
| :42 | Music (3 min) |
| :45 | Election update (3 min) |
| :48 | Race by race: the House and control of Congress |
| :55 | Music (3 min), then the sign-off |

No film, no feature, no markets, no weather. Music beds are 3 minutes at most, and the election board is on
screen under them.

**The 15-minute updates.** Each update is made twice. First it is made with the hour, as a placeholder: the poll
closings due in that quarter, the newest projections at that moment, and "counting continues". Then, 6 minutes
before it airs, it is made again on its own from a fresh read of the election coverage and spliced in. If the
fresh update fails its checks, or is not ready 20 seconds before it airs, it is skipped and the placeholder airs
instead, and the hour goes on. When the writer is busy with the next hour (from :15 to :45), the update is read
mechanically: each projection is read word for word as the article reported it.

**Poll closings** are called out by state at their scheduled times, from the race list
(`election/races2026.js`, `LAST_POLLS_CLOSE_ET`). They all fall on the hour or the half hour, so each is read in
the :00 or :30 update. For example: "It is seven o'clock in the evening in New York, and the last polls have closed
in Georgia, Indiana, Kentucky, South Carolina, Vermont and Virginia." The race list's closing times are the
builder's and are **unverified** against each state's election office. They err late, so a call-out comes late
rather than early.

**ScoopFeeds never calls a race.** Every result names the news organisation that projected it, and it must match
a projection that organisation made in an article (the rules of the Midterms desk, #197, in `checks.js`). Where
organisations disagree, both calls are read and the disagreement is named. A withdrawn call is not read. A poll is
never a result. If the writer goes over its daily budget, the special is read by the headline writer. It is never
replaced by a repeat.

## The screens (DrJ approved the mock-ups, 1 Nov)

The election desk and the special's race-by-race blocks show, in order: the **results board**, the **Senate map**,
the latest projections in the outlets' words, then the race pages. Before any projection, the slot ends on the
**countdown** instead. Code: `programme/electionDesk.js` (`summary`, `timeline`, `hotCards`, `mapStates`,
`beforePage`, `windowData`), drawn by `screen/scoopfeeds-radio-programme.html`; state outlines in `screen/usStates.js`
(US Census cartographic boundaries via us-atlas, public domain), served by the playout at `/radio/usStates.js`.

- **Results board.** Senate balance of power: totals are the 65 seats not up this year (32 D and 2 independents who
  caucus with them, 31 R; checked against the 2026 class lists) plus races projected this year where every
  organisation that called it agrees. A disputed race stays "to go". **Flip** = projected winner from the other party
  than the one holding the seat (`SENATE_UP`). Under it: the House as one named organisation's own seat count (we never
  add up districts), governors, and the next poll closing with a countdown. Then six **hot races** (`RADIO_HOT_SENATE`,
  an editorial pick) and **projections as they come in**, newest first, each with its time and who projected it.
  Candidate names appear only once a projection names them; there is no candidate list and no headshots.
- **Senate map.** Real geography. Blue / red only once a named organisation projects the state; grey = not yet
  projected; blue-red hatching = organisations disagree; dark = no Senate race this year.
- **Countdown.** Before the first projection: time to the first poll closing, every closing tonight, the races to
  watch with the party holding each seat, and the Senate going in (47 D with independents, 53 R).
- **The election window.** From 24 hours before the special to the end of the counting days, every hour carries
  `electionWindow` in programme.json: on the headline and music scenes it replaces the rail's markets and weather; beside
  a film it replaces "Watch more"; over a full-frame episode it is a one-line bug. Senate and House totals, the newest
  projection (gold **Just in** for 90 s after its time), the next poll closing. The 15-minute updates refresh it.
  Every word on all of these is at the 26 px floor; `screen/fontFloor.test.js` renders them all.

## The day after: Wed 4 to Fri 6 Nov

From 3 am New York on 4 Nov to the end of Friday 6 Nov, every produced hour has a 3-minute **"Counting continues"**
desk, where the Midterms desk usually sits. It names the races no organisation has projected yet and reads the
projections made since. On 4 Nov, 3 am to 6 am New York is produced, not repeated, so that no pre-results hour is
replayed. After that the normal day clock (repeats overnight) returns.

## The dress rehearsal: Sun 1 Nov, 6 hours, disk only

On the Mac mini, in `~/work/scoopfeeds` (on `main` once this is merged):

```bash
nohup backend/src/radio/playout/deploy/macos/run-election-rehearsal.sh > /dev/null 2>&1 &
tail -f ~/scoopfeeds-radio/election-rehearsal/logs/rolling.log
```

The special starts at the next hour that can still be prepared, at least 30 minutes away. It runs for 6 hours with
the projections in `programme/fixtures/electionNight.fixture.json`: invented results, by party only, timed from the
start of the special. They include a conflict, a withdrawn call, a poll and an unattributed claim, so the checks
are tested too. Poll closings move with the night. **Nothing is streamed and no YouTube broadcast is touched**,
whatever the env file says. The live 24/7 loop is not stopped. `touch ~/scoopfeeds-radio/PAUSE` stops the rehearsal
as well as the live loop.

By default the rehearsal does not start a second playout (Chrome and an encoder) beside the live stream. Dead air
is measured from the mixed audio instead: the air check listens to every hour, and the report checks that the audio
plan covers every second. Pass `--playout` to record the screens as well, `--fake-writer` to make no Claude calls,
or `--hours N`.

**The report** is written to `~/scoopfeeds-radio/election-rehearsal/report.md` and sent to DrJ (Mac notification,
and email when `RADIO_ALERT_EMAIL` and SMTP are set). It gives a verdict of PASS, FAIL or UNVERIFIED (something
could not be measured). It lists every hour (aired or fell back, producing time, air check) and every update
(produced on time, or skipped and why). It also reports dead air, every dropped line, and an attribution audit
that re-checks every electoral line against the projections it was written from. The verdict is PASS only when all
of these are clean and nothing is unmeasured.

## To verify on the Mac

- The rehearsal itself: run it on Sun 1 Nov and read the report (D6).
- Kokoro and the Claude writer shared between the live loop and the rehearsal: how much slower each hour is made.
  The rehearsal's writer calls are counted in its own ledger, but they use the same subscription.
- The poll-closing times and the Senate list in `election/races2026.js` (both marked unverified there).
- Listen to one update and one poll-closing call-out in a rehearsal hour.
