# Scoopfeeds Skills Architecture Strategy v1

**Status:** Strategic vision document  
**Date:** 2026-05-10 (Session 13)  
**Author:** DrJ + AI strategic discussion  
**Scope:** Phase B+ architectural direction  
**Commits Phase A:** No  

---

## TL;DR

Scoopfeeds will eventually be a thin-core platform with capabilities ("skills") that latch onto it. News, Reality Index, Markets, Search, Distribution will all be skills. The core will be a small shell handling routing, auth, layout, theme, plugin contract, observability.

This is the **eventual** end state. Getting there responsibly requires building Phase B as a "modular monolith" — code organized as if skills were separate, but running as one application, until pain or growth justifies physical separation.

This document defines the direction. It does not commit to engineering work. Phase B execution decisions will happen at the time of execution, informed by user behavior data, team size, and operational pain Phase A has surfaced.

---

## 1. Vision

Scoopfeeds is not just a news site. The strategic plan v6 articulates five capabilities:
1. **Layer 1 — Newsroom** (the core news experience)
2. **Layer 2 — Intelligence Desk** (premium tier)
3. **Reality Index** (multi-source probability triangulation)
4. **Distribution** (multi-channel delivery)
5. **Scoop search** (analyst-grade search portal)

Each of these is a substantial product surface. Each has its own data needs, failure modes, evolution pace, and potentially its own team.

The vision is that Scoopfeeds becomes a platform — a small core that hosts these capabilities as independent skills, with the ability to add new skills (Markets, Climate, Geopolitics, Health) over time without rewriting the core.

The user experience is unified. A user sees scoopfeeds.com as one product. They don't know that News, Markets, and Reality Index are technically independent. The architecture is invisible to them.

---

## 2. Architectural Philosophy

### Thin core, rich skills

