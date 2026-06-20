/**
 * Migration 010: entity_idf.cat_span — category-span per entity key (step 3b-1b).
 *
 * 3b-1 found the residual over-merge is bridged by HUB entities that are document-rare (high IDF)
 * but appear across many article CATEGORIES (e.g. Q131364 spanned 8 categories). Document-frequency
 * rarity ≠ discriminativeness. cat_span = # distinct article categories the key appears in over the
 * IDF window; the matcher excludes/﻿down-weights high-span hubs so they can't form a cross-category
 * core. Populated by the same windowed-IDF recompute. Additive column; nothing reads it unless the
 * entity gate is on.
 */

export const id = "010_entity_idf_catspan";

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(entity_idf)").all();
  if (!cols.some((c) => c.name === "cat_span")) {
    db.exec("ALTER TABLE entity_idf ADD COLUMN cat_span INTEGER NOT NULL DEFAULT 1");
  }
}
