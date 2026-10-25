# Radio playout in the cloud: what it would take (#196, build step 5)

**Status: a paper for DrJ to decide on later. Nothing is provisioned, ordered or configured.**
Every price and capacity figure below is an **UNVERIFIED estimate** written from general knowledge on 23 Oct 2026.
None was measured on a cloud server or checked against a live price page. Check before deciding.

## Why consider it

Today the playout (`backend/src/radio/playout/`) runs on the Mac mini at home. Air depends on that one machine, its
power and its home uplink. #196 hardens the Mac (stream watch, 720p fallback, restart after a power cut). A cloud host
removes the home uplink and home power from the chain. `docs/radio/autonomous-newsroom.md` (Stage 4) already names
"an always-on wired host with backup power, or a cloud playout" as the end state, and the standing approval asks that
the design "allow a cloud host later".

## What already works on Linux

- The playout is plain Node + headless Chromium (Playwright) + ffmpeg. `playout/Dockerfile.dev` builds exactly that
  image (Node 20, Playwright Chromium, ffmpeg with libx264/AAC) and is how the playout is tested off the Mac.
- `run-playout.sh` notes the Linux equivalent of the launch agent: a systemd unit with `Restart=always`.
- The fan-out (YouTube + X), stream watch and alerts have no macOS dependency. Mac-only pieces fall back safely:
  the macOS notification is skipped (email still goes out) and the 720p fallback's `networkQuality` is absent, so the
  upload is UNMEASURED and the output stays at 1080p unless `RADIO_PLAYOUT_QUALITY=720p` is set.

## What would have to change

| Piece | Today (Mac mini) | In the cloud |
|---|---|---|
| Launch | launchd agent + `caffeinate` | systemd unit (`Restart=always`) or a container with a restart policy |
| Browser | system Chrome (`RADIO_PLAYOUT_CHROME=system`) | Playwright's Chromium, as in `Dockerfile.dev`; needs `--shm-size=1g` in Docker |
| Programme hours | `autoair.mjs` produces the hour on the Mac, with Kokoro TTS running locally | either run Kokoro on the server (more CPU and RAM), or keep producing on the Mac and copy the finished hour folder up; the second keeps the server small |
| Auto-air timer | launchd calendar job (`install-autoair.sh`) | a systemd timer; `autoair.mjs` pauses the 24/7 radio with `launchctl`, which would need a Linux branch |
| Secrets | `~/.scoopfeeds-radio.env`, mode 600 | the same file on the server, mode 600. Moving keys to a new host is stop-list item 2 (DrJ) |
| Alerts | Mac notification + email | email only (`RADIO_ALERT_EMAIL` + `SMTP_*`) |

Running the playout on the existing ScoopFeeds VPS is **not** recommended: one 1080p x264 encode plus Chromium would
compete with the web app, worker and database for CPU. A separate small server keeps a radio problem from touching
the site. Either way, a new server or a change to the VPS is stop-list item 2 (and item 3 if it costs more than 25%).

## Sizing (UNVERIFIED estimates)

- **CPU**: one 1080p30 libx264 `veryfast` encode at 4.5 Mbps is roughly 1.5 to 2.5 cores; headless Chromium
  screencasting the radio page about 1 core; the copy-only relays almost nothing. Estimate **4 dedicated vCPU**
  (shared vCPU risks dropped frames when a neighbour is busy). 720p would fit in fewer.
- **RAM**: about 2 to 3 GB for Chromium + ffmpeg + Node. Estimate **8 GB** to leave room. Add 4 GB or more if Kokoro
  TTS also runs there.
- **Disk**: 40 GB is enough for the code, music library, films and a day of programme folders.
- **Outbound traffic**: each output is about 4.6 Mbps at 1080p (video 4.5 + audio 0.128, plus framing), which is
  about **1.5 TB per output per month** around the clock. YouTube + X is about **3 TB a month**; 720p roughly halves it.
- **Inbound**: small (music and films uploaded once, programme folders if produced on the Mac).

## Monthly cost (UNVERIFIED, list prices from memory, before tax)

| Option | What it is | Rough monthly cost | Notes |
|---|---|---|---|
| Budget dedicated-vCPU VPS (e.g. Hetzner CCX-class, 4 dedicated vCPU / 16 GB) | 4 dedicated vCPU, generous included traffic | **about $30 to $45** | traffic included in the plan covers 3 TB; EU locations add latency to US ingest, usually harmless for RTMP |
| Mainstream cloud VPS (e.g. DigitalOcean CPU-optimised 4 vCPU / 8 GB) | 4 dedicated vCPU, ~5 TB transfer included | **about $85 to $100** | US regions close to YouTube/X ingest |
| Hyperscaler VM (e.g. AWS c6i.xlarge on demand) | 4 vCPU / 8 GB | **about $125 for the VM + about $270 for 3 TB of egress = about $400** | egress pricing makes this the most expensive; reserved or savings plans lower the VM part only |

Against today's ScoopFeeds hosting, even the budget option may be more than a 25% increase in monthly hosting spend,
which makes it stop-list item 3 as well as item 2. That comparison needs the current hosting bill, which this paper
does not have (UNVERIFIED).

## A middle path worth considering

Keep the Mac mini as the primary playout and use a cloud server only as a **standby**: the same image, idle, started
by hand (or by the stream watch alert) when the Mac is down for long. Billed hourly while running, it costs a few
dollars a month instead of the full figure. It needs the hour folders and music kept in sync, and a decision on who
presses the switch.

## Decision DrJ would need to make

1. Whether to move off the Mac at all, or keep it with a standby (above).
2. Which provider and region (cost vs. US latency).
3. Where programme hours are produced (on the server with Kokoro, or on the Mac and copied up).
4. Approving the new server and the move of the stream keys (stop-list items 2 and 3).

Until then the Mac mini stays the playout host.
