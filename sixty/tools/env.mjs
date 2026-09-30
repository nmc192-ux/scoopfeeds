// Shared environment for every 60 · tool. Runs on the Mac mini, never in prod.
// Must be imported BEFORE any backend module: the backend reads process.env at import time.
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const HOME = process.env.SIXTY_HOME || path.join(os.homedir(), "sixty");
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BACKEND = path.join(REPO, "backend");

const set = (k, v) => { if (!process.env[k]) process.env[k] = v; };
set("SCOOP_PERSISTENT_DATA_DIR", path.join(HOME, "data"));          // music-library lives here
set("VIDEO_TTS_PROVIDER", "kokoro");
set("VIDEO_TTS_KOKORO_URL", "http://127.0.0.1:8880");               // ~/sixty/kokoro-start.sh, same v0.9.0 as prod
set("VIDEO_TTS_KOKORO_VOICE", "bm_george");
set("VIDEO_TTS_CACHE_DIR", path.join(HOME, "tts-cache"));
set("SHOT_ENGINE_PYTHON", path.join(HOME, "shotengine/bin/python"));
set("LOG_LEVEL", "warn");
// Never let a tool see an API key: 60 · runs on the Claude subscription only (brief, Billing).
delete process.env.ANTHROPIC_API_KEY;

export const W = 1080, H = 1920, FPS = 24, FILM_SECS = 60.0;
