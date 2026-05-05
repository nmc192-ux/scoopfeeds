# Scoop On A Mac Mini
Document type: Operational runbook
Owner: DrJ
Last updated: 2026-04-05
Status: Active

This setup runs Scoop on your Mac mini full-time and exposes it to the internet through a Cloudflare Tunnel.

## Why this setup

- `launchd` keeps Scoop running and starts it on boot.
- `cloudflared` exposes Scoop securely without opening router ports.
- Scoop already serves the built frontend from the Node backend, so there is only one app process to run.

## 1. Put the project on the Mac mini

Copy this repo to a stable path, for example:

```bash
mkdir -p ~/apps
cp -R /path/to/scoop-news ~/apps/scoop-news
cd ~/apps/scoop-news
```

## 2. Build Scoop

```bash
chmod +x scripts/build-scoop.sh scripts/start-scoop.sh
./scripts/build-scoop.sh
```

## 3. Create the production env file

```bash
cp backend/.env.production.example backend/.env.production
```

Edit `backend/.env.production` and set any keys you want:

- `OPENWEATHER_API_KEY` for weather
- `GEMINI_API_KEY` for AI summaries
- `PORT=4000` is fine by default

## 4. Test locally on the Mac mini

```bash
./scripts/start-scoop.sh
```

Then check:

```bash
curl http://localhost:4000/api/health
```

Open `http://localhost:4000` in the browser on the Mini.

## 5. Run Scoop automatically with launchd

Copy the template and replace `REPLACE_ME` with your macOS username and the real repo path.

```bash
cp deploy/com.scoop.news.plist ~/Library/LaunchAgents/com.scoop.news.plist
```

Load it:

```bash
launchctl unload ~/Library/LaunchAgents/com.scoop.news.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.scoop.news.plist
launchctl start com.scoop.news
```

Check status:

```bash
launchctl list | grep scoop
curl http://localhost:4000/api/health
tail -f ~/Library/Logs/scoop.log
tail -f ~/Library/Logs/scoop-error.log
```

## 6. Expose Scoop to the internet with Cloudflare Tunnel

This is the easiest path if the Mac mini is behind a home router.

Prereqs:

- A Cloudflare account
- A domain in Cloudflare DNS
- A hostname such as `scoop.example.com`

Install cloudflared on the Mac mini:

```bash
brew install cloudflared
```

Authenticate:

```bash
cloudflared tunnel login
```

Create the tunnel:

```bash
cloudflared tunnel create scoop
```

Create DNS:

```bash
cloudflared tunnel route dns scoop scoop.example.com
```

Copy `deploy/cloudflared-config.yml` to `~/.cloudflared/config.yml`, then replace:

- `REPLACE_ME` with your macOS username
- `TUNNEL_ID.json` with the file created by `cloudflared tunnel create`
- `scoop.example.com` with your real hostname

Run a quick test:

```bash
cloudflared tunnel run scoop
```

Now visit:

```text
https://scoop.example.com
```

## 7. Run the tunnel automatically

Cloudflare can install itself as a macOS service:

```bash
sudo cloudflared service install
```

After that, keep Scoop running with `launchd` and let `cloudflared` keep the public tunnel up.

## 8. Updating Scoop later

From the repo directory on the Mac mini:

```bash
./scripts/build-scoop.sh
launchctl kickstart -k gui/$(id -u)/com.scoop.news
```

## Notes

- If you do not want Cloudflare, you can also use Tailscale Funnel, Caddy, or router port forwarding plus a reverse proxy.
- Cloudflare Tunnel is the safest default because it avoids exposing your home network directly.
- If you later want a clean domain root with HTTPS, the tunnel already gives you that.
