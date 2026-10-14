# Runbook — the VPS auto-deploy (full-throttle engine)

Installed 2026-10 as part of the full-throttle engine (`docs/engine/full-throttle.md`).
The script is `scripts/ops/autodeploy.sh`; it follows `deploy.md` step for step.

## Install (once, on the VPS)

```bash
cd /opt/scoopfeeds && git pull origin main && sudo bash scripts/ops/install-autodeploy.sh
```

## What it does every 5 minutes

1. Stops if `/opt/scoopfeeds/.engine-paused` exists or an issue labelled `engine:pause` is open.
2. Stops if `origin/main` has nothing new, or if that commit already failed once.
3. Stops unless every GitHub Actions check on that exact commit is green.
4. Holds (and notifies) a range whose migrations contain DROP / DELETE / UPDATE … SET / RENAME.
5. Fast-forwards (never resets onto local edits), builds all services, ups all services.
6. Health check for up to 3 minutes: home page 200, `/api/health` 200, every service running.
7. On any failure: back to the previous commit, rebuild, up, mark the bad commit, notify.

Notifications go to `SLACK_WEBHOOK_URL` when it is set in `~/.scoopfeeds.env` or
`backend/.env`; every run also writes `/var/lib/scoopfeeds-autodeploy/autodeploy.log`.

## Everyday commands

```bash
sudo tail -50 /var/lib/scoopfeeds-autodeploy/autodeploy.log     # what it did
touch /opt/scoopfeeds/.engine-paused                              # pause deploys
rm /opt/scoopfeeds/.engine-paused                                 # resume
sudo rm /var/lib/scoopfeeds-autodeploy/bad-<sha>                  # allow a retry of one commit
sudo systemctl disable --now scoopfeeds-autodeploy.timer          # switch it off entirely
```

## Not covered (still by hand, see `deploy.md`)

A held destructive migration, a `.env` change, and anything in Caddy or
`docker-compose.override.yml`. The script never edits `.env` and never touches the proxy.
