# Phase B Status Audit — 2026-06-17
Document type: Operational snapshot (plan-vs-actual)
Owner: DrJ
Status: Point-in-time (Session 16)

Read-only audit comparing the Phase B plan against actual progress. Grounded in
`phase_b_kickoff_brief.md` §8 (exit criteria) / §9 (budget), `strategic_tactical_reconciliation_v1.md`
§8.4, the `phase_b_retrospective_inputs.md` execution log (Sessions 1–16), git history, and
read-only `news.db` / `scoring-run/news.db` counts. "Now" = 2026-06-17; Phase B opened 2026-05-18.

## 1. Exit-criteria scorecard (brief §8, lines 405–442)

Brief says "~22 conditions" (line 443); enumeration is **26** (14 user-facing + 5 architectural +
5 performance + 2 close-out). Grading is strict — a built *feature* ≠ a met *metric*.

**Tally (26): DONE 1 · PARTIAL 7 · NOT-STARTED 12 · UNKNOWN 6** → ~4% fully met, ~31% partially
touched, ~65% not-started/unverified.

- **DONE (1):** §8.3.1 hashed-asset `Cache-Control …immutable` — S6 commit `c7267b8` (live header not re-verified).
- **PARTIAL (7):**
  - §8.1.1 homepage ATF = comprehension — built (`c9862ef`), **reverted** (`a614599`); article-list live (#120/#121).
  - §8.1.3 tracker engine + ≥10 active — 8/8 detectors live (S7–8, `2c16c27`/`99163db`); `tracker_instances`=**0** (DB).
  - §8.1.4 breaking alerts (push+email+Telegram) — web push + email digest (`2a1ab1a`, S5) present; Telegram not evidenced.
  - §8.1.8 ≥150 sources **with scores** — 154 sources (≥150 ✓), **0 scored in prod** (DB); 23 only in `scoring-run`; scorer deferred to Phase C (#118).
  - §8.2.1 codebase-by-skill — `src/skills/scoring/` exists (B.6); broad B.1 reorg not evidenced.
  - §8.2.5 5 BullMQ migrations **live in prod** — coded w/ graceful fallback (`jobs/queues.js`, `jobs/redis.js`); `REDIS_URL` unset → in-process, not live.
  - §8.3.5 ≥1 hot route SSR'd — `seo.js` SSRs `/topic/:slug` for **bots only**; planned Vite/full SSR (Sprints 4–6) not started.
- **NOT-STARTED (12):** §8.1.7 (3 newsletters/30% open), §8.1.9 (10k social followers), §8.1.11 (10k searches/mo), §8.1.12 (dossiers top results), §8.1.14 (5k Telegram); §8.2.2 (skill contracts), §8.2.3 (boundary linter), §8.2.4 (image/video POC); §8.3.3 (HTML s-maxage/SWR), §8.3.4 (API SWR); §8.4.1 (Phase B retrospective), §8.4.2 (Phase C kickoff brief).
- **UNKNOWN (6):** §8.1.2 (Lighthouse ≥90), §8.1.5 (op-ed ≥80% — `events`=0, unmeasurable), §8.1.6 (video ≥60% — `events`=0), §8.1.10 (3% social engagement), §8.1.13 (25% returning), §8.3.2 (CDN x-cache on HTML).

**BLOCKED:** §8.1.1 (comprehension homepage) — by the Session-16 event-graph over-merge (Findings
#120–122; prod probe = 778-article blob, `events`=0 in prod after revert). §8.1.5/§8.1.6 coverage
% unmeasurable while `events`=0. Reality Index v1 (Capability 3) blocked by BullMQ realityIndex
queue not live (§8.2.5) + no events.

## 2. What's next (critical path: brief §6.1)

1. **Event-graph integrity sprint** (S16 decision; #120–122). Unblocks §8.1.1 (the built redesign
   `c9862ef` is parked) and gates Capability 2 (Event Dossier) + Capability 3 (Reality Index) —
   both consume `events`. Current critical-path blocker; the spine isn't bankable until sound.
2. **Operationalize the source scorer on prod** → closes §8.1.8. 154 sources but 0 scored in prod;
   scorer (B.6, S9–14) built but **deferred to Phase C** at S14 over calibration bias (#118) — the
   unresolved upstream item. Also lets the Signal Service serve real scores (today: all-unscored on prod).
3. **Revive a non-spine track** — distribution (§8.1.7/9/14, Telegram in §8.1.4) and Track 3
   performance (Sprints 1–6, §8.3.2–4) are all NOT-STARTED while S9–16 went 100% to the spine.

## 3. Timeline drift

**Basis:** both docs measure Phase B duration *relative to its own start* (2026-05-18). Strategic
Plan v6 said "Months 1–3" (Track-1-only original); brief/reconciliation revised the **same** axis
upward as Tracks 2+3 + a 1.3–1.8× realism multiplier were applied → **Months 4–7 estimated / 6–9
realistic ≈ 60–110 / 90–145 sessions** (brief line 80). No basis conflict — one re-estimated axis.

**Actual:** ~30 days (≈1.0 month, ≈4.3 weeks), **16 sessions** → **≈3.7 sessions/week** (above the
planned ~2/week sustained; within the 4–5/week burst band). *Caveat: Sessions 9–16 are undated in
the retro — back-half rate inferred against now=2026-06-17, not pinned.*

**Burn:** 16 of 60–110 = 15–27% (est) / of 90–145 = 11–18% (realistic). Calendar ~1.0 mo of 4–7 =
14–25% (est) / of 6–9 = 11–17%. Completion: ~4% fully met.

**Verdict: on-pace (mildly ahead) on session/calendar burn; narrow on breadth + track balance.**
Depth went to the spine (S1–8 tracker engine; S9–14 source scoring; S15–16 clustering + homepage —
correct per the critical path) at the cost of an untouched distribution/performance frontier, a
**no-track-dark violation** (Track 3 dark S7–16 after a single S6 contribution; rule = brief line 164,
>4 consecutive silent sessions), and a spine integrity bug that must clear before §8.1.1 can bank.
Not a schedule emergency — a sequencing/balance correction.

## Note — session-budget reconciliation
An earlier **"~25–40 Phase B sessions"** figure lived in `phase_b_retrospective_inputs.md` §0
("Duration and cadence") and contradicted the locked **60–110 / 90–145** in brief §9 (line 80) and
reconciliation §8.4. This was a real **cross-doc inconsistency** (25–40 was the original Track-1-only
estimate, before Tracks 2+3 + the realism multiplier), **now reconciled** in retro_inputs §0 in the
same commit as this snapshot — not a phantom. Drift math above uses the authoritative 60–145.
