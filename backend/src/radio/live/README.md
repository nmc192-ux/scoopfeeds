# Radio live events desk (#202)

DrJ, 22 Oct 2026: carry live events and speeches **only from official, public feeds** (the body or
person's own stream), plus short credited social clips inside our segments. **Never re-air another
broadcaster's live feed** (CNN, Al Jazeera, BBC…).

> **Do not switch on `RADIO_LIVE_ENABLED`, and do not wire social-clip playback, until #218's pre-air and
> live-delay content-safety gate has landed** (DrJ, 23 Oct 2026). After that, the flag still waits for the
> 5-minute NASA rehearsal on the Mac and DrJ's go-ahead.

| File | What |
|---|---|
| `officialFeeds.js` | The allow-list. DrJ adds entries; the engine may propose one in a PR. `assertCanAir()` is the only gate to air. |
| `feedProbe.js` | Pre-air check: live, public, plays with no login (yt-dlp with no cookies/config, then ffprobe). |
| `eventsCalendar.js` + `events.manual.json` | Scheduled events: the manual file, plus publisher-announced YouTube streams (listed only unless the entry says `schedule: "auto"`). |
| `liveDesk.js` | Grid → `LIVE · <publisher>` at start → grid at end or after 30 s with no media. One attempt per event. |
| `pictureHub.js` | The feed's picture to the screen as in-memory MJPEG on 127.0.0.1. Nothing is recorded or re-hosted. |
| `socialClips.js` | Clips: ≤ 30 s (cap enforced by `trimArgs`), "via @handle on <platform>", only when the post is the story, logged. |
| `liveLog.js` | JSONL log of carries, refusals and clips (`RADIO_LIVE_LOG_DIR`). |
| `cli.js` | `feeds`, `check <url>`, `calendar [--fetch]`, `audit`. |

How a carry works in the playout: one "live feeder" ffmpeg reads the feed (`-re`), writes its sound as
PCM into the encoder's existing audio pipe (the same swap a daypart bed change uses) and its picture
as JPEG frames to `pictureHub`; the screen shows them in the `livefeed` scene. The encoder process,
the RTMP connection and anything simulcast from it are not restarted. If the feed stalls, silence is
fed so the stream keeps moving; after 30 s the desk returns to the grid and the bed takes the audio back.

Playout host needs `yt-dlp` and `ffprobe` on PATH (`brew install yt-dlp`).

Rehearsal (disk only):

```
node backend/src/radio/playout/cli.js --segments-dir /tmp/live-rehearsal --state-file <state.json> \
     --live-now nasa --live-url https://www.youtube.com/@NASA/live --live-minutes 5
node backend/src/radio/live/cli.js audit
```
