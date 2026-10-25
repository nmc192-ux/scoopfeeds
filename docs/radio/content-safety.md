# Content safety: DrJ's media rule (#218)

**The rule (DrJ, 23 Oct 2026), verbatim:** "NO SEXUAL, VIOLENCE and ABUSE, physical or otherwise, ANIMAL HARM and
videos and audio in other such category will ever be allowed."

It is absolute and standing. It covers every video and audio item ScoopFeeds puts out: the radio (live feeds, social
and journalist clips, footage from the public, films, Shorts, features) and any other video or audio surface. There is
no override flag and no "newsworthy" exception. **Loosening it is stop-list item 5** (`docs/engine/full-throttle.md`).

**Scope as built:** the rule bans the *media*: footage, images and audio that show or play sexual content, violence,
abuse (physical or otherwise), harm to animals, or anything of the same kind (gore, the aftermath of injuries). It does
not stop the radio *reporting* such a story in words under the existing story rules.

## Pre-recorded items: one gate

`backend/src/radio/safety/contentSafety.js` → `assertMediaSafe(item, checkers)`. Every clip, film, Short, feature
and item of footage from the public passes it before it can be scheduled.

| Check | How | Threshold |
|---|---|---|
| Pictures | one ffmpeg pass keeps a frame whenever 1 s has passed **or** the scene score is above 0.3; every kept frame goes to the vision check (`claude -p`, subscription) | measured gap between frames ≤ 1.05 s, start and end included |
| Sound | the audio is transcribed (whisper CLI) and the transcript checked (`claude -p`) | explicit "safe" only |
| Sound events | screams, gunshots, … | **no classifier is installed yet**: any file with sound is refused until one is |
| Every check | — | 10 min timeout |

**Honesty rule:** only an explicit "safe" from a check that ran passes. A check that did not run, threw, timed out,
skipped a frame or is unsure is a FAIL. One flagged frame refuses the whole item. Every result is logged (JSONL) with
reasons and timestamps.

A pass writes `<file>.safety.json`, bound to the file's size, SHA-256 and the rule version (`RULE_VERSION`). An edited
file or a new rule version needs a fresh check. The schedulers accept only a valid clearance:

- `programme/autoair.mjs` drops an uncleared film or feature from the hour (and alerts); the rest of the hour airs.
- `programme/airCheck.js` refuses an hour that still contains an uncleared film or feature (the second lock).
- `filmCli.mjs plan` plans only cleared films and Shorts and lists the rest under `notCleared`.

Run it on the Mac:

```bash
cd backend
node src/radio/safety/contentSafetyCli.mjs check <file> [...]   # writes the clearance on a pass
node src/radio/safety/contentSafetyCli.mjs library              # every film and Short in the radio library
node src/radio/safety/contentSafetyCli.mjs status <file>        # is the clearance still valid?
```

Log: `~/scoopfeeds-radio/content-safety.jsonl`.

## Live feeds: a delay buffer

`backend/src/radio/safety/liveSafetyGate.js` → `createLiveSafetyGate({ check, delayMs: 60_000, ... })`. Every live
feed, **official ones included** (a Security Council session or a defence briefing can show war footage), reaches air
only through it.

- A buffered frame or audio chunk is released only after the delay (60 s) **and** once a checked sample at or after it
  is "safe" on every track (video sampled at least once a second; audio in 5 s windows).
- **On a hit** (unsafe, unsure, or a failed check): everything still buffered is discarded, so the flagged frames
  never air; `onCut` switches the playout to the normal grid and the music bed; the feed stays off for the rest of the
  event until DrJ calls `resume()`; the cut is logged.
- **Checker down or behind:** nothing is released; once an item is 10 s past the delay without a verdict, the feed is
  cut rather than aired late.
- `stats().measuredDelayMs` reports the delay actually applied.

**Not wired into the playout yet.** The live events desk (PR #211) owns that code. Before `RADIO_LIVE_ENABLED` can be
switched on, its picture hub and audio feeder must pass through `push()`/`release()` and its `onCut` must cut to the grid.
The same applies to social clips (`socialClips.js`: `assertMediaSafe` before `prepareClip`) and footage from the public (#219).

## What is still to verify on the Mac

- `claude -p` reading frames with the Read tool on the Mac's CLI version (it worked in the cloud session, CLI 2.1.309, on
  synthetic frames: UNVERIFIED on the Mac and on real footage).
- The whisper CLI: which transcriber the Mac has is unknown; until one runs, files with sound are refused.
- A sound-event classifier: none yet, so files with sound are refused (the honesty rule).
- The 30-minute rehearsal on a parliament feed: false-positive rate UNVERIFIED (not measured; the gate is not wired to a live feed yet).
