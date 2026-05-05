# Hostinger Migration Plan
Document type: Operational runbook
Owner: DrJ
Last updated: 2026-04-19
Status: Active

Scoop is moving from `scoop.urbenofficial.com` to `scoopfeeds.com` on Hostinger.

## Primary site

- Primary domain: `https://scoopfeeds.com`
- Backend listens on `PORT` and defaults to `3000`
- The app should be deployed as a Node.js web app on Hostinger

## Legacy domain redirect

The old domain should 301 redirect to the new one:

- `https://scoop.urbenofficial.com/*` → `https://scoopfeeds.com/*`
- `https://www.scoop.urbenofficial.com/*` → `https://scoopfeeds.com/*`

This repo now supports that redirect in the backend via:

- `PRIMARY_SITE_URL`
- `REDIRECT_FROM_HOSTS`

## Deployment notes

1. Deploy the Scoop app to Hostinger under `scoopfeeds.com`.
2. Set `PRIMARY_SITE_URL=https://scoopfeeds.com`.
3. Set `REDIRECT_FROM_HOSTS=scoop.urbenofficial.com,www.scoop.urbenofficial.com`.
4. Keep `ENABLE_SCHEDULER=true` for normal production, or set it to `false` temporarily if you need to isolate a startup problem.
5. Set your AdSense and analytics env vars on the Hostinger app.
6. Confirm `https://scoopfeeds.com` works before switching DNS for the old domain.
7. Point `scoop.urbenofficial.com` to Hostinger and let the app redirect it.

## Verification checklist

- `https://scoopfeeds.com` loads the homepage
- `https://scoopfeeds.com/api/health` returns OK
- `https://scoop.urbenofficial.com/` returns a 301 to `https://scoopfeeds.com/`
- The page source for `scoopfeeds.com` includes your AdSense and analytics tags
