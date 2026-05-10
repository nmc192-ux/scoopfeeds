# Phase A — Retrospective Inputs

This file accumulates findings during Phase A execution. Sprint 6's
formal Phase A Retrospective will synthesize these into structured
lessons.

## Sprint 1 findings

### 1. Brief inaccuracies surfaced in 3 of 4 code issues
Issues 1.3 (auth model), 1.4 (translation gap), 1.5 (cost framing)
each had Brief framings that investigation corrected. Future Phase
Briefs should build investigation phases into every issue by default,
not as exceptions.

### 2. Translation pipeline produces poor-quality Urdu output
Discovered via Issue 1.4 production deploy. Mojibake characters
in translated content; partial translations leaving English mixed
with Urdu. Affects: AI service routing, source content pipeline,
UI rendering. Phase B/C investigation needed.

### 3. Mixed English-Urdu content in RTL mode creates UX problems
Even when individual translations are clean, English-source content
displayed in RTL layout reads badly. Phase B/C should consider
per-content-direction handling.

### 4. Hostinger GitHub auto-deploy disconnection
Exact cause unclear; manual redeploys work fine. Don't investigate
mid-Phase-A unless it becomes painful.

### 5. Codex's prior hardening was more thorough than Brief credited
Admin auth was already enforced globally before Sprint 1 began.
Issue 1.3 was code clarity, not a security fix. The Brief's framing
("close fail-open gap") was incorrect; the commit message corrected it.

### 6. Smoke test design referenced non-existent metric
Sprint 1 Issue 1.5 smoke test referenced `lastTimelineBuilderRun`
field in `/api/health` that doesn't exist. Future smoke-test plans
should verify metric existence before shipping. For timeline-builder
specifically, post-deploy verification needs to be log-based or
DB-based — or add instrumentation as part of Sprint 3 metrics work.

### 7. Alarm response to ambiguous data needs calibration
Article count drops and uptime resets are normal in cloud hosting;
not every anomaly is a bug signal. First diagnostic should always
be "is this metric meaningful?" before "is this metric broken?"

### 8. Hostinger restarts cause partial database rollback
Production has experienced two restarts in 37 hours, each causing
~300-600 articles to disappear from the database (15,269 → 14,897 →
14,301). Articles ingested in stable periods persist correctly
(verified: 14,301 → 14,498 over 50 minutes of stable uptime, ~4
articles/minute ingestion). The loss happens at restart events,
suggesting news.db is being restored from a snapshot taken before
the most recent ingestion period. Likely root cause: Hostinger
persistent-storage configuration where the database file lives on
ephemeral storage and snapshots restore on restart. Fix likely
involves moving the database to a persistent volume or adjusting
backup/restore policy. Investigation needed in a separate session:
confirm via file-system inspection where news.db is stored and
whether sibling backup files exist with stale snapshots. Logged for
Phase A retrospective; not blocking Sprint 2 work because production
is functional in stable periods and restarts are infrequent.

### 9. Phase A Brief described a phantom bug in Issue 2.1
Sprint 2 Issue 2.1 was scoped to fix "ALTER TABLE migrations re-run
on every restart and log success even when no-op." Investigation
revealed all 5 ALTER TABLE sites in the codebase already use a
column-existence guard pattern (PRAGMA + if (!cols.some(...))) that
short-circuits before any log fires on already-applied migrations.
The formal migration system at backend/src/db/migrate.js tracks
applied migrations in a schema_migrations table and is also
idempotent. Issue 2.1 closed as no-op; no code change needed.

This is the second case in Phase A where the Brief described
behavior that didn't match the codebase (the first was Sprint 1
Issue 1.3, where the local requireAdmin in ri-ops.js was already
dead code due to upstream global middleware). Pattern: the Brief
was written without full knowledge of Codex's prior hardening work.
Going forward, every Phase A issue's investigation phase should
include a "verify the Brief's premise" check before proposing a
fix, and Issues that turn out to be no-ops should be tracked as
a meta-data point about Brief accuracy.

### 10. /api/events endpoint returns 500 in production
Production smoke testing of CSP Stage 1 (Issue 2.2) revealed that
GET /api/events returns 500 Internal Server Error. Unrelated to
Sprint 2 work — pre-existing condition surfaced by a clearer
console view (CSP work quieted third-party noise). Endpoint is
called by the homepage on load. Investigation needed: check
Hostinger Runtime Logs for stack traces, identify the failing
operation, fix. May relate to retrospective input #8 (Hostinger
restart database rollback) if the events table is being affected
by restart-time data loss. Investigation deferred to a separate
session focused on production stability.

### 11. Issue 2.4 integration summary log missing from Runtime Logs
After production deploy of Sprint 2 Issue 2.4 (commit 12cd630),
the expected "🔌 integrations summary: X/Y configured" log line
does not appear in Hostinger Runtime Logs. The log line passes
local syntax check and the file (backend/src/config/integrations.js)
was created and committed correctly. Possibilities: (a) Hostinger's
log panel filters certain emoji or formats; (b) winston meta-object
serialization fails silently in production; (c) a runtime error in
collectIntegrationStatus() throws and the try/catch swallows the
emit; (d) the lazy import paths fail at runtime in production's
file layout. Investigation needed: SSH to production, check actual
process stderr/stdout, or add a fallback plain-text emit.
Investigation deferred to a separate session.

### 12. Hostinger lsnode bridge does not capture winston output
Investigation of finding #11 revealed that Hostinger's lsnode.js
LiteSpeed bridge captures console.* method calls but does NOT
capture winston's process.stdout.write output. Consequence: all
winston-emitted logs (logger.info, logger.warn, logger.error) are
invisible in Hostinger Runtime Logs panel. Affected log streams
include:
- All startup logs (🚀 NewsFlow API, 📰 RSS sources, ⏰ Refresh,
  scheduler status, integration summary from Issue 2.4)
- CSP violation logs via /api/csp-report (Issue 2.2 Stage 1)
- Admin auth audit logs (Issue 1.3 work)
- All error stack traces from any logger.error call

Operationally significant because it means we've had a production
observability blackout since the codebase started using winston.
Real CSP violations being collected at /api/csp-report cannot be
read in Hostinger; we'd been relying on synthetic curl tests for
verification.

Finding #11's narrow fix (commit f2fc7f5) addresses the integration
summary specifically by adding a parallel console.log. The systemic
fix (making all winston output visible) requires modifying
backend/src/services/logger.js.

Investigation in Phase 2 of session 4 evaluated four approaches:
(a) custom winston Transport subclass that calls console.log;
(b) replacement Console transport library; (c) logger.js wrapper
around logger.info/warn/error; (d) winston 3.11's built-in
forceConsole: true flag on the existing Console transport.

