# Productions — the authored sources, kept out of /tmp

Each film's **authored** files live here: the script, the storyboard, the
publish configs, the provenance record, and the ids of what went live. The
engine renders from these; the renders themselves are not committed.

## Why this directory exists

`new-project.sh <slug> scratchpad` builds a working directory under the
session scratchpad, which resolves to `/private/tmp`. macOS purges that — on
reboot and by age — and it did, during the very session that produced these:

| production | state when this was written |
|---|---|
| `scoopfeeds-longform` (film 1, "Who Pays For AI") | **sources gone**, empty directory |
| `v2` (film 2, "Entry-Level Jobs") | **sources gone**, empty directory |
| `v3` (Hormuz) | only `storyboard.mjs` survived — script, publish config and the rendered film all lost |
| `v4` (Ebola/Bundibugyo) | complete, and captured here |

Nothing was backed up because the working directory was treated as a build
artifact. Most of it is: `out/` is regenerable, `node_modules` and `fonts` are
symlinks. But `script.md` is hours of sourced writing, `storyboard.mjs` is
every card authored by hand, and `publish.json` holds a 5,000-character
description written to YouTube's limit with its sources and disclosures. None
of that is regenerable, and two films' worth is already unrecoverable.

**Author into a project directory here, or copy sources back after a run.**

## What is kept, and what is not

**Kept** — irreplaceable, small:
`script.md` · `storyboard.mjs` · `beats.json` · `project.json` ·
`shorts.json` · `publish.json` · `ig.json` · `tiktok.json` · `docs.json` ·
per-project tools like `thumb.mjs` · `data/LICENSES.md` (footage provenance) ·
`data/*.json` (captured source data) · `data/published-ids.json` (the ids of
what went live — the only handle on a scheduled upload) · the `.srt`.

**Not kept** — regenerable or large:
`out/` renders (the Ebola project's is 458 MB), footage MP4s (re-fetchable from
the URLs in `LICENSES.md`), narration audio (~$2 of ElevenLabs to re-synthesise;
cheaper than the git weight), `node_modules` and `fonts` (symlinks).

## Rebuilding a production

```bash
bash engine/new-project.sh <slug> <parent-dir>       # scaffold
cp -R projects/<slug>/*.md projects/<slug>/*.mjs projects/<slug>/*.json <dir>/
cd <dir> && node <engine>/narrate.mjs && node <engine>/build.mjs
```

Footage is re-fetched from the provenance table in `data/LICENSES.md`; narration
re-synthesises from `script.md` (the text sidecars make the cache exact).

## bundibugyo — "The Ebola Outbreak Nobody Saw Coming"

Published 2026-08-20. 49 beats, 7:14. Every figure is CDC's on one basis with
its date; `script.md` carries the sourcing, the deliberate exclusions, and the
note on why WHO AFRO's and CDC's counts disagree. `data/published-ids.json` has
the YouTube and Facebook ids.

## hormuz-strait — "What Happens If The Strait Of Hormuz Closes"

**Partially lost.** Only `storyboard.mjs` survived the purge. The film and its
five Shorts are uploaded and scheduled on YouTube, so the output is safe, but
the script, publish config and provenance record are gone. If that film is ever
revised, it starts from the storyboard and the published description.
