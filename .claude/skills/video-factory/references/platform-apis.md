# Platform APIs

Verified against the live accounts on 2026-08-18. Re-check before assuming.

## Identity gate (all platforms)

Run before any post, and refuse on mismatch:

- YouTube: `channels?part=snippet&mine=true` → `customUrl` must be `@scoopfeedsnews`
- Facebook: `GET /me` → `id` must equal `FACEBOOK_PAGE_ID` (`1126859220500685`)
- Instagram: IG user `17841429776015289` (`scoop.feeds`)

Querying `GET /{page-id}?fields=name` is **not** a gate — a token minted for a
different page returns the right name happily.

## YouTube

**Token scopes are `youtube.upload` + `youtube.readonly` only.** Consequences:

- `videos.update` is **forbidden**. `publishAt` must be set **inside**
  `videos.insert` (`status.privacyStatus=private` + `status.publishAt`), which
  `youtube.upload` permits.
- `captions.insert` is impossible. SRT must be uploaded by hand in Studio.
- `setYouTubePrivacy()` in `backend/src/services/youtubeClient.js` will 403.
- `thumbnails.set` works (channel is phone-verified).

`uploadToYouTube()` in the production client has no `publishAt` parameter, so a
scheduled upload needs its own resumable insert. Do not widen the live
auto-poster's API for one video.

**Always set `isShort: false` for long-form** — the client defaults to true and
appends `#Shorts` to a 7-minute film.

Read back `status.publishAt` from the insert response; do not assume it stuck.

**Manual afterwards:** tick "Altered or synthetic content" if any AI imagery is
used, and upload captions.

## Facebook

`postVideoToFacebook` / `postReelToFacebook` in the production client **hardcode
`published=true`** and cannot schedule. For a scheduled post, call the endpoints
directly:

- Page video: `POST /{page-id}/videos`, multipart, `published=false` +
  `scheduled_publish_time` (unix seconds).
- Reel: three phases against `/{page-id}/video_reels` — `start` (returns
  `video_id` + `upload_url`), raw-bytes POST to `upload_url` with an
  `Authorization: OAuth <token>` header, then `finish` with
  `video_state=SCHEDULED` + `scheduled_publish_time`.

**Load the token the way the production client does:** `data/facebook-token.json`
first, env second.

A freshly uploaded long-form sits in `processing` with
`publishing_phase: not_started` for minutes. That is not a failed schedule —
re-query until `video_status: ready`, then confirm `publish_status: scheduled`.

## Instagram

Account: `scoop.feeds` (`17841429776015289`), linked to the Page. Quota is 100
API-published posts per rolling 24h (`GET /{ig-id}/content_publishing_limit`).

**Two hard limits, both Meta's design:**

1. **No scheduling.** There is no `publish_time` parameter; Meta's own docs
   frame scheduling as the caller's concern. Containers expire after exactly
   24h, so you cannot pre-build a container for a slot days out. "Scheduled IG
   posting" means a process that wakes up and posts.
2. **No byte upload.** IG fetches media from a public URL. There is no
   multipart path.

Flow: `POST /{ig-id}/media` (container) → poll the container until
`status_code=FINISHED` → `POST /{ig-id}/media_publish`. Publishing an
`IN_PROGRESS` container fails.

**Reels work. Stories currently do not.** Container probes on 2026-08-18:
`media_type=REELS` reached `FINISHED`; `media_type=STORIES` failed with
**error 2207077** on the identical file, at both 34s and 14s — so not duration.
The code appears in no public error reference. Treat Stories as best-effort:
wrap it so a Story failure cannot abort the Reels loop, and judge run success on
Reels alone.

**Hosting for the public URL.** The only in-system public video route is
`/scoop-ops/videos-gen/file/:articleId`, which serves from `VIDEOS_DIR` on the
prod VPS — putting files there is a prod write and needs DrJ. The alternative
used in practice is a temporary tunnel from the local machine, exposing an
explicit allowlist of files for the minute Meta needs.

**cloudflared does not work from this machine** — the quick-tunnel POST to
`api.trycloudflare.com` exceeds its internal deadline every time, sandboxed or
not. **localtunnel does**, and was verified with Meta's own user agent
(`facebookexternalhit`): 200, `content-type: video/mp4`, byte-exact download, no
interstitial. Serve ranged requests — Meta issues HEAD then a ranged GET.

Captions cannot contain working links. Say "link in bio" and make sure the bio
link is actually correct.

---

## TikTok — Content Posting API

**Two facts decide the whole design, both verified against TikTok's docs:**

1. **There is no scheduling.** No `publish_at`, no `schedule_time`, on any
   endpoint. A post happens when the call is made. So TikTok gets a poller
   (`tiktok-setup.sh`), the same shape as Instagram and for the same reason.
2. **An un-audited client can only post `SELF_ONLY`.** TikTok forces every post
   from a client that has not passed the Content Posting API audit to private
   viewing. `creator_info/query` returns the allowed `privacy_level_options`;
   `tiktok-publish.mjs` reads them and **refuses to post** if the level it was
   asked for is missing, rather than putting five invisible videos on the
   account and reporting success.

Other limits: ~15 posts per creator per day; un-audited clients may enable at
most 5 users in 24h. Captions up to 2200 UTF-16 characters.

### Why not the Higgsfield connector

It authenticates and reads fine — the Commercial Music Library returns results —
but every publish call returns `error 40131: authentication failed`. Reads
succeeding while writes fail isolates it to the Content Posting product, which
is gated separately. A second, freshly authorised connector failed identically,
so it is not a scope the user missed at the consent screen. It is that app's
registration, and re-authorising cannot change it.

### Flow

```
POST /v2/oauth/token/                     refresh_token → access_token
POST /v2/post/publish/creator_info/query/ → privacy_level_options, max duration
POST /v2/post/publish/video/init/         post_info + source_info{FILE_UPLOAD}
                                          → publish_id, upload_url (1h)
PUT  <upload_url>                         Content-Range: bytes 0-(n-1)/n
POST /v2/post/publish/status/fetch/       poll until PUBLISH_COMPLETE | FAILED
```

`FILE_UPLOAD`, not `PULL_FROM_URL`: the latter needs a verified domain, and the
files exist only on the build machine. Single chunk — TikTok wants 5–64 MB
chunks and every file here is well under 64 MB, so chunking adds only failure
modes. **Poll the status endpoint**: TikTok accepts the bytes and can still
reject the video asynchronously, so a 200 on the PUT is not a published post.

### Env

```
TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
```

### Registering the app (one-time, and only the account holder can do it)

1. developers.tiktok.com → register as a developer with the ScoopFeeds TikTok
   account.
2. Create an app. Add **Login Kit** and the **Content Posting API** products, and
   request all three scopes: **`user.info.basic`**, **`video.publish`**,
   **`video.upload`**.
   `user.info.basic` is not optional — `creator_info/query` needs it, and that
   call is what returns the account's permitted `privacy_level_options`, so
   without it publishing cannot even determine what it is allowed to do.
   **Whatever scopes the app requests must match what the privacy policy says
   it requests**; a reviewer compares the two.
3. Add **Login Kit** so the app can obtain a refresh token at all.
4. Submit for audit. Until it passes, everything posts `SELF_ONLY` — the poller
   detects this and holds rather than posting invisibly.
5. Authorise once to mint `TIKTOK_REFRESH_TOKEN`, and put the three values in
   `~/.scoopfeeds.env`.
