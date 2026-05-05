# Mediavine / Ezoic Readiness Checklist
Document type: Operational runbook
Owner: DrJ
Last updated: 2026-04-25
Status: Active

Apply **now** — review takes 2–4 weeks. Submit before you hit the threshold,
not after.

---

## Mediavine Journey (lowest tier)

**Hard requirement:** 10 000 monthly sessions (not pageviews).  
Mediavine reads this from a GA4 property you share with them during the
application. Sessions ≠ pageviews — GA4 groups pageviews into sessions by
same user within 30 minutes.

### Traffic gate
- [ ] GA4 → Reports → Acquisition → Overview → last 28 days ≥ 10 000 **sessions**
- [ ] Trend is flat or growing (declining traffic = rejection)
- [ ] Primary traffic source is organic search or direct (not paid, not bots)

### Content quality gate
- [ ] At least 10 original or substantially synthesised article pages indexed
- [ ] Each article page has ≥ 300 words of unique body text (verify via
      Google Search Console → Pages → drill into any article URL → cached)
- [ ] E-E-A-T pages live and indexed: `/about`, `/editorial-policy`,
      `/contact`, `/privacy` (check Search Console → URL Inspection)
- [ ] No thin pages that are just a headline + outbound link — Mediavine
      reviewers manually browse the site

### Technical gate
- [ ] Google AdSense account approved and serving ads (Mediavine requires
      an existing AdSense history — they take it over, not replace it from scratch)
- [ ] AdSense `ads.txt` file at `scoopfeeds.com/ads.txt` returns 200
      (`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, ...`)
- [ ] Core Web Vitals: LCP < 2.5 s, CLS < 0.1, INP < 200 ms
      (check PageSpeed Insights for both mobile and desktop on an article page)
- [ ] Site is HTTPS with valid cert (already live on Hostinger ✓)
- [ ] No interstitial pop-ups that block content on first load
      (the push opt-in banner triggers after 90 s + 1 scroll — this is fine)

### Application steps
1. Go to [mediavine.com/get-mediavine](https://www.mediavine.com/get-mediavine/)
2. Submit with your GA4 property ID (format: G-XXXXXXXXXX)
3. Connect GA4 via the "Link GA4" OAuth flow they send in the confirmation email
4. Mediavine will reply within 2–4 weeks with either approval or a list of issues

---

## Ezoic (alternative / backup)

**No hard session minimum** — Ezoic accepts sites at any traffic level under
their "Ezoic Access Now" programme, but RPM is much lower until you hit their
Levels system (Level 1: 0–10k visits/mo, Level 4: 100k+/mo).

Ezoic is worth applying to in parallel as a fallback if Mediavine rejects.

### Application steps
1. Go to [ezoic.com/publishers](https://www.ezoic.com/publishers/)
2. Choose **Ezoic Access Now** (no minimum traffic)
3. Connect GA4 + Search Console via OAuth
4. Add their `ezoic.net` nameserver CNAME or install their WordPress plugin
   (for Node.js: use the **Ezoic Cloud Integration** — they become a reverse
   proxy in front of your site via a DNS CNAME change on Hostinger)
5. Run their **Site Speed Accelerator** test — this is a selling point for
   their ad stack

### Ezoic DNS integration on Hostinger
The simplest path for a Node.js app is the **Cloud Integration**:
1. Hostinger DNS → change the A record for `scoopfeeds.com` to point at the
   IP Ezoic provides during setup
2. Ezoic proxies all traffic, injects their ad tags server-side, passes the
   request on to your origin
3. No code changes needed on the backend

---

## After approval — switching from AdSense

Both networks take over your AdSense account (they become a reseller). The
switch sequence for scoopfeeds.com:

1. Mediavine / Ezoic sends you their ad tag snippet
2. In `.env` on Hostinger, set `ADSENSE_TEST_MODE=false` → `ADSENSE_TEST_MODE=true`
   to pause AdSense rendering without removing the `ads.txt` entry
3. Add their new `ads.txt` lines (they provide them) to the `ADSENSE_PUBLISHER_ID`
   environment variable or directly in the `/ads.txt` route handler
   (`backend/src/routes/seo.js` → search for `ads.txt`)
4. Replace the AdSense `<script>` tags in `frontend/index.html` with their
   header tag (or use the `publicConfig.adsense` feature-flag path in
   `frontend/src/components/ads/AdSense.jsx` to kill AdSense rendering while
   the new network initialises)
5. Monitor RPM in their dashboard for the first 7 days — typical lift is 1.8–3×
   over AdSense direct

---

## RPM benchmarks to set expectations

| Network | RPM (US/UK traffic) | RPM (PK/IN traffic) | Approval time |
|---|---|---|---|
| AdSense (current) | $1–3 | $0.20–0.60 | Already live |
| Ezoic Access Now | $2–6 | $0.50–1.50 | 1–2 weeks |
| Mediavine Journey | $8–18 | $1–3 | 2–4 weeks |
| Mediavine (full, 50k+ sessions) | $15–30 | $2–5 | — |

*RPM = revenue per 1 000 pageviews. News sites trend toward the lower end of
these ranges because dwell time is short. Supplement with affiliate wrapping
(Skimlinks) to capture the readers who click outbound.*

---

## Quick-win while waiting for approval

Skimlinks can be live in 48 hours and requires zero ongoing work:

1. Sign up at [skimlinks.com/publishers](https://skimlinks.com/publishers/)
2. Add their 2-line JS snippet to `frontend/index.html` (before `</body>`)
3. They automatically affiliate-wrap all outbound product links on the page
4. No per-merchant setup; they handle link detection and cookie attribution
5. Expected lift: $0.05–0.40 EPC on articles in cars, health, tech, science
   categories where product links appear

This runs alongside AdSense / Mediavine — there is no conflict.
