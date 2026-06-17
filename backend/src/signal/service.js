/**
 * service — the four internal operations the contract defines, returning final contract
 * shapes. BOTH transports (HTTP routes, MCP tools) call exactly these, so their outputs are
 * identical by construction. Thin composition of readLayer (DB) + contract (shaping); no
 * business/editorial logic, no writes.
 */
import * as read from "./readLayer.js";
import * as shape from "./contract.js";

export function getHealth() {
  return shape.publicHealth(read.health());
}

export function getSources() {
  return read.listSources().map(shape.publicSource);
}

export function getArticles(params = {}) {
  return shape.publicArticlesPage(read.queryArticles(params));
}

export function getArticleById(id) {
  const row = read.getArticle(id);
  return row ? shape.publicArticle(row) : null;
}
