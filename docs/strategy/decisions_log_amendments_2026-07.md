# Decisions Log — Amendments, July 2026

**Document type:** Decisions Log addendum
**Applies to:** Decisions Log v1 (31 decisions)
**Owner:** DrJ
**Last updated:** July 2026
**Status:** Active

> Per Strategic Plan v6 §12, decisions are revised with documented rationale and date.
> This addendum records revisions and new decisions made between May and July 2026.
> Fold these into Decisions Log v2 at the next revision; until then this file is
> authoritative alongside v1. Where an amendment conflicts with v1, the amendment wins.

---

## Amended decisions

### Decision 9 (Brand identity) — AMENDED 2026-07-21

**Was:** Brand refresh in Phase B.
**Now:** Full rebrand of the ScoopFeeds visual identity, executed with AI design tools. Direction locked: "editorial disruption" — black base, oversized cropped grotesk type, type-as-image, data as decoration. Reference aesthetic: @hypertech-style social formats (photoreal image over black band, heavy condensed all-caps headlines with acid-lime/white alternation, small italic wordmark, carousel-first). Name and handles unchanged. Magenta rejected as signature colour; symbol-logo candidates rejected to date.
**Rationale:** the existing look reads old-school; the video channel and social engine need a defined visual character applied to every asset.
**Review trigger:** after first 10 videos published under the new identity.

### Decision 13 (Alert delivery channels) — FLAGGED FOR REVIEW 2026-07-20

**Was:** Free tier alerts via web push + email + Telegram broadcast; WhatsApp reserved for premium.
**Status:** Not yet changed, but Telegram has proven unstable in Pakistan — unreliable enough that the founder's own approval channel was moved from Telegram to WhatsApp. Before the alert engine is built, re-verify Telegram reliability for the target audience regions. If Telegram remains unreliable in core markets, the free/premium channel split needs redesign (candidates: web push + email free; WhatsApp introduced earlier at low volume).
**Review trigger:** alert engine v1 kickoff.

### Decision 19 / Platform sequencing (Social) — AMENDED 2026-07-19/20

**Was:** YouTube Shorts Phase C; YouTube long-form and TikTok Phase D.
**Now:** YouTube channel launched July 2026 (@scoopfeedsnews), TikTok handle claimed (@scoopfeeds); long-form landscape video is the **primary** format, Vox-style explainer (voiceover over motion graphics, context-behind-the-headline). Shorts are an independent production track, not only cut-downs. Same videos distributed to YouTube and Facebook; Shorts also to TikTok and Instagram. Goal: monetized channels as a ScoopFeeds revenue stream.
**Quality gate:** V1 pipeline judged below bar after first upload; V5 production-quality phase (voice, script gate, motion + word-synced captions, b-roll, selection bar) required before scale.
**Rationale:** founder priority plus monetizable distribution; pulling video forward front-loads the highest-direct-revenue social channel.

### Decision 20 (Content generation workflow) — AMENDED 2026-07-20

**Additions:** approval channel is WhatsApp (not Telegram). A founder topic inbox is part of the loop — DrJ drops links (YouTube, Instagram, Facebook, articles) as inspiration seeds for research and scripts. Channel content is organized into sub-categories: finance, politics, Middle East/Palestine, personal finance, self-help, health, public health.

### Decision 22 (Brand voice) — AMENDED 2026-07-20

**Was:** consistent core voice — informed, data-first, regionally aware, never partisan, never sensationalized (wire-adjacent neutrality implied everywhere).
**Now:** unchanged for text surfaces (site, dossiers, briefs, social text posts). For **long-form video narration**, the voice carries an explicit point of view — analytical, context-driven, Vox-style — while remaining data-grounded, non-partisan in the party-political sense, and never sensationalized. A point of view is an editorial stance on *what matters and why*, not advocacy.
**Rationale:** pure wire-service neutrality does not work as long-form video; the format requires a narrator with a perspective.
**Risk note:** raises the geopolitical-content risk from the register; mitigation is the human review gate on all video scripts (Decision 20) plus the editorial boundary in Decision 32 below.

---

## New decisions

### Decision 32 — Video editorial boundary (2026-07-19)

Skip Pakistani domestic and political news in video content unless DrJ specifically directs otherwise. Focus on global audiences and topics of wider public interest.
**Rationale:** audience strategy (global monetization) and founder risk posture given DrJ's public role.

### Decision 33 — Video channel identity (2026-07-19)

Use the existing ScoopFeeds brand for the video channel; no separate video sub-brand.
**Rationale:** brand compounding; one identity across site, social, and video.

### Decision 34 — Sequencing: graph integrity before Phase B features (2026-06/07)

Event-graph integrity and dossier quality (A2/A5/A6, cleanup waves, machine-event quarantine) take precedence over the Phase B feature list (trackers, breaking news engine, op-ed aggregation, alert engine, Scoop portal, source expansion to ≥150). Those capabilities are **deferred, not cancelled**; each is unblocked as the graph settles.
**Rationale:** a comprehension platform whose events are contaminated cannot credibly layer features on top; reader-visible defects (wrong markets, porous merges, machine-slug events) are trust-destroying in a way missing features are not.
**Review trigger:** when Wave 3 + machine-event quarantine ship, re-open Phase B scope with a fresh kickoff brief.

---

*End of document.*
