# VPS Migration Runbook v1

**Document type:** Operational runbook (executable, phased)
**Owner:** DrJ
**Status:** Active
**Created:** 2026-06-25
**Companion:** `phase_b_go_live_runbook.md` (the entity work this unblocks), Strategic Plan v6, Decisions Log v1 (Decision 10 posture)

---

## 0. Why this exists, and when it ends (anti-drift anchor)

This migration is a **bounded means to an end**, not an infra project to live in. It exists because the current host (Hostinger shared, CloudLinux LVE) has a process/memory ceiling that blocks the forward build: it forbids in-process entity extraction, starves the Scoop search portal's processing, caps source scaling past ~150, and bleeds time to recurring fork-exhaustion / SSH refusals / restart double-ups. Removing that ceiling clears Decision 10's bar honestly — a *binding* constraint with *broad, user-facing* benefit, not premature optimization.

**Definition of done (migration is COMPLETE when all true):**
1. Prod runs on the Hostinger KVM 2 VPS via the committed Docker stack, stable (health 200, scheduler running).
2. DNS cut over; `https://scoopfeeds.com` serves from the VPS with valid TLS; legacy 301 redirect intact.
3. The live DB (with the synced entity tables + computed IDF) is on the VPS, verified.
4. **In-process entity extraction is live** (`ENTITY_EXTRACTION_ENABLED=true`) — coverage now self-sustains, the thing the LVE cap forbade.
5. Old host retained as cold rollback for a few days, then decommissioned.

