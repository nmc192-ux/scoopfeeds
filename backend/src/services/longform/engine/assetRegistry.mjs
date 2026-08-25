// Rights-clean asset registries — personality cutouts and landmarks (#82).
//
// Modelled on the genscene library, and it amortizes the same way: one
// rights-clean portrait per personality (or one landmark shot), registered
// once with its provenance, reused across every film. The manifest tracks
// `uses`; credits-per-placement falling is the argument for the library.
//
// THE LICENSE FIELD IS THE GATE. An entry cannot be registered without a
// recognised license, because personality photos are the most-litigated
// asset class on the internet and a channel strike arrives months after the
// mistake. The allowlist is deliberately short:
//
//   public-domain   — US federal works (White House, Congress, State, DVIDS,
//                     NASA), and anything with an explicit PD dedication
//   cc-by / cc-by-sa — Wikimedia Commons etc.; attribution REQUIRED, so
//                     `author` and `sourceUrl` become mandatory
//   handout         — agency/press handout, used within its terms
//
// Getty/AP/agency editorial licenses are structurally absent — that is the
// point, not an oversight. If DrJ ever buys a license, the allowlist grows
// by a deliberate commit, not by a looser string.
//
// Registries live per REPO (assets/, beside genscenes), not per project —
// a cutout of a senator serves every film that senator appears in. Files
// referenced must exist at registration; nothing registers a promise.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

export const LICENSES = new Set(["public-domain", "cc-by", "cc-by-sa", "handout"]);
const ATTRIBUTION_REQUIRED = new Set(["cc-by", "cc-by-sa"]);
export const KINDS = new Set(["cutout", "landmark", "flag"]);

/** Path to a registry manifest. `root` is the skill's assets dir. */
const manifestPath = (root, kind) => path.join(root, "evidence-assets", `${kind}s.json`);

export function loadRegistry(root, kind) {
  if (!KINDS.has(kind)) throw new Error(`assetRegistry: unknown kind "${kind}" (${[...KINDS].join(", ")})`);
  const f = manifestPath(root, kind);
  if (!existsSync(f)) return { kind, entries: {} };
  return JSON.parse(readFileSync(f, "utf8"));
}

/**
 * Validate one entry. Returns problems, empty when clean. Reject, never
 * repair — the same posture as validateGeo and validateParallax.
 */
export function validateEntry(entry, { root } = {}) {
  const errs = [];
  for (const f of ["key", "subject", "file", "license", "sourceUrl"]) {
    if (!entry?.[f]) errs.push(`missing "${f}"`);
  }
  if (entry?.license && !LICENSES.has(entry.license)) {
    errs.push(`license "${entry.license}" is not in the allowlist (${[...LICENSES].join(", ")}) — `
      + `a paid editorial license is added by a deliberate commit, not a looser string`);
  }
  if (entry?.license && ATTRIBUTION_REQUIRED.has(entry.license) && !entry.author) {
    errs.push(`license "${entry.license}" requires attribution — "author" is mandatory`);
  }
  if (entry?.key && !/^[A-Z][A-Z0-9_]*$/.test(entry.key)) {
    errs.push(`key "${entry.key}" must be SCREAMING_SNAKE (it is referenced from storyboards)`);
  }
  if (root && entry?.file) {
    const p = path.isAbsolute(entry.file) ? entry.file : path.join(root, "evidence-assets", entry.file);
    if (!existsSync(p)) errs.push(`file does not exist: ${p} — nothing registers a promise`);
  }
  return errs;
}

/**
 * Register an entry (or refuse). Writes the manifest and returns the entry.
 * Re-registering an existing key requires `overwrite: true` — a silent
 * replace is how a rights-clean file gets swapped for an unchecked one.
 */
export function registerAsset(root, kind, entry, { overwrite = false } = {}) {
  const errs = validateEntry(entry, { root });
  if (errs.length) throw new Error(`assetRegistry(${kind}): ${errs.join("; ")}`);
  const reg = loadRegistry(root, kind);
  if (reg.entries[entry.key] && !overwrite) {
    throw new Error(`assetRegistry(${kind}): "${entry.key}" already registered — pass overwrite to replace, deliberately`);
  }
  reg.entries[entry.key] = { ...entry, registeredAt: new Date().toISOString(), uses: reg.entries[entry.key]?.uses ?? 0 };
  mkdirSync(path.dirname(manifestPath(root, kind)), { recursive: true });
  writeFileSync(manifestPath(root, kind), JSON.stringify(reg, null, 2));
  return reg.entries[entry.key];
}

/**
 * Resolve a key for use in a film: returns the absolute file path and bumps
 * `uses`. Throws on an unknown key — a storyboard referencing an
 * unregistered asset must fail at plan time, not in ffmpeg.
 */
export function useAsset(root, kind, key) {
  const reg = loadRegistry(root, kind);
  const e = reg.entries[key];
  if (!e) {
    throw new Error(`assetRegistry(${kind}): "${key}" is not registered. `
      + `Registered: ${Object.keys(reg.entries).join(", ") || "(none)"} — register it with its license first`);
  }
  e.uses = (e.uses || 0) + 1;
  writeFileSync(manifestPath(root, kind), JSON.stringify(reg, null, 2));
  return { ...e, absPath: path.isAbsolute(e.file) ? e.file : path.join(root, "evidence-assets", e.file) };
}

/**
 * The LICENSES.md lines for every registered asset a film used — appended to
 * the project's provenance file in the existing format, so a rights question
 * is answerable without re-deriving anything.
 */
export function licenseLines(entries) {
  return entries.map((e) =>
    `- **${e.key}** (${e.subject}) — ${e.license}${e.author ? `, ${e.author}` : ""} — ${e.sourceUrl}`);
}