The core does not implement features. The core implements:
- The contract for how skills register and present themselves
- Routing infrastructure that delegates to skills
- Authentication and identity (so skills don't reimplement)
- Layout and theming (so skills look unified)
- Observability and logging (so skills can be monitored consistently)
- An event bus for skill-to-skill communication
- Shared data models (Article, Event, User) that skills reference

The core does NOT contain:
- News rendering logic (that's the News skill)
- Reality Index data ingestion (that's the Reality Index skill)
- Article reader UI (that's part of the News skill)
- Markets data fetching (future Markets skill)

### Skills are independent capabilities

Each skill:
- Owns its own data models (extensions of core models if needed)
- Owns its own routes and UI components
- Owns its own ingestion, processing, rendering
- Communicates with other skills only through the event bus or core's public services
- Can fail without taking down other skills
- Can evolve at its own pace

### Failure isolation as a core architectural value

When Markets fails, the user sees Markets go dark. The rest of the site works. When Reality Index has a bad day, breaking news still flows. The blast radius of any one failure is bounded.

This is not just about technical failure — it's about evolutionary failure too. If we ship a feature and users hate it, we can remove the skill without unwinding it from a tangled monolith.

---

## 3. The Path: Modular Monolith → Physical Separation

We do NOT build a thin-core platform with separate services in Phase B. We build a **modular monolith** that architecturally looks like skills but physically runs as one application.

### Why modular monolith first

1. **We don't yet know what skills need.** Designing the skill contract requires knowing the requirements skills will impose on the core. We don't know that yet — Reality Index is 7 days old in production, Markets isn't built, Distribution is partial. A contract designed too early will be wrong.

2. **Premature physical separation costs more than it gains.** Network boundaries between our own code add latency, error handling complexity, deployment overhead, and infrastructure cost. For a solo-or-small-team product at modest scale, the cost outweighs the benefit until specific pain demands it.

3. **Architectural readiness for separation is the actual value.** If skills are properly bounded internally — separate folders, no cross-skill imports, communication through well-defined interfaces — then physical separation later is a refactoring task, not a rewrite.

4. **The discipline is the architecture.** What makes skills work is not the network call between them; it's the agreement that they don't reach into each other. That discipline can be enforced in a single codebase.

### Phase B scope (when Phase A wraps)

Phase B's first work item is to **reorganize the codebase by skill**. Currently the structure is by technical layer:


```

backend/src/ routes/ services/ models/ jobs/ frontend/src/ pages/ components/ hooks/

```

The Phase B reorganization moves to:


```

backend/ core/ auth/ routing/ layout/ storage/ observability/ events/ (internal event bus) models/ (shared data models) skills/ news/ routes/ services/ ingestion/ models/ reality-index/ routes/ services/ ingestion/ models/ distribution/ channels/ services/ models/ image-video/ pipeline/ services/ models/
frontend/ core/ layout/ theme/ routing/ skills/ news/ pages/ components/ hooks/ reality-index/ pages/ components/ hooks/

```

This is a structural refactor, not a behavioral one. The application does the same things. But suddenly:
- Each skill has a clear home
- Cross-skill imports become visually obvious (and bad)
- Adding a new skill is "create a new folder under skills/"
- Removing a skill is "delete its folder"
- A new team member can understand "I work on the Markets skill" without needing the whole architecture

### When physical separation happens

Specific skills get physically separated (running as their own service) when one or more of these is true:

- The skill creates resource pressure that affects other skills (memory, CPU, process count)
- The skill needs different deploy cadence than core (we want to deploy News daily but Reality Index weekly)
- The skill needs different infrastructure (Markets needs a Redis cache, News doesn't)
- A separate team owns it and wants independent deploy ownership
- The skill experiences failures that bleed into core when integrated (today's Phase 6 saga is a faint version of this — the skill's deploy mechanism affects core, even though the change is skill-bounded)

**First candidate for physical separation (when Phase B is mature enough to consider it):**

**Image/video generation pipeline.** It's already partially separated (some work happens in GitHub Actions). It's compute-heavy (would benefit from independent scaling). It has a clean async interface (jobs in, results out). It has been a recurring source of resource pressure. The separation work would be relatively straightforward because the boundaries are already clean.

This is treated as a Phase B+ POC — a proof of concept that the skill isolation pattern works in practice. It is NOT a commitment for Phase B's first work item. The first work item is the codebase reorganization. The POC isolation is a candidate for Phase B's second or third work item, depending on what Phase B reveals.

---

## 4. Skill Taxonomy (Current + Future)

### Core (always present)
- **Site shell:** navigation, header, footer, layout, theming, auth
- **Routing infrastructure:** delegates URL paths to skills
- **Auth and identity:** user accounts, sessions, subscription state
- **Storage:** database access, file storage, caching
- **Observability:** logging, metrics, alerting
- **Event bus:** in-process pub/sub for skill-to-skill communication
- **Shared models:** Article, Event, User, Source

### Layer 1 skills (newsroom)
- **News skill:** the newsroom experience — feed, filtering, ranking, breaking news, article reader. The foundational identity of Scoopfeeds.

### Layer 2 skills (Intelligence Desk, $19/mo)
- **Reality Index skill:** live event stream, dossiers, multi-source probability, anomaly detection, watchlist push
- **Scoop search skill:** analyst-grade search across articles, events, sources

### Lateral skills (cross-cutting capabilities)
- **Distribution skill:** push notifications (Telegram, email, web push, WhatsApp), webhooks, Slack/Teams integrations
- **AI services skill:** routing across Cerebras, Groq, Cloudflare, NVIDIA, Ollama, Gemini for embeddings, sentiment, summarization, translation
- **Image/video generation skill:** pipeline for visual content (cards, social posts, videos)

### Future skills (when product evolves)
- **Markets skill:** financial markets data, terminal-style display
- **Climate skill:** climate-related signals, alerts, projections
- **Geopolitics skill:** conflict tracking, diplomatic events
- **Health skill:** public health signals
- **Sports skill:** real-time sports data, live scores
- **Entertainment skill:** culture, media, entertainment industry signals

The future skills list is not committed. Many will not be built. Some will be built and removed. The architecture should welcome all of them and resist none of them.

---

## 5. Skill Design Principles

### Each skill owns its surface
A skill has its own folder. Its own routes. Its own services. Its own models. Its own components. Its own hooks. Its own tests. If something is "part of" a skill, it lives under that skill's folder.

### Skills do not import each other
News skill code does not import Reality Index skill code. Markets skill code does not import News skill code. They communicate through:
- The event bus in core (asynchronous notifications)
- Public services in core (synchronous shared concerns)
- Shared data models in core (common types)

Reaching across skill boundaries is a code smell. Code review (or AI-assisted review) catches this.

### Skills fail in isolation
A skill's exception does not crash the core. Skills implement try/catch boundaries at their public entry points. The core handles skill failures gracefully — the skill goes dark, the rest of the site works.

### Skills publish events, not direct calls
When News ingests an article, it publishes an event. Reality Index might subscribe, Distribution might subscribe, Search might subscribe. News doesn't know who's listening. This decouples skills temporally and causally.

### Skills declare their dependencies
A skill explicitly declares: "I need core's storage. I need core's auth. I subscribe to these events. I publish these events." This makes the dependency graph visible and audit-able.

### Skills handle their own data
A skill's data model lives within the skill, even if it extends a core model. Reality Index's "EventDossier" is its own thing, not News's. Markets's "Ticker" is its own thing.

### Skills have their own admin surface
Each skill has its own admin/ops endpoints under the skill's folder. The core admin surface aggregates skill admin surfaces but doesn't reimplement them.

### Skills evolve at their own pace
A skill can be rewritten without touching other skills. A skill can be deprecated and removed without unwinding tangled dependencies.

---

## 6. Skill-to-Skill Communication

### Event bus (asynchronous)

Skills publish events that other skills can subscribe to. The bus is in-process initially (a simple emitter), with the option to migrate to a real message queue when physical separation happens.

Example events:
- `news.article.ingested` — News skill publishes when a new article is processed
- `reality_index.event.detected` — Reality Index skill publishes when a new event is identified
- `user.subscription.upgraded` — Core publishes when a user upgrades to Layer 2
- `distribution.alert.fired` — Distribution publishes when an alert is sent

### Core services (synchronous)

Core exposes public services for shared concerns. Skills call these:
- `core.auth.getUser(userId)` — get user identity
- `core.storage.getArticle(articleId)` — get an article (skills can extend the article object)
- `core.observability.logEvent(event)` — log structured events
- `core.events.publish(event)` — publish to the event bus
- `core.events.subscribe(eventType, handler)` — subscribe to events

### Shared data models

Common types live in core. Skills extend them as needed.


```

core/models/Article.ts: base Article shape news/models/NewsArticle.ts: extends Article with news-specific fields reality_index/models/IndexedArticle.ts: extends Article with credibility scores, dossier links

```

### What's NOT allowed

- Skill A directly importing from Skill B's folder
- Skill A reading Skill B's database tables (skills' tables are private; access through B's services)
- Skill A's components rendering Skill B's components (compose at the page level via core)
- Skills calling each other's HTTP endpoints (use the event bus)

---

## 7. Sequencing and Prioritization

### Phase B work items (in approximate order)

**B.1: Codebase reorganization**
- Restructure backend/ and frontend/ folders by skill
- Move existing code into skill folders
- Establish core/ as the small foundation
- No behavioral change; pure refactor
- Estimated: 1-2 dedicated sessions

**B.2: Define skill contract documentation**
- Write the actual skill design principles as enforceable rules
- Create skill scaffolding template (a "new skill" boilerplate)
- Document the event bus protocol
- Document the core services API
- Estimated: 1 dedicated session

**B.3: Establish skill boundaries through code review**
- Add tooling (linter rules, import boundaries) that prevents cross-skill imports
- Add tests that verify skill isolation
- Document the review checklist
- Estimated: 1 dedicated session

**B.4: First skill isolation POC (image/video generation)**
- Take the cleanest existing boundary
- Physically separate it as its own service or job runner
- Use as reference implementation for future skill isolations
- Document lessons learned
- Estimated: 2-3 dedicated sessions

**B.5+: Other skill formalization, as time and pressure require**
- Reality Index gets formalized when its resource pressure justifies separation
- Distribution gets formalized when channel count grows
- Markets gets built as a skill from day one
- Each is its own work item, prioritized by need

### What does NOT happen in Phase B

- Building a plugin loading system before knowing what skills need
- Rewriting News skill (it's the core domain; refactor to skill folder, don't rebuild)
- Physical separation of all skills (only those with specific pain)
- Public plugin API for third parties (premature; skills are internal)
- Microservices migration (skills can live in one process for a long time)

---

## 8. Anti-Goals

These are things we explicitly do NOT do, even when tempted:

### Don't build the platform before the application
Plugin systems, skill loaders, dynamic registration mechanisms — these are infrastructure for skills that don't exist yet. Build skills first, then formalize the patterns they reveal. The plugin infrastructure is the LAST thing to build, not the first.

### Don't physically separate before pain demands it
Splitting skills into separate services adds operational complexity. Network calls fail in ways function calls don't. Independent deploys mean coordination problems. Don't pay this cost until the cost of NOT separating exceeds it.

### Don't over-specify the skill contract
The contract should be minimal. Skills should be free to evolve their internals. The contract is "how skills register and communicate," not "what skills can do."

### Don't allow cross-skill coupling to creep in
Resist the temptation. When News needs to know something from Reality Index, the answer is "subscribe to Reality Index's events," not "import Reality Index's service directly." If the event bus doesn't support what News needs, expand the event bus, not the coupling.

### Don't build skills you can't maintain
Each skill is a maintenance burden. Don't build Markets if no one is going to keep its data current. Don't build Climate if there's no domain expert to validate its logic. The number of skills should match the team's capacity to evolve them.

### Don't pretend skills are decoupled when they aren't
If two "skills" share so much that they really are one capability, fold them together. False modularity is worse than honest monolith.

---

## 9. Connection to Phase A Findings

Several Phase A findings directly motivate this architecture:

### Finding #8 (recurring DB rollback on Hostinger restart)
A worker restart wipes recent ingestion state. In a skills architecture with ingestion as separate skills, restart impact is bounded — only the restarted skill loses its in-flight state. Other skills' state is unaffected.

### Finding #19 (Instagram dedup loop)
A bug in one distribution channel cascaded into 181 duplicate posts. In a skills architecture, distribution channels are skills with isolated failure boundaries. A bug in Instagram doesn't put 181 posts on every channel.

### Finding #25 (RSS date-parsing producing future-dated articles)
A bug in News skill ingestion put bad data into the system. In a skills architecture, News skill's ingestion has its own validation; bad data doesn't propagate to skills that consume from News (Reality Index, Distribution).

### Findings #35-#38 (Phase 6 deploy crashes, process saturation, root cause)
Today's investigation revealed that production runs as one Passenger process. Any skill's resource pressure affects the whole process. In a separated skills architecture, Reality Index's process pressure wouldn't affect News's deploy stability.

### Finding #39 (three relief paths)
Path 3 (architectural split) is the durable fix for process saturation. That path IS this skills architecture, applied to the cron scheduler specifically. The whole codebase moving toward skills makes Path 3 a natural eventual outcome rather than a one-off refactor.

---

## 10. Phase B Kickoff Criteria

Phase B starts when:

1. **Phase A is wrapped cleanly.** All Sprint 0-2 issues closed. Phase A retrospective written. No outstanding production incidents.

2. **Strategic clarity on Reality Index.** Decision made about Reality Index gating, plan upgrade, or refactoring. Either it's running stable (no urgency), or relief has been applied (workload is bounded).

3. **Operational baseline understood.** A few weeks of post-Phase-A observability data exists. We know what production actually does day-to-day, what the resource patterns look like, what's working and what's not.

4. **Time and energy budget realistic.** Phase B is structural work that's mostly invisible to users. Don't start it during periods of high user-facing pressure.

If any of these aren't true, Phase B waits.

---

## 11. Open Questions for Future Sessions

These are deliberately unanswered now because answering them prematurely would be a guess. Phase B sessions will resolve them:

1. **Where does the line between core and skills sit exactly?** Auth is core. Routing is core. Layout is core. But what about translation? What about ratelimiting? What about analytics? The boundary needs to be drawn case-by-case.

2. **What does "skill registration" actually look like?** Static (skills are imported in a known order at startup) or dynamic (skills register themselves at runtime)? Probably static for a long time, dynamic if/when third-party skills become a thing.

3. **How does cross-skill data sharing work for things that can't be events?** Some queries need data from multiple skills (e.g., "show me articles about events with high credibility"). This crosses News and Reality Index. The answer is probably a query layer in core that aggregates across skills' public APIs, but the design is open.

4. **How is the front-end skill structure mirrored in the back-end?** Is each skill's frontend and backend tightly bound? Loosely bound? Independent?

5. **What's the migration path for shared utilities?** There's a lot of code in `services/` that's used by everything (axios wrappers, common helpers). Where does that live? Probably in core, but the boundaries need thought.

6. **Does each skill have its own database tables, or share a database?** Probably shared database with skills having "ownership" of certain tables, but this is a real decision.

7. **How are skills versioned?** When News skill changes its event schema, how do other skills handle the transition?

These are the hard questions. They get answered through Phase B work, not in advance.

---

## Document maintenance

This is v1. Future updates as Phase B reveals what works:
- v1: Strategic vision (this document)
- v2: After Phase B.1 (codebase reorganization) — refine with what we learned
- v3: After first skill isolation POC — refine with operational lessons
- v4+: Continued refinement as skills accumulate

When this document is updated, the version increments and prior versions are preserved (don't overwrite v1 with v2).
