import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_PERSISTENT_ENV = path.join(os.homedir() || "", ".scoopfeeds.env");

let loaded = false;
let cachedResult = null;

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return 0;

  let count = 0;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = value;
      count++;
    }
  }

  return count;
}

export function loadEnv() {
  if (loaded) return cachedResult;

  const inRepoEnv = path.join(BACKEND_ROOT, ".env");
  const persistentEnv = process.env.SCOOP_SECRETS_FILE || DEFAULT_PERSISTENT_ENV;

  const inRepoCount = loadEnvFile(inRepoEnv);
  const persistentCount = loadEnvFile(persistentEnv);

  cachedResult = {
    inRepoEnv,
    inRepoCount,
    persistentEnv,
    persistentCount,
  };
  loaded = true;

  return cachedResult;
}

export const envLoadResult = loadEnv();
