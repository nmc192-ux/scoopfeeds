# Radio playout (R3, file output only)

Captures `/radio/screen?broadcast=1&state=<state.json url>` in headless Chromium and mixes it with the
current Eastern-daypart music bed (`musicLibrary.pickBed`) into 1080p30 H.264 + AAC.

```
node backend/src/radio/playout/cli.js --out test.mp4 --seconds 120 --music-dir <dir> \
     [--state-file state.json | --base-url https://host] [--demo-cycle 15]
```

- Without `--base-url` the playout serves the template and `state.json` itself on 127.0.0.1.
- `--demo-cycle N` switches scenes every N s (test renders only; air relies on the feed's own scene).
- No `--out` selects RTMP, which needs BOTH `RADIO_PLAYOUT_ENABLED=true` and `RADIO_STREAM_KEY`; otherwise it refuses.
- Needs `playwright-core` (+ its Chromium) and `ffmpeg` on the host. They are NOT in `backend/package.json`:
  `Dockerfile.dev` here builds an image with both for tests and renders.
- Live mode restarts the Chromium+ffmpeg unit with 1 s→60 s backoff, and onto a new bed at each daypart change
  (a few seconds of dead air on the stream at each boundary: unverified against YouTube).

## Always-on on a Mac (launchd) - R3 Phase B

`deploy/macos/`: `install.sh` (user LaunchAgent, no sudo; `install.sh uninstall`), `run-playout.sh` (launcher), `phase-c-check.sh`.

- Output is `--segments-dir`: a ring of 10 x 60 s MPEG-TS files (~350 MB), so the disk cannot fill. RTMP only when `~/.scoopfeeds-radio.env` (mode 600; the launcher refuses anything else) sets `RADIO_PLAYOUT_MODE=rtmp`, and the playout itself still needs BOTH `RADIO_PLAYOUT_ENABLED=true` and `RADIO_STREAM_KEY`.
- Browser: Playwright's pinned Chromium by default (`npm install` + `npx playwright-core install chromium` in this folder). `RADIO_PLAYOUT_CHROME=system|<path>` selects installed Chrome.
- Live units feed the bed to the encoder as PCM from a separate "feeder" ffmpeg. A daypart change swaps the feeder: the encoder, the video and the RTMP connection are not restarted (hard cut between beds, no crossfade). If a swap fails, a planned restart runs with no crash backoff.
- Crash handling: Chromium, encoder, feeder or node dying restarts the unit (1 s doubling backoff to 60 s; launchd restarts node). A dead RTMP link is detected in ~7.3 s (`-rw_timeout 7 s` + killing ffmpeg on its first muxer write error).
- Test-only: `--force-daypart-cycle SEC` (refused with RTMP).
- Known limitation: the RTMP URL, which contains the stream key, is an argument of the ffmpeg process, so other local processes of the same user can read it with `ps`. Logs are redacted; process listings are not.
- Linux: run `run-playout.sh` from a systemd unit with `Restart=always` (drop the `caffeinate` line).

## YouTube + X together (#207)

- Destinations are data: `../live/destinations.js` (YouTube and X, both primary; Facebook and Twitch deferred by DrJ on 22 Oct).
- X is added only when `RADIO_X_ENABLED=true` AND `RADIO_X_STREAM_KEY` AND `RADIO_X_RTMP_URL` are set, on top of YouTube's two gates.
  With X off, the encoder's command line is byte-identical to the single-output one (pinned by `live/destinations.test.js`).
- With X on, the encoder writes FLV to stdout once, and `../live/fanout.js` runs one `-c copy` relay ffmpeg per destination.
  A dead link, a crash or a stalled uplink (more than ~7 s of data queued) takes down only that relay, which reconnects
  with backoff (1 s doubling to 30 s) and rejoins at the next keyframe. YouTube is never restarted because X failed, or the reverse.
- Per-destination status (live / connecting / reconnecting / shed / restarting / off) goes to `--status-file`
  (`~/scoopfeeds-radio/outputs.json` for the 24/7 radio; `<hour>/outputs.json` for an auto-aired hour, whose
  `status.json` carries the summary as `outputs`). An alert goes out only when a primary is down for over 5 minutes.
- Priority: when a primary backs up or stalls, secondary outputs are dropped first for 10 minutes. With YouTube + X only,
  there is nothing to drop. Platform duration caps (`maxDurationSec`) restart that output at a programme part or daypart
  boundary; neither YouTube nor X "start immediately" has a cap.
- The relays' command lines contain their own URL + key, so the `ps` limitation above applies to each of them.

### Upload bandwidth (path a: direct, or b: VPS relay)

Two 1080p outputs need about 10.2 Mbps, 14.3 Mbps with the 40% headroom DrJ set (720p: 8.1 Mbps).
On the Mac, run `bash deploy/macos/measure-upload.sh 8 180` (8 samples, 3 h apart), then `node ../live/bandwidth.js`.
It judges on the worst sample: `direct` = the Mac sends both itself (what is built here); `relay` = recommend the
VPS relay, which changes the server (stop-list item 2, needs DrJ; not built); `unverified` = fewer than 4 samples.

### DrJ's one-time steps for X

1. Take the X subscription that live streaming needs (DrJ said he is doing this).
2. X Media Studio > Producer: create a source, choose **start immediately** (scheduled broadcasts stop at 6 hours),
   copy the RTMP URL and the stream key.
3. In `~/.scoopfeeds-radio.env` (mode 600): `RADIO_X_RTMP_URL=<url>`, `RADIO_X_STREAM_KEY=<key>`, `RADIO_X_ENABLED=true`.
4. Restart the radio (`launchctl kickstart -k gui/$(id -u)/com.scoopfeeds.radio`) and check `~/scoopfeeds-radio/outputs.json`
   shows both `youtube` and `x` as `live`.
## Live official feeds (#202)

Dark unless `RADIO_LIVE_ENABLED=true`. At an event's start the unit swaps its audio feeder for a live feeder
(official feed's sound) and shows the feed's picture in the `livefeed` scene with `LIVE · <publisher>`; at the end, or
after 30 s with no media, it swaps back to the bed. Encoder and RTMP untouched. Only allow-listed feeds can air:
see `../live/README.md`. Rehearsal: `--live-now <feed id> --live-url <url> [--live-minutes 5]` with `--segments-dir` (refused with RTMP or `--out`).
