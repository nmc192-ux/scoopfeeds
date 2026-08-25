# Generated scenes — the approved registers, and the rules that keep them cheap

DrJ approved generated stylized collage scenes on 2026-08-23, from three pilots
(now the library's first three entries). Approval covers **stylized metaphor
scenes only**, in exactly three registers. It does **not** cover the unattended
auto-shorts pipeline (undecided — treat as no), and it never covers realism.

## The division of labor — hard rule

| subject | source |
|---|---|
| Real people | real photo/video cutouts (Higgsfield `remove_background` on rights-clean imagery) |
| Real events | real footage — DVIDS, NASA, screen captures via `footage-search.mjs` |
| Abstract concepts, metaphors, through-line objects | **generated collage — this file** |

A generated scene must contain **no readable text, no likeness of a real
person, no depiction of a specific dated event**. That is both the editorial
line (it can never be mistaken for documentation) and the economic one (it is
what makes a scene reusable across stories).

## The three approved registers

1. **map** — torn-paper geography: landmasses, routes, chokepoints, regions
   filling. Pilot: `chokepoint-queue-916`.
2. **document** — paper artifacts: agreements tearing, redaction bars,
   hourglasses, tape, stamps. Pilot: `deal-tears-916`.
3. **object** — hand-drawn/cutout physical metaphors: scales, stacks, fuses,
   balloons, dominoes. Pilot: `unequal-scales-916`.

A fourth register is a DrJ approval, not a prompt tweak — `genscene.mjs add`
enforces the whitelist.

## Credit discipline — reuse first, generate last

- **Search the library before every generation**: `node backend/src/services/longform/engine/genscene.mjs
  find "<concept words>"`. A near-match beats a new 30-credit clip; scenes are
  deliberately story-agnostic so "document tears" serves any collapsed deal.
- **Preflight cost** (`get_cost: true`) before submitting; gemini_omni 10s ≈ 30
  credits. Budget guidance: **≤ 2 new scenes per video**, and only when the
  library has no fit. A video needing five new metaphors has a script problem,
  not a library gap.
- **Register everything generated** (`genscene.mjs add` + `fetch`), including
  rejects worth keeping. An unregistered clip is a credit spent twice.
- The manifest tracks `uses` — `list` shows credits-per-placement falling as
  the library amortizes. That number is the whole argument for the library.

## Generating (agent-side, via Higgsfield MCP)

Follow the vox-motion-graphics skill's block template exactly (STYLE
REFERENCE / SCENE / MOTION / AUDIO / NEGATIVE — the NEGATIVE line verbatim).
Known traps, all hit during the pilots:

- Attach the Mixed Media style key (`resolve_explainer_preset`,
  preset `80e4dd7b-cd65-42d4-b191-b58d62558602`) to every clip.
- Pass `aspect_ratio` **explicitly** — the key does not set framing.
- Expect the server to intercept with a "3D RENDER" `preset_recommendation`:
  decline via `declined_preset_id` from `retry_literal_with`. Never accept a
  photoreal/3D preset.
- Pre-screen frames before registering: photoreal drift, readable text, or an
  accidental likeness = reject and re-prompt, don't ship.

### 16:9 for long-form

The preset key is 9:16. For landscape scenes, generate a **16:9 style key
once** (`generate_image`, `nano_banana_pro`, the STYLE KEY prompt in the
vox-motion-graphics references), then register it in the manifest under
`styleKeys` so it is never paid for twice. Scenes do not crop between aspects —
the composition is the content; generate per-aspect.

## Using a scene in a project

```bash
node backend/src/services/longform/engine/genscene.mjs use <slug>     # from the project directory
```

Copies the clip into `out/footage/GS_*.mp4` (ordinary INSERTS/FOOTAGE plumbing
from there) and stamps LICENSES.md with the AIGC provenance line.

**The stamp is load-bearing.** publish-all.mjs refuses to publish a stamped
project whose description claims "No AI-generated imagery", whose
`syntheticContent` is unset, or whose tiktok.json lacks `isAigc: true`. The
all-real films keep the no-AI claim; the mixed ones disclose. Nobody has to
remember which is which — the gate does.
