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
