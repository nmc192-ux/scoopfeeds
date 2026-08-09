# Strategic Plan v6 — delta as of 2026-08

**Read this before `strategic_plan_v6.md`.** v6 remains the origin document — the thesis,
the five capabilities, the monetization model are unchanged and still hold. Its *timeline*
and *phase sequencing* no longer describe reality. This page is the correction; v6 is not
being rewritten.

Grounded in `docs/audits/code_vs_docs_reconciliation_2026-08.md` (code-verified,
file:line-cited) and `docs/audits/docs_gap_analysis_2026-08.md`.

---

## 1. Where the timeline actually went

| v6 said | Actual |
|---|---|
| Phase A: "Now → 4 weeks" | Exited late, with three criteria corrected after the fact (`phase_a_exit_criteria_correction_2026-07.md`) |
| Phase B: complete by month 3 | Month 3 is now. Phase B features are **deferred by Decision 34** pending event-graph integrity |
| Phase C: months 3–5 | Not started |

The May reconciliation already re-estimated Phase B at "months 6–9 realistic" and that
estimate has held up better than v6's. Treat v6 phase dates as aspiration, not schedule.

**No new dates are asserted here.** The J Loop now produces measurable throughput (issues
closed per week); estimates will be rebuilt from that once there is a month of data. Declared
dates are what made v6 stale.

## 2. What actually shipped, measured

Verified in code, not asserted:

| Capability | Real | Note |
|---|---|---|
| Event stream + source matrix | **~35%** | 110 RSS sources. The 17×10×10 taxonomy has **zero of three axes** — see §4. |
| Event Dossier + **Tracker Auto-Detection Engine** | **~75%** | The tracker engine is **built and live** (all 8 detectors, cron, API, page). It was mis-filed under "deferred" until this audit. |
| Reality Index (multi-source) | **~20%** | Polymarket only. Decision 11's four sources are one. Currently mis-binding (open item 1). |
| Distribution | **~40%** | Six platforms publish. X is digest-only. **Telegram does not exist** — see §3. One newsletter of three. |
| Scoop search | **~10%** | FTS5 keyword. Zero Brave, zero Exa, no multi-model answers. |

Also shipped and understated: **10-locale UI with RTL** for Urdu and Arabic. The README
still calls those languages "Phase E roadmap."

## 3. Telegram — removed from the plan (decision, 2026-08)

Decision 13 built the free tier on Telegram. The July amendments record Telegram as
**"unstable in Pakistan"** — the core market. Code check: **zero Telegram backend code
exists**, and three Phase B exit criteria plus the ≥5,000 / ≥25,000 subscriber targets in §8
depend on it.

**Resolved: Telegram is dropped.** The exit criteria and subscriber targets that name it are
void. Web push (`services/pushService.js`, live) and email digest (`services/digest.js`,
live) carry the free-tier notification role. WhatsApp remains in use for the internal video
approval loop and is *not* being promoted to a subscriber channel at this time.

This closes an invisible gap: Telegram was neither built nor deferred — it was simply
forgotten while three exit criteria still pointed at it.

## 4. Source matrix — criterion rewritten (decision, 2026-08)

v6 specifies "17 categories × 10 regions × 10 types". Code check:

- categories in `config/sources.js` are **product tags** (`international`, `business`,
  `tech`, `pakistan`), not the 17 strategic categories
- `region` is `"global"` on **98 of 110** rows — the axis is unpopulated
- `source_type` is `CHECK (source_type IN ('rss','youtube'))` (`migrations/002:56`) — a
  transport flag, not the 10 strategic types

So "≥150 sources" could be met in full and the matrix criterion would still be unsatisfied.

**Resolved: the criterion is rewritten to what the schema supports** —
*≥150 active sources with a populated `quality_score` from the scoring skill*. The scoring
skill already exists (`backend/src/skills/scoring/`, 80 files) but its cron is registered
**disabled** (`scheduler.js:193-203`), and scoring has run on roughly 15 sources.

The taxonomy is not abandoned — it moves to Deferred capabilities as an explicit,
re-openable decision rather than an assumed-done axis. Region is the axis with real product
value (South Asia / Muslim-world differentiation) and is the natural first slice if it
re-opens.

## 5. What this does not change

The thesis, the two presentation layers, the intel subdomain (D1), $19/mo pricing (D2), the
staggered Phase D revenue plan (D3), and Decision 34's "integrity before features" ordering
all stand. This delta corrects the schedule and two criteria; it does not reopen strategy.

## 6. Resolved since this delta was drafted

- **D19 vs D34 sequencing — settled 2026-08.** A sequencing note was added to the amendments
under D34. Video is exempt from the deferral because it does not read from or write to the
event graph, and because distribution channels compound with time while features do not. The
exemption is conditional: if video selection ever reads from `events`, it inherits D34's
constraint.
- **Decision numbering collision — fixed 2026-08.** The amendments' "Decision 32 — Video
editorial boundary" is renumbered **Decision 35**; Decisions Log v1 keeps Decision 32
(Embedding Provider). The D22 cross-reference was updated.

Nothing in this delta is now awaiting a decision.
