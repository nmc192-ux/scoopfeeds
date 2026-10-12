# ScoopFeeds Radio — brand resources

Approved by DrJ on 12 Oct 2026 ("all three are good to go; change as we go").
These are the source of truth for the radio's identity. Change them here, not in copies.

## Identity: "The Signal"

- **Symbol:** a red dot inside a ring on a navy disc (an on-air light / a signal).
  Used alone for the YouTube avatar, the on-screen corner mark and notifications.
- **Wordmark:** `ScoopFeeds` in Bodoni Moda (roman, 500) + `Radio` in Bodoni Moda italic, red.
- **Palette:** ink `#111111` · paper `#F4EFE6` · signal red `#D7261E` (on dark: `#FF4A3D`) · navy `#0F2238`.
- **Type:** Bodoni Moda for the name, headlines and show titles; Schibsted Grotesk for labels,
  clocks, tickers and data. Both are Google Fonts.
- Sheet: `identity-sheet.png`. The design canvas ("ScoopFeeds Radio — Logo & Promo",
  board "Combined identity") holds the editable version.

## Idents

| File | Length | Ground | Runs |
|---|---|---|---|
| `idents/signal-id.mp4` | 8 s | navy | after every programme |
| `idents/signal-top.mp4` | 10 s | ink | at :59:56, into the top-of-hour news |
| `idents/signal-sting.mp4` | 3 s | paper | between segments, into and out of breaks |

All three build the symbol in the same order: the red dot appears with a sonar **ping**, the ring
draws, the disc forms, then the wordmark rises. `idents/signal-idents.html` is the source
(`?mode=id|top|sting`, `window.renderAt(t)` draws any frame). The MP4s were rendered from it at
1080p30.

**4K masters:** `idents/4k/signal-{id,top,sting}-4k.mp4` are 3840×2160, 30 fps, H.264 High.
They come from the same source at 2× pixel density and carry the same audio as the 1080p files.
Use them for YouTube uploads, trailers and any re-edit. The 1080p files are what the live stream
plays. `identity-sheet@2x.png` (3680×3400) is the print/press version of the sheet.

**Live use:** the top-of-hour ident in the MP4 shows a sample time (09:00 New York). On air it
must be drawn by the radio screen with the real clock — port `signal-idents.html` into the
screen as a scene; play `sonic/signal-top.wav` so its ping lands exactly on :00:00.

## Sonic logo

`sonic/*.wav` (48 kHz stereo) match the MP4s. The signature is a sonar ping (E6) followed by
a rising A–C♯–E on a soft electric piano, resolving on an A major chord. In the top-of-hour
version four soft ticks count down and **the ping is the hour signal**. Keep the ping identical
across every ident — it is what listeners learn to recognise.
