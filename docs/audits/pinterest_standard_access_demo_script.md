# Pinterest Standard Access Demo Video Script

**Application:** Scoopfeeds Autoposter (Pinterest Developer App)
**Recording date:** May 19, 2026
**Duration target:** 2.5 minutes
**Tool:** QuickTime Player (Cmd+Shift+5 → New Screen Recording)
**Audio:** Voiceover OR text overlays (DrJ choice)
**Resolution:** 1920×1080 minimum
**Output:** `docs/audits/pinterest_standard_access_demo_video.mov` (NOT committed to git — too large; stored separately by DrJ)

---

## Pre-recording checklist

Before starting QuickTime:

- [ ] Pinterest re-enabled in production (`PINTEREST_ACCESS_TOKEN` restored, backend restarted; verify via `/scoop-ops/auto-status` showing `pinterest` in `enabled` array)
- [ ] Close non-essential browser tabs (Pinterest reviewer shouldn't see Slack, email, etc.)
- [ ] Open Terminal at `/Users/jahanzebhussain/Downloads/scoop-news`
- [ ] Open browser Tab 1: https://scoopfeeds.com (homepage)
- [ ] Open browser Tab 2: https://www.pinterest.com — logged into Scoopfeeds business Pinterest account → Main board (so Scene 5 shows the pin without authentication step)
- [ ] Have admin token ready in password manager (paste during Scene 4 live curl)
- [ ] Disable system notifications (Do Not Disturb)
- [ ] Quit Slack, email clients
- [ ] Test recording first: 10-second test to verify audio + video capture working

---

## Scene 1 — Introduce Scoopfeeds (~30 sec)

### Visual
Browser Tab 1: scoopfeeds.com homepage

### Action
Scroll slowly through homepage showing article cards across categories (world, politics, tech, climate).

### Narration / overlay text
"Scoopfeeds is a news intelligence platform aggregating high-credibility news across world events, politics, technology, climate, and markets. This video demonstrates our Pinterest API v5 integration, built for our @scoopfeeds business Pinterest account. The integration generates pins from published Scoopfeeds articles, with each pin linking back to the source article for our audience to read full coverage."

---

## Scene 2 — OAuth flow integration (~30 sec)

### Visual
Switch to Terminal. Show `pinterest-auth.mjs` script structure.

### Command to run during recording

```bash
cat backend/scripts/pinterest-auth.mjs | head -40
```

### Narration / overlay text
"Our OAuth flow uses Pinterest API v5 Authorization Code grant type. We request scopes user_accounts:read, boards:read, boards:write, pins:read, and pins:write. The flow runs locally on port 8088, exchanges authorization code for access and refresh tokens, and lists available boards. Tokens are stored as environment variables. Refresh tokens enable 60-day rotation without re-authorization."

---

## Scene 3 — Backend integration architecture (~45 sec)

### Visual
Terminal: show `pinterestClient.js` content.

### Command to run during recording

```bash
cat backend/src/services/pinterestClient.js
```

### Narration / overlay text
"The Pinterest client targets the configured board via PINTEREST_BOARD_ID environment variable. The API base URL is configurable for sandbox-versus-production routing. Pin creation uses POST /v5/pins with media source as image URL. Title is capped at 100 characters and description at 500 characters per Pinterest specifications. Image source uses our OG card endpoint, generating 1200×630 pixel images optimized for Pinterest's display format. Authentication uses OAuth bearer token in the request header."

---

## Scene 4 — Live pin creation via API (~45 sec)

### Visual
Terminal: prepared curl command with admin token already pasted.

### Command to run during recording

```bash
curl -X POST "https://scoopfeeds.com/scoop-ops/auto-post?platform=pinterest" -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
```

DrJ substitutes `<ADMIN_TOKEN>` with actual admin token before recording. Token will appear briefly in terminal — **rotate admin token AFTER video recording per security note below.**

### Narration / overlay text
(while curl executes)
"Triggering pin creation via our admin API. The backend selects a high-credibility article from our recent ingestion, generates the OG card image, composes pin caption and title, and posts to the Pinterest API."

(when JSON response appears showing pin URL)
"Pin successfully created. Response shows pin ID, pin URL on Pinterest, article ID, and confirmation."

### Expected JSON response format

```json
{
  "ok": true,
  "platform": "pinterest",
  "posted": true,
  "url": "https://www.pinterest.com/pin/<pin_id>/",
  "platformPostId": "<pin_id>",
  "article": { ... }
}
```

---

## Scene 5 — Pin visible in Pinterest account (~20 sec)

### Visual
Switch to browser Tab 2: Scoopfeeds business Pinterest account → Main board. Already logged in (no auth screen visible).

### Action
Scroll to find the pin created in Scene 4 (will be the most recent pin, top-left of board). Click into the pin to show detail view with title, description, image, and source link.

### Fallback

If the Scene 4 pin doesn't appear immediately on the Main board (Pinterest CDN propagation can take a few seconds to a minute), use a pre-existing pin on the Main board instead. The reviewer sees a real pin in the account; doesn't matter whether it's Scene 4's pin or an earlier one. Goal: demonstrate pin appearing in account, not specifically the Scene 4 pin.

### Narration / overlay text
"Here's the pin live on our Scoopfeeds business Pinterest account, Main board. The pin shows article title, the composed description, the OG card image generated by our backend, and links back to the source article on scoopfeeds.com."

---

## Outro (~10 sec)

### Visual
Side-by-side: scoopfeeds.com tab + Pinterest account tab.

### Narration / overlay text
"Scoopfeeds currently operates under Pinterest Trial access. We're applying for Standard access to enable public visibility of these pins for our Pinterest audience. Thank you for reviewing."

---

## Post-recording actions

- [ ] Stop QuickTime recording (button in screen recording toolbar)
- [ ] Save .mov file as `pinterest_standard_access_demo_video.mov`
- [ ] Review the recording (especially Scene 4): confirm admin token is briefly visible
- [ ] **CRITICAL: Rotate admin token immediately after** — generate new token via `openssl rand -hex 32`, update Hostinger production env, restart backend, save new token in password manager. The token visible in video is no longer trusted.
- [ ] If audio quality poor or scene rushed: re-record problematic scenes
- [ ] Upload video to hosting (YouTube unlisted, Vimeo, Loom, etc.) OR have file ready for direct upload to Pinterest
- [ ] Note video URL for Pinterest application form

## Pinterest application form prep

When submitting at developers.pinterest.com → "Scoopfeeds Autoposter" app → "Apply for Standard access" (or similar "Upgrade" button):

Expected form fields:

- **App description**: "Scoopfeeds is a news intelligence platform aggregating high-credibility news across world events, politics, technology, climate, and markets. Pinterest integration automatically generates pins from published Scoopfeeds articles for our @scoopfeeds business Pinterest account."
- **Use case**: "Automated content distribution from our news curation platform to Pinterest. Each pin links to the source article on scoopfeeds.com for full content. Posting cadence is limited to 4-6 pins per day to respect Pinterest's discovery algorithm and avoid spam patterns."
- **Demo video**: Upload .mov file OR paste video URL
- **Privacy policy URL**: https://scoopfeeds.com/privacy (confirmed HTTP 200)
- **Terms of service URL**: https://scoopfeeds.com/terms (confirmed HTTP 200)
- **Editorial standards URL** (if asked): https://scoopfeeds.com/editorial-policy (confirmed HTTP 200)
- **Estimated API usage**: "4-6 pin creations per day. Single authenticated account. No user-facing OAuth flows for end users."
- **Contact email**: DrJ's Scoopfeeds business email

Capture application confirmation reference + submission timestamp for retrospective inputs.
