# Radio election map (#204)

A red/blue **tile map** (one square per state) for the 3 Nov 2026 midterms, plus Senate and
House control bars and a governors view. Dark behind `RADIO_ELECTION_MAP_ENABLED=true`.

| File | What |
|---|---|
| `races2026.js` | Which states have a Senate / governor race, seats not up, tile layout. |
| `projections.js` | **The only way a state gets a colour.** Attributed projections from the election pack (#197); refuses polls, leads and unattributed items; conflicting outlets → not coloured, both shown. |
| `civicApi.js` | Free per-state vote counts from civicAPI. Numbers only, never colour. Held before polls close and when implausible. |
| `mapState.js` | Builds the map JSON (tiles, bars, sources). |
| `mapScene.js` | Renders it as a 1920×1080 page in the Signal identity. |
| `mapStore.js` | `radio/election-map.json` + the flag. Routes: `/api/radio/election-map.json`, `/radio/election-map?view=senate\|governor`. |
| `schedule.js` | When it airs: headlines 3–6 Nov, full-screen at :00/:15/:30/:45 on election night (18:00–06:00 ET), governors on :15/:45. |
| `cli.js` | `render`, `build`, `civic`. |

## Contract for the election pack (#197)

```js
{ kind: "projection", race: "senate" | "governor", state: "NC", party: "D" | "R" | "I",
  candidate: "Roy Cooper", outlet: "AP", at: "2026-11-04T02:10:00Z", url, quote }
{ kind: "retraction", race: "senate", state: "NC", outlet: "AP", at, url }
{ kind: "house-seats", outlet: "AP", at, url, seats: { D: 190, R: 180 } }
```

`quote` is the article's sentence. When present, it must contain a positive call
("AP projects Cooper wins", "projected winner", "called the race for") and none of: a negated
call ("not yet called", "too early to call"), a poll or forecast word, a lead or partial-count
word. Otherwise the item is refused even if the pack marked it a projection. A real call
refused this way costs a grey tile; that trade is deliberate.

A `retraction` at least as new as an outlet's call removes that call (a later call restores
it), and "Latest calls" shows "<outlet> withdrew its call". Without `race` it applies to
every race in the state.

## Not wired yet: spec item 4 is NOT done

The election desk, top-of-hour headlines and the 15-minute updates live in the programme
code (PR #168 / #193, #197), which is not on `main`. They should call
`buildMapState` / `writeMapState` with the pack's items and `mapCue(now)` to decide when
to show `/radio/election-map`.

Try it: `node cli.js render --input items.json --out map.html` (fixture in the issue comment).