Root cause confirmed by reading
backend/node_modules/winston/lib/winston/transports/console.js
lines 85-91: by default the Console transport writes via
`console._stdout.write(...)` (an internal Node Console property
pointing at process.stdout) rather than `console.log(...)`.
lsnode patches console.log but not the underlying _stdout stream,
hence the invisibility.

Recommendation: option (d). Setting forceConsole: true on the
existing Console transport routes writes through this._consoleLog
(a console.log.bind(console) reference set at transport
construction), which lsnode does intercept. Single-line config
change in logger.js; zero risk to existing call sites (winston's
public API and message format are unchanged); this is the exact
use case the forceConsole flag was designed for (process managers
and serverless environments that monkey-patch console but not raw
stdout streams).

Next session should:
1. Apply forceConsole: true to the Console transport in
   backend/src/services/logger.js
2. Deploy and verify the existing winston.info startup lines
   appear in Hostinger Runtime Logs
3. If verified, decide whether to remove the narrow console.log
   fallback added in commit f2fc7f5 (server.js) — the root-cause
   fix obviates it, but leaving it as belt-and-braces is also fine
4. Confirm CSP violation logs from /api/csp-report are now visible
   too (the original purpose of Issue 2.2 Stage 1 — observation —
   has been partly defeated by the invisibility gap, so this
   verification is operationally important)

