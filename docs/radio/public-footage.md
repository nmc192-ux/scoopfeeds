# Footage from the public (#219)

**DrJ, 23 Oct 2026:** "It's important to get footage from public for breaking news etc. Try and find
a way to include this."

Everything here sits behind DrJ's content rule (#218, `docs/radio/content-safety.md`): no sexual
content, violence, abuse or animal harm in any video or audio, ever. Nothing in this document can
put a clip on air without passing that gate.

## The one path to air

```
 route 1: social post clip ─┐
                            ├─> air copy (credit burned into every frame, cut to ≤ 30 s)
 route 2: "Send us your     │      └─> content-safety gate on the air copy (#218)
  video" submission ────────┘             └─> [route 2 only] metadata + reverse search + approval tap
                                                └─> insert queue (re-checks everything at admission AND at take())
                                                      └─> breaking-news insert (#201, not built yet)
```

| Piece | File |
|---|---|
| Licence text, credit choices | `backend/src/radio/footage/licence.js` |
| Storage, one folder per submission | `backend/src/radio/footage/intakeStore.js` |
| Credited air copy | `backend/src/radio/footage/credit.js` |
| Checks (metadata, reverse search, safety) | `backend/src/radio/footage/verify.js` |
| Approval tap | `backend/src/radio/footage/approval.js` |
| Insert queue | `backend/src/radio/footage/insertQueue.js` |
| Route 1 (social clips) | `backend/src/radio/footage/socialInsert.js` (rules from `live/socialClips.js`, PR #211) |
| Website endpoints | `backend/src/routes/footage.js`, page `frontend/src/pages/SendVideoPage.jsx` (`/send-video`) |
| Mac CLI | `backend/src/radio/footage/footageCli.mjs` |

### Credit on screen for the whole clip
The credit is drawn into the picture of the air copy itself (ffmpeg `drawtext` with no time window),
not by the playout or the screen page. Whatever part of the air copy plays, the credit is in it. A
sidecar binds the credit text to the file's SHA-256, and the queue refuses a file without a matching one.
Route 1 credit: `via @handle on <platform>`. Route 2 credit, as the sender chooses:
`Video: <name>, sent to ScoopFeeds`, `Video: @handle, sent to ScoopFeeds`, or
`Video: viewer footage, sent to ScoopFeeds`.

### Route 2 checks (any unmeasured check = does not air)
1. **Metadata** from the original file: the recording date must exist and fall between 2 h before the
   story began and 10 min after the file reached us. If the story has coordinates, the file must carry
   a location within 50 km. Thresholds: `VERIFY_THRESHOLDS` in `verify.js`.
2. **Reverse search** for older copies. No service is wired in (a paid API is a cost decision). Until
   one is, a named editor runs the search by hand and records how (`--reverse-search "…"`
   `--no-older-copies`, or `--older-copy URL`). Without that, the submission fails.
3. **Content safety** (#218) on the air copy.
4. **Approval tap** by DrJ or a name in `RADIO_FOOTAGE_APPROVERS`. A re-verification clears the approval.

### On the Mac
```bash
cd backend
node src/radio/footage/footageCli.mjs pull                       # needs ADMIN_BEARER_TOKEN in the Mac's env
node src/radio/footage/footageCli.mjs list
node src/radio/footage/footageCli.mjs verify <id> --by DrJ --story-time 2026-11-03T23:10:00Z \
     --story-lat=40.71 --story-lon=-74.00 --reverse-search "Google Lens + TinEye on 3 keyframes" --no-older-copies
node src/radio/footage/footageCli.mjs approve <id> --by DrJ
node src/radio/footage/footageCli.mjs queue <id>
node src/radio/footage/footageCli.mjs pending
```
Negative coordinates need the `=` form (`--story-lon=-74.00`).

## Licence (DRAFT for DrJ)
The sender ticks every one of these; the full text, version and ticks are stored in the same folder as
the file (`submission.json`):
- I filmed this video myself, and nobody else owns it.
- I give ScoopFeeds a non-exclusive licence: I keep my copyright and can still use, sell or license the
  video elsewhere.
- ScoopFeeds may show the video worldwide, on its broadcasts and live streams (including YouTube and X)
  and online, edited for length, with no fee.
- ScoopFeeds will credit the video the way I choose below, on screen for the whole time it plays.
- ScoopFeeds may decide not to use the video. Nothing airs before it has been checked and approved by
  an editor.

This is not legal advice and has not been reviewed by a lawyer. It is stop-list item 5 (legal) as well
as item 4 (new public page).

## Privacy (DRAFT for DrJ)
- **What we store:** the video, what the sender typed (optional description, place, time, contact
  email), the licence acceptance and our checks. **Not stored:** IP address, user agent, device id.
- **The air copy drops the file's own metadata** (location, device), so it never goes out with the clip.
- **Bystanders' faces:** the approver looks for identifiable bystanders. Proposed rule: a clip where a
  private person's face is clearly identifiable and they are not the subject of the story is rejected,
  or aired only once the face is blurred (blurring is not built; today such a clip is rejected).
- **Children:** proposed rule: no identifiable child's face airs, ever. Rejected unless blurred
  (not built; today: rejected).
- **Victims, the injured and the dead:** already excluded by DrJ's content rule (#218).
- **Sender's contact:** used only to ask about the video, never published, never added to a mailing list.
- **Retention:** proposed 90 days for anything not aired; aired clips kept with their licence for as
  long as the clip is in our archive. (Not built: no automatic deletion yet.)
- **Removal:** a sender can ask us to stop using their video; we stop airing it and remove it from the
  queue. (By hand today.)
These need DrJ's decision and wording on the privacy page before the intake opens.

## Route 3: licensed eyewitness-video services (research only, nothing signed)
| Service | What it is | Licence model found | Covers a 24/7 YouTube + X stream? | How to get a price |
|---|---|---|---|---|
| **Storyful** (News Corp) | Verified social video, cleared with the creators | Per-clip licences, priced by use (digital, TV, advertising); buyers register and are approved first (MediaPost, Feb 2020) | **Unknown**: no public terms name YouTube or X streaming. Ask for "digital + broadcast, including live streams on YouTube and X". | Register as a buyer; sales quote. No public price list. |
| **Newsflare** | UGC video marketplace, 1,300+ media customers; uploaders get 45% (Press Gazette, Jan 2022) | Licensing marketplace, rights cleared by its "Trust Algorithm"; per-clip vs subscription not stated publicly | **Unknown**: ask the same question. | Contact sales for a quote. |

Both sources are 2020–2022 articles; current terms and prices are **UNVERIFIED**. Any subscription is
stop-list item 3 (cost) and waits for DrJ.

Sources: [MediaPost: Storyful to launch video licensing marketplace](https://www.mediapost.com/publications/article/346979/None),
[Press Gazette: Newsflare doubles down on UGC](https://pressgazette.co.uk/news/agency-newsflare-doubles-down-on-ugc-with-5m-investment/).
