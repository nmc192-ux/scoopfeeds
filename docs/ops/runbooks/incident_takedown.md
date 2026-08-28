# Runbook — withdrawing published incident media

**Written:** 28 Aug 2026 · **For:** a poster who granted permission and has withdrawn it,
or a takedown request on footage already published.

**Read the finding first. It changes what the permission request may promise.**

---

## 0. The finding

**Only YouTube can be retracted programmatically. Every other surface is manual.**

A short reaches up to seven surfaces, and `video_posts` stores a post id for each:
`youtube_id`, `facebook_post_id`, `instagram_post_id`, `threads_post_id`,
`bluesky_post_id`, `tiktok_post_id`, `x_post_id`.

Exactly one client exports a retraction function:

| Surface | Retraction available | What exists |
|---|---|---|
| YouTube | **yes** | `setYouTubePrivacy(videoId, "private"\|"unlisted")` |
| Facebook | no | upload only (`postReelToFacebook`) |
| Instagram | no | upload only (`postReelToInstagram`) |
| Threads | no | upload only |
| Bluesky | no | upload only |
| TikTok | no | upload only (`uploadToTikTok`) — a privacy LEVEL is set at upload and cannot be changed afterwards by us |
| X | no | upload only |

Verified by reading every client in `backend/src/services/*Client.js` for an exported
delete / remove / privacy / retract function. Six of seven have none.

### And the one route we have is the wrong shape

`POST /scoop-ops/video/unlist-recent` does **not** take a video id. It runs:

```sql
SELECT * FROM video_posts
 WHERE status = 'published' AND youtube_id IS NOT NULL
 ORDER BY published_at DESC LIMIT ?
```

— i.e. it flips **the last N published videos**. Using it to retract one specific video
either requires that video to be the most recent, or takes down N−1 videos that nobody
asked about. It was built as a "the loop went wrong at 3am" button, which is a different
job from a targeted withdrawal, and it does that job well.

**This route has never been successfully called** (open-items list since launch). The
runbook below therefore treats the YouTube step as *unverified in production* and says so
at the point of use.

### What this means for the permission request

The Gate B message tells the poster:

> If you say yes and then change your mind before we publish, tell me and we won't use it.

That promise is **fully enforceable** — pre-publication revocation is a ledger state change
and nothing renders afterwards (`assertRenderable` refuses `revoked`).

The message does **not** promise post-publication removal, and on the current evidence it
should not, without qualification. What can honestly be said is: *"if you change your mind
after publication, tell me and I will take it down — that takes me a few minutes by hand on
some platforms."* That is true. "It will be removed automatically" is not.

---

## 1. Record the revocation first

Do this before touching any platform. It is what makes the rest of the runbook auditable,
and it is what stops the asset being used again in a future render.

```bash
curl -X POST https://<host>/scoop-ops/incident/candidates/<id>/revoke \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"grantor_withdrew","note":"who told us, when, and in what words"}'
```

`reason` ∈ `grantor_withdrew` | `takedown_request` | `rights_dispute` | `operator`.
The note is **required** and must be substantive — this is the row most likely to be read
by someone outside the project.

The response tells you whether a takedown is needed:

```json
{ "requiresTakedown": true, "videoId": "yt-AbCd1234",
  "next": "Video yt-AbCd1234 is published and must be pulled. Unlist it, then POST …/takedown-actioned." }
```

If `requiresTakedown` is `false`, nothing was published. **You are done** — stop here.

## 2. Find every surface that carries it

```bash
curl "https://<host>/scoop-ops/video/status" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN"
```

Then read the `video_posts` row for the article to get the per-platform post ids. The
`/scoop-ops/incident/takedowns` endpoint lists what is outstanding and, for each, the
surface checklist.

## 3. YouTube — the one programmatic step

⚠️ **Unverified in production.** This route has never been successfully called. Expect to
debug it the first time, and do not assume a 200 means the video moved — check the video's
privacy in YouTube Studio afterwards.

If the video is the most recent published:

```bash
curl -X POST "https://<host>/scoop-ops/video/unlist-recent?n=1&privacy=private" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN"
```

If it is **not** the most recent, do **not** raise `n` to reach it — that flips every video
in between. Set it private by hand in YouTube Studio instead. (A targeted
`unlist-one/:videoId` route is the obvious fix and is deliberately not built here; changing
a live recovery route is DrJ's call.)

## 4. The six manual surfaces

Each of these is a hand action in the platform's own app or studio. There is no API path
from this codebase.

| Surface | Action | Notes |
|---|---|---|
| Facebook | delete the Reel from the Page | Meta Business Suite → Content |
| Instagram | delete the Reel | app or Business Suite; archiving is not deletion |
| Threads | delete the post | app only |
| Bluesky | delete the post | app; deletion propagates but caches may lag |
| TikTok | delete the video | app; privacy set at upload cannot be changed by us |
| X | delete the post | app |

**Do them before the YouTube step if the request is urgent** — YouTube is the one you can
come back to, because it is the one that is scriptable.

## 5. Record that it is actually gone

```bash
curl -X POST https://<host>/scoop-ops/incident/candidates/<id>/takedown-actioned \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"YouTube private 11:20, FB/IG/Threads/Bluesky/TikTok/X deleted 11:28"}'
```

**Only this clears the pending bucket.** Deciding to pull a video is not the same fact as
it being gone, and the ledger keeps them apart deliberately. Until you post this, the
candidate sits in the queue's **first** bucket, above all other work, and the trail records
how many seconds it was outstanding.

## 6. Reply to the person

Not a system step, and the most important one. They asked; tell them it is done and where.

---

## What would make this better, in priority order

1. **A targeted `unlist-one/:youtubeId` route.** The current one cannot retract a specific
   video without collateral. Small change to a live recovery route — needs a ruling.
2. **A delete path for Bluesky.** The AT Protocol supports record deletion and we already
   hold an authenticated agent; it is the cheapest of the six to automate.
3. **Verify `unlist-recent` once, deliberately, on a throwaway video.** It has never run.
   A recovery route that has never been executed is a plan, not a capability — the same
   reasoning that made this engine's own gates get exercised rather than asserted.
