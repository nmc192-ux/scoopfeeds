#!/usr/bin/env bash
# One-time install of the auto-deploy timer on the VPS. Run as root from the repo:
#   cd /opt/scoopfeeds && git pull origin main && sudo bash scripts/ops/install-autodeploy.sh
# Undo: sudo systemctl disable --now scoopfeeds-autodeploy.timer
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

for bin in jq curl flock git docker; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    if [ "$bin" = "jq" ] && command -v apt-get >/dev/null 2>&1; then apt-get install -y jq >/dev/null; else echo "missing: $bin" >&2; exit 1; fi
  fi
done

chmod +x "$REPO/scripts/ops/autodeploy.sh"
cat > /etc/systemd/system/scoopfeeds-autodeploy.service <<EOF
[Unit]
Description=ScoopFeeds auto-deploy (full-throttle engine)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=SCOOP_REPO=$REPO
Environment=HOME=/root
ExecStart=$REPO/scripts/ops/autodeploy.sh
TimeoutStartSec=1800
EOF

cat > /etc/systemd/system/scoopfeeds-autodeploy.timer <<'EOF'
[Unit]
Description=Run ScoopFeeds auto-deploy every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now scoopfeeds-autodeploy.timer
echo
echo "Auto-deploy is on. It checks main every 5 minutes."
echo "  Log:    sudo tail -f /var/lib/scoopfeeds-autodeploy/autodeploy.log"
echo "  Pause:  touch $REPO/.engine-paused     (resume: rm it)"
echo "  Off:    sudo systemctl disable --now scoopfeeds-autodeploy.timer"
systemctl list-timers scoopfeeds-autodeploy.timer --no-pager | head -3
