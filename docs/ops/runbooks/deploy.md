# Runbook — deploying to the VPS

**Written:** 28 Aug 2026, from DrJ's corrections to a deploy sequence that was wrong in
three environment-specific ways. Every rule below is here because getting it wrong has
already cost this project time.

**Read §1 before writing any deploy step.** The four facts there are not preferences.
They are properties of this box that make otherwise-correct commands do nothing, or
silently deploy half the system.

---

## 1. The four facts that make obvious commands wrong here

### 1.1 The image bakes the source. A `git pull` alone deploys nothing.

`docker-compose.production.yml` builds with `COPY backend ./backend`, so the running code
is whatever was in the image at build time. `git pull` followed by `up -d` leaves the old
code live: compose sees no image change and reports **`Running 0.0s`** rather than
`Started`, which reads like success.

**The shape is always `build` then `up -d`.** Not `up -d --build` in place of thinking
about it, and never `up -d` alone after a pull.

### 1.2 NEVER filter services on a deploy.

`docker compose ... build web scheduler` is how the **worker ran week-old code and week-old
env for days** in July while every check passed — because the checks were all against
`web`, and nobody looked at `worker`. Three processes come from one image
(`SCOOP_PROCESS_ROLE`), and a partial deploy produces a system where two thirds of it is
one version and the rest is another.

Build all. Up all. `ps` all.

### 1.3 Every compose command needs `-f docker-compose.production.yml`.

There is **no plain `docker-compose.yml`** on this box. A bare `docker compose` fails with
`no configuration file provided: not found`. This is easy to get right in most of a
sequence and then miss in one step, which is exactly what happened.

### 1.4 `SCOOP_PERSISTENT_DATA_DIR` does not exist in the host shell.

It is set **inside the containers**. In the deploy user's shell it is empty, so
`sqlite3 "$SCOOP_PERSISTENT_DATA_DIR/news.db"` silently becomes `sqlite3 /news.db` and
tells you nothing true.

From the host the database is at:

```
/var/lib/docker/volumes/scoopfeeds_scoop_data/_data/news.db      (root-owned; needs sudo)
```

Migrations run **on boot inside the container**, not from a host shell. `npm run db:migrate`
on the host is the wrong tool here — it would migrate a database that isn't the live one.

---

## 2. Before you touch anything

```bash
cd /opt/scoopfeeds

# The rollback point. Record it somewhere you can read after a bad deploy.
git rev-parse HEAD

# The flags live ONLY in a gitignored file, single copy, one box.
cp backend/.env ~/scoopfeeds-env-$(date +%F).bak

# A single malformed .env line makes EVERY compose command fail. This catches it
# without changing anything.
docker compose -f docker-compose.production.yml config >/dev/null && echo OK
```

**Back up the database before any deploy that migrates.** `npm run db:backup` exists and
**has never had a restore drill** (insurance item I1 in STATE_OF_PLAY) — so treat the
backup as unproven and keep the pre-deploy snapshot until the deploy has been verified.

---

## 3. The deploy itself

```bash
cd /opt/scoopfeeds
git pull origin main
git log --oneline -1                       # confirm you are on what you think you are

docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

`ps` must show every service recreated. A service reporting `Running` rather than
`Started` did not pick up the new image — see §1.1.

### Immediately after `up -d`, check the site is actually served

```bash
curl -sI https://scoopfeeds.com | head -1
```

**A recreate is when latent proxy faults fire.** The Caddyfile and
`docker-compose.override.yml` have disagreed about the host port **twice**, most recently
28 Aug 2026, producing a site-wide 502 that lasted a day. The override is untracked
(`vps_migration_v1.md` §204 has the durability note), so a re-clone or an edit on either
side can reintroduce it. Containers can all be healthy while the site is down.

---

## 4. Verifying a migration ran

Against the real path, from the host:

```bash
sudo sqlite3 /var/lib/docker/volumes/scoopfeeds_scoop_data/_data/news.db \
  "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 10;"
```

`schema_migrations` is the authority. Migrations are idempotent and tracked, so re-running
is safe and a missing id is a real failure rather than a display quirk.

---

## 5. Rollback

```bash
cd /opt/scoopfeeds
git reset --hard <sha from §2>
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

No service filter, for the reason in §1.2. **Rolling back code does not roll back a
migration** — the schema stays forward. That is usually fine (migrations here add columns
and triggers rather than removing them), but check the specific migration before assuming
it.

---

## 6. What to verify after any deploy that ships a feature dark

A dark feature needs a **positive** check, not an absence of errors. "No errors in the
log" is equally consistent with "the feature is absent", "the feature is present and
dormant", and "nobody looked".

The pattern that works:

- **Present** — a read-only endpoint that only exists if the code deployed, answering 200
  with content only the new code can produce.
- **Empty** — the feature's own listing surfaces returning nothing.
- **Refused** — a write refused with a *named* code, so the refusal is attributable to the
  flag rather than to a bug.
- **Still reachable** — anything deliberately exempt from the gate, proven not gated.

The last one is the one that gets skipped. A gate that refuses everything, including the
exempt path, passes the first three checks and is worse than no gate at all.

`incident_takedown.md` and the Phase 6E deploy sequence are the worked example.

---

## 7. Env flags

Flags live in `backend/.env` (and `~/.scoopfeeds.env`), read by `src/config/env.js`, which
**never overwrites an already-set var**. Every flag belongs in
`docs/reference/env_reference.md` with its code default *and* its prod value — the code
default is what most of prod actually runs on.

To confirm a set of flags is absent before a dark deploy:

```bash
grep -nE '^(FLAG_ONE|FLAG_TWO)=' backend/.env ~/.scoopfeeds.env
```

No output is the pass. A flag that is *present but empty* is not the same as absent for
every consumer — remove the line rather than blanking it.

**A flag with no consumer is worse than no flag.** `VIDEO_SUBJECT_VISUALS_ENABLED` sat off
in production while four PRs were built on top of it, and `VIDEO_INCIDENT_MEDIA_ENABLED`
was decorative until Gate F wired it to something. Before trusting a flag to hold a
feature back, grep for its consumer and confirm the thing it is supposed to gate actually
asks.
