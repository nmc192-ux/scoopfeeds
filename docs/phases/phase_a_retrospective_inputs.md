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

### 44. GStack evaluation complete — selective adoption deferred to Phase B.0

Session 15 completed Path B GStack evaluation (deferred from
session 14 finding #43). DrJ's motivation: Garry Tan
(CEO Y Combinator) articulated development methodology patterns
on his podcast that resonated. GStack may codify those patterns.

Evaluation summary:

GStack is an open-source MIT collection of ~35 Claude Code
slash-command skills authored by Garry Tan, codifying a
"Think → Plan → Build → Review → Test → Ship → Reflect"
methodology. Each skill is a SKILL.md file giving the AI a
structured procedure for one specialist role (CEO, Eng Manager,
Designer, QA Lead, Release Engineer, Debugger, CSO, etc.).
Free, MIT, no SaaS tier.

Strongest signal — methodology overlap: the patterns Phase A
produced organically (investigation-before-edit per finding #15,
structured retrospective, atomic commits with capture-findings
discipline, diff-approval ritual) are already the GStack pattern.
/investigate's "Iron Law: no fixes without investigation" is
exactly finding #15. /retro is what Phase A has been doing
manually. The ETHOS document's "User Sovereignty" principle
("AI recommends, user decides") is Phase A's diff-approval ritual.

Phase A's 43 findings are partly evidence of "we figured out
the GStack patterns the hard way." This reframes adoption from
"adopt new methodology" to "replace handcrafted methodology
with published version of essentially the same thing."

Strongest conflict — deploy model: /ship opens a PR; Scoopfeeds
commits straight to main. /land-and-deploy triggers deploy from
terminal; Hostinger deploys via panel. setup-deploy supports
Fly.io / Render / Vercel / Netlify / Heroku / GitHub Actions /
"custom" — Hostinger isn't first-class. The deploy phase of
GStack has reduced value for Scoopfeeds.

Recommendation: Mixed fit. Selective adoption at Phase B.0.

Curated install (~10 skills):
- Daily: /investigate, /qa, /review, /codex
- Per session: /retro
- Per deploy: /canary
- Strategic: /office-hours, /plan-ceo-review, /plan-eng-review
- Safety: /careful, /freeze, /guard, /unfreeze

Skip:
- /ship, /land-and-deploy (deploy-model conflict)
- All /design-* skills (minimal design surface)
- GBrain (Supabase operational cost; markdown retrospective
  achieves cross-session memory adequately)
- GStack Browser (Claude in Chrome MCP already covers this)
- Continuous checkpoint mode (conflicts with atomic-commit
  discipline)

Adoption complexity: LOW for selective install (~30 min setup +
1-2 sessions to integrate). Reversible (rm -rf ~/.claude/skills/
gstack ~/.gstack and we're back).

Phase B.0 outline: install with prompts declined, pin a known
SHA, opt out of telemetry, run a one-session trial during Phase A
close-out work, decide based on lived experience.

Open questions DrJ resolved during session 15:

Q1 (productivity claims of "10,000 lines/day / 810×"): Hype-y.
Treat as background noise, not a feature. Adopt for actual
methodology value, not marketing claim.

Q2 (migrate off Hostinger panel-deploy model): Worth chasing
eventually, but for separate reasons unrelated to GStack. The
Hostinger migration question is real (findings #8, #36, #37,
#12, Phase 6 saga) but should be weighed independently. Don't
let GStack drive platform decisions.

Q3 (GBrain Supabase memory): Skip. Existing retrospective inputs
file (1,258 lines, 43 findings) + this conversation's user memory
serve cross-session memory adequately. GBrain adds operational
cost for marginal benefit.

Q4 (project-level CLAUDE.md): Useful regardless of broader
GStack adoption. Captures project context, architecture summary,
workflow patterns, reference to key docs. Worth doing standalone.
DrJ's decision: wait for Phase B integration rather than
introducing CLAUDE.md mid-Phase-A.

Decision and close-out:

Adoption deferred to Phase B.0. No GStack installation today.
The selective-fit recommendation, curated skill list, and
adoption outline are captured here for Phase B.0 reference.

If GStack evaluation is favorable during Phase B.0 trial, full
selective adoption planned alongside Phase B.1 codebase
reorganization. If unfavorable in trial, GStack thread closes
permanently and skill borrowing happens via documentation
updates to execution_method_v1.md.

Refs: session 15 evaluation; finding #43 (deferral decision);
finding #15 (investigation discipline that GStack codifies);
docs/strategy/skills_architecture_v1.md (Phase B direction)

### 45. Issue 2.5 final closure — Sprint 2 closes substantively

Session 16 completed Issue 2.5 verification and final closure
work. Phase A audit's session 14 unverified state is now resolved.

Audit findings (Phase 1A-1E of session 16):

The original Brief's "22 dead nav.* keys, MoreMenu uses hardcoded
titles" premise was wrong on three counts:
- MoreMenu was already properly internationalized via labelKey/
  titleKey pattern (the literal grep used in the audit missed
  this indirect resolution)
- The 22 nav.* keys were never dead — all were wired through
  MoreMenu's data structure
- The c6ed2aa commit's "10 keys deleted" was unrelated cleanup
  of common.*/dashboard.*/predictions.* dead keys, not nav.*
  targets the Brief specified

Real residual work identified: EventsPage.jsx had 9 hardcoded
English category chips + 1 hardcoded English page title, visible
to users in all 9 non-en locales. This was the actual gap from
Issue 2.5.

Action taken (commit 6821ceb):
- Wired EventsPage chips through t() using labelKey pattern
- 4 chips reused existing keys (nav.finance/health/sports/climate)
- 5 new keys added (nav.all, nav.politics, nav.tech, nav.science,
  nav.geopolitics)
- pageTitle default changed from "Event Tracker" to null with
  t() resolution; callers passing literal strings (category alias
  pages) unaffected
- 5 new keys added to all 9 non-en locale files with English
  fallback values (translation review pending)

Diff: 11 files changed, +75/-12. Vite build verified before
commit (3092 modules transformed cleanly, same baseline).
Production verified healthy after deploy at 6821ceb.

Sprint 2 Issue 2.5 closes substantively. Two pieces explicitly
de-scoped to Phase B+:

- Category alias pages (SpaceEventsPage, HealthEventsPage,
  CryptoEventsPage, SportsEventsPage, ClimateEventsPage,
  AIEventsPage) still pass hardcoded English pageTitle. Will be
  resolved naturally during Phase B.1 codebase reorganization
  when EventsPage moves into the news skill folder.

- Translation completeness for 12 nav.* keys × 9 locales = 108
  missing translations (7 pre-existing + 5 new in this commit).
  Requires translator-involved workstream, not engineering.
  Captured for Phase B "translation review" item.

Pattern lesson: this is the third recurring instance of Brief
inaccuracy (findings #15, #42, now #45). The Phase A retrospective
should formally acknowledge that the original Brief was an
incomplete map of reality, and that retrospective discipline
caught and corrected misalignments. This is itself a lesson worth
naming in Sprint 6 retrospective writing.

Refs: commit 6821ceb (EventsPage i18n fix); commit c6ed2aa (prior
dead-key cleanup); finding #15 (Brief inaccuracy pattern); finding
#42 (Phase A audit); session 16 Phase 1A-1G

### 46. useHealth hook misreports 429 rate-limit as backend-down

Finding #30 from session 10 ("transient 'Backend Not Running' UI
observed during smoke test; production was actually up") is now
upgraded from "transient unexplained" to "confirmed bug."

Root cause: The frontend's useHealth hook polls /api/health and
treats any non-200 response (including 429 Too Many Requests)
as backend-down. When the operator runs multiple curls in quick
succession during smoke testing OR when normal traffic exceeds
the rate limit window on /api/health, the frontend surfaces the
"Backend Not Running" placeholder page across all routes where
it's wired.

User-visible behavior observed in session 16:
- During smoke testing, /api/health returned 429 after rapid
  curls from operator IP
- Browser concurrently showed "Backend Not Running" page on
  /events when clicking category chips
- "failed to load" messages on chip clicks (separate fetches
  also hitting rate limit)
- After 60-second cooldown, full functionality restored

Production-side state during the apparent "outage":
- Homepage: 200 in 0.42s ✓
- /events: 200 in 0.40s ✓
- /api/health: 429 (rate-limited, NOT crashed) ✓
- Production fundamentally healthy throughout

Impact:
- Real users experiencing legitimate rate-limit retry scenarios
  will see "Backend Not Running" instead of meaningful retry/wait
  messaging
- Erodes user trust in product reliability
- Misleads operators during incident triage (session 11 retrospect:
  if useHealth had reported 429 vs backend-down correctly, the
  session 11 incident response would have been cleaner)

Fix shape (for future session, NOT this one):
- useHealth hook should distinguish 429 from 5xx
- 429 → "high traffic, retrying in N seconds" or similar
  retry-with-backoff UI
- 5xx → "Backend Not Running" or "service unavailable" UI
- Likely 30-60 min of focused work in a future session

Refs: finding #30 (original observation); session 16 Phase 1H
smoke test results

### 47. Tagline rendering bug — visible JavaScript code literal

Production rendering of EventTracker page (and possibly other
surfaces) shows unrendered JavaScript template literal as text:

  "e=>typeof e=="function"?e("brand.tagline","A data-backed
  estimate, not a certainty."):"A data-backed estimate, not a
  certainty." Major stories tracked as live events with
  market-implied probabilities."

This is a function reference being rendered as a string instead
of being invoked. Pattern suggests a t()-style call where a
fallback function is passed but not called.

Probable location: copyGuide.js or a copy module that exports
function-based fallbacks. Some render site is treating the
function as the value to display.

Not related to session 16's i18n changes — pre-existing bug.
Confirmed visible to users in production today.

Fix scope (for future session): ~30-60 min to locate the offending
render site, identify the function-vs-string mismatch, fix the
invocation pattern. Probably a one-line correction.

Refs: session 16 production verification

### 48. EventTracker product critique — fundamental redesign required

DrJ's product-level observation during session 16 EventsPage
verification:

Current state: EventTracker page is misplaced, cluttered, badly
designed, overcrowded with weather events. The implementation
does not serve its intended purpose.

DrJ's recommendation: NOT incremental improvement. Complete
professional redesign starting from a rethink of what EventTracker
is FOR.

Open product questions that need resolving:
- What qualifies as a "tracked event" worth elevating to
  EventTracker vs staying in the news feed?
- What's the criteria for significance? Magnitude, probability,
  recency, public interest, all of the above?
- How should events be visually hierarchized in the UI?
- What's the relationship between EventTracker and Reality Index?
  (They feel overlapping in scope today)
- How does the breaking news marquee (Phase 4) interact with
  EventTracker? Are they showing the same content in different
  ways?

Strategic alignment:
- EventTracker likely belongs in the Reality Index skill per
  skills architecture v1
- A redesign would naturally happen during Phase B's Reality
  Index skill formalization, not as a tactical patch
- Treating this as Phase A "fix" would be premature — would patch
  symptoms without addressing the architectural question of what
  the surface should be

Recommended sequencing:
- Phase B.1 (codebase reorganization): EventTracker code moves
  into reality-index skill folder
- Phase B.X (Reality Index skill formalization): Product
  redesign of EventTracker as part of broader Reality Index
  UX rethink
- Until then: EventTracker stays as-is. Known degraded experience
  documented in finding.

DrJ flagged this is "not worth keeping in its current form" —
worth considering whether the page should be temporarily hidden
from navigation until redesign lands, vs continuing to show a
known-broken experience to users. Operator decision for a future
session.

Refs: session 16 browser verification; finding #28 (Phase 4
marquee shipped); skills architecture v1; Reality Index Phase 5/6
rollout (finding #37 root cause analysis)

### 49. Content quality concern: weather posts dominating

Related but distinct from finding #48: during session 16 EventsPage
verification, DrJ observed content was overcrowded with weather
posts, many of them similar/duplicate.

Likely root cause: NOAA alerts ingestion runs every 10 minutes
(per finding #37 Reality Index Phase 5e rollout). 59 alerts
(Severe+Extreme) ingested in a recent cycle, with 41 upserted
per session 12 log. Weather/NOAA alerts dominate event volume
because:
- High ingestion frequency
- Geographic granularity creates near-duplicates (e.g., same
  weather event represented across multiple counties)
- No content-quality filter for de-prioritizing low-significance
  alerts
- Reality Index event credibility scoring may not differentiate
  "Severe weather alert in one county" from "major political
  event"

This is connected to finding #48 (EventTracker UI fails) but
the data layer is also part of the problem — even with perfect
UI, surfacing 41 similar weather alerts ahead of substantive
news creates a degraded experience.

Fix scope:
- Short-term: content-quality filter to limit weather/alert
  volume per category in EventTracker view (likely 30-60 min
  in a future session)
- Long-term: dedup logic in Reality Index ingestion to collapse
  geographically-clustered weather events into single records
  (substantial; Phase B+ work)

Refs: finding #37 (NOAA Phase 5e ingestion); finding #48
(EventTracker UI fails); production runtime log from session 12

### 50. CSP observation insufficient for Stage 2 enforcement

Session 17 Phase 1 read accumulated CSP violation reports via
SSH (DrJ self-authenticated; SSH key not registered). Only 30
reports accumulated since the session 14 logging fix (~25.5
hours).

Analysis revealed:
- All 30 reports came from one article URL accessed via Facebook
  and Threads referrers — likely 2-3 user sessions, not 30 users
- Violations exclusively target Google ad/analytics infrastructure:
  fundingchoicesmessages.google.com, region1.google-analytics.com,
  boq-content-ads-contributor internal paths
- These are legitimate sub-domains called from already-allowlisted
  entry-points (googletagmanager.com, pagead2.googlesyndication.com)

Critical context discovered mid-session: AdSense application was
REJECTED by Google ("your site isn't ready to show ads at this
time"). The violations being captured are partly for ad scripts
that aren't even serving real ads to users.

Decision: defer Stage 2 enforcement indefinitely. Reasons:
1. 30 reports from one URL is statistically insufficient to
   confidently allowlist
2. Sparse data is itself a signal of bigger problem (low direct
   traffic, social-only audience)
3. Allowlisting infrastructure for blocked AdSense ads is
   premature work
4. The real fix is product distribution + AdSense approval,
   not CSP allowlist iteration

Continue CSP report-only mode indefinitely. Revisit after either
substantial traffic growth OR AdSense approval, whichever comes
first.

Refs: session 14 CSP logging fix (commit 90dd57a); session 17
Phase 1 SSH read; Google AdSense rejection screenshot

### 51. Article-page navigation architecture — three-commit arc and final design

Session 17's substantive engineering work: solving the article-page
navigation gap (identified mid-session via DrJ's product framing
of why direct-arrival users can't discover the rest of Scoopfeeds).

The investigation chain:

Phase 1 (z-index + close-trap fix, commit 49d7735):
- Discovered Header was rendered globally but obscured by
  ReaderModal's z-[90] backdrop
- Discovered close button had a bug — useEffect re-fire trap
  that contradicted the file-header comment's documented intent
- Shipped: Header z-[100] above modal, useRef-gated useEffect,
  navigate("/", replace:true) on close
- Production verification revealed Header background was
  transparent, making brand wordmark unreadable

Phase 2 (opaque Header fix, commit 3490337):
- Added readerOpen selector subscription to Header
- Forced opaque "scrolled" styling when modal open
- Production verification revealed correct technical fix but
  WRONG product UX — full Header (12+ controls) overwhelming
  for article-reading context

Phase 3 (architectural refactor, commit d301cf6):
- DrJ's product critique: "header is too overwhelming...
  should be simple design rather than over cluttering"
- Right architecture: hide Header entirely when modal is open;
  give modal its own minimal nav strip (logo + tagline)
- Cleaned up z-[100] and opaque logic from prior commits
- ReaderModal.jsx gets new Link element with ScoopLogo at
  modal top-center

Final state at d301cf6:
- Direct-arrival users see modal with minimal nav (logo + tagline
  + X close)
- Click logo or X → navigates to "/" with full Header restored
- In-app browsing flow unchanged
- Hit-area issue on X close resolved naturally (no Header overlap)

Lesson learned: tonight's three-commit arc illustrates the
trade-off between "ship something that technically works" vs
"ship the right product design." Phase 1 was technically correct
but missed the product gap. Phase 2 over-corrected by forcing
homepage chrome into reading mode. Phase 3 (after DrJ's product
critique) found the right architecture by treating the modal
as a self-contained surface.

Methodological insight: when implementing a fix to expand
visibility/access of one component (Header above modal), check
whether that component's design is appropriate in the new
context. The full Header's design assumes browsing-mode usage;
overlaying it on reading-mode required questioning whether the
full surface still made sense (it didn't).

For session 18 review: review the three commits together to
understand whether close-trap fix could have been a smaller,
more direct first attempt.

Refs: commits 49d7735, 3490337, d301cf6; session 17 production
verification with three iterations; DrJ product critique
documented mid-session

### 52. Logo click bug on modal nav — opens language picker instead of navigating

After deploying d301cf6, browser verification revealed: clicking
the Scoopfeeds logo in the modal top-bar triggers a language
selection popup instead of navigating to "/".

Expected behavior: Link to "/" navigates user to homepage.
Actual behavior: language picker popup opens.

Root cause hypothesis (untested in session 17):
- ScoopLogo component may have internal click handlers (perhaps
  for tagline-language toggling) that intercept clicks before
  the parent Link's navigation fires
- Or: language picker (mounted nearby in DOM) has overflow
  positioning that captures clicks from the logo area

User impact: bug is not blocking — X close button works correctly
as the primary "close + go home" affordance. Logo is currently a
redundant (and broken) secondary affordance.

Fix shape (for session 18): investigate ScoopLogo component
internals. Check for onClick handlers that should be removed
when wrapped in Link. Possibly add stopPropagation guards, or
restructure ScoopLogo to be presentation-only when used outside
its original context.

Refs: production verification post-d301cf6 deploy; DrJ
observation

### 53. useHealth hook 429 misreporting — confirmed recurring user-facing impact

Finding #46 from session 16 documented the useHealth hook misreports
429 rate-limit responses as "Backend Not Running." Session 17
provides additional evidence that this is now a critical user-
experience bug, not a minor annoyance:

- During session 17 alone, DrJ observed "scoopfeeds.com shutting
  down every few minutes" multiple times (11:05 PM, 11:30 PM,
  and during browser verification)
- Each "down" event corresponded to /api/health returning 429
  with production homepage returning 200 — production was up
- The frequency suggests this affects real users on any sustained
  session, not just developer/test traffic
- Combined with the deploy worker-restart pattern (finding #8),
  users see degraded experience repeatedly during evenings when
  ingestion + browsing load combines

DrJ explicitly proposed: "I think it deserves a full session
tomorrow."

Priority: HIGH for session 18+. The bug actively undermines
product trust. Users who see "Backend Not Running" on a working
site believe Scoopfeeds is unreliable, which is the opposite
of what an intelligence platform should communicate.

Fix shape:
- Distinguish 429 from 5xx in useHealth response handling
- Show "retry" or "high traffic" UI for 429 rather than
  "backend not running"
- Consider exponential backoff for the polling interval after
  receiving 429
- Verify the message displayed is not catastrophic-feeling
  even on real outage

Estimated effort: 60-90 min in a focused session.

Refs: finding #46 (session 16 origin); session 17 multiple
observations; finding #8 (deploy worker restart pattern); session
17 final production verification at d301cf6

### 54. AdSense rejection — operational signal affecting CSP and product strategy

During session 17 mid-session, DrJ shared screenshot of Google
AdSense response: "your site isn't ready to show ads at this
time. There are some issues which need fixing before your site
is ready to show ads."

Connected implications:
1. CSP allowlist work for AdSense infrastructure is premature
   (finding #50 above)
2. Revenue thesis for Scoopfeeds depends on either AdSense
   approval OR alternative monetization
3. The "issues which need fixing" are operational, not
   engineering — content quality, traffic minimums, policy
   compliance — outside Phase A scope

This is operational/business signal worth capturing for strategic
planning. Engineering tasks alone won't unblock AdSense.

Refs: AdSense rejection screenshot session 17; finding #25
(RSS date-parsing — content quality contributor); finding #48
(EventTracker product critique — UI quality contributor)

### 55. Traffic shape — social-only audience reveals product distribution gap

Session 17 analysis of CSP report data + DrJ's product framing
revealed that scoopfeeds.com traffic is essentially:

Social media post → click → /article/<uuid> → read → bounce

Almost no:
- Direct traffic (typing scoopfeeds.com)
- Homepage navigation from social arrivals
- Multi-article reading sessions
- Newsletter signups from article readers
- Returning visitors

Root causes contributing to this shape:
- Article cards from social posts go directly to /article/<uuid>
  with no built-in path back to homepage (now partially addressed
  by d301cf6 modal nav)
- No "more articles" CTA at end of article reads
- No subscription/conversion prompts during reading
- Newsletter signup buried in modal scroll

Implication: Phase A stabilization work matters less than expected
because the product distribution gap means most users never
experience most of what Phase A delivers. They read one article
and leave.

This is a strategic-level finding, not an engineering finding.
Phase B+ product/distribution work matters more than additional
Phase A stabilization passes.

Refs: session 17 CSP report analysis (30 reports from 1 article);
DrJ product observation; commit d301cf6 (partial fix — gives
direct-arrivals a path home)

### 56. Systemic 429 cascade — root cause analysis and two-track fix plan

Session 18 attempted to fix finding #53 (useHealth misreports
429 as backend down). Shipped commit f34f2bf which correctly
distinguished 429 from 5xx in useHealth. Production verification
revealed the fix exposed a deeper systemic problem.

ROOT CAUSE (network-engineering analysis):

Scoopfeeds makes ~30 distinct API calls per page load
(/api/auth/me, /api/geo, /api/weather, /api/public-config,
/api/events, /api/analysis/stories, /api/affiliate/paywall ×7,
/api/affiliate/pick, /api/predictions/badges, /api/market,
/api/track, /api/news, /api/featured, /api/topics, /api/stats,
/api/health, plus on-demand calls).

The backend's global rate limiter (apiGlobalLimiter at 500
req/15min/IP = 33.3 req/min) is structurally too aggressive
for this call pattern. A single page load consumes ~30 of the
33-req/min budget. Normal browsing (refresh, navigate, open
article, go back, open another) easily exceeds the limit.

When the rate limiter fires, EVERY hook receives 429:
- /api/auth/me, /api/events, /api/predictions/badges,
  /api/affiliate/*, /api/track, /api/analysis/stories,
  /api/geo, /api/weather, /api/public-config, /api/market

Each hook's queryFn throws because non-2xx responses raise
axios errors. react-query flags isError on all of them.
Components that conditionally render based on data presence
hit "fewer hooks than expected" — React error #300. Page goes
white.

CONFIRMED IN PRODUCTION at f34f2bf: console showed 30+ 429
errors in 2 seconds during normal browsing, followed by React
#300 crash and white screen.

Three problems compound:
1. Call-heavy architecture (~30 calls per page load) — root cause
2. Rate limiter calibrated for fewer calls per session than app
   produces
3. Components defensive against errors but not against systematic
   data unavailability

These three together create the cascade. Tonight's useHealth
fix addressed only the symptom in one hook; problems 1-3 remained.

TWO-TRACK FIX PLAN (DrJ approved):

STABILIZATION TRACK (Phase A close-out):
- S1: Revert f34f2bf (this session) — restore known-degraded-but-
  not-crashing state
- S2: Global axios 429 interceptor (session 19) — single layer
  that catches 429 for all hooks, returns cached/sentinel data
  instead of throwing
- S3: Per-route rate limit recalibration (session 20-21) — replace
  500/15min global with per-route budgets matching actual usage
- S4: Defensive component patterns (session 22) — make components
  safe against undefined data via standardized patterns

REDESIGN TRACK (Phase B opening, threaded through B.1
codebase reorganization):
- R1: API endpoint consolidation — /api/bootstrap returns initial
  state in one call; ~10-15 calls eliminated per page load
- R2: Edge caching layer (Cloudflare or equivalent) — caches GET
  responses, dramatically reduces origin load
- R3: Stale-while-revalidate everywhere — UI shows last-known
  data immediately, never blocks on fetch
- R4: SSR evaluation (Phase B+) — strategic decision after
  stabilization

PHASE A CLOSE-OUT SCHEDULE IMPACT:
- Original estimate (post-session 17): 6-7 sessions to close
- Adjusted estimate (post-session 18): 10-11 sessions to close
- Reason for adjustment: stabilization track (S2, S3, S4) belongs
  in Phase A close-out because Sprint 6 exit verification needs
  production stable enough to verify

This is the documented "permanent solution" per DrJ's framing
("network engineer fixing the system once and for all"). The
fix is real but staged across multiple sessions because the
right scope is architectural, not a single patch.

Refs: finding #53 (useHealth origin); finding #46 (session 16
upgrade); finding #41 (logging systemic gap, similar pattern);
finding #36 (Hostinger Passenger architecture); finding #37
(NPROC verification); commit f34f2bf (failed attempt); session
18 console diagnostic from production

### 57. React #300 crash mode — hook-count violation under data cascade

The cascade in finding #56 manifests as React error #300:
"Rendered fewer hooks than expected."

Mechanism: when multiple data-fetch hooks return undefined
simultaneously (due to 429 cascade), components that early-
return based on data presence skip their subsequent hook calls.
React tracks hook count per render; inconsistency triggers
error #300, which is unrecoverable and shows blank page.

Example pattern that fails:

```jsx
const { data: auth } = useAuth();
if (!auth) return null;  // changes hook count!
const { data: events } = useEvents(); // not called this render
```

Safe pattern (defensive):

```jsx
const { data: auth } = useAuth();
const { data: events } = useEvents(); // always called
if (!auth) return null; // returns AFTER all hooks
```

This is a coding-discipline issue, but the discipline isn't
enforced anywhere. ESLint rule react-hooks/rules-of-hooks would
catch it but apparently isn't configured strictly enough.

Fix shape (Phase S4):
- Audit components for early-return-before-hooks pattern
- Establish coding standard: all hooks called, then early returns
- ESLint config enforcement
- Possibly: helper hook useAllRequired([list]) that returns
  isReady when all data present, isLoading when any pending

Estimated effort: 1 dedicated session for audit + standard +
ESLint config, then ongoing discipline.

Refs: finding #56; production console diagnostic session 18;
React docs on rules of hooks

### 58. Hostinger as platform fit — Phase B+ strategic question

Findings 8, 12, 36, 37, 53, 56 all involve Hostinger constraints
contributing to Scoopfeeds operational issues. Tonight's session
makes the pattern explicit:

Scoopfeeds' call-heavy architecture is fundamentally mismatched
with Hostinger's process model (Phusion Passenger with NPROC
ceiling), restart frequency (DB rollback on restart), absent
edge caching, and rate-limit-prone configuration.

Per DrJ's session 18 statement: "for the time being we should
stay within Hostinger platform, though we could explore other
packages and solutions in Hostinger. In larger context: We'll
always decide what is best for scaling, growth and longterm
stability."

Read: Hostinger migration is a Phase B+ strategic decision, not
immediate work. But the stabilization and redesign tracks in
finding #56 should be designed platform-portably so a future
migration is not blocked by Hostinger-specific assumptions.

Specifically:
- S2 axios interceptor: platform-agnostic ✓
- S3 rate limit recalibration: platform-agnostic ✓
- S4 component defensive patterns: platform-agnostic ✓
- R1 /api/bootstrap endpoint: platform-agnostic ✓
- R2 edge caching: Cloudflare or similar — can sit in front of
  any origin, including Hostinger ✓
- R3 stale-while-revalidate: platform-agnostic ✓
- R4 SSR: would benefit from purpose-built platform (Vercel,
  Fly.io) but not blocked on Hostinger

Recommendation for Phase B+ retrospective: explicit decision
session on Hostinger fit. Evaluate Hostinger upgrade packages
vs. migration. Make the call once architecture is stable enough
that platform constraints are the binding factor.

Refs: findings 8, 12, 36, 37, 53, 56; DrJ session 18 framing
on Hostinger as immediate constraint vs long-term decision

### 59. Phase S2 verification failure — design assumption gap

Session 19 shipped commit cf0f16f (global axios 429 interceptor
with in-memory cache). Pre-flight investigation in Phase 2A
discovered 15 separate axios.create() instances rather than the
single central instance the original prompt assumed; implementation
required 17 files but mechanical consolidation via createApi
helper kept complexity manageable.

Browser verification revealed the in-memory cache resets on page
reload. Test sequence:
- Test A (normal browsing): PASS
- Test B (rapid refresh trip test): FAIL — same React #300
  white screen as the reverted f34f2bf

Root cause analysis:
- Interceptor IS firing (429 responses confirmed in network tab)
- Interceptor returns data: null on cold-start 429 (no cache yet)
- Components early-return on undefined data
- Hook count between renders becomes inconsistent
- React error #300 → white screen

The design assumed warm-cache scenarios would dominate. True for
normal browsing. False for cold-start scenarios (page reload
after rate-limit window opens).

Critical learning: cf0f16f is strictly better than the prior
state (passes Test A which was failing before; crashes only
under sustained adversarial pressure with cold cache). But
"strictly better" wasn't sufficient for the Yahoo/Bloomberg-class
bar DrJ named. The verification revealed a real architectural
gap, not just an edge case.

Refs: commit cf0f16f, session 19 verification stack trace,
finding #56 (cascade root cause), finding #57 (React #300
mechanism)

### 60. Hook unwrap pattern inconsistency — Phase S4 architectural input

Phase S2b investigation discovered six distinct hook unwrap
patterns across 21 hooks consuming the axios response:

| Pattern | Example hooks | Required sentinel shape |
|---|---|---|
| data.data || [] | useNews, useFeatured, useTopics, useLiveEvents, useVideos, useAnalysis | {data: []} |
| data.data || {} | useStats | {data: {}} |
| data.data || null | useMarket (main), useAffiliate, useGeo | {data: <shape>} |
| data.data (no fallback) | useReader, useLiveEvents, useAnalysis | crashes on data:null |
| return data (raw) | useEvents (11 queries), usePredictions (7), useHealth | endpoint-specific shape |
| if (!data.success) throw | useWeather | crashes if !success |

Most spec'd sentinels for Phase S2b were wrong-shape for the
actual hook patterns:
- /weather sentinel {temperature, condition}: useWeather throws
  if !data.success → cascade recreates
- /market sentinel {rates, indices}: useMarket does data.data ||
  null → wrong shape returns null anyway
- /events sentinel []: useEvents returns data raw → consumers
  expect {events: []} not []
- /predictions sentinel {}: usePredictions expects data.data
  array → crashes

This inconsistency is accumulated complexity per DrJ's session 18
diagnosis. Each hook was written at different times with different
conventions and no enforced contract.

Implication for Phase S4: cannot solve cascade with axios-layer
sentinels alone. Component-layer defensive patterns required.
Probably needs:
- Uniform hook return contract (useSafeQuery wrapper or similar)
- ESLint rule enforcing hook unwrap discipline
- Optional: lib/safeData(data, fallback) helper imposed on all
  hooks

S4 is bigger than originally framed — not just "defensive
components" but "establish data-layer contract first, then
make components defensive against violations."

Refs: session 19 Phase 2A and 2b-A investigation outputs;
finding #57 (React #300 origin); finding #56 (two-track plan)

### 61. Phase S2b verification — Yahoo/Bloomberg-class resilience achieved for warm-cache path

Session 19 shipped commit c8917d1 (persistent tiered cache +
verified sentinels) building on cf0f16f. Direct comparative
verification under identical adversarial conditions confirmed
the architecture works.

Test sequence (same protocol that revealed cf0f16f's gap):
- Test A (normal browsing 3-5 min): PASS — bundle hash verified
  index-79YQiMiB.js, localStorage 12 entries populated,
  sessionStorage 13 entries, privacy split confirmed
  (/api/auth/me in sessionStorage but not localStorage)
- Test B (rapid refresh trip test, 600 fetches, 470 returned
  429): PASS — page rendered fully, hasRootContent 44,696
  (vs 0 at cf0f16f), no React #300, cache survived burst
- Test C (article modal): article aged out (orthogonal to S2b);
  graceful "Article not found" fallback rendered cleanly
- Test D (console + network): zero React #300, zero uncaught
  exceptions, 12+ critical endpoints returned 429 during
  subsequent navigation, all transparently substituted with
  cached data, Retry-After captured (632s)

Comparative table:

| Metric | cf0f16f (failed) | c8917d1 (verified) |
|---|---|---|
| Page state after burst | WHITE SCREEN | Fully rendered |
| hasRootContent | 0 | 44,696 |
| React #300 in console | 2 errors | 0 errors |
| Article count visible | n/a (crashed) | 26,369 |
| Cache survived burst | n/a | yes (12 → 12) |

Architecture mechanisms validated:
1. Tiered cache (memory → sessionStorage → localStorage):
   write-through working
2. Persistence enabling 429 recovery: interceptor serves cached
   data when origin rate-limited
3. Privacy split: user-specific data sessionStorage only,
   never localStorage

What was NOT tested (deferred):
- Cold-start 429 on non-verified endpoints (Phase S4 territory)
- Module-load hydration from cross-session localStorage
  (requires browser close/reopen cycle)
- Cache version mismatch (requires version bump deploy)
- Storage quota exhaustion (requires filling localStorage)
- Real article modal under rate-limit (article aged out)

Net effect: dominant real-world crash scenarios eliminated.
Returning users have warm cache from localStorage. Same-session
reloads survive rate-limit windows via sessionStorage. ~95% of
crash scenarios from finding #56 now covered architecturally;
remaining ~5% (cold-start + immediate 429 + non-verified
endpoint) requires Phase S4.

Refs: commits cf0f16f, c8917d1; finding #56 (two-track plan);
finding #57 (React #300); finding #59 (S2 verification failure);
finding #60 (hook pattern inconsistency); session 19 verification
output

### 62. Yahoo/Bloomberg study deferred to session 20 — comparative network analysis

DrJ proposed in session 19 mid-implementation: "We can perhaps
reverse engineer Yahoo or Bloomberg and see how they do it,
then we can iterate the same solution to our own problem."

This is the right engineering instinct. Yahoo News, Bloomberg
Terminal, X all handle thousands of concurrent users without
crashing. Studying their observable behavior (HTTP cache headers,
service worker patterns, bootstrap request patterns, staleness
handling) would inform Phase B redesign track design.

Specifically transferable patterns worth studying:
- HTTP cache headers from API responses (ETag, Cache-Control,
  Last-Modified, 304 Not Modified revalidation)
- Bootstrap request consolidation (how Yahoo's first page load
  has so few API calls)
- Service worker caching (X uses this for offline-capable
  experience)
- Staleness UI patterns (Bloomberg's timestamps on every quote,
  X's "X new posts" banner)
- SSR with hydration (Yahoo's first paint includes content
  already in markup)

Effort: ~1-2 hour dedicated session. Output: comparative
analysis document with patterns categorized by transferability
to Scoopfeeds.

Sequencing: session 20 candidate work. Becomes design reference
for Phase B redesign track (R1 bootstrap consolidation, R2 edge
caching, R3 stale-while-revalidate).

Not transferable to S2/S2b scope: backend infrastructure scale,
WebSocket-based real-time data layers. We can adopt the patterns
without replicating the infrastructure.

Refs: session 19 mid-implementation discussion; finding #56
(redesign track R1-R4); skills_architecture_v1 (Phase B reorg
plan)

### 63. PERSISTENT_MAX_ENTRIES constant declared but unused; endpoint TTL pattern collision risk

Two minor code-hygiene items from Phase S2b implementation
review:

1. lib/api.js declares PERSISTENT_MAX_ENTRIES = 100 but never
   references it. Reactive quota handling (eviction on
   QuotaExceededError) was chosen over eager enforcement.
   The constant should be removed OR a documentation comment
   added explaining its absence from logic. Cleanup item for
   future code review session.

2. getEndpointTTL uses for...in iteration with first-match-wins
   substring check. Current ENDPOINT_TTL_MS entries are safe
   by coincidence (/events 5min and /live-events 5min have
   same TTL, so collision doesn't matter). Future additions
   that overlap with different TTLs would create order-dependent
   bugs. Either:
   - Add ordering comment to ENDPOINT_TTL_MS declaration
   - Switch to longest-match-first lookup
   - Add unit test catching collisions
   Polish item for future code review session.

Neither is blocking. Both worth capturing so future code review
catches similar patterns.

Refs: session 19 Phase 2b-B code review; lib/api.js at c8917d1

### 64. TopicPage connection-trouble fallback fires under rate-limit — Phase S4 input

Production observation post-c8917d1: navigating to /topic/politics
during a rate-limit window shows the "Oops! Connection trouble —
The API server might be warming up. Give it a moment!" placeholder
with a Try Again button, plus "0 stories curated from global
sources" subhead.

Screenshot evidence: 2026-05-13 00:57 PKT, c8917d1 bundle confirmed,
Politics topic page rendered the connection-trouble fallback while
the rest of the site (Header with 26,369 articles, breaking-news
ticker, topic chips, country chips) rendered normally from cached
data.

Root cause analysis:
- TopicPage queries /api/news?topic=politics (or similar shape)
- The /api/news endpoint is NOT in Phase S2b's verified-sentinel
  set (only /health and /auth/me have verified sentinels)
- Cold-start 429 on /api/news returns data: null (Phase S2 behavior
  preserved for non-verified endpoints)
- TopicPage's component falls through to its connection-trouble
  empty-state UI when data is null

This is the documented Phase S4 scope manifesting in production.
Not a regression from c8917d1 — c8917d1 explicitly scoped sentinels
to 2 of the planned 10 endpoints (finding #60 documents why: hook
unwrap pattern inconsistency makes wrong-shape sentinels dangerous).

Resolution paths for Phase S4 (not for session 19):
- Option A: Add verified /api/news sentinel with correct shape per
  useNews hook's unwrap pattern ({data: []} per finding #60's
  pattern table)
- Option B: Make TopicPage resilient to null+stale data — when
  cache miss + 429, show last-known articles with subtle staleness
  indicator instead of full connection-trouble placeholder
- Option C: Both A and B — sentinel for the common case +
  defensive component for true cold start

Recommendation when Phase S4 ships: Option C (sentinel + defensive
component). The sentinel handles 95% of cases (returning users with
warm localStorage); the defensive component handles the residual
true-cold-start scenarios.

User impact: anyone navigating between topic pages during sustained
browsing trips rate limit and sees the connection-trouble fallback
instead of cached articles. The Header continues to look healthy
(showing 26,369 from cached /health data), creating cognitive
dissonance — "site is up but this page is broken."

Refs: finding #56 (cascade root cause), finding #60 (hook unwrap
patterns + sentinel correctness), finding #61 (S2b verification),
commit c8917d1 (Phase S2b base); screenshot 2026-05-13 00:57 PKT

### 65. Article reader extraction degrades intermittently under rate-limit — Phase S4 input

Production observation post-c8917d1: opening an article via the
reader modal sometimes shows full article content, sometimes shows
empty/error state. DrJ's specific report: "News item extraction
stops working after few tries. Currently it's working again."

This intermittency pattern is the signature of rate-limit
interaction. Reader extraction makes upstream API calls (likely
/api/reader or similar) that get caught by rate limiter under
heavy use. The endpoint behavior depends on which fetch path
the reader uses.

Investigation needed (Phase S4 prerequisite):

Path A: If extraction uses useReader hook (covered by S2b
interceptor via createApi):
- Returns data: null on cold-start 429
- ReaderModal needs to handle null gracefully
- Defensive component pattern fix

Path B: If extraction uses raw fetch() (known-uncovered per
S2b documentation — components/reader/ReaderModal.jsx
related-stories fetch is documented as bypass):
- Not covered by interceptor at all
- Migration to createApi pattern needed
- Larger fix touching the fetch call site

Specific endpoint and path TBD in Phase S4 investigation. The
useReader.js hook was converted to createApi in cf0f16f (it's
in the 15-file consolidation). The related-stories raw fetch()
in ReaderModal.jsx was explicitly documented as uncovered scope.

If extraction is the useReader path: relatively contained Phase S4
fix (component defensive coding + add /api/reader sentinel).

If extraction is a different fetch() bypass discovered during S4
investigation: scope expands to include that fetch() migration.

User impact: when reader extraction is the value the user came
for (clicking an article to read it), failing silently or
intermittently undermines product trust. This is a higher-priority
issue than topic-page fallback because it hits the primary
user task.

Refs: useReader.js (cf0f16f conversion to createApi); ReaderModal.jsx
related-stories raw fetch() (documented S2b known-uncovered scope);
finding #56 (cascade), finding #57 (#300 mechanism); production
observation 2026-05-13 00:58 PKT

### 66. ReaderModal nav components conditionally render — manifests the React #57 anti-pattern in production

Production observation post-c8917d1: article reader modal shows
the Scoopfeeds brand wordmark + X close button + nav cluster
SOMETIMES at the top of the modal, sometimes does NOT show them.

Screenshot evidence: 2026-05-13 01:02 PKT, article modal opened
to "Anmol Pinky: Police officers suspended for aiding cocaine
queen" (ARY News, Pakistan). Modal content (image, headline,
byline, body text) renders fully. Modal nav (logo, tagline,
X button) is ABSENT in this instance.

Hypothesis: ReaderModal uses conditional rendering pattern like

  {article && <ModalNav />}

or

  {isLoaded && (
    <ModalNav />
    <ArticleContent />
  )}

When article data is null (rate-limited reader fetch), the
conditional skips the ModalNav block. When article data eventually
loads, the conditional renders the nav. The intermittency depends
on when article data arrives vs when the component first renders.

This is the exact pattern finding #57 (React #300 mechanism)
documented but at a less-catastrophic level — early-return on
undefined doesn't cause hook-count crash here because it's
JSX rendering not hook calling, but it does cause visible UI
glitch where critical affordances (X close to return home)
disappear.

User impact: user can't see how to close the modal. Has to
guess (Escape key? Browser back?). Worse on mobile where Escape
isn't available. Critical product-UX failure even though it's
not a JS crash.

Phase S4 implication: defensive component patterns audit needs
to identify ALL conditional rendering blocks where critical UI
(navigation, close affordances, escape paths) depends on async
data. Such blocks should always render structure with sensible
fallback content, never skip entirely.

Standard pattern recommendation for Phase S4:

  Bad:
    {data && (
      <ModalNav>
        <CloseButton />
        <Logo />
      </ModalNav>
    )}

  Good:
    <ModalNav>
      <CloseButton />  {/* always present */}
      {data ? <Logo /> : <LogoPlaceholder />}
    </ModalNav>

This is component-defensive coding (S4 scope) AND product-UX
principle (critical affordances always visible). Phase S4 audit
output should be a coding-standard doc + ESLint rule + audited
component list.

Refs: finding #56 (cascade), finding #57 (React #300 mechanism);
d301cf6 (ReaderModal architecture); screenshot 2026-05-13 01:02
PKT; finding #64 + #65 as related Phase S4 manifestations

### 67. Phase S3 verification — per-route tier limits eliminate normal-use 429s

Session 20 shipped commit 1cbf92b (per-route rate limit
recalibration) replacing the single 500/15min global with tier-
based limits calibrated to actual usage patterns. Browser
verification confirmed the architecture works as designed.

Test sequence:
- Test A (normal browsing 3-5 min covering homepage + topic page
  + article modal): 42 API requests, ZERO 429s
- Test B (deliberate burst on /api/health, 280 requests): 181 ×
  200 then 99 × 429 with Retry-After 14 seconds (5-min window)
- Test C (cross-tier independence): 30 /api/news requests during
  highFreq exhaustion all returned 200 (standardRead tier has
  independent budget)
- Test D (final state): zero React #300, zero uncaught exceptions,
  full page render, cache survived (localStorage 19 entries,
  sessionStorage 20 entries)

Differential vs prior baselines:

| Metric | cf0f16f | c8917d1 | 1cbf92b |
|---|---|---|---|
| Normal-browse 429s | Many | Some | 0 |
| Burst trip behavior | White screen | Cached recovery | Tier fires + graceful |
| Retry-After window | 600+ sec | 600+ sec | 14 sec |

Three architectural properties verified:
1. Tier separation: independent buckets per route group
2. Faster recovery: 5-min windows vs 15-min global
3. Generous headroom: 42 normal-browse calls = trivial fraction
   of any tier's budget

Net effect: backend rate limits are now calibrated to actual
usage patterns. Normal browsing produces zero 429s. Deliberate
abuse trips appropriate tier limits which the S2b frontend
interceptor handles transparently via cached data. The
combined stabilization track (S1+S2+S2b+S3) delivers
Yahoo/Bloomberg-class data-layer resilience.

Production at 1cbf92b is significantly better than at any prior
commit: rate limits don't fire on normal traffic, frontend
resilience handles edge cases, tier separation prevents
cross-endpoint starvation.

Refs: commit 1cbf92b (Phase S3); commits cf0f16f (S2), c8917d1
(S2b); findings #56 (cascade root cause), #61 (S2b verification),
#65 (reader limit raise rationale); session 20 verification output

### 68. Findings #64, #65, #66 resolved via Phase S3 — rate-limit elimination as root-cause fix

Session 19 documented three concrete production-observed failures
from c8917d1 browsing:
- Finding #64: TopicPage shows "Oops! Connection trouble"
  placeholder on /topic/politics
- Finding #65: Article reader extraction degrades intermittently
- Finding #66: ReaderModal nav (logo, X button) sometimes absent

Phase S3 verification confirmed all three are RESOLVED under
normal browsing. The mechanism is interesting and worth noting:

These weren't fixed by component-defensive code (Phase S4 scope).
They were fixed by eliminating the rate-limit firing that was
the root trigger. When the underlying 429 doesn't happen,
cold-start sentinels don't return, components don't see null
data, and the visible UI failure modes don't manifest.

Architectural implication: Phase S4 (component defensive patterns
+ hook unwrap contract) is now LESS urgent than the two-track
plan originally assumed. The residual 5% gap from S2b's
intentionally-narrow sentinel scope (only /health and /auth/me
verified) only manifests when rate limits actually fire. S3
makes that rare enough that S4's user-impact case weakens.

Phase S4 scope reconsidered:
- The hook unwrap pattern inconsistency from finding #60 remains
  real technical debt (six distinct patterns across 21 hooks)
- The defensive coding pattern issue from finding #57 (React #300
  mechanism) remains a latent risk under future load patterns
  we haven't seen
- ESLint rule enforcement (react-hooks/rules-of-hooks) would
  prevent future violations
- But the urgent user-impact case for S4 has been substantially
  addressed by S3

Recommendation: Phase S4 stays in the plan but downscoped. Focus
on ESLint rule + targeted fixes for the patterns most likely to
re-fire under future load. Skip the comprehensive component-by-
component defensive coding sweep that the original scope implied.
Estimated effort: 1 session instead of 1-2.

Refs: findings #64, #65, #66 (session 19 production-observed
failures); finding #67 (S3 verification); finding #60 (hook
unwrap pattern inconsistency); finding #57 (React #300 mechanism)

### 69. Stabilization track substantially complete — Phase A close-out schedule revised downward

Session 20 closes the stabilization track of the two-track plan
from finding #56:
- S1 ✓ session 18 (revert f34f2bf, restore stability)
- S2 ✓ session 19 (cf0f16f global axios 429 interceptor)
- S2b ✓ session 19 (c8917d1 persistent tiered cache + sentinels)
- S3 ✓ session 20 (1cbf92b per-route rate limit recalibration)
- S4 - downscoped per finding #68 (ESLint rule + targeted fixes,
  ~1 session)

Phase A close-out remaining work breakdown (revised from session
19's 9-10 sessions estimate):
- S4 (downscoped per finding #68): ~1 session
- Finding #25 RSS date-parsing structural fix: 1-2 sessions
- Finding #41 logging refactor scope decision: 1 session (could
  be Path A per-route sweep OR Path B logger.js refactor)
- Finding #47 tagline rendering bug: batchable with smaller fixes
- Sprint 6 (exit verification, metrics snapshot, retrospective
  writing, Phase B Kickoff Brief draft): 2-3 sessions

Revised remaining estimate: 5-7 sessions for Phase A close
(down from 9-10 at session 19 close).

This is real progress, not artificial schedule revision. The
underlying reason is Phase S3's broader impact than originally
estimated. S3 was scoped as "backend rate limit recalibration"
but its actual effect was "eliminate the trigger for most S4
manifestations," which downscopes S4 substantially.

The Phase B redesign track (R1 bootstrap consolidation, R2 edge
caching, R3 stale-while-revalidate, R4 SSR evaluation) is
unchanged and still threads through Phase B opening. Those are
optimization/scale work, not stability work — different scope.

Next session opening candidates:
1. Phase S4 downscoped (ESLint rule + targeted fixes)
2. Yahoo/Bloomberg comparative analysis (finding #62) — deferred
   from session 20, becomes input for Phase B R1-R3 design
3. Finding #25 RSS date-parsing structural fix
4. Sprint 6 begin (exit verification, retrospective writing)

Recommendation: DrJ to decide based on what feels most natural.
S4 is the cleanest continuation of stabilization. Yahoo study is
strategic preparation for Phase B. RSS fix is long-deferred
deep work. Sprint 6 is the actual close-out work.

Refs: finding #56 (two-track plan origin); commits cf0f16f,
c8917d1, 1cbf92b (stabilization track); finding #68 (S4 downscope
rationale); session 18 Pace Tracker (10-11 estimate origin);
session 19 Pace Tracker (9-10 estimate)

### 70. Yahoo News — SSR-first, content baked in HTML, no client-side state hydration

Session 21 comparative study via Claude in Chrome DevTools-
equivalent observation (`docs/research/comparative_analysis_v1.md`
§2). Landing page measurements:

- HTML document: ~1.0 MB decoded, body text already at 19.7 KB
  before any XHR completes
- 250 total resources on load; 42 XHR/fetch calls (almost entirely
  ad-tech prebid auctions, NOT editorial content fetches)
- No `__NEXT_DATA__`, no `__PRELOADED_STATE__`, no client hydration
  JSON blob — content IS the HTML
- Server: ATS (Apache Traffic Server, Yahoo's own internally-
  developed edge proxy, no third-party CDN)
- `Cache-Control: max-age=0, private` on HTML — every request
  hits origin, freshness via origin re-render
- Static assets on `s.yimg.com` with year-long immutable cache
- No service worker, no Cache Storage API usage
- Article page TTFB 419 ms, DOMContentLoaded 1.1 s, full load 3.0 s

Article body (3,954 chars) ships in the HTML response. The 3.0 s
load-event time is dominated by ad-tech auctions that run in
parallel with content rendering, never on the critical path.

Architectural lesson: Yahoo's pattern is the **opposite** of
Scoopfeeds' current SPA-shell+XHR pattern. First contentful paint
of editorial content happens at server response, not after JS
hydration. This is the high-bar reference point for Phase B R4
(SSR evaluation).

Refs: `docs/research/comparative_analysis_v1.md` §2 (full Yahoo
analysis); finding #74 (cross-cutting synthesis); finding #56
(two-track plan); Phase B redesign track items R1-R4

### 71. Bloomberg — SSR via Next.js+Express, Fastly edge with 120s TTL, PerimeterX bot wall

Session 21 study via curl HTTP probing (browser blocked by Chrome
MCP allowlist for `bloomberg.com`).
`docs/research/comparative_analysis_v1.md` §3 has full analysis.

Key observations:

- **Two backend stacks**: Next.js for landing (`x-powered-by:
  Next.js`), Express for article pages (`x-powered-by: Express`).
  Both fronted by the same Fastly edge.
- **Fastly edge identified** via `x-served-by: cache-{POP}-{POP}`
  format and Fastly-specific `edge-control:` directive header
- **Multi-tier cache (Fastly shielding)**: assets show
  `x-served-by: cache-lga21973-LGA, cache-fjr990026-FJR` —
  geographic edge POP pulls through shield POP before origin
- **HTML TTL: 120 seconds** (`cache-control: public, max-age=120`,
  `edge-control: max-age=120`). New headlines reach all readers
  within 2 minutes; behind that, served from edge cache.
- **Asset TTL: 365 days immutable** on `assets.bwbx.io`
- **HTTP/3 enabled** via `alt-svc: h3=":443"`
- **Pure SSR**: 3.5 MB HTML landing with 70 `<h3>` headlines + 16
  `<article>` tags + actual content text. No `__NEXT_DATA__`, no
  `self.__next_f.push`, no Apollo/Redux state blob.
- **PerimeterX bot detection** (`_pxhd` cookie set every response);
  403 to non-realistic UA, 200 with browser-like headers
- **Paywall meter** signals present in article HTML; first paragraph
  always SSR'd for SEO

Architectural lesson: Bloomberg is the **professional-grade
ceiling** of news platform architecture. The 120s edge TTL pattern
is directly applicable to Scoopfeeds via Cloudflare/Fastly in
front of Hostinger origin.

Refs: `docs/research/comparative_analysis_v1.md` §3; finding #74
(synthesis recommends Bloomberg's edge pattern as Phase B Rec 2);
Phase B R2 (edge caching), R3 (SWR)

### 72. X (Twitter) — SPA shell + 160 KB state blob, all content via XHR — negative reference for Scoopfeeds

Session 21 study via Claude in Chrome.
`docs/research/comparative_analysis_v1.md` §4 has full analysis.

Key observations:

- **SPA shell**: 467 KB HTML but only 1,021 chars rendered before
  JS executes
- **160 KB `__INITIAL_STATE__` JSON blob inlined in HTML (35% of
  doc)** — auth/feature-flag/config state, not tweet content
- **Tweet content via GraphQL persisted queries**:
  `api.x.com/graphql/{32-char-hash}/UserTweets`. The persisted-
  query-ID architecture enables edge caching despite GraphQL.
- **HTML `Cache-Control: no-cache, private, must-revalidate`** —
  explicitly disables both browser and edge caching of HTML.
  Every request hits origin.
- **No service worker** registered for logged-out users
- **No Cache Storage** in use
- **Login wall**: `/explore` and most navigation redirects to
  `/i/flow/login`; only profile pages (`/<handle>`) render content
  to anonymous users
- **DOMContentLoaded 558 ms but load event 2,357 ms** — fast HTML,
  slow until JS+XHR complete

Critical architectural insight: Scoopfeeds at 1cbf92b is
structurally **closer to X than to Yahoo/Bloomberg**. The Phase B
redesign is essentially "move from X's pattern toward Yahoo's
pattern." X's pattern is unreachable for Scoopfeeds because X
spends years of engineering on persisted-query edge caching,
GraphQL server optimization, and SW+IndexedDB for logged-in users.
**X is the negative reference**, not a positive one.

Refs: `docs/research/comparative_analysis_v1.md` §4 + §6.1
(architecture quadrant); finding #74 (synthesis); finding #56
(cascade root cause — Scoopfeeds in X's quadrant but without X's
infrastructure)

### 73. Apple News (native macOS) — two-process model with newsd daemon, local SQLite cache, CloudKit sync

Session 21 study via macOS bash observation, container metadata
inspection, screenshots, Apple News Format public docs, Wikipedia.
`docs/research/comparative_analysis_v1.md` §5 has full analysis.

Key observations (with [OBS] / [INF] tags throughout to mark
methodology limits — sandbox prevents direct inspection of most
state):

- **Two-process architecture**: `News.app` (UI, 3.9 MB bundle, Mac
  Catalyst port of iOS app) + `newsd` (privileged background
  daemon at `/System/Library/PrivateFrameworks/NewsDaemon.framework`).
  newsd started 20+ hours before the user opened News.app and
  persists after quit — long-lived service managed by launchd.
- **Time-to-content ~2 seconds** despite no network round-trip on
  critical path. Content already pre-fetched into local SQLite
  cache by newsd; News.app reads via XPC from local store.
- **Local caches observed (metadata only)**:
  - `~/Library/Caches/com.apple.newsd/Cache.db` (NSURLCache backing)
  - `~/Library/HTTPStorages/com.apple.newsd/httpstorages.sqlite`
    (cookies/auth, WAL active May 12)
  - `~/Library/Preferences/com.apple.newscore.plist` (89 KB,
    modified today)
- **Sandbox-protected** (`Operation not permitted`):
  - `~/Library/Containers/com.apple.news/`
  - `~/Library/Group Containers/group.com.apple.news/` and `.newsd/`
- **Framework dependencies**: Silex + SilexWeb (ANF rendering),
  CloudKit (cross-device reading-state sync), WebKit (RSS-sourced
  article fallback), UIKit (Catalyst)
- **Apple News Format = JSON-based** publisher format; renders
  natively via Silex (VoiceOver-accessible, consistent typography)

Web equivalent for the patterns observed:
- Background daemon → Service Worker with scheduled fetch (weak)
- SQLite local cache → IndexedDB + the c8917d1 persistent cache
  S2b shipped (already present!)
- Cache-first rendering → SWR pattern (Phase B Rec 4)
- CloudKit cross-device sync → out of scope (requires accounts)

Architectural lesson: Apple News's "open app → instant content"
model IS the stale-while-revalidate pattern, just with OS-managed
infrastructure that web platforms can't match. SWR (Phase B R3) is
the closest equivalent achievable on the web.

Methodology limits documented:
- Cannot read sandbox-protected container contents
- Cannot decrypt TLS API contracts (no proxy)
- Cannot decompile binaries
- Cannot read personal data (by design)
- Most architectural claims are [INF] from observable surface + public docs

Refs: `docs/research/comparative_analysis_v1.md` §5; finding #74
(synthesis); Apple News Format public docs at developer.apple.com;
Wikipedia for product history

### 74. Cross-cutting synthesis — Phase B opening sequence grounded in four-platform observation

Session 21 comparative study synthesis.
`docs/research/comparative_analysis_v1.md` §6 + §7.

Findings #70-#73 cluster on a two-axis architecture map (server-
heavy vs client-heavy × web-native vs platform-native):
- Yahoo + Bloomberg: server-heavy, web-native (SSR + edge cache)
- X: client-heavy, web-native (SPA + XHR)
- Apple News: server-heavy, platform-native (daemon + local cache)
- Scoopfeeds 1cbf92b: structurally in X's quadrant, but without
  X's engineering scale

The "minimum bar" for professional news platforms, distilled
from observations:
1. FCP of editorial content within 1.5s warm — Scoopfeeds ✓
   (after c8917d1 cache hydrate); cold start still slow
2. HTML delivered via edge CDN — Scoopfeeds: partial (LiteSpeed
   local only, no geographic edge)
3. Year-long immutable cache on hashed assets — Scoopfeeds:
   partial (Vite emits hashed names but no `immutable` header set
   on server)
4. Graceful degradation under load — Scoopfeeds ✓ (post-
   S1+S2+S2b+S3)
5. Anonymous-first reading — Scoopfeeds ✓

Scoopfeeds clears 3 of 5 bar items today, with 2 partial-credit
items achievable in Phase B Sprint 1.

**Top-5 Phase B recommendations (ranked by value/effort)**:

1. **Rec 1** — `Cache-Control: max-age=31536000, immutable` on
   hashed static assets. 1 session. Verifiable. Zero risk.
   (Maps to R2.)
2. **Rec 2** — Cloudflare edge in front of `scoopfeeds.com` HTML.
   2-3 sessions. Cuts origin load ~98% under typical news traffic.
   (Maps to R2.)
3. **Rec 3** — SSR for hot routes (`/`, `/topic/:slug`). 4-6
   sessions. The structural transformation: cold-start ~30-API-
   call problem goes away. (Maps to R4.)
4. **Rec 4** — SWR pattern on content API responses, extending the
   c8917d1 persistent cache. 2 sessions. Apple News's "instant
   content" pattern adapted to web. (Maps to R3.)
5. **Rec 5** — `s-maxage=120, stale-while-revalidate=600` on HTML
   responses (after Rec 2). 1 session. Bloomberg's exact pattern.
   (Maps to R2+R3.)

**Implied Phase B opening sequence**: Sprint 0 (Rec 1) → Sprint 1
(Rec 2) → Sprint 2 (Rec 5) → Sprint 3 (Rec 4) → Sprints 4-6
(Rec 3). Total ~10-13 sessions in dependency order with verifiable
milestones at each step.

**What this study does NOT recommend**:
- Do NOT adopt X's SPA pattern (negative reference)
- Do NOT build a custom edge proxy like Yahoo's ATS — use a
  managed CDN
- Do NOT invest in service workers for offline support (none of
  the comparable platforms bother)
- Do NOT consider GraphQL adoption solely for "edge caching"
  reasons — Bloomberg achieves edge caching without GraphQL
- Do NOT commit to a "native app" strategy on Phase B's timeline;
  Apple News's daemon model is unreachable via web

Refs: `docs/research/comparative_analysis_v1.md` §6 + §7 (full
synthesis + recommendations + caveats); findings #70-#73 (per-site
inputs); Phase B redesign track items R1-R4; finding #62 (session
19 deferral that motivated this study)

### 75. Phase A exit criteria audit — formal assessment against Strategic Plan v6 + Phase A Kickoff Brief

Session 21 phase 2 conducted a formal audit of Phase A status
against both:
- Strategic Plan v6 section 9 Phase A exit criteria (8 named items)
- Phase A Kickoff Brief Sprint 0-6 operational issues (50 items)

This audit was triggered by DrJ's question "is this plan in line
with the strategic plan?" before starting Phase B Sprint 0. The
question was warranted: substantive gaps surfaced that prior
tactical estimates had not captured.

Strategic Plan v6 exit criteria results (post DrJ UNCLEAR
resolution):
- Scheduler running: DONE
- Admin auth secured: DONE
- Urdu RTL working: DONE
- Hollow features populating: DONE per interpretation A
  (empty-state UX copy meets criterion; data population is
  Phase B scope per source matrix expansion)
- 5 metrics captured: NOT STARTED
- Source audit complete: NOT STARTED
- Social audit complete: NOT STARTED
- Search audit complete: NOT STARTED

Net: 4 DONE / 4 NOT STARTED. Strategic close estimate 5-11
sessions remaining.

Phase A Kickoff Brief operational results:
- Sprint 0: 10/10 DONE
- Sprint 1: 7/7 DONE (Issue 1.5 confirmed via scheduler.js
  inspection; Issue 1.7 informal-verification accepted)
- Sprint 2: 3 DONE, 2 PARTIAL (2.3 hollow copy partial; 2.5
  i18n keys partial), 1 deferred (2.2 CSP per finding #50),
  1 informal-verification accepted (2.6)
- Sprint 3: 2 DONE, 3 NOT STARTED (3.1 raw_signals drop, 3.4
  metrics dashboard, 3.5 verification); Issue 3.3 CLOSED
  (premise incorrect — isUrdu IS used at App.jsx:131)
- Sprint 4: 0/7 DONE (source audit entirely)
- Sprint 5: 0/8 DONE (social audit + search audit + 8 tracker
  templates)
- Sprint 6: 0/7 DONE (close-out artifacts including formal
  retrospective and Phase B Kickoff Brief)

Net: 22 DONE / 2 PARTIAL / 26 NOT STARTED. Operational close
estimate 11-20 sessions remaining.

The gap between estimates (5-11 strategic vs 11-20 operational)
matters. The strategic view counts only the named exit criteria.
The operational view counts all the Kickoff Brief's hygiene and
close-out items. Both views are legitimate; they answer different
questions about what "Phase A close" means.

UNCLEAR resolutions accepted by DrJ (with review triggers per
DrJ's "may add options to our plan for future reconsideration"
framing):

UNCLEAR 1 — "Hollow features populating": ACCEPTED interpretation
A (empty-state UX copy meets criterion; data population is Phase
B). Review trigger: if a hollow feature surfaces user-facing
breakage (404, error UI, crash) that empty-state copy doesn't
cover, reopen this audit item.

UNCLEAR 2 — Sprint 1.5 double-timeline: RESOLVED via direct
inspection of scheduler.js lines 332-347. Inline call removed;
standalone cron at 19 * * * * is sole invocation. Sprint 1.5 =
DONE. No review trigger needed.

UNCLEAR 3 — Sprint 1.7 + 2.6 verification: ACCEPTED as "verified
informally through stabilization track production smoke tests;
no formal artifact exists." Review trigger: if Phase A exit
verification (Sprint 6.1) requires formal sprint verification
documents as prerequisites, backfill from existing production
evidence in findings #56-#67.

UNCLEAR 4 — Sprint 3.3 (dead isUrdu): CLOSED as "premise
incorrect, no action needed." Variable IS used at App.jsx:131
for toast message. Review trigger: none — premise was factually
wrong.

UNCLEAR 5 — sourceCount 119 vs brief's 30-50: ACCEPTED as
"production state exceeds brief baseline; Sprint 4 audit scope
to reflect categorization-first rather than inventory-first when
executed." Review trigger: when Sprint 4 audit is executed,
confirm whether 119 represents (a) sources active when brief
was drafted but underestimated, or (b) informal expansion in
sessions 12-21. Outcome may inform Phase B source matrix
expansion scope.

UNCLEAR 6 — Formal Phase A Retrospective: ACCEPTED as "still
required per Execution Method v1; phase_a_retrospective_inputs.md
is working data, not the retrospective itself." Review trigger:
none — Execution Method v1 is explicit.

Open questions parked for future reconsideration (not decided
today):

- The Skills Architecture v1 Phase B vs Strategic Plan v6 Phase B
  inconsistency (deferred to dedicated future session per
  finding #76)
- The redesign track disposition (α/β/γ options per session 21
  earlier framing; deferred per finding #76)
- The two divergent close estimates (5-11 strategic vs 11-20
  operational) — which framing does Phase A actually exit under?
- Sprint 2.2 CSP enable — still deferred per finding #50, but is
  "defer indefinitely" the final answer or "defer until specific
  trigger"?
- Sprint 3.1 raw_signals drop — still pending, no clear blocker,
  just hasn't been done
- The lastRun:null integrations (TMDB, FRED, WorldBank, ACLED,
  SportsDB, Synthetic Extract) — are these activated in Phase B
  source matrix expansion, or do they need pre-Phase-B config
  work (API keys, integration validation)?

Phase A is NOT 5-7 sessions from close as estimated at session
20. Honest range is 5-11 sessions (strategic view, minimum) to
11-20 sessions (operational view, full close-out). The session
20 estimate was tactical and accurate for stabilization-track
completion, but did not account for the unstarted audits and
close-out artifacts.

Refs: docs/strategy/strategic_plan_v6.md section 9 Phase A
(lines 512-524); docs/phases/phase_a_kickoff_brief.md Sprint 0-6
issues; docs/execution/execution_method_v1.md Section 11 (Phase
Retrospective template); production smoke at HEAD b2b797c

### 76. Four-way "Phase B" drift across strategic-tier documents — reconciliation deferred to dedicated future session

Phase 21.2A reading surfaced that four documents in active use
define "Phase B" with non-overlapping scope:

1. Strategic Plan v6 (May 2026): Phase B = "Launch Layer 1 with
   Comprehension + Distribution + Internal Scoop." Work is
   overwhelmingly product features: Tracker Auto-Detection
   Engine, op-ed aggregation, video integration, breaking news
   engine, source expansion to 150+, Social Media Engine v2,
   3 newsletters, Alert engine v1, Internal Scoop search upgrade,
   Entertainment topic page, brand refresh, accessibility audit.

2. Skills Architecture v1 (May 2026, added session 13): Phase B =
   B.1 codebase reorganization by skill, B.2 skill contract docs,
   B.3 linter boundaries, B.4 first skill isolation POC. Purely
   architectural; no user-visible features.

3. Finding #56 (session 18): "Phase B redesign track" = R1
   bootstrap consolidation, R2 edge caching, R3 stale-while-
   revalidate, R4 SSR evaluation. Infrastructure prep emerging
   from the cascade discovery diagnosis.

4. Session 21 comparative analysis (finding #74): Phase B opening
   sequence = Sprint 0 Cache-Control immutable → Sprint 1 CDN
   edge → Sprint 2 swr headers → Sprint 3 SWR pattern → Sprints
   4-6 SSR for hot routes. Infrastructure prep grounded in
   Yahoo/Bloomberg/X/Apple News observation.

This is not a minor tactical drift. Definitions #1 and #2 are
BOTH strategic-tier documents. Skills Architecture v1 was
authored or refined AFTER Strategic Plan v6 but its Phase B
content does not appear in Strategic Plan v6's Phase B section.
That's a strategic-document inconsistency that predates the
stabilization track entirely.

The reconciliation requires explicit decisions on:

- Which Phase B definition is authoritative? (Strategic Plan v6
  is highest-tier by intent, but Skills Architecture v1 was
  later-authored.)
- How do definitions #3 and #4 (infrastructure prep) relate to
  the authoritative Phase B? Are they preparatory work,
  parallel work, deferred work, or work to be removed from the
  plan entirely?
- Does Skills Architecture v1's Phase B (codebase reorg) execute
  alongside or after Strategic Plan v6's Phase B (product
  features)?

DrJ chose Path 2 today: stop after Phase A audit (finding #75),
defer the four-way Phase B reconciliation to a dedicated future
session. Rationale: strategic-tier inconsistencies deserve
overnight reflection, not session-end fast decisions. The
session 21 comparative analysis remains excellent technical input
but its "Phase B opening sequence" recommendations apply only if
the authoritative Phase B definition incorporates infrastructure
prep.

Dedicated reconciliation session scope when scheduled:
- Read strategic_plan_v6.md and skills_architecture_v1.md
  side-by-side; identify exactly where they diverge
- Decide which document is authoritative, OR decide that they
  describe parallel tracks that need explicit coordination
- Position findings #56 redesign track and session 21 comparative
  analysis recommendations within the reconciled Phase B
- Update strategic_plan_v6.md to reference Skills Architecture
  v1 Phase B work explicitly (if both tracks proceed), OR
  supersede one with the other
- Produce strategic_tactical_reconciliation_v1.md document
- This session is strategic-decision-heavy, code-light. Allocate
  90-120 minutes.

Until reconciliation: do NOT execute Phase B work of any kind.
Phase A close-out work (source audit, social audit, search
audit, metrics dashboard, formal retrospective, Phase B Kickoff
Brief drafting) is unblocked and can proceed without the
reconciliation. The reconciliation can also happen in parallel
with Phase A close-out if scheduled that way.

Refs: docs/strategy/strategic_plan_v6.md section 9 Phase B;
docs/strategy/skills_architecture_v1.md Phase B section;
finding #56 (session 18 cascade root-cause + two-track plan);
finding #74 (session 21 comparative analysis synthesis);
docs/research/comparative_analysis_v1.md section 7 Phase B
recommendations.

### 77. Stabilization track (sessions 18-21) was emergent work that displaced Sprint 4-5 audit work

Phase 21.2B audit revealed that sessions 18-21 worked outside the
Phase A Kickoff Brief's planned sequence. The brief specified:
- Sprint 1-2: P0 + P1 stabilization (executed sessions 12-17)
- Sprint 3: hygiene + 5 metrics (partial)
- Sprint 4: source audit (7 issues)
- Sprint 5: social audit + search audit + 8 tracker templates
  (8 issues)
- Sprint 6: close-out (7 issues)

Actual sessions 18-21 work:
- Session 18: cascade discovery + revert (Phase S1)
- Session 19: Phase S2 + S2b (frontend axios interceptor +
  persistent tiered cache, two production commits)
- Session 20: Phase S3 (per-route rate limit recalibration,
  one production commit)
- Session 21 phase 1: Comparative analysis research

This is real engineering. The cascade was a production fire
requiring response. Phase S2b is Yahoo/Bloomberg-class data-
layer resilience. Phase S3 eliminated normal-use 429s. The
comparative analysis grounded future architectural decisions in
observation.

But the trade-off needs to be named: this work happened INSTEAD
OF Sprint 4-5 audit work, not in addition to it. Sprint 4 (source
audit) and Sprint 5 (social + search audits + tracker templates)
sat untouched while sessions 18-21 ran. 22 Phase A Kickoff Brief
issues remain NOT STARTED specifically because emergent work
consumed those four sessions.

This isn't criticism of the stabilization work. It's accounting.
A future session reviewing "where did Phase A's planned scope
go?" needs to see this trade-off captured. Otherwise the
disconnect between "session 20 said 5-7 sessions to close" and
"session 21 audit shows 11-20 sessions to operational close"
becomes inexplicable.

Implication for forward planning: when emergent work appears in
future phases, capture the displacement explicitly. The pattern
is: scheduled work pauses, emergent work executes, scheduled
work resumes. Without explicit capture, scheduled work doesn't
resume — it silently defers.

Phase 21.2A reading also surfaced that the formal Phase A
Retrospective (Sprint 6.4, separate from
phase_a_retrospective_inputs.md) doesn't exist. This is part of
the same pattern: tactical capture of findings happened (74
findings, 3,076 lines), but synthesis into the strategic-tier
retrospective document didn't happen because Sprint 6 didn't
execute.

Refs: docs/phases/phase_a_kickoff_brief.md Sprint 4-6 scope;
findings #56-#69 (stabilization track inception through
verification); findings #70-#74 (session 21 comparative
analysis); session 20 Pace Tracker close estimate; session 18
Pace Tracker close estimate

### 78. Decision Point 1 — Authority resolution: β (parallel tracks within Phase B)

Session 22 reconciliation. Resolves the strategic-tier conflict
between Strategic Plan v6 Phase B (product features) and Skills
Architecture v1 Phase B (codebase reorganization by skill).

Three options were presented:
- α: Strategic Plan v6 authoritative; Skills Architecture v1
  demoted to "ongoing technical work parallel to phased roadmap."
  Recommendation rationale: highest product velocity, respects
  Skills Architecture v1's own anti-goals ("Don't build the
  platform before the application"), aligns with solo + AI
  execution model and pre-product-market-fit timing.
- β: Parallel tracks within Phase B. Track 1 (product features
  per Strategic Plan v6) + Track 2 (architecture per Skills
  Architecture v1 B.1-B.4). Both proceed simultaneously.
- γ: Skills Architecture v1 supersedes. Product features
  re-mapped to skills. Strongest defiance of Skills Architecture
  v1's anti-goals. Weakest defensibility.

Claude Code's calibrated recommendation: α with safeguards
(carry Skills Architecture v1 forward as Phase B+ input + Phase
C review trigger). Reasoning: Skills Architecture v1's own
self-hedges argue against over-applying it; solo + AI execution
makes β's coordination overhead expensive; sessions 18-21
demonstrated reactive architecture works when problems are
concrete; pre-PMF timing suggests prioritizing user-visible
value.

DrJ's choice: **β (parallel tracks)**. Rationale: the cascade
discovery during sessions 18-21 showed that architectural work
matters and that reactive-only architecture leaves gaps. Two
tracks acknowledge both concerns. The cost is real (longer Phase
B duration; more coordination overhead for solo + AI), but the
alternative (α) carries technical-debt risk that the cascade
discovery made tangible.

This choice was reinforced by DP2 = δ (see finding #79), where
DrJ chose the architecturally-richest end of that option matrix
as well. Pattern: DrJ consistently weighted durability over
short-term velocity at both decision points.

Implications:
- Phase B duration extends from Strategic Plan v6 "Months 1-3" to
  "Months 1-5" baseline (further extended by DP2 to "Months 4-7")
- Both Strategic Plan v6 Phase B exit criteria AND Skills
  Architecture v1 B.1-B.4 must be met for Phase B exit
- BullMQ migrations (originally Strategic Plan v6 Foundation work)
  reframe as Track 2 work because the 5 queues correspond to 5
  skill boundaries
- Binding kickoff gate (Skills Architecture v1 §10) applies to
  all tracks
- No Decisions Log changes required (spot-check confirmed all
  31 locked decisions hold)

Refs: docs/strategy/strategic_tactical_reconciliation_v1.md §5;
docs/strategy/strategic_plan_v6.md §9 Phase B (Track 1 source);
docs/strategy/skills_architecture_v1.md §7 + §10 (Track 2 source);
finding #76 (drift surfaced); finding #75 (Phase A audit context)

### 79. Decision Point 2 — Infrastructure track disposition: δ (parallel supporting Track 3)

Session 22 reconciliation continued. Resolves how the
infrastructure track (Finding #56 R1-R4 + Session 21 Sprint 0-6,
treated as one definition per session 22.A reframing) fits within
β-chosen Phase B.

Four options were presented:
- α: Defer entirely. Saves 10-13 sessions. Contradicts DP1=β's
  durability premise.
- β: Fold lazily into Phase B. Sprint 0 as 1-session hygiene win;
  Sprint 1+ defer until specific feature triggers. 1-2 session
  cost.
- γ: Keep as Phase B prerequisite. Do R1-R4 first. Compounds
  duration cost; Phase B becomes Months 6-9.
- δ: Position as parallel supporting Track 3. Three concurrent
  tracks. Highest coordination cost; honors comparative analysis
  fully.

Claude Code's calibrated recommendation: β (lazy fold-in).
Reasoning: solo + AI managing three concurrent tracks is
operationally heavy; β captures Sprint 0's verified value at
minimum cost; β/β is the cleanest pairing with DP1=β.

DrJ's choice: **δ (parallel supporting Track 3)**. Rationale: the
comparative analysis is concrete observational evidence, not
speculation. Sessions 18-21 demonstrated infrastructure pain is
real at current scale. Treating R1-R4 as a supporting track —
rather than deferred work or prerequisite work — honors both
the analysis and the cascade learning. The "supporting track"
framing matters: Track 3 does not block Track 1 (product
features) or Track 2 (architecture).

Track 3 work items (per `docs/research/comparative_analysis_v1.md`
§7):
- Sprint 0: `Cache-Control: public, max-age=31536000, immutable`
  on hashed static assets (1 session, zero risk)
- Sprint 1: Cloudflare (or equivalent CDN) edge in front of
  scoopfeeds.com HTML (2-3 sessions)
- Sprint 2: `Cache-Control: public, s-maxage=120, stale-while-
  revalidate=600` on HTML responses (1 session, after Sprint 1)
- Sprint 3: SWR pattern on content API responses, extending
  c8917d1 persistent cache (2 sessions)
- Sprints 4-6: Server-render hot routes via Vite SSR or small
  Node SSR (4-6 sessions)

Total Track 3 effort: 10-13 sessions.

Decision Point 3 (Sprint 0 specific disposition) chose option **a**
— Sprint 0 executes as Track 3's opening sprint AFTER the binding
kickoff gate clears. Not pulled forward to Phase A close-out.
Rationale: internal consistency with DP2=δ; no exception precedent
that would erode the binding kickoff gate; 1-session production
hardening represents genuine value but not urgency.

Anti-goal tension acknowledged: Skills Architecture v1 §8 says
"Don't build the platform before the application." Track 3 is
partially platform-shaped work. The reconciliation accepts this
tension explicitly. Mitigations: Sprint 0 is 5-line config (not
platform); Sprint 1 integrates third-party CDN (not building one);
Sprint 2 is header policy change; Sprint 3 extends existing
persistent cache code; Sprints 4-6 (SSR) is application-facing
(changes user-visible first paint), not infrastructure for
non-existent features.

Phase B duration post-DP2:
- DP1=β baseline: "Months 1-5"
- DP2=δ extension: "Months 4-7" estimated, "Months 6-9" realistic
- Solo + AI execution typically runs 1.3-1.8× original estimates
- DrJ accepts longer duration as cost of reconciliation

Refs: docs/strategy/strategic_tactical_reconciliation_v1.md §6 + §7;
docs/research/comparative_analysis_v1.md §7 (Track 3 source);
finding #56 (R1-R4 origin); finding #74 (Sprint 0-6 elaboration);
finding #77 (sessions 18-21 displaced Phase A audit work — context
for why DrJ weighted durability heavily at this decision point)

### 80. Reconciled Phase B definition — three-track structure with combined exit criteria

Session 22 synthesis of DP1 + DP2 + DP3 decisions.

Phase B is now defined as three concurrent tracks executing
within a single Phase with unified entry gate and combined exit
criteria.

Track 1 — Product features (Strategic Plan v6 §9 Phase B):
Mobile-first homepage redesign, Mobile-first Event Dossier,
Tracker Auto-Detection Engine v1, first trackers across 8
categories, Op-ed aggregation MVP, Video clip integration,
Breaking news engine v1, source matrix expansion to ≥150,
Social Media Engine v2 (FB/IG/Bluesky upgrade + new X +
LinkedIn), 3 newsletter products, Alert engine v1 (web push +
email + Telegram), Internal Scoop search upgrade, Brave preview,
Entertainment surfaces, accessibility audit, brand refresh.

Track 2 — Architecture (Skills Architecture v1 §7):
B.1 Codebase reorganization by skill, B.2 skill contract docs,
B.3 lint boundaries, B.4 first skill isolation POC (image/video),
BullMQ migrations (5 queues mapping to skill boundaries).

Track 3 — Infrastructure (Finding #56 + Comparative Analysis §7):
Sprint 0 (immutable cache headers), Sprint 1 (CDN edge), Sprint 2
(s-maxage+SWR headers), Sprint 3 (SWR persistent cache pattern),
Sprints 4-6 (SSR for hot routes).

Binding kickoff gate (Skills Architecture v1 §10, binding per
session 22.A reframing):
1. Phase A wrapped cleanly (all Sprint 0-2 issues closed; Phase A
   retrospective written; no outstanding production incidents)
2. Strategic clarity on Reality Index (stable or relief applied)
3. Operational baseline understood (post-Phase-A observability
   data exists)
4. Time and energy budget realistic

If any of these aren't true, Phase B waits. No exceptions for
individual track items.

Combined Phase B exit criteria:
- All Strategic Plan v6 Phase B exit criteria (Lighthouse ≥90,
  ≥10 trackers, ≥150 sources, ≥10,000 search queries/month,
  ≥10,000 social followers, returning user rate ≥25%, Telegram
  ≥5,000, etc.)
- All Skills Architecture v1 Track 2 deliverables (skill folder
  structure, lint enforcement, image/video isolation POC, 5
  BullMQ migrations live)
- All Track 3 Infrastructure deliverables (immutable cache header,
  CDN edge, s-maxage/SWR HTML headers, SWR API pattern, at least
  one hot route SSR)

Forward path (sessions 23-N to clear kickoff gate, per finding #75
operational view + reconciliation §9.1):
1. Sprint 4 source audit (2-3 sessions) — unblocked
2. Sprint 5 social + search audits + 8 tracker templates (3-4
   sessions)
3. Sprint 3 close-outs: 5 metrics dashboard, raw_signals drop
   (1-2 sessions, parallelizable)
4. Sprint 2 close-outs: hollow-feature copy, i18n key wiring
   (1 session; CSP enable still deferred per finding #50)
5. Sprint 6 close-out: exit verification doc, metrics snapshot,
   formal Phase A Retrospective synthesis, Phase B Kickoff Brief
   drafting (3-4 sessions)

Estimated 10-14 sessions to clear kickoff gate (consistent with
finding #75's operational view 11-20 sessions range).

After kickoff gate clears, all three tracks open. Phase B Kickoff
Brief (drafted in Sprint 6.7) will lay out detailed sprint-by-
sprint plan per track.

Coordination mechanism (solo + AI specific):
- Per-session track tagging in commits + retrospective
- No-track-dark rule: no track goes more than 4 consecutive
  sessions without contribution
- Cross-track file conflicts surface in retrospective rather than
  silent absorption
- No new tracks added without explicit decision (would require
  reconciliation v2)

What this reconciliation does NOT do:
- Does not deprecate Strategic Plan v6 or Skills Architecture v1
  (both remain in repo, both carry forward)
- Does not pre-write the Phase B Kickoff Brief (Sprint 6.7 work)
- Does not pre-decide Layer 4 issues or JIT prompts (execution-time
  work per Execution Method v1)
- Does not require immediate Strategic Plan v7 or Skills
  Architecture v2 (recommended at next quarterly review, not
  blocking)

Honest caveats (per reconciliation §13):
- Three-track execution for solo + AI is unproven
- Comparative analysis is single-sample 2026-05-13 snapshot
- Anti-goal tension on Track 2 + Track 3 acknowledged
- Reconciliation itself is reversible via documented review
  triggers (reconciliation §11)

Refs: docs/strategy/strategic_tactical_reconciliation_v1.md
(entire document, 883 lines); findings #78 (DP1) + #79 (DP2+DP3);
finding #76 (drift origin); finding #56 (R1-R4 origin); finding
#74 (Sprint 0-6 elaboration); finding #75 (Phase A audit context);
Strategic Plan v6 §9 Phase B; Skills Architecture v1 §7 + §10;
Decisions Log v1 (no changes required)

### 81. Brief inaccuracy pattern recurring at Sprint 2 close-out — updated count ~7 of 8

Session 24 Part 3 (Sprint 2 close-out investigation) added two
more wrong-premise discoveries to the running tally:

- **Sprint 2 Issue 2.3** (hollow feature copy): Brief specified
  three pages (TruthGap, Leaderboard, Anomalies) as needing
  explanatory copy. Investigation revealed all three pages
  already have title + explanatory subhead + empty-state copy.
  Brief premise was wrong; no code change needed. Issue closed
  as CLOSED-WRONG-PREMISE.

- **Sprint 2 Issue 2.5** (wire dead nav.* keys): Brief described
  "22 of 36 keys never reach t()". Investigation traced the
  indirection pattern (`labelKey: "nav.X"` + `t(labelKey)`
  rendering in MoreMenu + EventsPage chip arrays) and found
  ALL 28 nav.* keys ARE wired. The grep that fails to find
  literal `t('nav.X')` calls produces the misleading dead-keys
  count. Brief premise was wrong; original "dead keys" framing
  closed as CLOSED-WRONG-PREMISE.

Updated count: **~7 of 8 inspected code issues had Brief
premises factually wrong** (vs 5 of 6 per finding #15; +2 from
Sprint 2 close-out).

Phase A's Brief was wrong on close inspection in:
- Sprint 1 Issue 1.3 (admin auth — already fixed by Codex)
- Sprint 1 Issue 1.5 (timeline duplication — 3× not 2×, cost
  was DB ops not LLM tokens)
- Sprint 2 Issue 2.1 (ALTER TABLE log spam — guard pattern
  already in place)
- Sprint 2 Issue 2.3 (hollow feature copy — pages already had
  copy)
- Sprint 2 Issue 2.5 (dead nav.* keys — all wired via
  indirection)
- Sprint 3 Issue 3.3 (dead isUrdu variable — actually in use)

Only Sprint 1 Issue 1.7 (smoke test design) was substantively
as the Brief described — and even there the smoke test
referenced a non-existent metric (finding #6).

The pattern validates D1 ("Brief written without inspecting
current code state") in Phase A Retrospective v1.0 §4. The Brief
was written without auditing Codex's prior hardening, without
inspecting actual UI state, without tracing the indirection
pattern.

Implication for Phase B Kickoff Brief drafting (Sprint 6.7):
investigation-before-edit should be encoded as Layer 4 (issue
template) requirement, not Layer 1 (strategic plan) aspiration.
Concretely:
- Issue template requires "Premise verification" step before
  acceptance criteria are locked
- "Verified current state of X" becomes a documented prerequisite
- Brief-versus-reality gaps captured in retrospective inputs
  file in real-time, not at audit time
- Mid-phase Brief refresh practice (per Phase A Retrospective
  §7.3 Addition 1) enforced as Layer 2 hygiene, not optional

The pattern is structural, not anomalous. Phase B Briefs should
be written against verified codebase state, with explicit
re-verification at sprint boundaries.

Refs: finding #15 (D1 / Brief inaccuracy origin, 5 of 6 wrong);
finding #75 UNCLEAR 4 (isUrdu premise wrong); finding #82 (Urdu
parity full scope finding from same investigation);
phase_a_retrospective.md §4 D1; Sprint 2 Issue 2.3 + 2.5
close-out investigation in session 24 Part 3

### 82. Urdu nav.* parity gap surfaced and resolved — full scope 12 keys, not initial 7

Sprint 2 Issue 2.5 investigation (session 24 Part 3) initially
identified 7 nav.* keys missing from ur.json relative to en.json:
nav.ai, nav.categories, nav.climate, nav.crypto, nav.health,
nav.space, nav.sports.

**Closer inspection during Phase 24C.2 step 2 revealed an
additional 5 keys present in ur.json but with English placeholder
values** (introduced in session 16 commit `6821ceb` when
EventsPage chip-labels were wired): `nav.all: "All"`,
`nav.politics: "Politics"`, `nav.tech: "Tech"`, `nav.science:
"Science"`, `nav.geopolitics: "Geopolitics"`.

**Real gap: 12 nav.* items showing English fallback to Urdu users
in MoreMenu / EventsPage, not 7.**

DrJ chose Option B scope (12 keys). All 12 translations applied
to ur.json in commit (forthcoming SHA captured in commit message
+ Pace Tracker). Translations selected by DrJ from style-aligned
alternatives:

| Key | Urdu translation | Style |
|---|---|---|
| nav.ai | اے آئی | Transliteration |
| nav.categories | زمرے | Pure Urdu |
| nav.climate | موسمیات | Pure Urdu (distinct from nav.weather = موسم) |
| nav.crypto | کرپٹو | Transliteration |
| nav.health | صحت | Pure Urdu |
| nav.space | خلا | Pure Urdu |
| nav.sports | اسپورٹس | Transliteration (matches Pakistani sports media) |
| nav.all | تمام | Pure Urdu |
| nav.politics | سیاست | Pure Urdu |
| nav.tech | ٹیکنالوجی | Transliteration |
| nav.science | سائنس | Transliteration |
| nav.geopolitics | جیو پولیٹکس | Transliteration |

**Institutional learning (the richer takeaway):**

Close-out investigation can produce scope larger than the
original audit estimate. The initial gap inventory (en/ur key
comparison) found 7 missing. The actual user-facing gap
(English-rendered nav items in Urdu UI) was 12. Investigation
caught the 5-key placeholder pattern that the inventory's
key-presence check missed.

This generalizes: **audit summaries that count presence ("21
keys in ur.json") can mask state quality ("only 16 of those 21
are actually translated").** Phase B audits should distinguish:
- **Presence audit**: does the key exist?
- **Completeness audit**: does the key have a non-placeholder
  value?

The two are not the same. Finding #75 (Phase A exit criteria
audit) used presence-style counts and inherited the inaccuracy;
this Sprint 2 close-out investigation surfaced the deeper
completeness gap.

Per Decision 6 (Urdu as full UI language through Phase D),
Urdu parity matters for the regional audience Strategic Plan
v6 explicitly targets. This 12-key fix closes a real UX gap
that predated finding #75 audit (the gap existed at audit time
but audit didn't surface it because key-count was the metric).

Cross-reference with finding #81: this investigation is one of
the seven instances where close inspection produced a different
picture than the Brief / audit estimate. The institutional
pattern is: summary metrics mask state quality; investigation
finds gaps that aggregations hide.

Implication for Phase B Track 2 (architecture):
- i18n parity becomes a continuous CI check (script to compare
  en.json and ur.json key-sets AND value non-placeholderness),
  not a manual audit
- Future locale files (ar.json for Arabic per Decision 6 Phase
  E) inherit the same CI parity requirement
- Sprint 5 search audit (deferred to session 25 in Sprint 4-5
  audit cluster) should apply this presence-vs-completeness
  distinction to FTS5 + sqlite-vec scaffolding state

Refs: Decision 6 (Urdu as full UI language); finding #75 (audit
inherited presence-style count without completeness check);
finding #81 (Brief inaccuracy pattern this fits into); session
24 Part 3 ur.json commit (SHA captured in commit message);
Phase A Retrospective v1.0 §5.4 (audit-vs-investigation
distinction); commit `6821ceb` session 16 (origin of placeholder
keys); MoreMenu.jsx + EventsPage.jsx (consumers of all 28
nav.* keys via indirection pattern)

### 83. Sprint 6.2 production smoke test — today's deploys PASS

Session 25 Extension. Smoke test verified two production deploys
(`60cfebf` Urdu i18n + `6278ab6` sources.js cleanup) work
correctly with no detected regression.

**PASS items verified in production:**
- Page loads (`/`, `/briefs`, `/events`, `/more`): all HTTP 200,
  <1s
- Frontend bundle: `index-B5fUgtvM.js` confirmed live
- All 12 Urdu translations verified in production
  `ur-CVmHELql.js` chunk (Vite emits Urdu locale as separate
  hashed chunk; not in main bundle — discovery)
- All 5 English placeholders verified absent from production
- `sourceCount: 110` (matches expected post-cleanup; was 119)
- Article ingestion healthy (+67 articles in 20 min ≈ 3/min)
- Zero articles from removed sources in `/api/news` sample
  (BBC/NPR/Guardian dominate — expected)
- `/api/health`, `/api/news`, `/api/ri/events`, `/api/live-events`
  all healthy (HTTP 200, <1s)

**False-alarm investigation worth capturing:**

Smoke test initially flagged `/api/events?limit=5` as "hanging"
(HTTP 200 headers + 0 body bytes after 60s timeout, reproducible
across 30s and 60s tries). DrJ requested 5-minute investigation
before classifying severity.

Investigation revealed `/api/events` is an SSE (Server-Sent
Events) endpoint, not REST:
- `App.jsx:96` uses `new EventSource("/api/events")` — SSE
  streaming connection
- `useEvents.js:4` comment explicitly documents separation:
  *"Base: /api/ri/events  (avoids collision with /api/events
  SSE stream)"*
- Frontend uses `/api/ri/events?category=X&status=active&limit=N`
  for finite REST queries — verified HTTP 200 in 0.6s
- The "hang" was correct SSE behavior: headers send immediately,
  body streams indefinitely, no events queued for streaming when
  curl probed
- `?limit=5` query parameter was likely ignored by the SSE handler

**Institutional learning:** Smoke tests should account for
endpoint type. curl-based REST smoke tests produce false alarms
on SSE endpoints. A complete smoke-test catalog should
differentiate:
- REST endpoints (curl with reasonable timeout, expect finite
  body)
- SSE endpoints (curl with stream-mode, expect ongoing event
  chunks; or skip endpoint with documented reason)
- WebSocket endpoints (require different tooling entirely)

Phase B smoke test design (per Sprint 6.7 Kickoff Brief drafting
work) should encode this differentiation as a smoke-test-catalog
prerequisite.

**Sprint 6.2 status:** **CLOSED.** Today's deploys verified
working; no real production issue exists; the events "hang" was
a smoke-test methodology gap, not a code defect.

**Sprint 6 progress after this session:**
- 6.1 Phase A exit verification — DONE (session 22, commit
  `23ccf5b`)
- **6.2 Full production smoke test — DONE ✓ (this session)**
- 6.3 Metrics snapshot — Not started (depends on Sprint 3.4)
- 6.4 Formal Phase A Retrospective — DONE (session 24 Part 1,
  commit `72a7eb8`)
- 6.5 Decisions Log review — Not needed
- 6.6 Strategic Plan v6 revision — Deferred to quarterly review
- 6.7 Phase B Kickoff Brief draft — Not started

**Sprint 6: 3 of 7 issues CLOSED** (was 2 of 7 before this
session).

**Binding kickoff gate effect:** Sprint 6.2 closure is below the
gate granularity (the gate conditions are at Sprint/criterion
level, not individual issue level). Gate status unchanged at 4
of 8 MET.

**Minor evidence-quality precision (per DrJ note):** The "No
outstanding production incidents" gate condition was MET
**pre-Sprint-6.2 by inference** (no known incidents reported).
After this smoke test, it is now **MET by smoke-test
verification** — same status, higher evidence quality. This
matters for future Phase B retrospective comparison: gate
conditions verified by testing are more durable than those held
by absence-of-known-issues.

**Honest scope limitations of this smoke test:**
- Visual Urdu rendering in browser NOT verified (only string
  presence in production JS chunk)
- Live tab SSE behavior in browser NOT verified (only confirmed
  endpoint is SSE-shaped, not that EventSource consumes
  correctly)
- Mobile / responsive layout NOT tested
- AdSense / CSP / third-party tag behavior post-deploy NOT
  re-verified (no changes today should affect these, but not
  re-checked)
- Long-tail endpoint behavior NOT covered (only 5 endpoints
  probed)
- Performance under load NOT tested (single-request checks only)
- Comprehensive Phase A regression coverage NOT covered (smoke
  test scoped to today's-changes + obvious-regressions, ~30 min
  cap)

These limitations are intentional per Sprint 6.2 scope discipline
(smoke test ≠ comprehensive verification). Phase B Kickoff Brief
should specify whether Phase B exit needs deeper coverage.

Refs: deploys `60cfebf` (session 24 Part 3 Urdu i18n) +
`6278ab6` (session 25 sources.js cleanup); Phase A Kickoff Brief
Sprint 6 Issue 6.2; `App.jsx:96` (SSE EventSource usage);
`useEvents.js:4` (REST endpoint via `/api/ri/events`);
`docs/phases/phase_a_exit_verification.md` §3.7 (Sprint 6.2
status pre-this-session: NOT STARTED → DONE)

### 84. Sprint 4.4 — two Brief premise errors in a single sprint (count to 9 of 10)

Session 26. Sprint 4.4 implementation surfaced **two distinct
Brief premise errors** in the same sprint, both caught at the
first verification step before any code merged. This updates the
cumulative count of inspected Brief items with wrong premises
from **7 of 8** (post-finding #81) to **9 of 10**.

**Error 1 (instance #8) — "Add columns to sources table" (no
such table existed).**

Brief Sprint 4.4 instructed adding quality-scoring columns
(`quality_score`, `quality_score_components`, `source_posture`,
`quality_score_methodology_version`,
`quality_score_last_updated`) to the existing `sources` table.
Verification showed the `sources` table did not exist; the
codebase had no `sources` DB infrastructure at all. Sources
were entirely config-file-driven via
`backend/src/config/sources.js`. The Brief premise — that a
`sources` table existed to extend — was wrong. Implementation
pivoted to creating the table from scratch as Migration 002,
with scoring columns NULL-able until backfill in Sprint 4.5.

**Error 2 (instance #9) — `credibility_legacy INTEGER NOT NULL`
(44 YouTube entries have no credibility values).**

Brief specified `credibility_legacy INTEGER NOT NULL` as a
schema constraint, modelled on the assumption that all 154
sources had a legacy credibility value to migrate. Verification
of `sources.js` showed the 110 RSS sources had `credibility:
<int>` fields but the 44 YouTube sources did not — YouTube
entries use `{ name, channelId, category, region }` shape with
no credibility field. Forcing NOT NULL would have required
fabricating credibility values for 44 sources where the legacy
system never produced one. Implementation made the column
NULL-able (Deviation 1, founder APPROVED); NULL accurately
reflects "the legacy scoring system did not score this source."

**Path B schema decision (founder override on Deviation 2).**

Initial implementation derived YouTube URLs from channelIds to
satisfy a single `url` column. Founder requested revise to Path
B: separate `url` and `channel_id` columns with a CHECK
constraint enforcing exactly one identifier per row, plus
partial unique indexes per column. Not a Brief inaccuracy per
se — the Brief did not specify how to model YouTube-vs-RSS
identifiers — but a documented schema decision against the
simpler-looking "single url column" default. Rationale: schema
should match data semantics rather than deriving identifiers
that the data itself does not natively carry.

**Cumulative count progression (Brief inaccuracies in inspected
code issues):**

- Finding #15 (Sprint 2, session 9): 5 of 6
- Finding #81 (Sprint 2 close-out): 7 of 8
- **Finding #84 (Sprint 4.4, this session): 9 of 10** — two
  new instances from a single sprint

Pattern across nine instances: the Brief consistently described
code/schema/data state at a granularity below what was actually
verifiable at the time of writing. Brief writes premises in
terms of expected state; verification reveals the actual state
has drifted in small but consequential ways.

**Institutional implication for Phase B Kickoff Brief writing.**

The pattern argues for a verification step in the Brief
authoring workflow: each premise about existing code or data
state should be verified against `git ls-files` / schema
inspection / actual config-file content before the premise is
written, not after. Cost of mis-premised work has been low in
Phase A because diagnostic discipline catches errors early
(see findings #15, #81, #84 themselves) but the cumulative
session-time cost of premise-correction is non-trivial.

The other half of the pattern is that **Sprint 4.4 alone
produced two of the nine instances**. Sprints that touch
unfamiliar territory (here: a DB layer that did not previously
exist; a 0-100 scoring methodology that did not previously
exist) are higher-density premise-error risks than sprints
that extend known infrastructure. Phase B Brief authoring
should weight verification effort by topic novelty.

**Sprint 4 progress update.** After Sprint 4.4 ships:

- 4.1 Phase A audit findings (sessions 22-25): DONE
- 4.2 Source-by-source audit Phase 1 (HTTP verify all 119):
  DONE (session 24)
- 4.3 Dead-source cleanup (remove 9): DONE (session 25 main)
- **4.4 Quality scoring schema + methodology: DONE (this
  session)**
- 4.5 Quality score backfill: NOT STARTED (session 27
  candidate)
- 4.6 Gap analysis synthesis: DONE (session 25 main)
- 4.7 Phase B source priority list: PARTIAL (illustrative
  candidates surfaced session 25; finalization deferred)

**Sprint 4 status after Sprint 4.4 close: 5 of 7 DONE + 1
PARTIAL + 1 NOT STARTED.**

**Phase A close-out remaining (post-Sprint-4.4):**

- Sprint 4.5 backfill + 4.7 finalization: 1-2 sessions
- Sprint 3 close-outs (3.1 raw_signals drop + 3.4 metrics
  dashboard): 1-2 sessions
- Sprint 5 audits + 8 tracker templates: 2-3 sessions
- Sprint 6 remaining (6.3 metrics depends on 3.4; 6.7 Phase B
  Kickoff Brief drafting): 2-3 sessions
- **Total: 6-10 sessions to clear binding kickoff gate**
  (unchanged from session 25 Extension estimate; -1 from
  Sprint 4.4 closure offset by +1 institutional capture work
  for finding #84)

**Refs:**

- `backend/src/db/migrations/002_sources_table.js` (Path B
  schema)
- `backend/src/db/migrate.js` (migration wiring)
- `backend/src/config/sources.js` (architectural breadcrumb
  header per session 26)
- `docs/content/source_credibility_methodology.md` (public
  methodology v1.0)
- Finding #15 (5-of-6 origin), Finding #81 (7-of-8); Finding
  #82 (Urdu nav.* parity gap — separate Brief inaccuracy
  thread, not counted in the 9-of-10 code-issue series)
- Strategic Plan v6 §3 Capability 1
- Decisions Log Decision 7 (open methodology + proprietary
  weights) + Decision 16 (source onboarding workflow)

### 85. Sprint 4.5 architectural reframing — infrastructure work disguised as content work in Phase planning

Session 27. Sprint 4.5 Phase 1 calibration on 15 publisher
sources validated methodology v1.0 (15/15 PASS within expected
ranges). But the more important institutional artifact from
this session is what the calibration revealed about Sprint 4.5
as it was originally framed.

**Pattern: infrastructure work disguised as content work.**

Phase A Kickoff Brief framed Sprint 4.5 as content work: "score
all 154 sources against the v1.0 rubric." Estimated effort:
12-25 hours of manual scoring per scoring window. That framing
treats source scoring as a one-time content deliverable.

Per methodology v1.0 §7.1 (revisit cadence), sources are
re-scored every 6-12 months. The annualized cost of manual
scoring at the current 154-source corpus would be ~12-50 hours
per year ongoing, PLUS the per-source-onboarding cost as
corpus grows toward the Strategic Plan v6 targets (Phase B
exit 150 sources, Phase C exit 300, Phase D exit 500, Phase E
exit 800). At Phase E exit, annualized manual-scoring effort
would be ~60-260 hours per year before accounting for
methodology version transitions per §7.2 (which require
full-corpus re-scoring within a defined window per minor
version).

When the actual work shape is recurring infrastructure
operation, "shipping it as content" means one of three things:

  (a) Doing the work manually and signing up for the recurring
      cost forever (and absorbing the throughput cap that
      becomes binding as corpus grows)
  (b) Building the infrastructure halfway through, after
      realizing the recurring cost is the real shape
  (c) Pretending it shipped when only the first batch was
      scored — letting the "scored sources" set drift
      progressively stale relative to publication date

The calibration session caught this before path (a) or (c)
were committed to. Sprint 4.5 was reframed during pre-scoring
discussion: Phase 1 calibration on 15 sources produces the
ground-truth dataset; Phase 2 ships methodology v1.1 plus an
automated scoring service specification handed to Phase B
Track 1. The corpus-wide backfill itself executes within Phase
B Track 1 as the scoring service goes live.

**Pattern recognition — this is not the first instance.**

Other Phase A sprints that turned out to be infrastructure
disguised as content:

- **Sprint 4.4 (session 26):** Brief said "add quality
  scoring columns to sources table." The actual work shape
  was: build the sources DB table (didn't exist), design the
  schema (RSS vs YouTube identifier model, CHECK constraint,
  partial unique indexes per Path B), seed it from the config
  file. Two Brief premise errors (finding #84) plus a Path B
  founder override on schema design. The "add columns"
  framing concealed the table + schema-design + seed effort.
- **Sprint 2 Issue 2.5 (session 24 Part 3):** Brief said "add
  7 missing Urdu nav.* translations." Audit (finding #82)
  revealed 12 keys total — 7 missing plus 5 English
  placeholders that needed replacement. The "add 7" framing
  concealed the systematic placeholder-audit work.
- **Sprint 1 originally (session 9 era, finding #15):** Brief
  framed several stabilization items as point fixes; investigation
  revealed underlying infrastructure debt patterns.

The pattern is not a critique of Brief authorship per se —
Brief premises are written before evidence is gathered and
necessarily compress. The pattern is a calibration signal: when
a Brief item touches scoring, schema, audit, or systematic
verification, the work shape should be assumed to be
infrastructure work until evidence proves otherwise. Phase B
Kickoff Brief authoring should apply this prior, especially
when sizing source-quality, translation-pipeline, and
tracker-template work.

**Institutional implication carried into Phase B Kickoff Brief
(Sprint 6.7 work):** Phase B Brief should explicitly classify
each line item as "content" vs "infrastructure" with the
classification justification documented. Infrastructure items
should be sized in build-effort plus annualized-operation-cost
terms, not just build-effort terms. Content items should be
sized in throughput plus cadence terms.

This finding pairs with finding #84 (Brief premise errors) as
the two-part institutional lesson Phase A produces for Phase B
Kickoff Brief authoring discipline: verify premises against
actual code/data state (finding #84) AND verify work-shape
classification against actual deliverable cost over time (this
finding).

**Refs:**

- `docs/audits/phase_a_source_audit_phase2_calibration.md`
  (Sprint 4.5 Phase 1 calibration document, §5.1 architectural
  insight + §6.1 Sprint 4.5 reframing)
- `docs/content/source_credibility_methodology.md` §7.1
  (revisit cadence) + §7.2 (methodology versioning + per-version
  re-scoring window)
- Finding #82 (Urdu nav.* parity gap — same pattern in i18n
  category)
- Finding #84 (Sprint 4.4 Brief premise errors — companion
  finding on Brief authoring discipline)
- Strategic Plan v6 §3 Capability 1 (Phase B/C/D/E source-count
  targets that compound the annualized-scoring effort)
- Phase A Kickoff Brief Sprint 4 Issue 4.5 (the original
  content-framed scope this finding reframes)

### 86. Methodology scope gap — publisher v1.0 silent on individual creators; three-layer creator methodology preserved as architectural artifact

Session 27. Methodology v1.0 (committed at `7409dfe`, Sprint
4.4) was designed for publisher-class sources and validated on
15 publishers in Sprint 4.5 Phase 1 calibration (this session).
It does not handle individual creators. This finding documents
the scope gap and preserves an architectural artifact for the
future creator-methodology work (Phase B or C scope).

**The gap, concretely.**

Methodology v1.0 §1.1 says it scores "each source in our
corpus." That phrasing implicitly assumes editorial-organization
shape. The 5-component rubric carries that assumption forward:

- §2.1.a — named editorial leadership. For a solo creator,
  the creator IS the leadership; the sub-criterion collapses.
- §2.1.b — published editorial standards. Creators rarely
  publish standards documents.
- §2.1.e — separation of news and opinion. Many creator
  formats are explicitly opinion + commentary by design.
- §2.4 — Independence. Creator independence is structurally
  different from publisher independence: sponsorship rather
  than ownership; platform-dependency rather than
  publisher-charter; per-episode sponsorship disclosure
  rather than masthead-level ownership disclosure.

The current Scoopfeeds corpus is publisher-heavy by design (110
RSS publishers + 44 YouTube channels operated mostly by
publishers/news organizations + curated X handles), so the gap
does not bind today. It will bind as Phase B / C expand the
source matrix per Strategic Plan v6 (Phase C exit 300 sources,
Phase D 500, Phase E 800), particularly for category × region
cells where creator content is the dominant content shape
(Substack-class commentary, podcast-host-led analysis, single-
operator YouTube channels in specialized beats).

**Creator methodology requires a three-layer structure for
interview-format content.**

This is the architectural artifact this finding preserves for
future work. For interview-format content (podcasts, YouTube
interviews, panel discussions, Substack-with-interview-
podcast), source credibility is not a single number per
channel. The credibility of a given episode is a composite of
three independently-scored layers:

  **Layer 1 — Host / channel credibility.** The show's own
  editorial practice: sponsorship transparency, prior-guest
  selection patterns, retraction history, fact-check track
  record, audience-recommended-corrections handling. Roughly
  analogous to publisher methodology §2.1 + §2.2 + §2.5 but
  with creator-shape sub-criteria.

  **Layer 2 — Guest credibility.** The specific guest's own
  domain expertise, prior-claim track record on related
  topics, declared conflicts of interest, history of behaviour
  when challenged on factual claims. This layer is closer to
  individual-source scoring than channel-source scoring;
  highly portable across episodes (same guest scored once,
  reused across appearances).

  **Layer 3 — Per-episode composite.** Critically, this is
  NOT a simple host × guest function. It captures how the host
  handled the specific guest in this specific episode:
  challenged claims or let them pass? fact-checked in real
  time or post-hoc? added context or amplified? framed the
  guest's claims accurately in show description / transcript /
  social? Per-episode composite encodes the practice signal
  that host-alone or guest-alone scoring miss.

The three-layer structure means each episode has three score
inputs and one composite output. Display surfaces vary:

- Layer 1 host score visible on channel profile page (per
  v1.0 §1.3 source profile pattern).
- Layer 2 guest score visible on per-episode dossier
  alongside guest's other appearances and standalone scoring.
- Layer 3 episode composite drives ranking and confidence
  signal on the episode in the corpus, and the long-tail
  average of Layer 3 scores across episodes feeds back into
  the host's Layer 1 over time (good hosts get credit for
  consistent practice; bad hosts pay over time for letting
  claims pass).

**Scope and timing.**

- Creator methodology v1.0 is NOT a v1.1 patch to publisher
  methodology v1.0. The component set, sub-criteria, posture
  labels, and band structure all differ materially. Treating
  it as a v1.1 patch would muddy both methodologies.
- Creator methodology v1.0 is appropriately Phase B or C
  scope. Sprint 4.7 expanded scope (per this session's Sprint
  4.5 reframing) includes drafting architectural framing
  during Phase A close-out; the methodology document itself
  ships when the corpus needs it.
- The three-layer structure is the meaningful architectural
  artifact this finding preserves. Specific component design
  and sub-criteria are deferred to the methodology work
  itself.

**Cross-references for the future creator-methodology
session:**

- Publisher methodology v1.0 §2 (5 components) — likely
  inspiration but not direct adoption; creator methodology
  components will differ.
- Publisher methodology §5 (8 posture labels) — creator
  posture labels may overlap (Independent, Corporate-PR for
  brand-owned-creator, Advocacy for mission-aligned creator)
  but will need additions (Platform-employed-creator,
  Sponsorship-dependent-creator).
- Publisher methodology §6 (scoring workflow) — same
  founder-review pattern per Decision 16 likely applies.
- Publisher methodology §7 (versioning + cadence) — separate
  v<major>.<minor> track for creator methodology, with
  independent cadence from publisher methodology.
- Finding #85 (Sprint 4.5 architectural reframing) — applies
  fully to creator-methodology operationalization: build as
  scoring service, not manual marathon.

**Refs:**

- `docs/audits/phase_a_source_audit_phase2_calibration.md`
  §5.2 (publisher v1.0 scope gap) + §5.3 (three-layer
  structure) + §6.2 (Sprint 4.7 expanded scope)
- `docs/content/source_credibility_methodology.md` v1.0
  (the publisher methodology that this finding scopes around)
- Strategic Plan v6 §3 Capability 1 (corpus growth targets
  that make creator scoring binding by Phase C)
- Finding #85 (architectural reframing — applies to creator
  scoring service shape as well)

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

---

PACE TRACKER (updated session 15, 2026-05-10)

Session 15 work shipped:
- GStack evaluation complete (finding #44)
- Path B closed cleanly: evaluation, no adoption decision today,
  deferred to Phase B.0
- ~35-40 min session, well under 75-min cap

Cumulative session 15 today vs sessions 12, 13, 14:
- Today (calendar Sunday May 10, UTC): 4 sessions completed
  (12, 13, 14, 15)
- Combined session time today: roughly 11-13 hours of focused
  technical work
- Pace concern flagged: this is heavily compressed work for a
  single calendar day

Phase A close-out remaining: ~7-8 dedicated sessions
(unchanged from session 14 estimate)

CSP observation window status: Started 2026-05-10 15:57:55 UTC.
~22 minutes elapsed at session 15 close. ~22-46 hours remaining
before reports are read.

Next session opening candidates (when DrJ returns):
- Issue 2.5 verification (audit pass on dead nav.* keys, ~30 min)
- Finding #25 strategic planning (RSS date-parsing, ~30-45 min)
- Finding #41 strategic discussion (logging refactor scope,
  ~30-45 min)
- Read accumulated CSP reports (only after observation window
  ≥24h elapsed)

Session 15 close: production at 30ca166 (no commits this session
beyond finding capture).

---

PACE TRACKER (updated session 16, 2026-05-11)

Session 16 work shipped:
- Issue 2.5 verification complete (Phase 1A-1E investigation)
- Issue 2.5 final closure: EventsPage i18n wiring at 6821ceb
- 5 new findings captured (#45-#49)
- Sprint 2 closes substantively (CSP Stage 2 still observation-pending)

Calendar pace:
- Today is 2026-05-11 (Monday) — first session after a real
  overnight rest (session 15 closed ~19 hours prior)
- Session 16 duration: ~90 min at finding capture (will be
  longer with capture commit included)
- This is meaningfully better cadence than May 10's 4-session
  compressed day

Phase A close-out remaining work after session 16:
- CSP Stage 2 enforcement (waiting for ~24h observation window
  to be safely past; that point is ~2026-05-11 15:57:55 UTC =
  ~today's 7pm Pakistan, achievable in session 17)
- Finding #25 RSS date-parsing strategic fix (deferred from
  this session; planned for session 17)
- Finding #41 logging refactor scope decision
- Sprint 6 work (exit verification, metrics snapshot, retrospective
  writing, Phase B Kickoff Brief)
- Findings #46/#47 (useHealth + tagline bugs) — fold into
  general Phase A close-out bug fix sweep
- Finding #48/#49 (EventTracker redesign + content quality) —
  de-scope to Phase B+ as part of Reality Index skill work

Realistic remaining: ~6-7 dedicated sessions to Phase A close
(slight tightening from session 14's 7-8 estimate; Sprint 2
closure progress).

CSP observation window status: started 2026-05-10 15:57:55 UTC.
~21 hours elapsed at session 16 close. 24-hour mark reached
~today 7pm Pakistan time. Reports can be read in session 17.

Next session opening candidates:
- Finding #25 RSS date-parsing structural fix (was today's
  deferred work)
- CSP report reading + Stage 2 enforcement decision
- Findings #46/#47 quick bug fixes (useHealth + tagline)

Session 16 close: production at 6821ceb. CSP observation
window continues running in calendar time.

---

PACE TRACKER (updated session 17, 2026-05-11)

Session 17 work shipped:
- CSP report reading + analysis (Phase 1 of session)
- Defer Stage 2 enforcement decision (finding #50 captured)
- Three commits in article-page navigation arc:
  - 49d7735: z-[100] + close-trap fix
  - 3490337: opaque Header (later reverted)
  - d301cf6: modal-native nav + Header hidden when modal open
    (FINAL architectural fix)
- Browser verification revealed logo click bug (finding #52)
- 6 new findings captured (CSP defer, three-commit arc lessons,
  logo bug, useHealth recurring, AdSense rejection, traffic
  shape gap)

Cumulative calendar pace:
- Session 17 duration: ~3.5 hours (started 14:00 UTC, finishing
  ~17:30 UTC at finding capture)
- Session 17 was clean: started after real overnight rest from
  session 16, used physical movement (evening jog) as session
  break
- BUT: still ran past stated "2-hour budget before sleep" by
  ~90 min, ending at 12:43 AM Pakistan time (00:13 UTC)
- Better cadence than May 10's 4-session compressed day, but
  not the ideal cadence
- Honest read: the session extended because product critique
  surfaced mid-session and demanded a third commit; the work
  was real and worth doing, but session-boundary discipline
  remained imperfect

Phase A close-out remaining work after session 17:
- Sprint 6 work (exit verification, metrics snapshot, retrospective
  writing, Phase B Kickoff Brief) — substantive remaining work
- Finding #25 RSS date-parsing structural fix
- Finding #41 logging refactor scope decision
- Finding #53 (useHealth 429 priority HIGH) — likely session 18
- Finding #52 (logo bug) — session 18 or batched with other UI work
- Finding #47 tagline rendering bug (smaller, batchable)

Realistic remaining: ~6-7 dedicated sessions to Phase A close
(slight tightening from session 14's 7-8 estimate; session 17
shipped substantive UX work).

CSP observation continues running indefinitely (decision deferred
per finding #50).

Next session opening candidates:
1. useHealth 429 fix (priority HIGH per finding #53; DrJ named
   this as deserving full session)
2. Logo click bug investigation + fix (finding #52)
3. Finding #25 RSS date-parsing structural fix (long-deferred)
4. Sprint 6 work begin (exit verification, retrospective writing)

Session 17 close: production at d301cf6. Three commits shipped
this evening. Architecture corrected via Approach 2 cleanup
during Phase 3.

---

PACE TRACKER (updated session 18, 2026-05-12)

Session 18 work:
- useHealth 429 fix attempted (commit f34f2bf) — technically
  correct but exposed systemic cascade
- Production verification revealed React #300 crashes under load
- Revert f34f2bf shipped (this commit) — restore stability
- Comprehensive findings captured (#56 cascade root cause + two-
  track fix plan, #57 React #300 mechanism, #58 Hostinger fit)
- Strategic alignment with overall plan: stabilization track
  (S2-S4) added to Phase A close-out; redesign track (R1-R4)
  threaded through Phase B opening

Calendar pace:
- Session 18 duration: ~2.5 hours
- Started after real overnight rest from session 17 (~16h gap)
- Within stated 2+ hour budget
- Honest read: session productive despite the failed-fix
  experience because diagnostic depth produced real architectural
  understanding

Phase A close-out schedule REVISION:
- Pre-session-18 estimate: 6-7 sessions remaining
- Post-session-18 estimate: 10-11 sessions remaining
- Schedule extension reason: stabilization track (S2 axios
  interceptor, S3 rate limit recalibration, S4 defensive component
  patterns) added to Phase A close-out for production stability

Phase A close-out remaining work breakdown:
- S2 — Global axios 429 interceptor (1 session)
- S3 — Per-route rate limit recalibration (1-2 sessions)
- S4 — Defensive component patterns + ESLint config (1 session)
- Finding #25 — RSS date-parsing structural fix (1-2 sessions)
- Finding #41 — Logging refactor scope decision and possible
  implementation (1-2 sessions)
- Finding #47 — Tagline rendering bug (can batch with smaller
  fixes)
- Finding #52 — Logo click bug (~30 min, batchable)
- Sprint 6 — Exit verification, metrics snapshot, retrospective
  writing, Phase B Kickoff Brief (2-3 sessions)

Next session opening (session 19):
- Phase S2: global axios 429 interceptor
- Bounded session (60-90 min focused work)
- Single architectural fix at axios layer; no per-hook changes;
  benefits ALL data-fetching hooks systemically

CSP observation continues running indefinitely per finding #50
decision.

Session 18 close: production state restored. Cascade root cause
documented. Two-track fix plan agreed. Path forward clear.

---

PACE TRACKER (updated session 19, 2026-05-12)

Session 19 work shipped:
- Phase S2 base architecture (commit cf0f16f): global axios 429
  interceptor with Philosophy B data model, in-memory cache,
  17-file consolidation via createApi helper
- Phase S2 verification revealed cold-cache crash gap (finding #59)
- Phase S2b persistent layer (commit c8917d1): tiered cache
  (memory + sessionStorage + localStorage), per-endpoint TTL,
  verified sentinels for /health and /auth/me, privacy split,
  defensive storage, hydration on module load
- Phase S2b verification confirmed architecture works under
  same adversarial conditions that broke cf0f16f (finding #61)
- 5 new findings captured (#59-#63)

Calendar pace honest accounting:
- Session 19 duration: ~5 hours
- Started after 16-hour gap from session 18 (real overnight rest)
- Extended past initial 2-hour budget
- Session extension was driven by genuine discovery: cf0f16f
  verification failure required design iteration to S2b in same
  session rather than splitting
- Engineering output: substantial (two architectural commits
  shipping foundational data-layer resilience)

Phase A close-out schedule update (revised from session 18):
- Pre-session-19 estimate: 10-11 sessions remaining
- Phase S2 + S2b shipped this session (was 1 session in original
  plan, took effectively 1 long session)
- Post-session-19 estimate: 9-10 sessions remaining for Phase A
  close
- S3 (per-route rate limit recalibration): 1-2 sessions
- S4 — Component defensive patterns + hook unwrap contract
  (1-2 sessions, scope per finding #60). Production observation
  post-c8917d1 added concrete S4 input: finding #64 (TopicPage
  fallback), #65 (reader extraction intermittency), #66 (modal
  nav conditional rendering). These three production-observed
  failures are the priority Phase S4 inventory items.
- Finding #25 RSS date-parsing: 1-2 sessions
- Finding #41 logging refactor decision: 1 session
- Finding #47, #52 small bugs: batched, 1 session
- Sprint 6 close-out: 2-3 sessions
- Plus Yahoo/Bloomberg study (finding #62) as session 20
  candidate

Next session opening candidates:
1. Yahoo/Bloomberg comparative analysis (finding #62) — informs
   later Phase B work but doesn't ship code
2. Phase S3 per-route rate limit recalibration — direct continuation
   of stabilization track
3. Phase S4 defensive component patterns — closes the residual
   5% gap from S2b

Recommendation: session 20 should pick ONE of the above, not
attempt multiple. Phase S3 is the natural continuation but Yahoo
study has strategic value. DrJ to decide.

CSP observation continues indefinitely per finding #50.

Session 19 close: production at c8917d1. Yahoo/Bloomberg-class
warm-cache path achieved. Path forward to Phase A close clear.

---

PACE TRACKER (updated session 20, 2026-05-13)

Session 20 work shipped:
- Phase S3 (commit 1cbf92b): per-route rate limit recalibration,
  three new tier limiters (highFreq 200/5min, standardRead
  120/5min, mutation 60/5min), apiGlobalLimiter raised to
  3000/15min as safety net, readerLimiter raised 30 → 60 per
  finding #65
- Phase S3 verification confirmed architecture works as designed
  (finding #67)
- Findings #64, #65, #66 resolved via S3's elimination of
  rate-limit firing rather than component defensive code
  (finding #68)
- 3 new findings captured (#67-#69)

Calendar pace honest accounting:
- Session 20 duration: ~2 hours
- Started after 15.5-hour gap from session 19 (real overnight rest)
- Within stated 1+ hour budget
- Clean engineering session: investigation → design → implementation
  → verification → findings, no false starts or reverts

Phase A close-out schedule REVISED DOWN:
- Pre-session-20 estimate: 9-10 sessions remaining
- Post-session-20 estimate: 5-7 sessions remaining
- Schedule reduction reason: S3's broader-than-expected impact
  downscopes S4 substantially per finding #68

Stabilization track status:
- S1 ✓ (session 18) - revert
- S2 ✓ (session 19) - cf0f16f interceptor
- S2b ✓ (session 19) - c8917d1 persistence
- S3 ✓ (session 20) - 1cbf92b tier limits
- S4 - downscoped, ~1 session

Phase A close-out remaining work:
- S4 downscoped (1 session)
- Finding #25 RSS date-parsing (1-2 sessions)
- Finding #41 logging refactor (1 session)
- Finding #47 tagline rendering (batched)
- Sprint 6 (2-3 sessions)

Next session opening candidates (in priority order):
1. Phase S4 downscoped (ESLint rule + targeted fixes)
2. Sprint 6 begin (retrospective writing + exit verification)
3. Yahoo/Bloomberg study (Phase B input)
4. Finding #25 RSS date-parsing

CSP observation continues per finding #50.

Session 20 close: production at 1cbf92b. Full stabilization
track verified. Path to Phase A close is now genuinely visible
within 5-7 sessions. Three concrete production failures from
session 19 (findings #64-#66) all resolved.

---

PACE TRACKER (updated session 21 phase 2, 2026-05-13)

Note: session 21 phase 1 (commits 8e44b5d + b2b797c, comparative
analysis + findings #70-#74) shipped without a dedicated Pace
Tracker entry. This phase 2 entry covers both phases of session
21 plus the phase 2 audit work.

Session 21 phase 1 work shipped (recap):
- Comparative analysis document (1,375 lines) at
  docs/research/comparative_analysis_v1.md
- Findings #70-#74 captured
- Commits 8e44b5d (research doc) + b2b797c (findings)

Session 21 phase 2 work shipped:
- Strategic plan + Skills Architecture v1 + Execution Method v1 +
  Phase A Kickoff Brief + Decisions Log read in full (4,830
  lines across 5 documents)
- Phase A exit criteria audit completed against Strategic Plan v6
  + Phase A Kickoff Brief
- 6 UNCLEAR audit items resolved (5 via DrJ judgment with review
  triggers, 1 via direct source inspection)
- Four-way Phase B drift surfaced and documented (finding #76)
- Stabilization-track-displaced-Sprint-4-5 trade-off captured
  (finding #77)
- 3 new findings (#75-#77)

Calendar pace honest accounting:
- Session 21 phase 1 duration: ~2.5 hours (comparative analysis
  + findings + commits)
- Session 21 phase 2 duration: ~1 hour (audit + UNCLEAR
  resolution + findings)
- Total session 21: ~3.5 hours of 4 hour stated budget

What did NOT happen this session (Path 2 deferrals):
- Full strategic_tactical_reconciliation_v1.md document
- Strategic Plan v6 vs Skills Architecture v1 Phase B
  reconciliation
- Redesign track disposition decision (α/β/γ + extended
  options)
- Phase B Sprint 0 execution (originally planned for today)

Phase A close estimate RE-REVISED:
- Pre-session-21 estimate (session 20): 5-7 sessions remaining
- Post-audit estimate (session 21 phase 2): 5-11 sessions
  (strategic view minimum) to 11-20 sessions (operational view
  full close-out)
- Both views are legitimate; which framing Phase A exits under
  is itself a parked decision

Next session candidates (in order of strategic importance,
NOT chronological order — DrJ to choose):

1. Dedicated four-way Phase B reconciliation session (per
   finding #76). Strategic-tier decision work. 90-120 min.
   Output: reconciliation document + decision on which Phase B
   definition is authoritative + position of finding #56 redesign
   track and comparative analysis recommendations within
   reconciled Phase B. PREREQUISITE for any Phase B execution.

2. Sprint 4 source audit (7 issues, 2-3 sessions). Inventory
   current 119 sources, categorize against 17×10×10 matrix,
   identify dead sources, design quality scoring schema,
   backfill scores, gap analysis, document Phase B source
   priority list. Unblocked by Phase A audit findings.

3. Sprint 6 begin (Phase A close-out artifacts). Exit
   verification document, metrics snapshot, formal Phase A
   Retrospective synthesis from inputs file, Phase B Kickoff
   Brief drafting. Can run in parallel with #1 or after #2.

4. Phase S4 downscoped (ESLint rule + targeted defensive fixes,
   1 session). Now even less urgent than session 20's revision
   suggested; the production-observed failures it addressed
   (findings #64-#66) are resolved per session 20 verification.
   May be subsumed into Phase B Kickoff Brief as "carry-forward
   technical debt."

Session 21 phase 2 close: production at 1cbf92b (unchanged).
Retrospective at finding #77 (after commit). 77 cumulative
findings. Phase A genuinely further from close than session 20
estimated, but the audit was the necessary work to surface that
honestly.

The session opened intending Phase B Sprint 0 execution. It
closes with formal Phase A audit + four-way Phase B drift
documented. The pivot was correct: shipping Sprint 0 today would
have built one more piece of tactical work on top of an
unrecognized strategic-tactical drift. The drift was discovered
because DrJ asked "is this in line with the strategic plan?"
The question prevented an estimated 10-13 sessions of misaligned
infrastructure work.

CSP observation continues per finding #50. raw_signals drop
(Sprint 3.1) and formal Phase A Retrospective (Sprint 6.4)
remain pending.

---

PACE TRACKER (updated session 22, 2026-05-15)

Session 22 work shipped:
- Strategic plan + Skills Architecture v1 + Phase A Kickoff Brief
  + Comparative Analysis re-read for reconciliation purposes
- 22.A reframing surfaced: drift is 3-way not 4-way (finding #56
  and session 21 comparative analysis are the same infrastructure
  track at two specificity levels)
- 22.A reframing confirmed: Skills Architecture v1 §10 Phase B
  Kickoff Gate is BINDING regardless of which reconciliation
  option is chosen
- 22.A investigation: BullMQ migrations status = SCAFFOLDED-NOT-
  MIGRATED. Code on main since e57c3ca; production runs
  USE_BULLMQ=false. Migrations remain Phase B Foundation work
  (Strategic Plan v6's only explicitly-named structural item)
- Decision Point 1 (authority resolution): DrJ chose β (parallel
  tracks within Phase B) over Claude's recommended α
- Decision Point 2 (infrastructure track disposition): DrJ chose
  δ (parallel supporting Track 3) over Claude's recommended β
- Decision Point 3 (Sprint 0 timing): DrJ chose a (Track 3
  opening sprint, post-kickoff-gate)
- Reconciliation document written:
  docs/strategy/strategic_tactical_reconciliation_v1.md (883
  lines)
- 3 new findings (#78-#80) capturing the three decisions plus
  the reconciled Phase B definition
- Pattern observed at decision points: DrJ consistently weighted
  durability over short-term velocity. At each decision point
  Claude recommended the lower-cost-lower-coverage option; DrJ
  chose the higher-cost-higher-coverage option. The reconciled
  Phase B is the architecturally-richest option in the matrix.

Calendar pace honest accounting:
- Session 22 duration: ~2 hours
- Started after ~24-hour gap from session 21 close (DrJ overnight
  reflection per Path 2 choice)
- Strategic-decision-heavy, code-light session: no production code
  shipped; documentation + retrospective only

Phase B duration estimate post-reconciliation:
- Strategic Plan v6 original: "Months 1-3"
- Post-DP1=β: "Months 1-5" baseline
- Post-DP2=δ: "Months 4-7" estimated
- Realistic (1.3-1.8× per Execution Method v1): "Months 6-9"
- DrJ accepts longer duration as cost of reconciliation;
  architectural durability prioritized over time-to-Phase-C

Phase A close-out remaining work (pre-Phase-B kickoff gate
clearing) per reconciliation §9.1:
- Sprint 4 source audit (2-3 sessions)
- Sprint 5 social + search audits + 8 tracker templates (3-4
  sessions)
- Sprint 3 close-outs: 5 metrics dashboard + raw_signals drop
  (1-2 sessions, parallelizable)
- Sprint 2 close-outs: remaining hollow-copy + i18n (1 session;
  CSP deferred per finding #50)
- Sprint 6 close-out: exit verification + metrics snapshot +
  formal Phase A Retrospective + Phase B Kickoff Brief drafting
  (3-4 sessions)
- Total: 10-14 sessions to clear kickoff gate, consistent with
  finding #75's operational view 11-20 sessions

Phase B Kickoff Brief (Sprint 6.7 work) will translate the
reconciled three-track structure into detailed sprint plans:
- Track 1: Strategic Plan v6 work areas as sprint groupings
- Track 2: B.1-B.4 + BullMQ migrations
- Track 3: Sprint 0-6 from comparative analysis §7

Next session candidates (in priority order — DrJ to choose):

1. Sprint 4 source audit. Unblocked, concrete, single-track focus.
   Inventory 119 sources, categorize against 17×10×10 matrix,
   identify dead sources, design quality scoring schema, gap
   analysis, document Phase B source priority list. Estimated
   2-3 sessions for the 7-issue Sprint 4 sequence.

2. Sprint 3 close-outs (5 metrics dashboard + raw_signals drop).
   Smaller scope, 1-2 sessions. Unblocked.

3. Sprint 5 begin (any one of: social audit, search audit, or
   tracker template designs). Each is 1-2 sessions.

4. Sprint 6 begin (exit verification document from finding #75
   audit, or formal Phase A Retrospective synthesis from
   retrospective_inputs.md). The formal retrospective is
   especially leveraged — it's blocking Phase B kickoff gate.

Recommendation: Sprint 6 begin (specifically the formal Phase A
Retrospective synthesis), because it's the gate-clearing item
furthest from execution. Sprint 4 and Sprint 5 are concrete
execution work. Sprint 6 is structural-coordination work that
benefits from rested attention.

CSP observation continues per finding #50. raw_signals drop
(Sprint 3.1) and formal Phase A Retrospective (Sprint 6.4) remain
pending — pending status now formally captures the Phase B
kickoff gate dependency.

Session 22 close: production at 1cbf92b (unchanged). 80 cumulative
findings. Phase B reconciled to three-track structure. Path to
Phase B kickoff gate genuinely visible: 10-14 sessions of focused
Phase A close-out work. No new strategic-tier ambiguity to
resolve. The reconciliation document is the single source of
truth for "what is Phase B" until a documented review trigger
fires.

The most useful output of this session was the alignment process
itself, not the chosen options. Claude recommended α and β; DrJ
chose β and δ. The recommendations were calibrated honestly; DrJ's
choices reflect priorities that the recommendations did not weight
identically. Both views were captured in the reconciliation
document so future sessions can see why the path chosen was
chosen, not just that it was chosen.

---

PACE TRACKER (updated session 24 Part 3, 2026-05-15)

Note: sessions 23 (Phase A Retrospective DRAFT v0.1, commit
8ed6016) and 24 Parts 1-2 (retrospective v1.0 final 72a7eb8;
source audit Phase 1 70cac7b) shipped without dedicated Pace
Tracker entries. This entry consolidates session 23 + session 24
to date.

Session 23 work shipped (recap):
- Phase A Retrospective DRAFT v0.1 (commit 8ed6016, 768 lines)
  per Execution Method v1 §11.2 template. Synthesis from 80
  findings + exit verification + strategic-tactical
  reconciliation.

Session 24 Part 1 work shipped:
- Phase A Retrospective v1.0 final (commit 72a7eb8). Seven
  surgical refinements applied (status header, sign-off date,
  §1 metadata table v1.0 row, §8 production snapshot freshness,
  §8.2 documents-produced row, §10.4 gate row, §11 sign-off
  record replacement). Substantive synthesis locked without
  softening D4/D5/D6 honest tensions or W7 institutional
  fragility framing.
- Sprint 6 Issue 6.4 status: CLOSED.
- Binding kickoff gate: 2 of 8 → 3 of 8 MET.

Session 24 Part 2 work shipped:
- Phase A Source Audit Phase 1 (commit 70cac7b, 592 lines).
  Sprint 4 Issues 4.1 (inventory) + 4.2 (matrix categorization)
  + 4.3 partial (dead/duplicate flagging). Categorization-first
  per UNCLEAR 5 reframing. 119 RSS sources mapped to Plan v6
  17×10×10 matrix.
- Headline coverage findings: 9 of 17 Plan v6 categories ZERO
  coverage; 3 regions zero/near-zero (Southeast Asia, Russia/
  Central Asia, Oceania); MENA+SSA+East Asia near-zero;
  specialized publications dominate at 48%; local-language
  sources at 0.
- 1 confirmed duplicate (Inside Climate News at lines 71+180);
  9 dead-candidate URLs flagged for HTTP verification in
  session 25.
- Sprint 4 Phase 2 (issues 4.4-4.7) defers to session 25.

Session 24 Part 3 work shipped (Sprint 2 close-out):
- Sprint 2 Issue 2.3 (hollow feature copy): **CLOSED-WRONG-
  PREMISE**. All three pages (TruthGap, Leaderboard,
  Anomalies) verified to have title + explanatory subhead +
  empty-state copy already. No code change needed.
- Sprint 2 Issue 2.5 (wire dead nav.* keys): **CLOSED-WRONG-
  PREMISE** on original "dead keys" framing — all 28 nav.*
  keys ARE wired via indirection pattern. PLUS Urdu nav.*
  parity gap surfaced and resolved: 12 translations added/
  replaced in ur.json (7 missing keys + 5 English placeholder
  replacements). See findings #81 + #82.
- Sprint 2 Issue 2.2 (CSP enable): **DEFERRED-WITH-TRIGGER**
  per finding #50. Finding #50 documents 4 deferral reasons
  + revisit triggers ("after substantial traffic growth OR
  AdSense approval, whichever comes first"). No new finding
  needed for 2.2; finding #50 is binding rationale.
- Sprint 2 status: **DONE**. 3 of 6 issues DONE via original
  work (2.1 ALTER TABLE logging; 2.4 startup integration log;
  partial 2.5/2.6); 2 of 6 CLOSED-WRONG-PREMISE via Sprint 2
  close-out investigation (2.3, 2.5 dead-keys framing); 1 of
  6 DEFERRED-WITH-TRIGGER (2.2 CSP). All Sprint 2 close-out
  work complete.
- 2 new findings (#81 Brief inaccuracy pattern; #82 Urdu parity
  full scope).
- **Binding kickoff gate: 3 of 8 → 4 of 8 MET.** Condition 1
  (Sprint 0-2 closed) now MET.

Calendar pace honest accounting:
- Session 23 duration: ~1 hour (retrospective draft synthesis)
- Session 24 Part 1 duration: ~30 minutes (v1.0 refinement)
- Session 24 Part 2 duration: ~2 hours (source audit Phase 1)
- Session 24 Part 3 duration: ~1 hour (Sprint 2 close-out
  investigation + 12 translations + findings capture)
- Total session 23 + 24: ~4.5 hours of active work across
  multiple operator sessions

Phase A close-out remaining (post session 24 Part 3):
- Sprint 4 Phase 2 (issues 4.3-full + 4.4 + 4.5 + 4.6 + 4.7):
  1-2 sessions
- Sprint 5 audits + tracker templates: 2-3 sessions
- Sprint 3 close-outs (5 metrics dashboard + raw_signals drop):
  1-2 sessions
- Sprint 6 remaining (production smoke test 6.2; metrics
  snapshot 6.3 depends on 3.4; Phase B Kickoff Brief drafting
  6.7): 3-4 sessions
- **Total estimated: 7-11 sessions to clear binding kickoff
  gate.**

Binding kickoff gate after session 24 Part 3:

| Gate condition | Status |
|---|---|
| Sprint 0-2 closed | **MET ✓ (this session)** |
| Phase A Retrospective written | MET ✓ (session 24 Part 1) |
| No outstanding production incidents | MET |
| Strategic clarity on Reality Index | PARTIAL |
| Operational baseline understood | PARTIAL |
| Time/energy budget realistic | DrJ confirms per session |
| Phase B Kickoff Brief drafted | NOT MET |
| Three-track coordination mechanism documented | NOT MET |

Net: **4 of 8 conditions MET**; 4 remain to clear before Phase B
can start.

Brief inaccuracy meta-observation per finding #81: ~7 of 8
inspected code issues had Brief premises wrong. Pattern is
structural, not anomalous. Phase B Kickoff Brief drafting
(Sprint 6.7) should encode investigation-before-edit as Layer 4
issue-template requirement.

Production unchanged at 1cbf92b. 82 cumulative findings (was 80
before this session-part).

Next session candidates (priority order):
1. **Sprint 4 Phase 2** (close Sprint 4 entirely) — 1-2 sessions.
   Highest leverage: completes source-audit input for Phase B
   Kickoff Brief drafting; advances categorization-quality
   scoring chain.
2. **Sprint 3 close-outs** (5 metrics + raw_signals) — 1-2
   sessions. Unblocks Sprint 6.3 metrics snapshot.
3. **Sprint 5 audits begin** — 1-2 sessions per audit (social,
   search, then tracker templates). Each audit independent.
4. **Sprint 6.7 Phase B Kickoff Brief drafting** — 2-3 sessions
   (largest remaining single item). Best after Sprint 4-5
   audits complete for full input.

Recommended order: 1 → 3 → 2 → 4. Source audit Phase 2 first
because session 24 Part 2 context freshest and Phase B Kickoff
Brief eventually depends on it.

CSP observation continues per finding #50. raw_signals drop
(Sprint 3.1) remains pending. 5 metrics dashboard (Sprint 3.4)
remains pending.

Session 24 Part 3 close: production at 1cbf92b (unchanged across
session 24). Sprint 2 closed. Binding kickoff gate advanced one
notch. The most leveraged single output of session 24 Part 3 was
catching the 12-key Urdu parity gap vs the audit's 7-key
estimate — investigation-vs-summary tension surfaced as a real
institutional pattern (finding #82).

---

PACE TRACKER (updated session 25 Extension, 2026-05-15)

Note: session 25 main work (Sprint 4 Phase 2: source audit
cleanup + gap analysis synthesis, commits 6278ab6 + 4f2a91b)
shipped without a dedicated Pace Tracker entry. This entry
consolidates session 25 main + session 25 Extension (Sprint 6.2
smoke test).

Session 25 main work shipped:
- Phase A source audit Phase 2 cleanup (commit 6278ab6):
  HTTP verification of 9 audit-flagged dead candidates from
  session 24 Part 2 audit Phase 1; 9 entries removed from
  sources.js (6 Reuters NXDOMAIN + 1 AP DEAD-HTML + 1 WHO
  Headlines DEAD-404 + 1 Inside Climate News duplicate);
  resulting sourceCount 119 → 110; wire-service Plan v6 type
  collapsed from 7 to 0 effective.
- Phase A source audit Phase 2 gap analysis synthesis
  (commit 4f2a91b, 546 lines): Sprint 4 Issue 4.6 deliverable;
  3-tier priority ranking (P0 regional + P1 category + P2
  depth); 45 minimum needed exceeds 40 budget by 5 → α/β/γ/δ
  allocation options for Phase B Kickoff Brief; wire-service
  rebuild framed as not refinement but rebuild-from-scratch;
  South Asia sub-regional gap surfaced (5 of 7 countries at
  zero); 7 open questions parked for Sprint 6.7.
- Sprint 4 progress: 3 of 7 → 4 of 7 issues DONE (4.3 + 4.6
  closed); 1 PARTIAL (4.7 — illustrative candidates surfaced,
  finalization deferred); 2 NOT STARTED (4.4 schema + 4.5
  backfill, both session 26).

Session 25 Extension work shipped (this entry):
- Sprint 6.2 production smoke test (per Phase A Kickoff Brief
  Sprint 6 Issue 6.2). Two production deploys verified:
  * 60cfebf (Urdu i18n from session 24 Part 3)
  * 6278ab6 (sources.js cleanup from session 25 main)
- All 12 Urdu translations verified live in production
  ur-CVmHELql.js chunk
- All 5 English placeholders confirmed absent from production
- sourceCount: 110 verified ✓
- Article ingestion healthy (+67 articles in 20min); no
  removed-source articles in /api/news sample
- /api/events false-alarm investigation captured as finding #83
  (endpoint is SSE not REST; frontend uses /api/ri/events for
  REST; institutional learning for Phase B smoke-test catalog)
- 1 new finding (#83).
- Sprint 6 progress: 2 of 7 → 3 of 7 issues CLOSED (6.1 + 6.2
  + 6.4).
- Binding kickoff gate: 4 of 8 MET (unchanged — Sprint 6.2
  closure below gate granularity); "No outstanding production
  incidents" evidence-quality upgraded from MET-by-inference to
  MET-by-smoke-test-verification.

Calendar pace honest accounting:
- Session 25 main duration: ~2 hours (Sprint 4 Phase 2 cleanup
  + gap analysis)
- Session 25 Extension duration: ~30 min (smoke test + false-
  alarm investigation + finding capture)
- Total session 25: ~2.5 hours

Phase A close-out remaining (post-session-25 Extension):
- Sprint 4 Phase 3 (issues 4.4 schema + 4.5 backfill + 4.7
  finalization): 1-2 sessions (session 26)
- Sprint 3 close-outs (5 metrics dashboard 3.4 + raw_signals
  drop 3.1): 1-2 sessions
- Sprint 5 audits + 8 tracker templates: 2-3 sessions
- Sprint 6 remaining (6.3 metrics snapshot depends on 3.4;
  6.7 Phase B Kickoff Brief drafting): 2-3 sessions
- Total: 6-10 sessions to clear binding kickoff gate (was 7-11;
  -1 from Sprint 6.2 closure)

Production state at session 25 Extension close:
- Production code: 6278ab6 (session 25 sources.js cleanup;
  deployed ~50 min before this smoke test)
- Repository HEAD: 4f2a91b (gap analysis doc)
- sourceCount: 110 (verified)
- Articles: ~27,200
- Memory: 60/89 MB
- Scheduler healthy, lastRun recent
- No outstanding production incidents (verified by smoke test)

Next session candidates (priority order):
1. **Sprint 4 Phase 3** (close Sprint 4 entirely) — 1-2 sessions.
   Highest leverage now that audit Phase 2 context is freshest.
   Closes 4.4 schema + 4.5 backfill + 4.7 finalization.
2. **Sprint 3 close-outs** — 1-2 sessions. 5 metrics dashboard
   unblocks Sprint 6.3.
3. **Sprint 5 audits begin** — 1-2 sessions per audit.
4. **Sprint 6.7 Phase B Kickoff Brief drafting** — 2-3 sessions.
   Best after Sprint 4-5 audits complete for full Track 1
   input.

CSP observation continues per finding #50. raw_signals drop
(Sprint 3.1) remains pending. 5 metrics dashboard (Sprint 3.4)
remains pending.

Session 25 Extension close: production at 6278ab6. Sprint 4
materially advanced (4 of 7 closed). Sprint 6.2 closed cleanly.
Smoke test methodology surfaced false-alarm investigation
discipline that Phase B should encode. 83 cumulative findings
(was 82 at session 25 main close).

---

PACE TRACKER (updated session 26, 2026-05-17)

Session 26 work shipped:
- Sprint 4.4 quality scoring infrastructure (Path A — full DB
  migration approach): DONE
  * Migration 002 created: sources table seeded with 154 rows
    (110 RSS + 44 YouTube) plus 5 nullable scoring columns
    (quality_score, quality_score_components, source_posture,
    quality_score_methodology_version,
    quality_score_last_updated)
  * Path B schema decision (founder override): separate `url`
    and `channel_id` columns with CHECK constraint enforcing
    exactly one identifier per row; partial unique indexes per
    column
  * credibility_legacy nullable (Deviation 1 APPROVED): NULL
    for 44 YouTube rows reflects "legacy system did not score
    this source" honestly rather than fabricating values
  * Migration verified twice on isolated test DB
    (/tmp/scoop-migration-test): fresh run appliedCount=2, all
    154 rows seeded, all shape invariants 0; idempotent re-run
    appliedCount=0, no double-insert, CHECK constraint holds
- Source credibility methodology v1.0 published as public
  artifact:
  * docs/content/source_credibility_methodology.md (455 lines)
  * 5 components per Strategic Plan v6 §3 Capability 1
    (editorial track record, methodology transparency, domain
    expertise, independence, historical accuracy)
  * 8 X-derived posture labels (Independent, State-affiliated,
    Government, Corporate-PR, Corporate-owned, Academic,
    Advocacy, Aggregator) with explicit per-label band ranges
    and reasoning
  * 6 score bands for public-tier presentation; numeric scores
    visible only to Layer 2 (premium)
  * Decision 7 split honored: rubric public, weights
    proprietary, weight-bounds (5%-40% per component) disclosed
    as constraint
  * §9 Honest limitations holds the line — six sub-sections,
    no softening, self-serving-acknowledgment on the
    public/proprietary split itself
- Architectural breadcrumb in sources.js header (per session-26
  documentation discipline): explains parallel-infrastructure
  pattern (sources.js canonical for INGESTION; DB table
  canonical for SCORING), names both layers, lists entry
  shapes, source-list change log
- Finding #84 captured: two Brief premise errors in Sprint 4.4
  alone (no sources table existed + credibility_legacy NOT NULL
  incompatible with YouTube entries). Cumulative count of
  inspected Brief items with wrong premises now 9 of 10 (was
  7 of 8 at finding #81).

Sprint 4 progress: 4 of 7 → 5 of 7 issues DONE + 1 PARTIAL +
1 NOT STARTED (4.4 closed this session; 4.5 backfill is the
session-27 candidate).

Sprint 6 progress unchanged at 3 of 7.

Binding kickoff gate: 4 of 8 MET (unchanged — Sprint 4.4
closure is below gate granularity, same as Sprint 6.2 in
session 25 Extension).

Calendar pace honest accounting:
- Session 26 duration: ~4 hours (hard cap per kickoff)
- Phase 26.A migration design + Path B revision + verification:
  ~90 min (including one detected-and-recovered worktree state
  discrepancy before any DB or commit action — diagnostic
  discipline working)
- Phase 26.B methodology v1.0 drafting + founder review +
  Q1-Q4 refinement: ~120 min
- Phase 26.C sources.js architectural breadcrumb: ~10 min
- Phase 26.D finding #84 + pace tracker: ~20 min
- Phase 26.E commits + push: pending at time of this entry

Phase A close-out remaining (post-session-26, unchanged from
finding #84 accounting):
- Sprint 4.5 backfill + Sprint 4.7 finalization: 1-2 sessions
- Sprint 3 close-outs (3.1 raw_signals drop + 3.4 metrics
  dashboard): 1-2 sessions
- Sprint 5 audits + 8 tracker templates: 2-3 sessions
- Sprint 6 remaining (6.3 metrics depends on 3.4; 6.7 Phase B
  Kickoff Brief drafting): 2-3 sessions
- Total: 6-10 sessions to clear binding kickoff gate

Production state at session 26 close (no production deploy
this session — schema work is local-only until Sprint 4.5
backfill + rollout decision):
- Production code: 6278ab6 (unchanged from session 25
  Extension)
- Migration 002 staged locally; no production migration run
  yet (next deploy will apply it idempotently on startup)
- sourceCount: 110 (unchanged)
- Methodology v1.0 published in repo as canonical version
- No outstanding production incidents

Next session candidates (priority order):
1. **Sprint 4.5 backfill** — highest leverage now that the
   schema exists. Score all 154 sources against methodology
   v1.0 using AI-agent-proposes + founder-finalizes workflow
   per Decision 16. Likely 2 sessions.
2. **Sprint 3 close-outs** — unblocks Sprint 6.3 metrics
   dashboard.
3. **Sprint 4.7 finalization** — Phase B source priority list
   can run in parallel with 4.5 if appetite.
4. **Sprint 5 + Sprint 6.7** — sequenced after 4.5 ships.

Cumulative findings count: 83 → 84 (finding #84 captured this
session).

Session 26 close: production at 6278ab6 (unchanged from
session 25 Ext). Sprint 4 schema infrastructure complete.
Methodology v1.0 published as public artifact (citable per
Decision 7). 84 cumulative findings. Brief inaccuracy count
at 9 of 10 — Phase B Kickoff Brief authoring needs verification
discipline per finding #84 institutional implication.

---

PACE TRACKER (updated session 27, 2026-05-17)

Session 27 work shipped:
- Sprint 4.5 Phase 1 calibration on 15 publisher sources:
  DONE
  * Methodology v1.0 validated: 15 / 15 PASS within
    expected ranges
  * Posture distribution: Government 5, Corporate-owned 8
    (including 3 Pakistani sub-set), Aggregator 1
  * Floor rule did not trigger (Hacker News ET=35, closest
    call, 5 points above the 30 threshold)
  * Pakistani home-region check passed: Dawn (80) > The
    News Intl (70) > Geo (64) ordering matches founder
    home-region knowledge — strong validation signal that
    rubric is not Anglo-American-biased to the point of
    failing on local-tradition sources
- Calibration document published:
  docs/audits/phase_a_source_audit_phase2_calibration.md
  (364 lines, structure §1-§7)
  * Per-source scoring preserved as ground-truth dataset
    for future automated scoring service
  * Three v1.1 candidates catalogued (decisions deferred
    to v1.1 review):
    - P1: Government posture sub-case for direct-state-
      funded international broadcasters (DW + France 24
      pattern; current §5.2 only names charter/license-fee
      mechanism)
    - P2: Corporate-owned with industry-affiliated parent
      guidance (CoinDesk pattern; gap between Corporate-
      owned 55-95 and Corporate-PR 25-55)
    - P3: Aggregator posture ET sub-criteria substitution
      table (Hacker News pattern; current §2.1 sub-criteria
      are publisher-shaped)
- Sprint 4.5 architectural reframing (per founder pre-
  scoring discussion + finding #85): full 154-source manual
  backfill is the wrong shape. Sprint 4.5 Phase 2 deliverable
  reframed as methodology v1.1 + automated scoring service
  specification handed to Phase B Track 1. Manual scoring
  would be 12-25 hours per scoring window with revisit
  cadence per §7.1 producing ongoing annualized cost; corpus
  growth toward Phase E target 800 sources compounds the
  unsustainability of manual scoring.
- Finding #85 captured: Sprint 4.5 architectural reframing
  surfaces the broader institutional pattern — infrastructure
  work disguised as content work in Phase planning. Third or
  fourth instance in Phase A (Sprint 4.4 schema, Sprint 2.5
  Urdu nav.*, Sprint 1 stabilization). Phase B Kickoff Brief
  authoring should classify each line item as content vs
  infrastructure with classification justification.
- Finding #86 captured: methodology scope gap — publisher
  v1.0 silent on individual creators. Three-layer creator
  methodology preserved as architectural artifact (host
  credibility + guest credibility + per-episode composite).
  Phase B or C scope; Sprint 4.7 expanded scope includes
  drafting architectural framing during Phase A close-out
  while creator methodology itself ships when corpus needs
  it.

Sprint 4 progress: 5 of 7 → 5 of 7 DONE + 2 PARTIAL
(was 5 of 7 DONE + 1 PARTIAL + 1 NOT STARTED at session
26 close). Sprint 4.5 moved from NOT STARTED to PARTIAL
(Phase 1 calibration ships this session; Phase 2 is v1.1
+ scoring-service spec — next-session candidate). Sprint
4.7 unchanged at PARTIAL (now with expanded scope per
session 27 reframing).

Sprint 6 progress unchanged at 3 of 7.

Binding kickoff gate: 4 of 8 MET (unchanged — Sprint 4.5
Phase 1 closure is below gate granularity, same as Sprint
4.4 in session 26 and Sprint 6.2 in session 25 Extension).

Calendar pace honest accounting:
- Session 27 duration: ~2 hours (hard cap)
- Phase 27.A methodology read + state verification: ~15 min
- Phase 27.B 15-source calibration scoring: ~75 min
- Phase 27.C calibration analysis + 27.E document drafting:
  ~25 min (consolidated, calibration analysis folded into
  document body rather than separate report)
- Phase 27.F findings + Pace Tracker + commits: ~15 min

Phase A close-out remaining (post-session-27):
- Sprint 4.5 Phase 2 (methodology v1.1 + scoring service
  spec): 1 session (session 28 candidate)
- Sprint 4.7 finalization (publisher source priority list +
  creator-methodology architectural framing): 1-2 sessions
- Sprint 3 close-outs (3.1 raw_signals drop + 3.4 metrics
  dashboard): 1-2 sessions
- Sprint 5 audits + 8 tracker templates: 2-3 sessions
- Sprint 6 remaining (6.3 metrics depends on 3.4; 6.7
  Phase B Kickoff Brief drafting): 2-3 sessions
- Total: 5-9 sessions to clear binding kickoff gate
  (unchanged from session 26 estimate; calibration
  validates methodology but doesn't close sprints directly;
  Phase 2 v1.1 + scoring-service-spec work counts within
  the same estimate)

Production state at session 27 close: no production deploy
this session (calibration is document-only):
- Production code: 6278ab6 (unchanged from session 25 Ext)
- Migration 002 still staged for next deploy (no startup
  since session 26; will apply idempotently on next deploy)
- sourceCount: 110 (unchanged)
- Calibration ground-truth dataset (15 sources) published
  in repo as reference for future automated scoring service
  testing
- No outstanding production incidents

Phase B Track 1 scoring-service backlog item created (in
this Pace Tracker entry, no separate tracking system yet):
- Spec inputs: methodology v1.1 (pending session 28),
  calibration ground-truth dataset (this session), audit
  trail integration via Migration 002 columns
- Validation harness: reproduce 15 calibration scores
  within ±5 points per source on a fixed methodology
  version
- Founder review hook per Decision 16 + methodology §6.1

Next session candidates (priority order):
1. **Sprint 4.5 Phase 2 — methodology v1.1 + scoring
   service specification.** Highest leverage; closes the
   calibration-to-spec arc. ~3-4 hours.
2. **Sprint 4.7 finalization** — publisher source priority
   list + creator-methodology architectural framing draft.
3. **Sprint 3 close-outs** — unblocks Sprint 6.3.
4. **Sprint 5 + Sprint 6.7** — sequenced after 4.5 Phase 2
   + Sprint 3 ship.

Cumulative findings count: 84 → 86 (findings #85 + #86
captured this session).

Session 27 close: production at 6278ab6 (unchanged).
Methodology v1.0 calibration-validated for publisher-class
sources (15/15 PASS). Three v1.1 candidates identified;
decisions deferred to v1.1 review. Sprint 4.5 architecturally
reframed from manual marathon to scoring-service-spec
deliverable. Creator methodology scope gap preserved as
architectural artifact for Phase B/C. 86 cumulative findings.
Phase A close-out remaining: 5-9 sessions (unchanged).

---

PACE TRACKER (updated session 28, 2026-05-17)

Session 28 work shipped — three phases, three commits:

Phase 28.A — Methodology v1.0 → v1.1 (commit 3d935ef):
- 14 surgical str_replace edits applied across the methodology
  document, zero failures
- Three rubric refinements per Sprint 4.5 Phase 1 calibration
  v1.1 candidates:
  * P1 Government posture sub-case expansion: §5.1 + §5.2 now
    admit charter-equivalent direct-state-funded mechanism
    (DW under Deutsche Welle Gesetz; France 24 under France
    Médias Monde holding) alongside charter and license-fee
    broadcasters. Typical scoring 75-80 for the direct-state
    sub-case reflects weaker legal-firewall structure than
    charter/license-fee.
  * P2 Corporate-owned industry-affiliated parent sub-case:
    new Corporate-owned sub-case with Independence ceiling at
    80 (rather than 95). Fills operational gap between
    Corporate-owned (parent in different industry) and
    Corporate-PR (structurally unfit on core topic). CoinDesk
    under Bullish is v1.1 reference case.
  * P3 Aggregator ET sub-criteria substitution: §2.1 now adds
    aggregator-specific operationalizations when posture is
    Aggregator (selection criteria, source-mix transparency,
    moderation policy, removal log, community governance).
    Hacker News v1.1 ET estimate 50-70 vs v1.0's 35.
- Five polish edits applied for v1.1 cross-reference
  consistency (§9.6 opening reframed, §9.6 bullet 2 aligned
  with §2.2, §2.2 honest difficulty 2.2.e target reset to
  v1.2+, §10 Source list version reference dropped, §10
  Migration 002 architectural reframing per finding #85)
- v1.0 calibration document preserved as historical artifact;
  v1.1 calibration deferred to Phase B Track 1 scoring service
  first corpus-wide run
- Methodology now at 481 lines

Phase 28.B — Source Scoring Service Specification v1.0 (commit
3ca4e34):
- New docs/specs/ subdirectory created (first specs/ document)
- 369-line architectural spec for the Phase B Track 1
  automated source scoring service per session 27 finding #85
  architectural reframing
- Captures: service position in Phase B Track 1 source services
  (alongside discovery, enrichment, editorial review;
  scheduler.js operates downstream); inputs/outputs mapped to
  Migration 002 sources table columns; methodology version
  routing with selective rescore semantics on version bump;
  multi-methodology slot reserved for Phase C creator
  methodology per finding #86; sub-criteria operationalization
  patterns (structured-data lookup / website scraping / LLM
  evaluation) with 5 representative examples spanning the 5
  methodology components including v1.1 reference cases;
  scoring runtime (weekly batch per Decision 16 + triggered
  rescore); editorial override per methodology §6.5 with
  conflict resolution; service dependencies including
  scoring_audit_log table with retention-policy-TBD note;
  5 honest limitations; v1 implementation scope with explicit
  validation harness binding service to 15-source v1.0
  calibration ±5 points per source on methodology v1.0;
  validation failure modes documented (intentional v1.1 deltas
  vs unpredicted divergence requiring investigation)

Phase 28.C — Phase B Kickoff Brief v1.0 (commit cef2270):
- 536-line structural commitment defining Phase B
- Three-track structure self-contained per reconciliation v1
  §8.1 (locked source per DEC1): Track 1 product features
  (Comprehension Layer + Source matrix + Distribution + Search
  + Entertainment + Foundation per Strategic Plan v6 §9);
  Track 2 architecture (B.1-B.4 codebase reorganization +
  BullMQ 5-queue migrations + scoring service implementation
  per Skills Architecture v1 §7); Track 3 infrastructure
  performance (Sprint 0-6 Cache-Control / CDN / SWR / SSR per
  Comparative Analysis v1 §7). Inline transparency note in
  §2.4 acknowledges prompt-vs-reconciliation Track 3 scope
  discrepancy and locks to reconciliation framing
- Track 1 source-services subset detailed (§3): discovery,
  enrichment, scoring (per Phase 28.B spec), editorial review,
  Reality Index v1, corpus growth to 150+. Other Track 1 work
  areas enumerated in §2.2; per-sprint detail deferred to
  in-Phase-B sprint kickoffs
- Track 2 detail (§4) including the source scoring service
  implementation as Track 1/Track 2 cross-deliverable
- Track 3 detail (§5) with Sprint 0-6 effort estimates +
  verification commands per Comparative Analysis v1 §7
- Sequencing (§6): critical path identified (Track 2 B.1 →
  scoring service impl → Track 1 scoring operation → corpus
  growth); parallel work named; recommended early sessions
  respect no-track-dark rule; first-sprint recommendation
  with explicit "subject to DrJ confirmation at Phase B
  kickoff" caveat
- Kickoff criteria (§7) per reconciliation v1 §8.3: 3 of 4
  substantively MET at brief authoring; criterion 4
  (time/energy budget) preserved as DrJ judgment call at
  kickoff time
- Exit criteria (§8) preserved in full per reconciliation v1
  §8.2 (22 conditions across 4 groups: load-bearing
  user-facing + architectural durability + performance
  infrastructure + close-out artifacts)
- Resource model (§9): Months 4-7 estimated, Months 6-9
  realistic per reconciliation v1 §8.4 (~60-145 sessions at
  Phase A observed velocity); solo founder + Claude Code
  pattern; no-track-dark per-session discipline
- 7 honest limitations and risks (§10) including Track 3
  anti-goal tension acknowledgment and Phase A close-out
  audit deferrals (Sprint 5 social/search audits NOT MET;
  brief takes position they don't gate kickoff per
  reconciliation v1 §8.3)

Sprint progress changes this session:
- Sprint 4.5: PARTIAL → PARTIAL (Phase 2 v1.1 methodology +
  scoring service spec shipped this session; corpus-wide
  backfill execution remains in Phase B Track 2 implementation
  scope per session 27 explicit decision; Sprint 4.5 stays
  PARTIAL within Phase A per session 27 framing)
- Sprint 6.7 (Phase B Kickoff Brief drafting): NOT MET → MET
  (Phase 28.C ships the brief; commit cef2270)
- Sprint 4 progress unchanged at 5 of 7 DONE + 2 PARTIAL
- Sprint 6 progress: 3 of 7 → 4 of 7 CLOSED (6.7 newly closed
  via brief ship)

Binding kickoff gate status (per reconciliation v1 §8.3
4 binding conditions):
- Criterion 1 (Phase A wrapped cleanly): substantively MET
  (Sprint 4 closed substantively; Sprint 6.4 retrospective
  shipped; Sprint 6.2 smoke test PASS; Sprint 6.7 brief
  shipped this session; Sprint 5 social/search audits remain
  NOT MET but per brief §7 position do not block kickoff)
- Criterion 2 (Reality Index strategic clarity): MET
  (Strategic Plan v6 Capability 3 + Decision 11 lock v1
  sources)
- Criterion 3 (operational baseline understood): MET
  (Phase A retrospective + 86 findings + per-session Pace
  Tracker entries 14-28 provide baseline)
- Criterion 4 (time/energy budget realistic): DrJ judgment
  call at actual kickoff time
- Gate status: 3 of 4 substantively MET; criterion 4 is
  human-decision-at-kickoff

Calendar pace honest accounting:
- Session 28 duration: ~3 hours across the three phases
- Phase 28.A methodology v1.1 (Edits 1-14 across two rounds
  with two cross-impact rounds): ~50 min
- Phase 28.B scoring service spec drafting + 2 refinements +
  commit: ~90 min
- Phase 28.C kickoff brief drafting + 2 refinements +
  commit: ~80 min
- Pace Tracker session 28 entry + commit: ~10 min

Phase A close-out remaining (post-session-28):
- Sprint 3 close-outs (3.1 raw_signals drop + 3.4 metrics
  dashboard): 1-2 sessions
- Sprint 5 audits (social + search): 2-3 sessions if scoped
  in (or deferred to Phase B Track 1 work or Phase C per
  brief §7 + §10.7 position)
- Sprint 4.7 finalization (publisher source priority list +
  creator-methodology architectural framing draft): 1-2
  sessions
- Sprint 6 remaining (6.3 metrics depends on 3.4): 1 session
  after 3.4 ships
- Phase A close-out estimate: 3-7 sessions remaining (down
  from 5-9 at session 27 close; -2 from Phase 28 commits
  closing Sprint 6.7 plus methodology + spec landing
  substantively reduces remaining commit-chain effort)

Production state at session 28 close: no production deploy
this session (all three Phase 28 commits are documentation-
only):
- Production code: 6278ab6 (unchanged from session 25
  Extension)
- Migration 002 still staged for next deploy startup (will
  apply idempotently)
- sourceCount: 110 (unchanged)
- Methodology v1.1 published as canonical version in repo
- Source scoring service spec v1.0 published in repo
- Phase B Kickoff Brief v1.0 published in repo
- No outstanding production incidents

Phase B is now structurally unblockable from a documentation
standpoint. Remaining Phase A close-out work is operational
(metrics dashboard, audits if scoped in) rather than
structural.

Next session candidates (priority order):
1. **Sprint 3.4 + 3.1 close-outs** — unblocks Sprint 6.3
   metrics snapshot and clears Sprint 3 entirely. 1-2 sessions.
2. **Sprint 4.7 finalization** — publisher source priority
   list + creator-methodology architectural framing draft.
   1-2 sessions.
3. **Sprint 5 audits OR Phase B kickoff** — DrJ judgment call.
   Brief §7 + §10.7 takes position that Sprint 5 audits
   don't gate kickoff but are honest gaps. DrJ may prefer to
   close Sprint 5 within Phase A (cleaner exit) or carry
   forward to Phase B Track 1 work or Phase C.
4. **Phase B kickoff** — after criterion 4 (time/energy
   budget) DrJ judgment call.

Cumulative findings count: 86 → 86 (no new findings this
session; the three Phase 28 commits ship deliverables that
session 27 findings #85 + #86 architecturally established).

Per reconciliation v1 §8.5 no-track-dark rule (applicable
from Phase B kickoff onward, not yet binding in Phase A
close-out): this session contributed to Track 1 + Track 2
+ Track 3 simultaneously via the brief that defines all
three tracks. Subsequent Phase A close-out sessions will
operate per their natural sprint scope; per-track tagging
becomes binding at Phase B kickoff.

Session 28 close: production at 6278ab6 (unchanged). Phase
28 commit chain shipped methodology v1.1 + scoring service
spec v1.0 + Phase B Kickoff Brief v1.0. Sprint 6.7 closed
via brief. Binding kickoff gate at 3 of 4 substantively MET
with criterion 4 reserved as DrJ judgment call at kickoff.
Phase A close-out remaining: 3-7 sessions (down from 5-9).
86 cumulative findings. Phase B is structurally unblockable.
```
