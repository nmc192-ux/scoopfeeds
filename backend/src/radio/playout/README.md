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
- Crash handling: Chromium, encoder, feeder or node dying restarts the unit (1 s doubling backoff to 60 s; launchd restarts node).
- Test-only: `--force-daypart-cycle SEC` (refused with RTMP).
- Known limitation: the RTMP URL, which contains the stream key, is an argument of the ffmpeg process, so other local processes of the same user can read it with `ps`. Logs are redacted; process listings are not.
- Linux: run `run-playout.sh` from a systemd unit with `Restart=always` (drop the `caffeinate` line).
