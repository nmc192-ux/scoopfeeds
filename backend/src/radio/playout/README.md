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
