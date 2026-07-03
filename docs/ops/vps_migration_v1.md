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
| TLS | Edge / certs | **Cloudflare proxy** (orange-cloud) on Full setup; nameservers on Cloudflare; free Universal SSL at edge | The tunnel's only advantage was avoiding the NS move — which the free tier can't do anyway (Partial/CNAME setup is Business-plan only). With the domain on Cloudflare, the standard proxy is simpler. *(Supersedes the earlier `cloudflared` tunnel plan.)* |
| Jobs | Redis/BullMQ | **In-process first**; BullMQ a clean follow-up | One variable at a time; BullMQ is coded-but-not-live (Phase B audit) — enable after migration is stable |
| Cutover | DB window | **Short off-peak window** (~15-30 min) | Traffic is low; a clean snapshot-and-place is far simpler than bulk+delta sync |

**Target spec:** Hostinger KVM 2 — 2 vCPU / 8 GB RAM / 100 GB NVMe, Ubuntu 24.04 LTS. ~$7-9/mo intro (24-mo term holds the rate), ~$12-18/mo at renewal; 30-day money-back covers the trial.

**Standing rollback principle:** the old shared host stays **live and authoritative** until DNS is cut AND verified AND a stability soak passes. Every step before decommission is reversible. Nothing irreversible happens until M6's decommission, days later.

