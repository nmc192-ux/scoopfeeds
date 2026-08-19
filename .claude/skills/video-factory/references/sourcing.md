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