**The moment it's done, we DO NOT linger.** Return immediately to the build plan, in this order:
- **Finish the event graph** (now feasible because extraction is live): enable matcher gate + breaker on current coverage, dissolve the live blob, un-park the comprehension homepage (`c9862ef`), enable display-grouping. Event graph = **shipped and self-sustaining.** Time-boxed.
- **Rebalance to leverage points** (per the Phase B status audit's "revive a non-spine track"): distribution (social upgrade + Telegram), then the Scoop search portal.

If any session finds us polishing infra or the matcher instead of advancing this sequence, that's drift — stop and re-anchor here.

---

## 1. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| TLS | Edge / certs | **Cloudflare proxy** (orange-cloud) + origin cert | Free, adds CDN + DDoS, hides origin IP, matches Mac-mini runbook posture |
| Jobs | Redis/BullMQ | **In-process first**; BullMQ a clean follow-up | One variable at a time; BullMQ is coded-but-not-live (Phase B audit) — enable after migration is stable |
| Cutover | DB window | **Short off-peak window** (~15-30 min) | Traffic is low; a clean snapshot-and-place is far simpler than bulk+delta sync |

**Target spec:** Hostinger KVM 2 — 2 vCPU / 8 GB RAM / 100 GB NVMe, Ubuntu 24.04 LTS. ~$7-9/mo intro (24-mo term holds the rate), ~$12-18/mo at renewal; 30-day money-back covers the trial.

**Standing rollback principle:** the old shared host stays **live and authoritative** until DNS is cut AND verified AND a stability soak passes. Every step before decommission is reversible. Nothing irreversible happens until M6's decommission, days later.

---

## 2. Phases

### M0 — Provision
**Goal:** VPS exists, reachable, Ubuntu 24.04, SSH-key auth.
**Steps:**
1. Buy KVM 2 (24-mo term). OS: Ubuntu 24.04 LTS. Add your SSH public key during setup.
2. Note the VPS public IP. Set a strong root password (stored in your password manager, not here).
**Verify:** `ssh root@<VPS_IP>` succeeds; `lsb_release -a` shows Ubuntu 24.04.
**Rollback:** none needed (old host untouched).

### M1 — Base setup
**Goal:** Docker + hardening + repo present.
**Steps:**
1. Create a non-root sudo deploy user; copy your SSH key to it; disable root SSH login + password auth (`/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`; restart sshd — keep your current session open until verified).
2. Install Docker Engine + Compose plugin (official convenience script or apt repo).
3. `ufw default deny incoming` / allow `22,80,443` / `ufw enable`. Install `fail2ban`.
4. Clone: `git clone https://github.com/nmc192-ux/scoopfeeds.git /opt/scoopfeeds`.
**Verify:** `docker --version` + `docker compose version` ok; `ufw status` shows 22/80/443; repo present; new SSH session as deploy user works.
**Rollback:** none needed.

### M2 — Stack bring-up on a throwaway DB
**Goal:** validate the Docker runtime in isolation, before real data.
**Steps:**
1. Create `/opt/scoopfeeds/backend/.env` with prod env vars (from the old host's `$HOME/.scoopfeeds.env` + hPanel-injected set). Include: `ENABLE_SCHEDULER=true`, `SCOOP_PERSISTENT_DATA_DIR=/var/lib/scoop`, `PORT=3000`, `PRIMARY_SITE_URL=https://scoopfeeds.com`, `REDIRECT_FROM_HOSTS=scoop.urbenofficial.com,[www.scoop.urbenofficial.com](https://www.scoop.urbenofficial.com)`, AdSense/analytics keys, AI keys. Set `ENTITY_EXTRACTION_ENABLED=false` and `ENTITY_IDF_ENABLED=true` for now. **Leave `REDIS_URL` UNSET** (in-process jobs — decision locked).
2. Bring up against an EMPTY data volume: `docker compose -f docker-compose.production.yml up -d --build`. Migrations auto-apply on the fresh DB.
**Verify:** `docker compose ps` all healthy; `curl http://localhost:3000/api/health` -> 200; scheduler logs show boot; no LVE-style errors (there won't be — root + 8 GB).
**Rollback:** `docker compose down`; old host untouched.

### M3 — DB cutover (the delicate one — off-peak window)
**Goal:** the live 8 GB DB (with entity tables + IDF) running on the VPS.
**Steps:**
1. **Off-peak window opens.** On the OLD host, take a consistent snapshot (the method that worked before — NOT `.backup`, which stalls): `sqlite3 $HOME/.scoopfeeds-data/news.db "VACUUM INTO '$HOME/news-cutover.db'"`.
2. Transfer snapshot -> VPS. Direct `scp` if the old host's SSH cooperates; if it fights (LVE), route via the Mac mini (old -> Mac -> VPS). Compress in flight (`scp -C`).
3. On the VPS: `docker compose stop`; place the snapshot into the `scoop_data` volume as `/var/lib/scoop/news.db`; `docker compose up -d`. Migrations auto-apply (idempotent; entity tables already present in the snapshot).
**Verify:** on the VPS DB — `article_entities`~=14,283, `surface_qid_cache`~=10,361, `article_entity_processed`~=3,506, `entity_idf` populated; `PRAGMA integrity_check`=ok; article/event counts match the snapshot; `curl localhost:3000/api/health` 200; homepage serves real data on the VPS IP.
**Rollback:** old host is still live and serving the public — nothing has cut over yet. Re-pull snapshot if integrity fails.

### M4 — TLS + domain (Cloudflare)
**Goal:** HTTPS terminates correctly in front of the stack.
**Steps:**
1. Ensure `scoopfeeds.com` is on Cloudflare (nameservers pointed). SSL/TLS mode: **Full (strict)**.
2. Generate a Cloudflare **Origin Certificate**; install it on a lightweight reverse proxy on the VPS (Caddy or nginx) terminating 443 and proxying to `web:3000`. (Caddy is simplest: a 3-line Caddyfile with the origin cert.) Add the proxy as a small service alongside the compose stack, or front the web container with it.
3. Test against the VPS directly (host header override) before any DNS change.
**Verify:** `curl -H 'Host: scoopfeeds.com' https://<VPS_IP> --resolve scoopfeeds.com:443:<VPS_IP>` returns 200 with a valid cert chain.
**Rollback:** none (DNS still points at old host).

### M5 — Cutover (DNS)
**Goal:** public traffic on the VPS, old host as rollback.
**Steps:**
1. **A day before:** lower the `scoopfeeds.com` DNS TTL to ~5 min (in Cloudflare).
2. **In the off-peak window:** point the `scoopfeeds.com` A-record -> VPS IP, **proxied (orange cloud)**. Old host still answers stale resolvers until propagation.
**Verify:** `https://scoopfeeds.com` serves from the VPS (check response + Cloudflare headers); cert valid; `scoop.urbenofficial.com` -> 301 to scoopfeeds.com intact; AdSense + analytics tags present in page source; `/api/health` 200.
**Rollback:** point the A-record back to the old host IP (<=5 min TTL). Fully reversible.

### M6 — Close + the payoff
**Goal:** the migration's whole point — extraction live, coverage self-sustaining.
**Steps:**
1. Confirm scheduler running on the VPS (`/api/health` scheduler lastRun fresh).
2. **Set `ENTITY_EXTRACTION_ENABLED=true`** in the VPS env; restart the stack. With 8 GB + root, in-process extraction runs on every new article — **no LVE wall.** Watch a few enrich cycles: `article_entity_processed` climbs, new articles get entities, the daily IDF cron (03:30) keeps weights fresh.
3. Stability soak (a few days). Then **decommission the old host** (keep its final snapshot as a cold archive briefly).
**Verify:** extraction processing new articles; coverage no longer goes stale; site stable on VPS over the soak.
**Rollback:** until decommission, DNS-back to old host remains available.

---

## 3. Effort & risk

**Effort:** ~2-3 focused sessions (M0-M1 setup; M2-M3 stack + DB cutover; M4-M5 TLS + DNS; M6 close).

**Risk register:**
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Old-host snapshot pull fights LVE (M3) | Medium | Low | Done successfully before; route via Mac mini if needed |
| DNS propagation lag | Low | Low | Pre-lowered TTL; old host answers during; reversible |
| Renewal price jump (140-232%) | Certain | Low | Budgeted ~$15/mo long-term; 24-mo term holds intro |
| Self-managed security exposure | Low | Medium | ufw + fail2ban + no root SSH + Cloudflare proxy hides origin IP |
| TLS/reverse-proxy misconfig (M4) | Medium | Low | Tested against VPS IP before DNS cut; old host unaffected |
| Scope creep into infra-land | **Medium** | **Medium** | Section 0 definition-of-done + mandatory return-to-build-plan |

**BullMQ note:** deliberately OUT of this migration (decision: one variable at a time). After migration is stable, enabling Redis/BullMQ is a clean, separate follow-up.

---

## 4. Execution log

- *(append per session: phase reached, verify results, decisions, next step)*

**2026-06-28 (Session) — M0–M2 COMPLETE.**
- **M0 DONE** — KVM 2 provisioned (Ubuntu 24.04.4, 2 vCPU / 7.8 GB / 96 GB, Malaysia region); SSH key auth confirmed.
- **M1 DONE** — apt upgraded (33 LTS security patches); 2 GB swap added; `ufw` active (22/80/443 only); `fail2ban` installed; Docker 29.6.1 + Compose v5.2.0 installed; non-root `deploy` user (sudo + docker groups, passwordless sudo) created and key-login verified; SSH hardened (`PermitRootLogin no`, `PasswordAuthentication no` across main config + `50-cloud-init.conf` + `60-cloudimg-settings.conf`) — gate passed: root REFUSED, deploy ACCEPTED; repo cloned to `/opt/scoopfeeds` at `31235d6`.
- **M2 DONE** — committed Docker stack built for the FIRST time (frontend compiled, better-sqlite3 rebuilt fresh against `node:20` — no ABI issue), web container Healthy on empty DB, `/api/healthz` 200. Used a `docker-compose.override.yml` to neutralize BullMQ for the isolated test (in-process-first decision); `backend/.env` minimal placeholder (real secrets come at M3). Test stack torn down + empty `scoop_data` volume removed to park clean.
- **NEXT = M3 (DB cutover).** Prep: (1) pull real prod env secrets from old host's `$HOME/.scoopfeeds.env` + hPanel-injected vars into VPS `backend/.env` (secrets — never in chat); (2) snapshot pull from old host (`VACUUM INTO`, then `scp` direct old->VPS or via Mac); off-peak window. Old shared host remains live + authoritative until M5 cutover.