**Cloudflare onboarding — PREREQUISITE before M4.** `scoopfeeds.com` must be added to Cloudflare and its nameservers moved off Hostinger (currently NS = `dns-parking.com`). **Verify ALL imported DNS records — especially MX/email — before flipping nameservers.** The live site is unaffected by this (imported records are identical and still resolve to the old host). Domain registration **stays at Hostinger**; Cloudflare is **DNS + edge proxy only**; **$0** added cost.

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
3. `ufw default deny incoming` / allow `22,80,443` / `ufw enable`. Install `fail2ban`. *(80/443 must stay open — the Cloudflare proxy reaches the origin on them. At M6, restrict inbound 80/443 to Cloudflare's published IP ranges so only the edge can hit the origin directly.)*
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

### M4 — TLS + domain (Cloudflare proxy, staging subdomain)
**Goal:** HTTPS via the **Cloudflare proxy**, validated on a staging hostname before any live cutover. *(Supersedes the earlier `cloudflared` tunnel plan — the domain is now on Cloudflare Full setup, so use the standard proxy.)*
**Steps:** *(prereq: Cloudflare onboarding above is done — zone Active, NS on Cloudflare, records verified)*
1. In Cloudflare DNS, create `vps.scoopfeeds.com` as a **PROXIED (orange) A record -> VPS IP**.
2. Bring up the stack on the VPS (web serving real data; expose the origin on 80/443 for the edge to reach).
3. Cloudflare's free Universal SSL covers the subdomain — no origin cert to manage.
**Verify:** `https://vps.scoopfeeds.com` serves the VPS with valid edge TLS; live `scoopfeeds.com` untouched (apex still grey -> old host).
**Rollback:** delete the `vps.scoopfeeds.com` staging record; nothing live affected.

### M5 — Cutover (point apex at the VPS, proxied)
**Goal:** public traffic on the VPS via the Cloudflare proxy, old host as rollback.
**Steps:**
1. **In the off-peak window:** change the apex `scoopfeeds.com` A record (and `www`) from the old host IP to the **VPS IP**, and flip them to **PROXIED (orange)**. No TTL pre-lowering needed — the Cloudflare proxy switch is instant and reversible by toggling back. *(Take a final fresh snapshot just before, if the live DB has moved since M3.)*
2. **Email records stay grey/untouched** (MX/DKIM/SPF/autoconfig/autodiscover) — forever.
**Verify:** `https://scoopfeeds.com` serves from the VPS (check response + Cloudflare headers); cert valid; `scoop.urbenofficial.com` -> 301 to scoopfeeds.com intact; AdSense + analytics tags present in page source; `/api/health` 200.
**Rollback:** point the apex `A` record back to the old host IP. Fully reversible.

### M6 — Close + the payoff
**Goal:** the migration's whole point — extraction live, coverage self-sustaining.
**Steps:**
1. Confirm scheduler running on the VPS (`/api/health` scheduler lastRun fresh).
2. **Set `ENTITY_EXTRACTION_ENABLED=true`** in the VPS env; restart the stack. With 8 GB + root, in-process extraction runs on every new article — **no LVE wall.** Watch a few enrich cycles: `article_entity_processed` climbs, new articles get entities, the daily IDF cron (03:30) keeps weights fresh.
3. **Harden firewall to match the proxy posture:** restrict inbound `80/443` to Cloudflare's published IP ranges (keep `22`), so only the Cloudflare edge can reach the origin directly (no proxy-bypass to the origin IP). **Verify the site still serves through Cloudflare after tightening.**
4. Stability soak (a few days). Then **decommission the old host** (keep its final snapshot as a cold archive briefly).
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
| Cloudflare onboarding / proxy misconfig (esp. MX records on NS move) | Medium | Low | Verify all imported records before flipping nameservers; test on staging hostname first |
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

**2026-06-28 (Session, cont.) — M3 COMPLETE (validation).**
- Captured prod env from old host (58 vars, 16 secrets) via hPanel File Manager route (old-host SSH fork-wedged under LVE; browser download worked); built clean VPS `backend/.env` (45 lines, stripped LiteSpeed/thread-workaround + compose-managed vars, `chmod 600`).
- Snapshotted live DB (`VACUUM INTO`, 11 GB live -> 8.7 GB snapshot), gzip'd to 1.6-1.8 GB, transferred old-host -> Mac (File Manager) -> VPS, decompressed into `scoopfeeds_scoop_data` volume.
- Integrity check `ok`; counts verified: `articles` 24,280, `article_entities` 14,283 (exact match to 4a sync), `entity_idf` 5,101 (exact match to 4b).
- Brought up `web` only against real data with the no-ingest override (`ENABLE_SCHEDULER=false`, `USE_BULLMQ=false`, `REDIS_URL=""`); health 200, serving real data. Mac retains `snap-m3.db.gz` as offline fallback.
- **NEXT = Cloudflare onboarding (PREREQUISITE for M4):** `scoopfeeds.com` is NOT yet on Cloudflare (NS = Hostinger `dns-parking.com`). Add zone, VERIFY imported records (esp. MX/email) before flipping nameservers; live site unaffected (records identical, still -> old host). Then **M4** = `cloudflared` tunnel -> `web:3000`, tested on a staging subdomain (`vps.scoopfeeds.com`). Old host authoritative until M5.

**2026-06-30 (Session) — CLOUDFLARE ONBOARDING COMPLETE (M4 prerequisite).**
- Found `scoopfeeds.com` was NOT on Cloudflare (NS = Hostinger `dns-parking.com`), and Cloudflare Tunnel's free tier requires **Full setup** (nameservers on Cloudflare) — Partial/CNAME setup is **Business-plan only ($200/mo)**.
- **Decision:** move nameservers to Cloudflare (Full setup), protecting the live email setup (1 active mailbox `admin@scoopfeeds.com` on Hostinger Business Email). *(This also makes the standard Cloudflare proxy available — superseding the tunnel plan; see M4/M5.)*
- Captured all 13-14 DNS records; added zone to Cloudflare (Free). On import, fixed 5 email CNAMEs (3 DKIM `hostingermail-a/b/c`, `autoconfig`, `autodiscover`) that Cloudflare wrongly set to Proxied -> set **ALL records to DNS-only (grey)** for a behavior-identical migration. Confirmed DNSSEC off at Hostinger.
- Flipped nameservers Hostinger -> `aaden`/`gigi.ns.cloudflare.com`. Propagated in ~20 min; zone **Active**.
- **VERIFIED:** NS = Cloudflare; site HTTP 200 (still old host `<OLD_HOST_IP>`, grey/unproxied); MX/DKIM/SPF intact; a real test email to `admin@scoopfeeds.com` arrived in webmail. **Email fully survived.**
- **NEXT = M4** (staging validation: `vps.scoopfeeds.com` as a PROXIED A record -> VPS IP) -> M5 (point apex at VPS, proxied). Old host authoritative until M5.

**2026-07-03/04 (Session) — M5 DONE (CUTOVER — site LIVE on VPS).**
- Chose **Option B** (simple cutover; strict TLS deferred to follow-up) after the Origin-Cert + Caddy path proved fiddly and was aborted (origin certs revoked as a precaution).
- **Final fresh snapshot:** `VACUUM INTO` on old host (12 GB live -> 9.4 GB snap), routed old-host -> Mac (File Manager) -> VPS. First `scp` (uncompressed, 5h over slow home uplink) arrived **CORRUPTED** (SQLite "malformed") — **caught by the pre-swap integrity check before any flip.** Re-transferred the gzip (1.9 GB) via `rsync` with **md5 verification both ends (matched)** + `gunzip -t` — clean. Swapped into `scoop_data` volume; `quick_check` ok, 24,184 articles, newest ~Jun 30.
- Enabled the **full stack** (web+scheduler+worker+redis) with `PRIMARY_SITE_URL` reverted to `https://scoopfeeds.com`; scheduler confirmed ingesting (110 sources; 503/429s from X/Gemini are normal external rate-limits).
- **THE FLIP:** in Cloudflare, apex `A scoopfeeds.com` -> **VPS IP, proxied (orange)**; deleted old `AAAA`; `www` CNAME set proxied; all 8 email records left **grey/untouched**.
- **VERIFIED:** apex resolves to Cloudflare IPs; site **HTTP/2 200** via `cf-ray` (SIN edge) serving VPS data; MX intact; a real test email to `admin@scoopfeeds.com` arrived; live site renders fresh feeds after a Cloudflare cache purge (`cf-cache-status: DYNAMIC`; article count grew **24,184 -> 26,625**, confirming live VPS ingestion).
- **Old host now DORMANT** (no app process, no scheduler crontab; the on-demand app never spawns since Cloudflare routes all traffic to the VPS) — retained as rollback fallback (repoint apex to old host IP to revert). **NOT decommissioned.**
- **REMAINING (M6):** (1) strict TLS follow-up — Cloudflare Origin Cert + Caddy, SSL mode Flexible -> Full(strict) [**generate a FRESH cert**; the prior ones were revoked]; (2) restrict inbound 80/443 to Cloudflare IP ranges; (3) review the "Block AI training bots" default; (4) soak period, then decommission old host; (5) reboot VPS for the pending kernel update (deferred during cutover). Then per the anti-drift anchor: **return to the build plan — finish the event graph, then distribution / Scoop.**

**2026-07-04 (Session) — M6 IN PROGRESS (hardening, paused mid-way).**
- **DONE:** Soak confirmed healthy (stack up 13h+, app responding, ingestion live). Reviewed firewall. Fetched Cloudflare's **current** IP ranges directly from `cloudflare.com/ips-v4` and `/ips-v6` (15 IPv4 + 7 IPv6). Locked `ufw` to allow 80/443 **only from Cloudflare ranges** (SSH left open; add-before-remove: added CF allows, verified site 200 via Cloudflare, then removed the Anywhere 80/443 rules).
- **BLOCKER FOUND:** the `ufw` lock did **not** actually block direct origin access — the web container publishes `0.0.0.0:80` via `docker-proxy`, which **bypasses the host firewall.** Confirmed definitively: added Cloudflare-only rules to the `DOCKER-USER` iptables chain with a final `DROP`, but the DROP rule shows **0 packets** (traffic never traverses `DOCKER-USER`; `docker-proxy` intercepts in userland). Direct `curl` to the origin IP on `:80` still returns 200 from a non-Cloudflare IP. Origin currently reachable directly on port 80 — **low risk** (origin IP hidden from DNS behind Cloudflare, same app/content, requires targeted discovery) — but should be closed.
- **PROPER FIX (deferred to next session):** stop publishing the app port to `0.0.0.0`. (1) rebind web container to `127.0.0.1:8080:3000` (localhost only); (2) install **Caddy on the HOST** (not Docker) listening on `0.0.0.0:80+443`, reverse-proxy to `127.0.0.1:8080`, TLS via a **FRESH Cloudflare Origin Certificate** (prior certs were revoked; match cert+key from **ONE** generation — the earlier mismatch was mixing blocks across generations); (3) Cloudflare SSL mode Flexible -> Full(strict). This single change **hides the origin AND encrypts the edge->origin hop AND gives strict TLS** — closing all remaining security items at once. Note: the `ufw` CF-allow rules + `DOCKER-USER` rules currently in place are **harmless but ineffective**; the Caddy/localhost-bind approach supersedes them. Also: `iptables` `DOCKER-USER` rules are **NOT reboot-persistent** — moot once the Caddy approach lands.
- **STILL REMAINING after the Caddy fix:** review Cloudflare "Block AI training bots" default; pending VPS **kernel reboot** (do in a deliberate window; confirm the stack auto-recovers + persist any host firewall rules); soak then **decommission old host** (still dormant fallback). Then per the anti-drift anchor: **return to the build plan — finish the event graph (4c gate+breaker on the live graph, un-park the comprehension homepage `c9862ef`), then distribution / Scoop.**
