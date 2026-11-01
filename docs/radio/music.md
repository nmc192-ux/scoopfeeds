# ScoopFeeds Radio — music library and manifest (#208)

**Decision (DrJ, 22 Oct 2026).** Music beds come from the **YouTube Audio Library, "Creative Commons –
attribution required" tracks only**. Those may be used outside YouTube with credit, which covers the X
simulcast. Standard Audio Library tracks are licensed for YouTube only and **must not be used**, because the
same stream goes to X. No ElevenLabs or other AI-generated music, ever: the stream must never contain
anything that would require YouTube's "altered or synthetic content" setting.

**Who selects.** A Claude session with browser access to the Mac (Claude in Chrome or the desktop app's
browser, logged in to YouTube Studio) selects and downloads the tracks. The engine's headless runs never do.
This page is for that session.

## What to pick

- 20 to 30 tracks, instrumental only, no vocals.
- Calm, news-style moods (for example Calm, Inspirational, Bright, Dramatic used lightly). No comedy, no
  horror, no heavy drops.
- In Studio: **Audio Library > Filter > License type > "Creative Commons"**. Every track must show
  "Attribution required". Skip any track without it.
- Spread them across the four dayparts (US Eastern time): `morning` 05:00–09:30, `markets` 09:30–16:00,
  `evening` 16:00–24:00, `overnight` 00:00–05:00.

## Where the files go (on the Mac mini)

```
~/scoopfeeds-radio/music/
  manifest.json
  morning/    <track>.mp3
  markets/    <track>.mp3
  evening/    <track>.mp3
  overnight/  <track>.mp3
```

(`RADIO_MUSIC_DIR` overrides the folder. On the VPS layout it is `$SCOOP_PERSISTENT_DATA_DIR/radio/music/`.)
If loudness copies are made (`backend/src/radio/normalizeMusic.mjs` writes `<name>.norm.mp3` beside each
file), a copy airs under its original's manifest entry, and only while the original file is still there,
unchanged. The playout also levels every bed itself, so the copies are optional.

## manifest.json

One entry per **downloaded** file (not per `.norm.mp3`):

```json
{
  "tracks": [
    {
      "file": "evening/calm-river.mp3",
      "title": "Calm River",
      "artist": "Example Artist",
      "licence": "Creative Commons Attribution 4.0",
      "credit": "Calm River by Example Artist is licensed under a Creative Commons Attribution 4.0 license. https://creativecommons.org/licenses/by/4.0/",
      "downloaded": "2026-10-24",
      "sha256": "<64 hex characters: shasum -a 256 evening/calm-river.mp3>",
      "source": "YouTube Audio Library"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `file` | Path relative to the music folder, with its daypart folder. |
| `title`, `artist` | As the library lists them. They make the on-screen credit "Music: Artist – Title". |
| `licence` | Must be Creative Commons **attribution**, and not NonCommercial. |
| `credit` | The library's credit text **exactly as it gives it** (copy it from the track's licence pop-up). It is pasted into the YouTube description and the X text unchanged. |
| `downloaded` | The date the file was downloaded (`YYYY-MM-DD`). |
| `sha256` | Of the downloaded file. A file edited or swapped later no longer matches and stops airing. |
| `source` | Optional; if present it must say "YouTube Audio Library". |

## What the playout does with it

- **Refuses** a bed with no entry, an incomplete entry, a licence that is not CC attribution, a NonCommercial
  licence, anything naming an AI music tool (ElevenLabs, Suno, Udio, ...), or a file whose sha256 no longer
  matches. The refusal is logged; it is never "repaired".
- With **no** cleared bed at all (for example before the library is loaded), the radio uses the
  **procedural bed** (`backend/src/radio/proceduralBed.js`): a quiet pad synthesised by ffmpeg from sine
  waves, no AI model, no samples, no licence. It is a fallback only.
- **Credits:** every track an hour airs is listed in that hour's YouTube broadcast description and in
  `~/scoopfeeds-radio/x-broadcast.txt` (paste into X Media Studio), in the library's exact wording. During
  music breaks the screen shows a small "Music: Artist – Track" credit. This is a standard music credit, not
  an AI label. For the 24/7 stream (whose description is set by hand), run
  `node backend/src/radio/safety/broadcastText.mjs` after any library change and paste the two files it writes.
- **Looping a bed (1 Nov 2026).** A produced hour loops one bed per daypart under the whole hour. The loop runs
  on a copy with the near-silent start and end removed (below -40 dB) and a 0.3 s fade at each end, kept in
  `<music dir>/.loop-cache/` (outside the daypart folders, so it is never listed as a track). Atlantean Twilight
  ends in 7.3 s of silence; looped as it was, that tail came round every ~3 minutes as dead air from 25 Oct, and
  the listen-back (#273) refused every hour from 31 Oct. The credit, the loudness and the manifest entry are the
  original file's. The mix also runs through a peak limiter at -1 dBFS (`assemble.js` `makeLimiter`).
- **A credit is never cut.** When the credits do not fit a platform's limit, whole credits give way to a link
  to the full credits page (`RADIO_MUSIC_CREDITS_URL`); with no page, nothing is published. Setup steps:
  `docs/radio/safety.md` §1.

Code: `backend/src/radio/musicManifest.js` (the rules), `musicLibrary.js` (`listBeds` applies them),
`playout/playout.js` (`chooseBed`, the credit), tests in `backend/src/radio/safety/safety.test.js`.
