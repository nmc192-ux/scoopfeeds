/**
 * Startup wrapper — loads env files before server.js is evaluated.
 * Hostinger (and local dev) can still run: node backend/start.js
 */
import { loadEnv } from "./src/config/env.js";

const { inRepoCount, persistentCount, persistentEnv } = loadEnv();
if (inRepoCount || persistentCount) {
  console.log(
    `[start] env loaded: ${inRepoCount} from backend/.env, ` +
    `${persistentCount} from ${persistentEnv}`
  );
}

// Dynamic import ensures env vars are set before server.js (and all its
// transitive imports) are evaluated.
await import("./server.js");
