# Scoopfeeds

> The intelligence platform for events that shape the world.

Scoopfeeds is a news and event intelligence platform combining a fast,
mobile-first news experience for general readers with a research-grade
analytical workstation for journalists, researchers, and analysts.

**Read the news. See the data. Hear the perspectives. Decode the signals. Search like an analyst.**

## What Scoopfeeds offers

- **The Newsroom** (`scoopfeeds.com`) — Fast event-centric news with regional depth, quantitative trackers on every major event, multi-perspective op-eds, verified video, and breaking news alerts.
- **The Intelligence Desk** (`intel.scoopfeeds.com`, planned) — Research-grade analytical workstation with multi-source probability triangulation, full Event Dossiers with downloadable data, custom alerts, and programmatic API access.
- **Scoop** (planned) — AI-augmented search returning intelligence, not just links. Perplexity-style answers with citations, credibility-weighted ranking, no spam.

## Project status

The Newsroom is **live at [scoopfeeds.com](https://scoopfeeds.com)**. Phase A
(Stabilization and Audit) and the Phase B go-live are complete; current work is the
post-audit remediation programme — event-graph integrity and the reader-facing dossier.

**Start here for current state:**
- [State of play](docs/STATE_OF_PLAY.md) — what's shipped, what's dark, what's next
- [Dossier & event graph](docs/architecture/dossier_and_event_graph.md) — how the system actually works today
- [Environment / feature-flag reference](docs/reference/env_reference.md) — every flag, default, and prod value

For the longer arc, see the [Strategic Plan](docs/strategy/strategic_plan_v6.md) and the
[Phase B go-live runbook](docs/phases/phase_b_go_live_runbook.md).

**Language support note:** English UI is fully supported. Urdu UI has correct RTL layout but translation quality is currently variable due to translation pipeline limitations being addressed in Phase B/C. Other language UIs (Arabic, Russian, Mandarin) are on the Phase E roadmap.

## Documentation

All strategic, execution, and operational documentation lives in [`/docs/`](docs/README.md).

Key entry points:
- [Strategic Plan v6](docs/strategy/strategic_plan_v6.md) — what's being built and why
- [Decisions Log v1](docs/strategy/decisions_log_v1.md) — 31 strategic decisions made
- [Execution Method v1](docs/execution/execution_method_v1.md) — how work gets done
- [Phase A Kickoff Brief](docs/phases/phase_a_kickoff_brief.md) — current phase plan

## Tech stack

- **Backend:** Node.js / Express, SQLite via better-sqlite3 (+ `sqlite-vec` for embeddings;
  Postgres path documented for later phases)
- **Frontend:** React + Vite
- **Deployment:** VPS (`/opt/scoopfeeds`), Docker Compose — `web` / `worker` / `scheduler`
  containers split by `SCOOP_PROCESS_ROLE`
- **AI:** Google Gemini, pinned via `GEMINI_GENERATION_MODEL`, with deterministic
  (non-LLM) fallbacks on every path and hard cost rails (`LLM_DAILY_CALL_CAP`,
  `thinkingBudget: 0`, output caps)
- **Event graph:** embedding clustering + a single entity-affinity measure shared by the
  promoter, merge and breaker — see [dossier & event graph](docs/architecture/dossier_and_event_graph.md)
- **Search backbone (planned):** Brave Search API + Exa.ai
- **Alerts (planned):** web push, email, Telegram (free tier); WhatsApp + webhooks + Slack/Teams (premium)

## License and content notice

Code in this repository is licensed under [Apache License 2.0](LICENSE).

Editorial content produced by the platform — including AI-generated briefs, Reality Index outputs, quantitative trackers, dossiers, op-ed analyses, methodology documentation, and social posts — is **proprietary** and not licensed for reuse without explicit permission from Scoopfeeds.

This dual posture exists because the code is a contribution to public infrastructure for AI-augmented journalism, while the editorial content is the platform's commercial differentiator.

## Contributing

Primary execution is currently solo founder + AI agents (Claude Code). External contributions are welcomed but should follow the patterns documented in [CONTRIBUTING.md](CONTRIBUTING.md) and align with the Strategic Plan and Decisions Log.

## Contact

DrJ (Jahanzeb Hussain) — primary maintainer, Founder.
