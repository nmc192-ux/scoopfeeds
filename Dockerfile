FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm ci --prefix backend
RUN npm ci --prefix frontend

COPY backend ./backend
COPY frontend ./frontend

RUN npm run build --prefix frontend

FROM node:20-bookworm-slim AS runtime

# SYSTEM FFMPEG. bookworm ships ffmpeg 5.1, which has the `xfade` filter;
# @ffmpeg-installer/ffmpeg (still a dependency, still the fallback) bundles
# linux-x64 4.1.0, and xfade landed in 4.3. videoGenerator.supportsXfade()
# probes for it and silently degrades to hard cuts when absent, so every video
# rendered in this container to date has had no transitions at all.
#
# The keyframe renderer makes that a hard requirement rather than a nicety:
# slides are built as 4-6 KEYFRAME STATES crossfaded together, so without
# xfade there is no motion, only a slideshow of states. Installing it here
# removes the constraint for good instead of routing around it.
#
# getFFmpegPath() resolves `which ffmpeg` BEFORE the bundled binary
# (videoGenerator.js), so this is picked up with no code change.
#
# --no-install-recommends keeps the layer to the codecs actually needed; the
# apt lists are removed in the same RUN so they never reach the image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# THE SHOT ENGINE'S RENDER STEP (docs/briefs/shot-engine-shorts.md, Phase 0
# decision: a Python render step, the engine that rendered the approved sample).
# A venv, not the system site-packages: bookworm's pip refuses to install into
# the system interpreter, and pinning here means the image renders exactly the
# frames the checkpoint samples were judged on. Headless OpenCV (no GUI libs).
# Used only when VIDEO_SHOT_ENGINE_ENABLED=1; shotVideo.js reads the path below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && python3 -m venv /opt/shotengine \
 && /opt/shotengine/bin/pip install --no-cache-dir \
      numpy==2.2.6 pillow==11.3.0 opencv-python-headless==4.12.0.88 \
 && rm -rf /var/lib/apt/lists/*
ENV SHOT_ENGINE_PYTHON=/opt/shotengine/bin/python

ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=build /app/backend /app/backend
COPY --from=build /app/frontend/dist /app/frontend/dist

EXPOSE 3000

CMD ["npm", "run", "start:web"]