### 13. forceConsole flag on winston Console transport crashes production
The systemic observability fix identified by session 4's investigation
(adding forceConsole: true to backend/src/services/logger.js's Console
transport, per finding #12's Phase 2 recommendation) caused immediate
production failure when deployed.

Timeline (2026-05-08):
- 20:20:54 UTC — Hostinger deploy of commit 4a0abd9 (forceConsole
  flag added) completed
- Shortly after — Production began returning HTTP 503 across all
  endpoints; LiteSpeed could not connect to the Node.js process
- Recovery — Revert commit c67b741 created and deployed; production
  returned to 200 status within ~90 seconds of the revert deploy
- Post-recovery — Article ingestion resumed normally (18,326 → 18,576
  during the session); no apparent data loss

Root cause not yet investigated. Hypothesis space:
- winston "^3.11.0" may have resolved to an older version where
  forceConsole doesn't exist or behaves differently
- forceConsole may interact badly with the multi-transport setup
  (Console + 3 file transports)
- Production's lsnode environment may have console internals
  (console._stdout, console._consoleLog) that differ from
  documented behavior
- Side effect of forceConsole evaluation on the Console transport's
  format chain (combine + colorize + timestamp + custom format)

Future investigation should reproduce locally if possible
(potentially by running with NODE_ENV mimicking production), check
the actual installed winston version in production node_modules,
and consider alternative approaches if forceConsole proves
fundamentally incompatible:
- Custom Console-compatible Transport that calls console.log directly
- Logger module wrapper mirroring all calls to console.log
- Replace winston with a library whose Console output uses console.log

The narrow stdout fallback in commit f2fc7f5 (added console.log
specifically for the integration summary) remains in place and
provides minimal observability for that one log line. The systemic
observability gap (winston output invisible to Hostinger Runtime
Logs) remains open.

### 14. Local node --check is insufficient verification for foundational infrastructure changes
The forceConsole change in commit 4a0abd9 passed local node --check
syntax validation but crashed at runtime in production. This is the
inherent gap of static-only verification: the code is syntactically
valid but fails in the specific runtime environment.

Pattern observed across sessions:
- Issue 1.4 (Urdu RTL) — local Vite preview verification caught
  visual issues that node --check could not
- Issue 2.2 Stage 1 (CSP) — staged report-only deploy caught
  AdSense fraud-detection allowlist gap before enforcement
- Issue 2.4 (integration log) — narrow fix shipped successfully but
  the log was invisible in Hostinger panel for unrelated reasons
- forceConsole — passed all available local checks but crashed
  production immediately

For future Phase A and Phase B+ changes touching foundational
infrastructure (logger, error handling, app startup, middleware,
authentication boundaries), defense-in-depth verification should
include:
- Pre-prepared revert path documented BEFORE deploy
- Deploy during low-traffic windows where feasible
- Immediate post-deploy verification curl (any 5xx triggers
  immediate revert without further diagnosis)
- Where possible, test in an environment that mimics production's
  runtime configuration (none currently exists for Scoopfeeds)
- For especially critical changes, consider a staged-deploy pattern
  similar to CSP Issue 2.2 (report-only first, enforcement second)
  where applicable

This finding refines the investigate-before-act discipline that has
served prior sessions. Investigation catches incorrect assumptions
in the planning phase; this finding addresses the verification gap
between "code looks correct" and "code works in production."

### 15. Phase A Brief was wrong about specific details in 5 of 6 code issues investigated
Pattern observed across Sprint 1 and Sprint 2 execution: when an
issue required investigation before editing, the Phase A Brief's
description of the bug or fix was substantively incorrect in 5 of
6 cases.

Cases:
- Sprint 1 Issue 1.3 (auth refactor) — Brief described fail-open
  ?key= bypass that was already dead code; upstream global
  middleware (Codex's prior hardening) was already enforcing auth.
  Fix scope was "remove dead code" not "harden vulnerable endpoint."
- Sprint 1 Issue 1.4 (Urdu RTL) — Brief premise correct but missed
  that translation pipeline produces mojibake regardless of CSS
  direction. RTL CSS shipped successfully; underlying translation
  quality issue captured separately for Phase B/C.
- Sprint 1 Issue 1.5 (timeline duplication) — Brief framed cost as
  LLM tokens; actual concern is DB operations. Brief said 2x
  duplication; actual was 3x (the inline call ran at :13/:19/:43,
  not just :19/:43).
- Sprint 2 Issue 2.1 (migration log spam) — Brief described
  phantom bug. All 5 ALTER TABLE sites already used column-existence
  guard pattern; no log fired on already-applied migrations. Closed
  as no-op.
- Sprint 2 Issue 2.3 (hollow features) — Brief identified Reality
  Index, Truth Gap, Anomalies, Briefs as needing explainer copy.
  All four pages already had explainer subheads via copyGuide.js.
  Real issues found through investigation: DashboardPage genuinely
  hollow signed-in state, MacroPage rendering bug at two
  COPY.brandTagline call sites.

Only Sprint 1 Issue 1.7 (production smoke test design) was
substantively as the Brief described, and even there the smoke test
referenced a non-existent metric.

Implication for Phase B brief authoring discipline:
- Briefs written without inspecting current code state will
  systematically misdescribe what needs fixing
- Investigation phase should be mandatory for every issue, not
  skipped on confidence
- Brief authors should validate at minimum: does the named bug
  exist in the form described? Does the proposed fix scope match
  the actual problem? Are there adjacent bugs the Brief framing
  would miss?

The investigation-before-edit discipline that emerged organically in
this Phase A has caught real problems repeatedly. Phase B should
formalize this as part of every issue's lifecycle rather than
discovering it again.

### 16. Sign-in flow returns Page Not Found in production
Verified during Issue 2.3 verification on 2026-05-08. Clicking
"Sign in with email" on https://scoopfeeds.com/dashboard
(signed-out state) routes to a Page Not Found page styled with
Scoopfeeds branding (suggesting the React app's catch-all 404
route is firing, not a Hostinger LiteSpeed 404).

User-facing impact: new users cannot create accounts or sign in
through the documented flow. The duration this has been broken is
unknown — possibly weeks based on prior screenshots showing similar
auth UI from April 2026.

Investigation needed:
- What URL does "Sign in with email" actually route to?
  (Right-click → inspect → check href, or use DevTools Network tab)
- Is the route registered in the React Router config?
- Is there a missing Vercel rewrite or Hostinger configuration?
- Is the auth backend responding correctly to whatever endpoint
  the frontend hits?
- Are there working sign-in paths (e.g., direct URL navigation)
  vs only the button click broken?

Priority: HIGH for next session. Sign-in is core user functionality
and the fix may be small (routing typo, missing rewrite) or
larger (auth integration regression). Investigation needed before
scoping the fix.

### 17. MacroPage data quality issues
Observations during Issue 2.3 verification:
- Indicators displayed in no apparent logical order (governance,
  exports, GDP, inflation, unemployment intermixed without grouping)
- Country coverage limited to a small set (US, India, China,
  European Union, World) when the backing APIs (FRED + World Bank)
  support far more
- Mixed data freshness (some indicators from 2018, most from
  2024-2025)
- "FRED (US)" tab is empty despite the page subhead claiming data
  comes from "St. Louis Fed (FRED) and World Bank Open Data" — all
  visible data appears to be World Bank sourced
- Page presents as ill-prepared/illogical to users

Not a blocker for any current sprint work. Captured for future
phase scope: a proper Macro feature build-out would include
indicator categorization, expanded country coverage, fresh data
priority, FRED ingestion verification, and likely a redesign of
the indicator card layout for visual hierarchy.

Defer to Phase B+ as a feature-level revisit, not a Sprint 2 fix.
The brand tagline rendering bug has been resolved (Issue 2.3
commit 240f2fd); the data quality work is separate and substantial.

### 18. Finding #16 RESOLVED — sign-in 404 fixed
Commit 88b2637 (this session) replaced obsolete <a href="/login">
in DashboardPage.jsx with modal-based auth pattern matching
Header.jsx. Production smoke test confirmed: clicking "Sign in
with email" now opens the AuthModal as intended.

Resolution method: pattern-matched the working Header.jsx auth
trigger. The bug existed because DashboardPage was written before
or alongside the auth refactor that moved from page-based to
modal-based sign-in. Other entry points were updated; DashboardPage
was missed.

### 19. Instagram auto-publisher in infinite loop on stale content
Discovered during Issue #16 smoke test on 2026-05-09. The Scoopfeeds
Instagram account had published the same Alex Batty / BBC Sport
story 181 times (most recent post 7 minutes before discovery).

Symptoms:
- Same article looped repeatedly
- Same article matches the "BREAKING" header on the homepage
  (suggests both the breaking-news selection AND the Instagram
  publishing logic are stuck on the same stale item)
- Post timestamp shows "BBC Sport · May 13" — date inconsistency
  (the date is in the future vs reasonable publication dates)

Operational action taken: Instagram publishing disabled via
Hostinger environment variable INSTAGRAM_USER_ID (set to empty)
to stop the bleeding. No code changes; root cause not yet
investigated.

Likely root causes (hypothesis):
- Article-ranking logic stuck (always returning the same "top"
  article regardless of refresh)
- Deduplication broken (publisher doesn't track which articles
  it's already posted)
- Article ingestion has stalled despite scheduler still firing
- Date parsing returning incorrect values causing same article
  to always score highest

Investigation needed for next session:
- Check the Instagram publisher's selection logic
- Check breaking-news selection logic (likely the same root
  cause based on identical content)
- Verify article ingestion is actually adding new "breaking"
  candidates, not just total articles
- Check the publisher's deduplication/already-posted tracking

### 20. Stale breaking news header on production
Same Alex Batty / BBC Sport headline has been the breaking-news
header for an unknown but extended period (hours+). Likely related
to finding #19 (same article loop in Instagram). Both surfaced
simultaneously during Issue #16 smoke test.

Suggests a single root cause: the system that decides "what's
breaking news right now" is stuck. May be:
- Article ranking returning fixed result
- "Breaking" classification logic not promoting newer articles
- Time/freshness factor not weighting recent articles correctly

Investigation paired with finding #19.

### 21. Dashboard UX — empty state lacks clear guidance to populate
Even with Issue 2.3's signed-in subhead ("Your saved events,
prediction markets, and analyst briefs. Star anything across the
site to add it here."), DrJ reports difficulty understanding how
to follow events or markets to populate the Dashboard.

Possible UX issues:
- "Star" affordance may not be visible enough on event/market
  pages
- Empty Dashboard might benefit from a more illustrative
  empty-state with example actions
- The path from "I want to follow X" to "X appears on my
  Dashboard" may have multiple steps that aren't obvious

Defer to Phase B+ as feature-level UX work, not Phase A scope.
Issue 2.3's subhead addressed the "what is this page" gap; the
"how do I populate it" gap is a separate, larger UX question.

### 22. Social media post quality (general observation)
Beyond the Instagram loop bug (finding #19), DrJ notes general
quality concerns about social media posts (Instagram, possibly
others — Bluesky, Threads, Facebook, LinkedIn, YouTube, etc.).

Specific quality issues not yet enumerated. Captured here as a
placeholder for future detailed observation. Phase B+ work.

### 23. Findings #19 and #20 PARTIALLY RESOLVED
Session 9 work addressed both findings:

Finding #19 (Instagram loop) structural cause resolved by commit
274e74e — `findFreshUnpostedArticles` JOIN now treats both
'posted' and 'failed' status as already-posted, preventing the
infinite-retry pattern. Investigation revealed this dedup leak
affected all 6 social platforms (bluesky, threads, facebook,
instagram, linkedin, pinterest), not just IG. The May 4 local DB
showed 51 failed Bluesky and 45 failed Facebook records consistent
with the same pattern.

Finding #20 (stale breaking news) resolved operationally for the
Alex Batty article via Phase 2 endpoint exercise — published_at
moved from 2026-05-13 (future, RSS misparsed) to 2026-04-09 (30
days past). Breaking-news banner verified to show different article.

REMAINING for #19 and #20:
- Re-enable Instagram in next session, watch one full cycle to
  verify dedup fix works structurally
- The article will not naturally cause issues again because both
  the structural fix (Phase 1) AND the operational fix landed
- However, the RSS date-parsing precondition is still unfixed —
  see finding #25

### 24. Admin operational tooling for stuck articles now exists
Phase 2 of session 9 shipped POST /scoop-ops/articles/:id/
set-published-at as a narrow admin remediation endpoint:
- Single-purpose: updates one article's published_at field only
- Validation: rejects future dates (the bug pattern), rejects
  dates >1y in past (sanity), validates id length (≤128 chars),
  validates ms type
- Inherits admin auth from existing /scoop-ops/* boundary
- Returns before/after JSON for verification

Use case demonstrated: corrected Alex Batty article's misparsed
publication date.

This endpoint is operational tooling, not strategic. The strategic
fix (RSS date parsing hardening) is still needed — see finding #25.

If similar stuck articles surface in the future:
1. Find article ID via /api/news/featured (response shape is
   {success, data, meta} where data is the array)
2. Calculate target ms timestamp (typically 30 days ago)
3. POST to /scoop-ops/articles/{id}/set-published-at with
   {"published_at_ms": <ms>}
4. Verify symptom resolved

### 25. RSS date-parsing strategic fix STILL DEFERRED
Investigation in session 9 confirmed that the Alex Batty article's
future-dated published_at originated from RSS ingestion misreading
"May 13" from BBC documentary content as the article's publication
date. The "Coming soon:" prefix in the title indicates this was a
documentary promo, where dates in the article body refer to
broadcast schedules, not publication.

Phase 1 dedup fix and Phase 2 operational tooling reduce the
visible damage of this bug, but the precondition itself remains
unfixed. Other articles with similar promotional content patterns
(future broadcast/event dates parsed as publication dates) could
still trigger:
- Stale breaking-news banner (until article ages out)
- Stuck position in Top/Featured ranking
- Until structural fix lands, these would need manual remediation
  via the new admin endpoint

Investigation deferred to a future dedicated session. Scope:
- Identify which RSS parser library/code is responsible
  (rss-parser, custom logic, etc.)
- Find the date-extraction logic
- Determine whether the bug is general (any date string in
  content beats the RSS-spec pubDate) or specific to a pattern
- Fix to prefer RSS-spec pubDate fields (item.pubDate,
  item.published, dc:date) over content-extracted dates
- Audit existing articles for other future-dated published_at
  values that may need similar remediation
- Add validation at ingest time to reject future-dated articles

Likely 2-4 hour dedicated session. Priority: MEDIUM (structural fix
exists for the loop symptom; this is hardening against future
recurrence).

### 26. Token storage discrepancy between password manager and Hostinger
During session 9 Phase 2 execution, the ADMIN_BEARER_TOKEN value
in DrJ's password manager (saved during Sprint 1 Issue 1.2) did not
match the value currently set in Hostinger's environment variables.
Token had to be re-fetched from Hostinger panel directly to
successfully call the new admin endpoint.

Possibilities:
- Token was rotated in Hostinger at some point and password
  manager was not updated
- Password manager entry was wrong from the start (typo on save)
- Multiple tokens exist for different environments and password
  manager has the wrong one

Operational impact: significant friction in admin operations. Any
future use of /scoop-ops/* endpoints depends on having the correct
token readily available.

Recommended action (not urgent): reconcile the token storage.
Either:
- Update password manager with the value currently in Hostinger
- Or rotate to a new known value, set in both Hostinger and
  password manager simultaneously
- Document the canonical storage location going forward

Captured here for next-session attention.

### 27. Session 9 fatigue indicators in extended-session mode
Session 9 was an extended (~4 hour) session that successfully
shipped Phase 1 and Phase 2 of a planned 7-phase sequence. The
session was deliberately curtailed at Phase 2 completion because
of accumulating fatigue indicators:

- Curl substitution error: ran POST with timestamp value used as
  article ID and literal "<MS>" placeholder in body
- Multi-line paste error: pasted entire chat block into terminal,
  causing zsh to attempt executing prompt text as commands
- Admin token mismatch: required 15 minutes of credential
  reconciliation mid-fix execution

None of these caused production harm — endpoint validation rejected
the malformed request, terminal errors were self-contained, and
token retry succeeded after reconciliation. But the trend across
3+ hours of operational work suggests:

PATTERN: Extended sessions (>3 hours) involving operational
production changes (vs pure investigation or surgical commits)
benefit from breaking into multiple shorter sessions, even when the
operator reports being "fresh" and "good to go". Self-reported
fatigue is unreliable; the error pattern is the more honest signal.

For future sessions involving similar operational scope:
- Default to 2-hour caps regardless of stated availability
- Build in mandatory 5-minute breaks between phases (worked well
  this session)
- For credential-touching operations, establish credentials in a
  separate prep step BEFORE the operational session begins
- The "investigate-first" discipline that catches static bugs
  doesn't help with operational fatigue; that requires session
  scoping

Phases 4-7 of the original session 9 plan (breaking-news ticker,
category-aware breaking news, internal-link click destination,
re-enable Instagram) all deferred to subsequent sessions.

### 28. Phase 4 (breaking news marquee) shipped successfully
Session 10 work delivered the multi-item rotating ticker described
in session 9's Phase 4 plan. Implementation:

- CSS-driven horizontal marquee replaces single-item static banner
- Continuous concat: all matching headlines join into one
  scrolling track with bullet separators
- Right-to-left direction regardless of locale (per design call)
- Each headline is its own clickable <a> element
- Pause on hover/focus
- prefers-reduced-motion handling: stops scrolling, shows first
  matching headline statically
- Banner-level dismiss (X button) preserved
- Visual identity (orange BREAKING pill, gradient bar, height)
  preserved

Verified working:
- Desktop browsers: scrolling ticker as designed
- Android Chrome: scrolling ticker as designed
- iOS Safari with Reduce Motion OFF: scrolling ticker as designed
- iOS Safari with Reduce Motion ON: static first-headline
  fallback (respects accessibility preference)

The ticker provides defense-in-depth on top of session 9's
Phase 1 dedup fix and Phase 2 article remediation. Stuck content
now rotates out of focus naturally instead of remaining
permanently visible.

### 29. Click destination remains external (Phase 6 deferred)
Breaking news banner clicks still open the original article URL
in a new tab via target="_blank" — preserves pre-existing
behavior, not a regression introduced by Phase 4.

Phase 6 of session 9's original plan (change banner clicks to
open in-app reader matching news-card pattern) was deferred
during session 9 due to scope, and not addressed in session 10.

Effort estimate: ~20-30 min in a focused next session. Change is
small (replace target="_blank" + external href with internal
navigation pattern matching news cards) but requires
verification that Scoopfeeds' in-app reader handles the article
shape returned from /api/news/featured.

Priority: medium. User-facing inconsistency between banner
behavior and rest of site, but not a bug.

### 30. Transient "Backend Not Running" UI observed during smoke test
During session 10's production smoke test of Phase 4 marquee
deploy, briefly observed the React app's "Backend Not Running"
fallback page (the message that renders when useHealth() returns
an error or unreachable response). Production was actually up
during this window — curl checks returned HTTP 200 from both
homepage and /api/health within seconds of observation.

Possible causes:
- Brief connectivity blip during production restart that the
  frontend's useHealth hook detected and surfaced
- Frontend-backend reconnect timing edge case
- CDN cache propagation delay after redeploy

Not investigated in session 10 because production self-recovered
and verification continued normally. Captured for awareness; if
this becomes a recurring pattern, investigation worthwhile.

### 31. iOS Reduce Motion accessibility behavior
A non-trivial portion of iOS users have Reduce Motion enabled by
default (some iPhone configurations enable it automatically; some
users enable it manually for vestibular conditions or motion
sensitivity). For these users, the breaking news ticker
intentionally shows the first matching headline statically rather
than the scrolling ticker.

This is correct behavior per WCAG and Apple HIG accessibility
guidelines. No code change needed.

Captured for product awareness:
- Subset of iOS users won't see the marquee experience
- The static fallback shows the highest-credibility most-recent
  matching article (the "best single item" of what would have
  rotated)
- Phase 1 dedup fix and Phase 2 article remediation already
  prevent stale-content issues for those users
- If product wants to override Reduce Motion for this banner
  (not recommended), would require deliberately ignoring the
  user's accessibility preference

### 32. Phase 6 deploy correlated with production outage — root cause unclear
Session 11 attempted to ship Phase 6 of session 9's original plan
(change breaking news banner click destination from external
new-tab to in-app reader). The change in commit 7fa4d33 was a
3-edit diff in BreakingBanner.jsx:
- Added useReaderStore import
- Added const openReader = useReaderStore((s) => s.openReader)
- Replaced target="_blank"/rel attributes with onClick handler
  calling openReader(article) at two link sites

Diff was minimal, frontend-only, matched the existing pattern in
NewsCard.jsx and FeaturedCard.jsx exactly. Local Vite verification
was bundle-level only (same blocker as Issues 1.4, session 6, 8,
10 — backend not running locally).

After push and Hostinger redeploy of 7fa4d33:
- DrJ reported scoopfeeds.com not loading
- curl to https://scoopfeeds.com/ hung indefinitely (no response,
  no error code)
- Terminal eventually became unresponsive on the curl process
- Spotlight on Mac briefly became slow (recovered)
- Force-quit Terminal app, opened fresh terminal
- Reverted 7fa4d33 via commit c7421ad, pushed
- Triggered Hostinger redeploy of revert
- Production immediately returned to healthy 200 responses

Root cause UNKNOWN. Two hypotheses, neither verified:

Hypothesis A: The Phase 6 commit somehow crashed production
despite being a 3-edit frontend-only change that touched no
infrastructure. Mechanism by which a click handler change could
crash a Node.js backend or LiteSpeed reverse proxy is not obvious.

Hypothesis B: Local Mac/network failure made production appear
unreachable when it was actually healthy. The simultaneous
unresponsiveness of curl, Terminal, and (briefly) Spotlight is
more consistent with local-machine issues than with a remote
production crash. Phone-check was not performed during the
incident window to disambiguate.

Diagnostic gap: when "site not loading" was first reported,
operator should have checked from a second device (phone, with
cellular data) before assuming production was down. This was the
critical disambiguation step that was skipped under stress.

Action for next session:
1. Investigate before re-deploying Phase 6:
   - Check Hostinger Runtime Logs from the deploy time of
     7fa4d33 (00:48-00:50 UTC May 10) — were there startup errors?
   - Check if 7fa4d33 actually built successfully on Hostinger
     (was the deploy "Completed" or did it silently fail?)
   - Confirm via fresh deploy whether the same change crashes
     again or whether the previous "outage" was unrelated
2. If Hostinger logs show clean deploy of 7fa4d33: re-deploy
   Phase 6, monitor more carefully (phone-check from start)
3. If Hostinger logs show errors: investigate what specifically
   went wrong before any re-deploy attempt

This finding marks Phase 6 status as "unverified to work in
production" rather than shipped. The user-facing behavior
(banner clicks open external source) remains the pre-existing
state.

### 33. Diagnostic discipline under stress: distinguish local from remote symptoms
Session 11's incident response highlighted a recurring failure
mode: when symptoms suggest production is down, local-machine
issues can produce identical-looking symptoms (hung curl, browser
not loading, etc.). Without a verification path that bypasses the
local machine, root cause cannot be reliably identified.

The discipline missed in session 11:
- Phone check (cellular data, bypasses local WiFi/DNS) was not
  performed before reverting
- Reverting under uncertainty is asymmetric — if the change DID
  crash production, revert is correct; if it didn't, revert
  unnecessarily undoes work and creates churn

Pattern observed: under stress, the cognitive load of "is
production down?" + "what should I do?" combines into "revert
fast." This is sometimes correct (session 5's forceConsole) but
not always (this session, possibly).

Improvement: build a 60-second verification ritual into incident
response:
1. Try a curl with --max-time 10 (forces a result, not a hang)
2. Open the site on a phone with cellular data
3. Check Hostinger panel for Site Status indicator if available
4. Only after these three signals agree on "production down" do
   we revert

This discipline applies to ANY future incident response session.
Capture in operational practices for subsequent phases.

### 34. Recurring local Vite verification gap (compounding effect)
Session 11 marks the FIFTH issue in this Phase A where Vite-based
visual verification of frontend changes was blocked by the
backend not running locally:
- Issue 1.4 (Urdu RTL)
- Session 6 Dashboard subhead
- Session 8 sign-in fix
- Session 10 marquee
- Session 11 Phase 6 click destination (this)

Each time, we accept bundle-level verification (grep for the
expected change in the served Vite bundle) as a proxy for
visual/behavioral verification. This works for code-structurally-
correct changes but cannot exercise click flows, modal behavior,
state transitions, or any runtime-dependent behavior.

When Phase 6 deploy correlated with the production outage in
session 11, we had no opportunity to learn whether the actual
behavior of openReader(article) worked locally — only that the
correct tokens appeared in the bundle.

The bundle-verification proxy is structurally insufficient for:
- Verifying state-store interactions (this session's pattern)
- Verifying modal mount/unmount behavior
- Verifying click-flow that depends on backend-served data
- Verifying that components render correctly with realistic data

Action item for future Phase B planning: establish a way to
exercise frontend changes against either:
- A working local backend (boot scripts, not just frontend)
- A staging environment with realistic data
- Or accept that frontend-touching commits will continue to ship
  with bundle-only verification and adjust risk tolerance
  accordingly

This isn't a session-11-specific finding. It's been quietly
accumulating across the Phase A arc and now manifests as a real
gap.

### 35. Phase 6 saga: innocent commit, environmental cause

Phase 6 of session 9's original plan (change breaking news banner
click destination from external new-tab to in-app reader) was
attempted twice in production:

- Session 11 (May 9 ~21:32 UTC): commit 7fa4d33 deployed,
  production became unreachable, reverted via c7421ad
- Session 12 (May 10 ~05:30 UTC): commit c64c3ea (byte-identical
  re-application of 7fa4d33) deployed, production returned 503
  immediately, reverted via e4bdefc

Both crashes were 503 across all endpoints. Both reverts restored
service in 1-3 minutes.

The Phase 6 commit itself is innocent. The 3-edit diff (useReaderStore
import + destructure + 2 onClick handler replacements at link sites)
was code-correct and matched the canonical pattern from NewsCard.jsx
and FeaturedCard.jsx (both shipping in production). Bundle was
deterministic and benign.

Investigation arc (sessions 11-12):
- Phase 2A (build logs): both Phase 6 builds completed cleanly
- Phase 2B (import chain): useReader.js is benign; already loaded
  by 5 other components
- Phase 2C (Vite output): 0 new chunks, +17 bytes index.js,
  5 cascading hash renames with byte-identical content
- Phase 2D (deploy mechanics): no chunk filename pinning anywhere
- Phase 2E (MCP runtime logs): doesn't exist for Hostinger shared
  hosting JS apps
- Phase 2F (browser File Manager): retrieved log structure, found
  Hostinger truncates console.log on every worker restart, wiping
  failed-deploy traces
- Phase 2G (process patterns): identified actual root cause as
  process saturation, not Phase 6

Phase 6 retry recommendation: do NOT retry until process saturation
relief is in place (see #37, #39). After relief, Phase 6 should
deploy normally because the actual cause was the NPROC ceiling, not
the bundle.

### 36. Hostinger architecture revelation

Investigation revealed our model of how Scoopfeeds runs in
production was incomplete. Actual architecture:

**Phusion Passenger (not raw lsnode):** Scoopfeeds runs under
Hostinger's Phusion Passenger configuration, not bare LiteSpeed
node bridge. Passenger has its own worker management, restart
logic, and resource enforcement. Zero-downtime deploy semantics
spawn new workers before killing old ones.

**App root location:** Application lives at
~/domains/scoopfeeds.com/nodejs/, NOT ~/domains/scoopfeeds.com/
public_html/. The public_html/ directory contains:
- .htaccess (Hostinger-managed Passenger config — NOT in our git)
- .builds/ (Hostinger's deploy artifact directory, contains
  injected preload script)

The frontend dist/ that we kept inspecting is at nodejs/frontend/
dist/, not under public_html/.

**Hostinger-managed .htaccess:** ~/domains/scoopfeeds.com/public_html/
.htaccess (455 bytes, Hostinger-managed, not in our repo) contains:
  PassengerAppRoot     /home/u503692993/domains/scoopfeeds.com/nodejs
  PassengerAppType     node
  PassengerNodejs      /opt/alt/alt-nodejs18/root/bin/node
  PassengerStartupFile backend/server.cjs
  PassengerBaseURI     /
  PassengerRestartDir  /home/u503692993/domains/scoopfeeds.com/nodejs/tmp
  SetEnv NODE_OPTIONS  "--require .../public_html/.builds/config/preload-timestamp.js"
  SetEnv LSNODE_CONSOLE_LOG console.log

**NODE_OPTIONS preload script:** Hostinger injects a 28-line
preload-timestamp.js via NODE_OPTIONS that runs BEFORE our
server.cjs. The script wraps console.log/error/warn/info/debug/trace
to write JSON-structured stdout, and replaces process.stderr.write to
redirect stderr → stdout with a level tag. Pure logging shim, no
bundle interaction.

**Runtime log location and behavior:** Worker stdout/stderr lives at
~/domains/scoopfeeds.com/nodejs/console.log (single file, ~530KiB).
**Hostinger truncates console.log on every worker restart.** This
is the fundamental observability gap — every deploy/revert wipes the
previous worker's traces, making post-crash forensics impossible
without external log capture.

**Empty ~/.logs/:** The standard Hostinger logs directory is empty
for this account. Application logs only go to nodejs/console.log.

These details fundamentally change the model of what we can/can't
diagnose post-incident, and what infrastructure decisions matter
for Phase B planning.

### 37. Process saturation root cause: Reality Index rollout

Hostinger's 30-day Resource Usage panel revealed the actual cause
of all Phase 6 deploy failures:

**Max Processes:** 65 average, 120 hard limit. Sitting at 120
ceiling almost continuously for the past 2-3 weeks, with the chart
showing a dramatic transition from oscillating 0-50 range to
pegged-at-120.

**Storage IOPS:** 164 average, 512 limit. Frequent spikes hitting
ceiling, pink "at-limit" zones throughout 30-day chart.

**CPU and Memory:** Both fine. CPU 9% average, Memory 230 MB / 3072
MB limit. Neither was the bottleneck.

**Standing dashboard banner:** "Your hosting resource limits have
been reached" — confirmed not disk (4.55%) or inodes (7.74%).
Specifically the NPROC pressure.

**Root cause:** Reality Index Phase 5/6 rollout landed 2026-05-03,
exactly 7 days before today. That single day shipped 40+ commits
adding:
- 22 new cron schedules (USGS every 10 min, NOAA every 10 min,
  GDELT every 30 min, polymarket every 15 min, AI traders every
  1 hour, LLM outcome resolver every 1 hour, FRED every 6h, ACLED
  every 6h, World Bank daily, sports/entertainment ingesters,
  watchlist push every 15 min, +6 hourly schedulers)
- 30 new RSS feeds (Phase 5d) bringing total to 119 sources

**Mechanism:** All schedulers run in-process inside the single
Passenger web worker (ENABLE_SCHEDULER=true; REDIS_URL unset, so
the bullmq-based separate-worker path is dormant). At minute 0 of
every hour, ~10 cron schedules fire simultaneously, each holding
outbound HTTPS sockets via undici keepalive (4-second hold by
default). Combined with 119-source RSS ingestion (5 concurrent
batches), peak concurrent socket count is 30-80+ open connections.
On Hostinger's NPROC quota, kernel-thread entries per socket count
toward the 120-process limit.

**Verification status:** Hypothesis is leading-confidence (~80%)
based on:
- Code-side process spawning audit found NO child_process /
  worker_threads / Puppeteer / sharp / native subprocess patterns
  in production paths
- All gated subprocess code (videoGenerator.js spawn, bullmq
  Worker, Sentry profiling) is disabled in production
- Timing alignment between Reality Index rollout and saturation
  metrics
- Mechanism explains all observed crash and rollback patterns

**Verification path (for next session):** SSH or Hostinger Terminal
access to run:
  ps -L -u u503692993 | wc -l  (count TIDs against 120 limit)
  ps -L -u u503692993 -o pid,tid,comm | sort -k3 | uniq -c -f2 | sort -rn
  (breakdown by command name)

If the count is dominated by node TIDs and totals near 120, the
hypothesis is confirmed.

### 38. Connection to finding #8 (DB rollback recurrence)

Finding #8 (Hostinger restart causes ~300-600 article rollback,
recurring through Phase A arc) is downstream of #37's NPROC pressure.

**Mechanism:** When Passenger forces a worker restart at the NPROC
ceiling, the new worker has to wait for the old to exit before it
can fork. During that gap:
- In-flight better-sqlite3 transactions don't complete cleanly
- WAL (Write-Ahead Log) and SHM (shared memory) state is interrupted
- On WAL+SHM rebuild after the new worker's better-sqlite3 init,
  recently-written pages can be skipped
- Result: 300-600 article-sized rollback (matches typical 30-min
  ingestion cycle batch)

**This means:** the structural fix for #8 is the same as the fix
for #37. Either:
- Reduce NPROC pressure so worker restarts are clean (Reality Index
  gating, plan upgrade, scheduler architectural split)
- Migrate database off SQLite (Postgres, per .env.example Phase E
  target) so WAL/SHM concerns don't apply

The two findings are now consolidated under one root cause.

### 39. Three relief paths for next session

After session 12's diagnostic work, three concrete paths exist to
relieve NPROC pressure. Each has different cost, reversibility, and
risk profile. Strategic decision required before execution.

**Path 1: Verify hypothesis dynamically (must do first)**
- DrJ accesses Hostinger's web SSH or Terminal feature
- Runs `ps -L -u u503692993 | wc -l` to confirm TID count near 120
- Runs `ps -L -u u503692993 -o pid,tid,comm | sort -k3 | uniq -c -f2
  | sort -rn` for breakdown
- Cost: ~10 min, read-only, no production risk
- Risk: low (no modifications)
- Outcome: confirms or refutes #37 leading hypothesis

**Path 2: Cheapest immediate relief — gate Reality Index**
- Set ENABLE_REALITY_INDEX=false in Hostinger env vars
- Disables 22 of 45 cron schedules (Phase 5/6 ingesters)
- Estimated impact: drops sustained load below NPROC ceiling
- Cost: Reality Index features dark in production
- Reversibility: instant via env-var change + Passenger restart
- Risk: medium (worker restart triggers finding #8 rollback as
  side effect; Reality Index data freshness affected; UI may show
  stale data in any Reality Index components)
- Decision needed: is the trade-off worth it given Layer 2 ($19/mo)
  is still in private/early state?

**Path 3: Architectural fix — split scheduler off web worker**
- Move cron workload to GitHub Actions cron workflows hitting
  HTTP endpoints (pattern already used for video render per
  scheduler.js:161 comment)
- Web worker stays lean; every cron fires from outside the process
- NPROC pressure drops permanently
- Cost: substantial (endpoint design, auth review, GitHub Actions
  workflow setup, cron schedule migration)
- Estimated effort: 4-8 hours dedicated session, possibly multi-session
- Risk: medium-high (architecture change, requires careful review)
- Reversibility: complex but possible

**Path 4 (additional): Hostinger plan upgrade**
- Upgrade from Business plan to higher tier with more processes
- Cost: monthly subscription increase
- Reversibility: instant downgrade option
- Risk: low (paying for more headroom)
- Trade-off: ongoing cost vs engineering time

**Path 5 (additional): SQLite → Postgres migration**
- Already documented as Phase E target per .env.example
- Eliminates finding #8 root cause (WAL/SHM disruption on restart)
- But doesn't directly address NPROC pressure
- Cost: substantial migration work
- Better suited for Phase B planning than session 13

**Recommended sequence for session 13:**
1. Path 1 (verify) — 10 min
2. If confirmed: discuss Paths 2/3/4 strategically
3. Path 2 likely the right immediate move (if Reality Index
   downtime acceptable), with Path 3/4 as longer-term followups
4. Don't act on Phase 6 retry until relief is in place

After process saturation is relieved (any of Paths 2/3/4), Phase 6
retry should succeed normally because the underlying cause was
environmental, not the code.

### 40. CSP report logging fix shipped (Issue 2.2 Stage 1 closure prep)

Session 14 shipped commit 90dd57a applying the f2fc7f5 stdout
fallback pattern to backend/src/routes/csp-report.js. Four
logger.warn call sites in csp-report.js now have parallel
console.warn/console.error emissions with [csp-report] prefix
and JSON.stringify(data) payload, ensuring CSP violation reports
reach Hostinger's captured stdout (nodejs/console.log).

Implementation:
- Each logger.warn data dict hoisted to const so winston and
  console see byte-identical payload (avoids field-list duplication)
- Single 4-line explanatory comment at first added console.warn
  call referencing f2fc7f5 as precedent
- console.warn for violation cases, console.error for parse failures
  (matching f2fc7f5 level distinction)
- No CSP behavior change — header and policy untouched

Diff: +17/-6, single file. node --check passed locally. Production
verified healthy after deploy: homepage 200 in 0.76s, /api/health
200 in 0.50s.

Observation window started: 2026-05-10 15:57:55 UTC. After
24-48h, in a future session (probably session 16 or 17), read
accumulated CSP reports via SSH or Hostinger File Manager,
identify any legitimate violators needing allowlist updates,
then decide on Stage 2 enforcement (flip header from
Content-Security-Policy-Report-Only to Content-Security-Policy
in backend/server.js:157).

Issue 2.2 Stage 1 closure prep done. Issue 2.2 Stage 2 awaiting
calendar time for observation window.

Refs: Phase A audit (session 14); finding #12; commit 90dd57a;
prior commits 92f8c4f, f116508, f2fc7f5

### 41. Winston-invisible logging is systemic — broader than initially estimated

Phase 2E forward-look survey during session 14 revealed the
finding-#12 winston invisibility issue affects 104 logger.warn /
logger.error call sites across 30 route files, not the 23 sites
across 7 files initially estimated.

Affected files (alphabetical, 1+ call each):
affiliate, analysis, articles-ops, auth, briefs, cards, embed,
events, geo, liveEvents, macro, market, meter, news, newsletter,
newsletter-ops, predictions, push, reader, realityIndex, ri-ops,
syntheticMarkets, tips, track, translate, v1, videos, videos-gen,
watchlists. (csp-report.js was the only one fixed in session 14.)

Production observability has substantial gaps wherever the
f2fc7f5 stdout fallback wasn't applied. This blocks effective
debugging across most of the backend.

Two paths to address:

Path A — Per-route sweep: apply the f2fc7f5 dual-emit pattern
to error paths in production-critical routes (auth, events, news,
market) first, then expand. Lower risk, larger total work.

Path B — Logger.js refactor: change winston transport
configuration so all logger.warn/.error output reaches stdout
without per-call-site changes. Higher leverage single fix, some
risk of unexpected behavior in observability tooling later.

Recommended approach for future session: Path B (refactor) if
the winston configuration can be changed cleanly. Estimated
effort: 1-2 sessions for refactor + smoke tests across affected
routes.

This finding sits in Phase A close-out tier. Could be addressed
during Sprint 6 close-out work, or explicitly de-scoped to
Phase B+ if Phase A wrap timing matters more.

Refs: finding #12 (original observation); session 14 Phase 2E
survey

### 42. Phase A audit completed (session 14)

Session 14 produced a detailed audit of Phase A status against
the original Phase A Brief.

Key findings:
- Sprint 0 (foundation): COMPLETE. All 10 issues shipped.
- Sprint 1 (production stabilization P0): COMPLETE. All 7 issues
  shipped, Brief framing was wrong on 3 of 4 code issues but
  substantive fixes happened.
- Sprint 2 (debt cleanup P1): SUBSTANTIVELY IN MOTION with three
  meaningful gaps:
  - Issue 2.2 CSP Stage 2 not done (now unblocked by session 14
    fix; awaiting 24-48h observation)
  - Issue 2.5 dead nav.* keys: 10 keys deleted instead of 12 keys
    wired; remaining state unverified
  - Issue 2.6 verification not formally captured
- Sprint 3 (hygiene + first metrics): NOT STARTED. 5 issues
  pending; some may no longer be relevant (BullMQ failed-job rate
  metric is moot since BullMQ not running in production).
- Sprint 4 (source audit): NOT STARTED. Complicated by the Phase
  5d 30-RSS-feed addition (now 119 sources vs Brief's "30-50
  active").
- Sprint 5 (social + search audits + tracker templates): NOT
  STARTED. 8 tracker templates planned, 0 authored. Brief's
  audit framing predates the Phase 5/6 expansion.
- Sprint 6 (Phase A close-out): NOT STARTED. No exit verification,
  metrics snapshot, formal retrospective, or Phase B Kickoff
  Brief drafted.

Items shipped beyond original Brief scope (sessions 8-13):
Phase 4 marquee, Phase 6 click destination (deferred — finding
#29), IG dedup fix (#19 → #23), admin remediation endpoint,
sign-in 404 fix (#16 → #18), skills architecture v1 doc.

Items in original Brief that should be explicitly de-scoped to
Phase B+:
- Sprint 3.4 metrics dashboard (redefine metrics for actual
  architecture during Phase B.1 reorg)
- Sprint 4 source audit (Phase B opening, runs alongside B.1)
- Sprint 5 social + search audits + tracker templates (Phase B
  opening)
- Various deferred quality fixes (#2, #3, #17, #25)

Realistic estimate to honest "Phase A complete":
- Tier 1 (must do): Phase A retrospective writeup, exit-criteria
  verification, smoke tests, Phase B Kickoff Brief
- Tier 2 (relief required): finding #37 verification + relief
  decision, CSP Stage 2 (after observation window)
- ~7-8 dedicated sessions of work + 24-48h calendar window for
  CSP observation

Schedule reality: Phase A is behind the original 12-week timeline.
Emergent work and incident response have produced real value not
in the original plan but at the cost of original Brief items.
Phase A close-out timing should be explicitly re-set rather than
pretending we're on the 12-week track.

Refs: docs/phases/phase_a_kickoff_brief.md (the original Brief);
session 14 audit working notes

### 43. GStack adoption deferred to dedicated evaluation session

DrJ raised github.com/garrytan/gstack (Garry Tan, CEO of Y
Combinator) as potential tooling for Claude Code-assisted
development.

Decision: Path B — defer adoption to a dedicated evaluation
session before any integration. Mid-Phase-A tooling change
explicitly avoided.

Rationale:
- Neither chat assistant nor DrJ has read GStack's README;
  adopting unverified tooling is the pattern that creates
  confused state (per session 12's worktree discovery)
- Phase A is mid-execution with substantial concrete work
  remaining (per finding #42)
- Y Combinator brand credibility doesn't automatically mean
  fit for Scoopfeeds specifically
- Current pattern (Claude in chat for strategic + Claude Code
  for execution + retrospective discipline) has been working

Path B execution: One dedicated session (likely 15 or 16) to
read README, understand what GStack provides, identify what it
would change about current workflow. NO adoption decision in
that session — just understanding.

If GStack evaluation is favorable, adoption planned for Phase
B opening (alongside codebase reorganization) rather than
mid-Phase-A.

Refs: session 14 conversation; skills architecture v1 doc

---

## Pace Tracker

This section is added at the END of the retrospective inputs
file, after all findings, as a running snapshot of Phase A
schedule reality.

```
PACE TRACKER (updated session 14, 2026-05-10)
PHASE A Original schedule: 12 weeks across Sprints 0-6
Calendar elapsed in Phase A: ~5-6 weeks (estimated; session 1 was the start)
Sessions executed: 14
Realistic remaining: 7-8 dedicated sessions + 24-48h calendar window for CSP observation

Sprint completion against original schedule:

* Sprint 0 (Foundation): COMPLETE (5 weeks of 5 weeks planned) — but original timeline was 1 week
* Sprint 1 (Production stabilization P0): COMPLETE — original timeline was 2 weeks
* Sprint 2 (Debt cleanup P1): SUBSTANTIVELY IN MOTION with 3 small gaps (CSP Stage 2 awaiting observation, Issue 2.5 verification, Issue 2.6 verification) — original timeline was 2 weeks
* Sprint 3 (Hygiene + first metrics): NOT STARTED — original timeline was 1 week
* Sprint 4 (Source audit): NOT STARTED — DE-SCOPED TO PHASE B
* Sprint 5 (Social + search audits + tracker templates): NOT STARTED — DE-SCOPED TO PHASE B
* Sprint 6 (Phase A close-out): NOT STARTED — original timeline was 2 weeks

Items shipped this session (14):

* Sprint 2 Issue 2.2 Stage 1 closure prep: CSP report-logging fix (commit 90dd57a)
* Phase A audit (this session, captured as finding #42)
* Forward-look identification of systemic logging gap (finding #41)
* GStack deferral decision (finding #43)
* Pace Tracker section added to retrospective file

Items shipped that were NOT in original Brief (cumulative across sessions 8-14):

* Phase 4 marquee
* IG dedup structural fix
* Admin remediation endpoint
* Sign-in 404 fix
* Skills architecture v1 doc
* Phase A audit + Pace Tracker

Schedule reality: We are behind original Phase A timeline. Emergent and incident-driven work has produced real value not in the original plan. Phase A close-out timing should be explicitly re-set during the formal Phase A retrospective (Sprint 6.4 work).

Phase A close-out estimated calendar timeline: Assuming 1-2 sessions per week, 7-8 sessions to complete plus the 24-48h CSP observation: realistic Phase A close in 4-6 weeks of additional calendar time. This sets actual Phase A duration at ~10-12 weeks total — close to original 12-week estimate, but with substantially different scope mix than planned (less audit work, more emergent infrastructure work, more strategic documentation work).
```
