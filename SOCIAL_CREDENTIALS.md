# Social poster credentials — survival guide

## TL;DR

**Don't put `FACEBOOK_*`, `BLUESKY_*`, or any other social-poster credentials
inside `backend/.env` on production.** That file is gitignored, so any deploy
that does a fresh checkout (Hostinger's git auto-deploy can do this) wipes
it — and your posters silently stop until someone notices.

**Use one of two persistent locations instead:**

1. **Hostinger panel → Environment Variables UI** (recommended). These are
   stored by Hostinger and re-injected into the Node process on every
   restart. They survive deploys, restarts, and reinstalls.

2. **`~/.scoopfeeds.env`** — a file in the deploy user's home directory
   (e.g. `/home/u123456789/.scoopfeeds.env`). Hostinger's deploy never
   touches your home directory, so this file persists. `start.js` loads
   it automatically (added in commit after this doc was written).

## Why credentials "disappear"

Symptom you saw: Bluesky and Facebook posted normally for a while, then
stopped without warning. After investigation:

- `backend/.env` is in `.gitignore`
- Hostinger's git-deploy strategy for Node.js apps does a `git fetch &&
  git reset --hard && git clean -fd` (or equivalent) on each redeploy
- `git clean -fd` deletes untracked files — including `backend/.env`
- The fallback disk caches (`backend/data/bluesky-session.json`,
  `backend/data/facebook-token.json`) live in `backend/data/`, also
  gitignored, so they get wiped too
- Next process start: no env vars + no disk cache → poster sits idle

So the credentials didn't vanish "by themselves" — they get destroyed on
every redeploy. Each manual re-add only lasts until the next deploy.

## The persistent-fallback pattern

After the fix, `start.js` reads env vars from three sources in this order:

| Priority | Source | Survives redeploy? |
|----------|--------|--------------------|
| 1 (highest) | `process.env` (Hostinger panel, shell exports) | ✅ |
| 2 | `backend/.env` | ❌ wiped on `git clean` |
| 3 | `~/.scoopfeeds.env` (or `$SCOOP_SECRETS_FILE`) | ✅ |

For ANY credential that needs to survive a redeploy, use option 1 or 3.

Same pattern applies to **all persistent data** — the SQLite database,
disk-cached tokens (Bluesky session, Facebook page token), and video assets.
Set `SCOOP_PERSISTENT_DATA_DIR=/home/youruser/.scoopfeeds-data` and ALL
of these files move there, outside the deploy directory:

| File | What it contains | Effect if wiped |
|------|-----------------|-----------------|
| `news.db` | articles, social_posts, push subs, … | duplicate social posts, lost subscribers |
| `bluesky-session.json` | Bluesky refresh token | forced re-login, risks 429 rate-limit |
| `bluesky-cooldown.json` | 429 circuit-breaker state | 429 storm restarts after each deploy |
| `facebook-token.json` | Facebook page token | Facebook posts stop |

Without `SCOOP_PERSISTENT_DATA_DIR`, every redeploy wipes all of these.
The duplicate posts on Bluesky you see after a deploy are caused by the
`social_posts` table being lost — the dedup logic works, but has nothing
to check against. That dir survives deploys.

## Recommended setup on Hostinger

1. **SSH into the Hostinger box** (or use File Manager).
2. **Create the persistent data dir** in your home directory:
   ```bash
   mkdir -p ~/.scoopfeeds-data
   chmod 700 ~/.scoopfeeds-data
   ```
3. **Add these env vars in the Hostinger panel** (Node.js App → Configuration → Environment Variables):
   ```
   SCOOP_PERSISTENT_DATA_DIR=/home/<your-user>/.scoopfeeds-data
   FACEBOOK_PAGE_ID=<your page id>
   FACEBOOK_PAGE_TOKEN=<your permanent page token>
   BLUESKY_HANDLE=<your handle, e.g. scoopfeeds.com>
   BLUESKY_APP_PASSWORD=<freshly-generated app password>
   ```
4. Restart the Node app from the Hostinger panel.

That's it — they'll survive every redeploy from now on.

## Alternative: ~/.scoopfeeds.env file

If you'd rather edit a file than the panel UI:

1. SSH in.
2. Create the file:
   ```bash
   nano ~/.scoopfeeds.env
   chmod 600 ~/.scoopfeeds.env
   ```
3. Add lines like:
   ```
   FACEBOOK_PAGE_ID=...
   FACEBOOK_PAGE_TOKEN=...
   BLUESKY_HANDLE=...
   BLUESKY_APP_PASSWORD=...
   SCOOP_PERSISTENT_DATA_DIR=/home/<your-user>/.scoopfeeds-data
   ```
4. Restart the Node app.

`start.js` picks it up automatically on next boot. The file lives outside
the repo, so deploys can't touch it.

## How to verify it's working

Hit the admin status endpoint with your admin key (set in `ADMIN_KEY`):

```
https://scoopfeeds.com/scoop-ops/auto-status?key=YOUR_ADMIN_KEY
```

Response shape:

```json
{
  "ok": true,
  "enabled": ["facebook", "bluesky", "linkedin", ...],
  "env": {
    "FACEBOOK_PAGE_ID": true,        // ← should be true
    "FACEBOOK_PAGE_TOKEN": true,     // ← should be true
    "BLUESKY_HANDLE": true,          // ← should be true
    "BLUESKY_APP_PASSWORD": true,    // ← should be true
    ...
  },
  "blueskyHandle": "scoopfeeds.com",
  "facebookPageId": "1126859220500685"
}
```

If any of those `env.*` booleans are `false`, the credential isn't reaching
the Node process — fix that first.

If they're all `true` but posts still aren't going out, check
`/scoop-ops/auto-errors?key=YOUR_ADMIN_KEY` for recent failed-post error
messages. Most common causes:

- **Bluesky 401 "AuthenticationRequired"** → app password was revoked (often
  because of repeated failed login attempts hitting Bluesky's anti-abuse).
  Regenerate at bsky.app → Settings → App Passwords and update the env var.
- **Facebook 190 "OAuthException"** → page token invalidated (admin change,
  password change, app permissions revoked). Regenerate per the steps in
  `backend/src/services/facebookClient.js` (top of file).
- **Bluesky 429 "RateLimitExceeded"** → check `blueskyCooldown` in the
  `/auto-errors` response. The circuit breaker auto-clears in 10 minutes.

## Stock-photo backgrounds for branded cards (Pexels)

The card renderer composites a tag-matched landscape photo behind the
headline + branding, giving Facebook / IG / LinkedIn posts the visual
weight of a real news publisher's social graphics. Free to use — no
attribution required on the card itself (Pexels license is permissive).

Setup (~60 seconds):

1. Sign up at <https://www.pexels.com/api/> (email-only, no payment).
2. Copy the API key from the dashboard.
3. Add it to **the same persistent location** as the social credentials
   above (Hostinger Environment Variables UI **or** `~/.scoopfeeds.env`):

   ```
   PEXELS_API_KEY=<your-key>
   ```

4. Restart the Node app. Next post-cycle the cards will be photo-backed.

Free tier limit: 200 reqs/hour, 20,000 reqs/month. Auto-poster cadence is
~30 posts/day across platforms → ~900/month → well under the limit. Photos
are cached per-article in `data/stock-photos/` so re-posting / regenerating
doesn't re-hit the API.

**Without the key set**, the renderer falls back to the typographic-only
design — still strong, just not photographic. So this is a "make-it-better"
upgrade, not a critical dependency.
