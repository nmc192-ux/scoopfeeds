# Shot engine — reference implementation

The Python/OpenCV engine that rendered the approved Greenland sample short
("Greenland pact: signed, not sold", 61 s, 1080x1920, 23 Sep 2026). This is the
target format described in `docs/briefs/shot-engine-shorts.md`.

Kept verbatim as a reference for Phase 4 (vertical shot renderer) and Phase 5
(sound). It is not wired into the pipeline and is not run by any process.

- `vengine.py` — shared primitives: text patches, blit, easing, and the shot classes
  (`Photo`, `Video`, `SatZoom`, `MapShot`, `Card`, `Kinetic`, `Quote`, …). Written for the
  longform film engine; `short.py` re-sets it for 9:16.
- `short.py` — the Greenland short: vertical chrome (kicker / source / credit / brand at the
  safe-zone positions), `Clip` (moving 9:16 crop over 16:9 footage with a banner `ymax`),
  `VCard`, `Punch`, the word-anchored shot list (`at(phrase)` raises if the phrase is not in
  the narration), and word-by-word captions. Modes: `plan`, `preview`, `render`.
- `mix_short.py` — voice + music bed with envelope ducking, synthesised whoosh/impact SFX on
  cuts, two-pass loudnorm to -14 LUFS.

Not included (the scripts expect them beside them at run time): `fonts/` (Anton, Inter,
Oswald, IBM Plex Mono, Libre Baskerville), `sat/` Esri tile mosaics + `meta.json`, `geo/`
Natural Earth 50m GeoJSON, `align.json` (ElevenLabs word timings), and the fetched media.
