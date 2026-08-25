# Sourcing and disclosure

## Footage

Pexels, HD 1920x1080, free commercial use. Record every clip in a
`LICENSES.md` beside the render — attribution is not required by the licence,
but a provenance question should be answerable without re-deriving it.

**Screen out AI-generated stock.** Pexels now serves AI clips from
`content.pexels.com/aigc-bundle/…`. Only use contributor-shot clips from
`videos.pexels.com/video-files/…`.

**Reject upscales.** A clip that only exists below 1080 shows next to native
material.

## AI-generated stills

Permitted for **environments only — no synthetic humans.** Generating a
photorealistic fake person for a journalism piece is a materially different
claim from generating an empty room. Every person on screen must be real
footage or appear inside a cited source screenshot.

Any AI imagery means ticking **"Altered or synthetic content"** on YouTube and
disclosing it in the description and the Facebook caption.

## Source screenshots — measure, never guess

`engine/capture-measured.mjs` asks the browser for geometry instead of guessing
crops and highlight boxes:

1. Find the **container** element and screenshot exactly its bounding box plus
   padding. Nothing can clip, because the crop *is* the element.
2. Find the exact **phrase** with a DOM `Range` and read `getClientRects()` —
   one rect per line, so a highlight wrapping three lines highlights all three.
3. Emit `rects.json` in pixels relative to the screenshot origin (x2 for DPR 2).

The guessed approach took three or four rounds per document and still clipped
text and highlighted navigation chrome instead of the sentence.

If a phrase returns zero rects, the container climb stopped too early — the
Range search only looks inside the chosen element. Raise `minW`/`minH`.

## Statements and personality imagery (#82)

See `house-style.md` §Evidence for the full rules. In short: statements enter
only through `engine/statement.mjs` (never a found screenshot), render
verbatim or throw, need their parent when they are replies, and are
re-verified before publish. Personality cutouts, landmarks and flags come from
the repo-level registries in `assets/evidence-assets/`, where an entry cannot
exist without an allowlisted license — and paid editorial licenses (Getty, AP)
are deliberately not on that list.

## Honesty

Enforced, not aspirational (`docs/agentic-workflow.md` §5):

- A `SOURCES` block naming the primary document, not a secondary report of it.
- A **`Deliberately excluded`** block for figures that could not be verified to
  a primary source, saying so plainly. v2 excluded a widely-quoted "73% collapse
  in no-experience hiring", "Gen Z unemployment 8.3%", and a "software
  developers down 20%" figure that appears in neither document it was attributed
  to.
- Include caveats the source states about itself.
- Unmeasured is reported as "unverified", never as "passing".

---

## footage-search.mjs — finding real footage without stealing it

```bash
node engine/footage-search.mjs "strait of hormuz" "persian gulf tanker"
```

Searches DVIDS, NASA, Wikimedia Commons, Internet Archive and YouTube's
Creative-Commons filter, and writes `out/footage-candidates.json`. **It never
downloads anything.** Whether a clip may be used is not a decision a search tool
can make, so it assembles the evidence and stops.

Results are ranked by **provenance, not relevance**:

| tier | meaning | sources |
|---|---|---|
| **verified** | the publisher is the rights holder by construction | DVIDS, NASA/USGS — US Government works, public domain under 17 U.S.C. §105 |
| **declared** | an explicit licence from a plausible owner; still needs a look | Wikimedia Commons, Internet Archive |
| **unverified** | a lead. Not usable as found. | YouTube CC-marked |

### Why YouTube's CC filter is a lead, not a source

`videoLicense=creativeCommon` works and returns fresh results. Run it against a
breaking-news topic and it returns **news aggregators re-uploading agency
footage with the CC box ticked**. On "strait of hormuz" the first page was
News18 Punjab, DISTRITOTV, YOUTH PILOT and similar — channels that did not shoot
the material and cannot license it. A licence the uploader cannot grant is not a
licence; it is infringement wearing a badge, and Content ID matches it anyway.

Downloading also breaches YouTube's Terms of Service regardless of the licence
field. The tool therefore surfaces these and refuses to treat them as usable.

### Internet Archive's TV News Archive

Searches for current events return broadcast recordings (IRINN, BBC Persian,
TRT Haber) from hours ago. These have **no licence field**, and the tool labels
them "treat as all rights reserved". The TV News Archive exists for research and
citation, not for reuse in a monetised video.

### The date trap

Public-domain military footage is real but it is **not footage of your event**.
The best DVIDS Hormuz transit video is from 2016. Cutting it under narration
about a 2026 blockade makes it a claim about 2026 — the same error as a working
port under "ships stranded at anchor", or a Bangladeshi village under narration
about eastern Congo. Both of those cost a re-cut.

Rules that follow:
- Generic-but-true is fine **when the on-screen credit carries the date**:
  `US Navy / DVIDS · 2016`. The visible date is what makes it honest.
- Never place it under a sentence about a specific dated event.
- **Satellite imagery is the safest and the best-looking.** Geography does not
  go stale, NASA imagery is public domain with no attribution required, and a
  real satellite plate of a strait beats any amount of typography.

### Gotchas

- `commons.wikimedia.org/w/api.php` is **reset at the connection level** from
  some networks — ECONNRESET, which reads like a transient fault while
  `en.wikipedia.org` answers fine from the same machine. Use
  `api.wikimedia.org/core/v1/commons/…` instead.
- DVIDS needs a free API key (`DVIDS_API_KEY`, dvidshub.net/api). Without one the
  tool emits a browse link rather than pretending it found nothing.
