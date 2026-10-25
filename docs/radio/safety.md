# ScoopFeeds Radio — platform safety (#208)

**Why (DrJ, 22 Oct 2026):** the YouTube channel was suspended once and has only just been restored. 24/7
automated live coverage on YouTube and X must not put it at risk again: copyright strikes (three delete a
channel; Content ID can cut a live stream), YouTube's enforcement against mass-produced AI content, election
misinformation rules, and platform rules on synthetic content.

Adding any disclosure wording, or changing the election rule, is stop-list item 5 (`docs/engine/full-throttle.md`).

## 1. No AI label, no disclosure sentence; credits never cut

DrJ's decisions: **no continuous AI label on screen, and YouTube's "altered or synthetic content" setting is
not ticked** (22 Oct 2026). **No disclosure sentence either** (23 Oct 2026, PR #214, stop-list item 5): none in
the YouTube description, the X text or the spoken station ID. This covers the radio only; the long-form film
disclosure chain (`longformQcGate.js`) is unchanged. So that the synthetic-content setting is never required,
the stream carries no AI-generated music, no voice imitating a real person (the generic Kokoro voice imitates
no one; DrJ's own cloned voice on promos is his own voice), and no photorealistic synthetic imagery.

What the radio publishes around its streams (`safety/broadcastCopy.js`):

| Where | What | Code |
|---|---|---|
| Every YouTube broadcast the radio creates | The editorial description, then the verbatim credits of the tracks that hour aired, plus the credits-page link when `RADIO_MUSIC_CREDITS_URL` is set; the synthetic-content field is never sent | `live/youtubeLive.js` `broadcastBody()` → `withCredits()` |
| X broadcast text | Title and the same credits, written to `~/scoopfeeds-radio/x-broadcast.txt` each aired hour (paste into X Media Studio; there is no X API call) | `programme/autoair.mjs`, `xBroadcastText()` |
| The 24/7 stream (description set by hand) | `node backend/src/radio/safety/broadcastText.mjs` writes `youtube-247-description.txt` and `x-247-broadcast.txt`: "Music credits: <link>" when the page exists, else every credit | `safety/broadcastText.mjs` |
| Full credits page | `scoopfeeds.com/radio/music-credits`: every cleared track's credit verbatim, noindex | `safety/creditsPage.js` (`broadcastText.mjs --site-page`) |

**Credits are never cut** (DrJ, 25 Oct 2026; CC BY 4.0 and agentic-workflow §5, no silent caps). When every
credit does not fit YouTube's 5000 characters (or X's 4000), the description text is shortened first, then
whole credits give way to the credits-page link. With no link configured, nothing is published: the
generator exits 1, and an auto-air hour does not air (`credits-failed`, alert to DrJ). CC BY 4.0 §3(a)(2)
allows attribution by a link to a resource that holds the required information.

**Credits page, to set up on the Mac** (dark until then: nothing links to it until the URL is set):

```bash
cd ~/scoopfeeds/backend
node src/radio/safety/broadcastText.mjs --site-page ../frontend/public/radio/music-credits.html
# commit frontend/public/radio/music-credits.html through the engine (a normal PR); after it deploys:
echo 'RADIO_MUSIC_CREDITS_URL=https://scoopfeeds.com/radio/music-credits' >> ~/.scoopfeeds-radio.env
node src/radio/safety/broadcastText.mjs   # regenerate the two 24/7 files, then paste them
```

Re-run (and re-commit the page) after any change to the music library.

No scene on either screen shows an AI badge (test: `safety.test.js`).

## 2. Music

See `docs/radio/music.md`: YouTube Audio Library CC-attribution tracks only, a manifest entry per file, the
playout refuses anything else, credits on YouTube, X and screen, the procedural bed as the only fallback.

## 3. Films and episodes

A film or episode enters the rotation only when it is **known** to be clear (`safety/filmClearance.js`).
Anything unchecked is excluded, not assumed clean.

1. **A recorded copyright check.** The YouTube Data API does not expose Content ID claims or the Studio
   "Checks" result. A session with DrJ's browser opens **YouTube Studio > Content > the video > Checks** and
   records the result in `clearance.json` in the film folder (`RADIO_AUTOAIR_FILM` / `RADIO_AUTOAIR_FEATURE`):

   ```json
   { "films": [ { "file": "a-eye-ep4.mp4", "videoId": "abc123XYZ", "copyright": "no-issues",
                  "checkedAt": "2026-10-24T10:00:00Z", "checkedBy": "Claude in Chrome, Studio > Checks" } ] }
   ```

   Only `"no-issues"` passes. Any claim, even one that only mutes or blocks some regions, is written as what
   Studio says (e.g. `"claim: audio muted"`) and excludes the film. A record older than 30 days is stale.
2. **The API at air time:** the video exists, is processed, is not rejected, is public or unlisted, and is not
   blocked in any region. No API credentials, or an API error, means unknown, which means excluded.

## 4. Social clips and other broadcasters

Unchanged from #202: the 30-second cap and the on-screen credit; URL, handle and duration logged. No other
broadcasters' live feeds.

## 5. The standing watchdog: pause and alert

`safety/standingWatch.mjs`, every 10 minutes (`bash backend/src/radio/playout/deploy/macos/install-standing.sh`).

**On any new incident** it writes `~/scoopfeeds-radio/PAUSE` (with the reason), ends the live broadcast(s)
cleanly (`transition → complete`), stops the 24/7 playout (`launchctl bootout com.scoopfeeds.radio`), and
alerts DrJ at once: macOS notification, email (`RADIO_ALERT_EMAIL` + `SMTP_*`) and phone push
(`RADIO_ALERT_PUSH_URL`). An auto-air hour on air sees PAUSE within 30 s and ends; `run-playout.sh` holds
off air while PAUSE exists, so a reboot cannot restart the stream. **Resume is by hand only:** read the alert,
deal with the cause, then `rm ~/scoopfeeds-radio/PAUSE` and re-run
`bash backend/src/radio/playout/deploy/macos/install.sh`: the watchdog unloaded the 24/7 agent
(`launchctl bootout`), so removing PAUSE alone does not bring the stream back. The watchdog never removes
PAUSE.

What it can and cannot see (honesty rule: unread is "unknown", never "OK"):

| Signal | Read how | Incident when |
|---|---|---|
| Account suspended / closed | Data API error reason | it first appears |
| Channel restrictions | `channels.status.longUploadsStatus` | it becomes `disallowed` (follows strikes and live restrictions) |
| A broadcast cut by YouTube | `liveBroadcasts` `lifeCycleStatus` | `revoked` |
| Claim / rejection on the live broadcast | `videos.status.rejectionReason`, `contentDetails.regionRestriction` | a rejection reason, or newly region-blocked |
| Content ID claim count, strikes, warnings | **not exposed by any API we can use** | only through a notice (below) |
| X | no API; the playout's `outputs.json` (#207) when present | X refuses the stream for 15 min while YouTube stays live |
| Notices | any file `~/scoopfeeds-radio/notices/youtube-*.txt` or `x-*.txt` (DrJ, or a session that reads his email: YouTube and X email every claim, strike and takedown) | a new file; its text is the reason |

## 6. Weekly standing line

Each pass writes `~/scoopfeeds-radio/standing.json` with a one-line summary;
`node backend/src/radio/safety/standingWatch.mjs --line` prints it. For the Monday daily report:

> Radio standing: YouTube channel … · strikes unknown/3 · open claims unknown · live … · X account …

Strikes and claims read "unknown" until a notice or a future reader supplies them.

## 7. Election and content rules

- A spoken line asserting election **fraud or rigging**, or that someone **won**, is dropped unless it names
  who says so: an outlet that covered the story, a wire or decision desk, or an election official, with an
  attribution verb ("reports", "projects", "according to", ...). `safety/electionClaims.js`, applied in
  `programme/checks.js`.
- Titles are factual: "BREAKING", clickbait wording, exclamation marks or shouting capitals in a broadcast or
  feature title are replaced with the default (`titleProblems()`).
