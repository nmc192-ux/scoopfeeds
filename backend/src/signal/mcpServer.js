/**
 * mcpServer — agent-facing MCP transport for the Signal Service (stdio).
 *
 * Thin wrapper: every tool calls the SAME service.js function the HTTP routes use, so the
 * returned shapes are identical by construction. READ-ONLY — no tool writes, mutates, or
 * deletes anything. Uses the low-level Server + request-handler API (stable, JSON-Schema tool
 * definitions) so it isn't coupled to a specific zod/high-level-API version.
 */
import "../config/env.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as service from "./service.js";

const HONESTY = "READ-ONLY. Credibility honesty rule: an unscored source returns " +
  "credibility_score: null and credibility_status: \"unscored\" — never 0.0. Unscored ≠ " +
  "low-scored; do not treat a null score as zero credibility.";

const TOOLS = [
  {
    name: "scoopfeeds_health",
    description: `Service + scorer health: status, db_connected, scorer_version, scored_source_count, total_source_count, served_at. ${HONESTY}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "scoopfeeds_list_sources",
    description: `List every source with its per-source credibility: source_id, name, credibility_score|null, credibility_status, credibility_version. ${HONESTY}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "scoopfeeds_query_articles",
    description: `Recency-ordered article window. Returns { window, count, next_offset, articles[] }; each article carries its source's credibility. ${HONESTY}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        window:        { type: "string", description: 'Lookback window, e.g. "48h", "7d". Default 48h.' },
        limit:         { type: "integer", minimum: 1, description: "Page size (capped server-side)." },
        offset:        { type: "integer", minimum: 0, description: "Pagination offset." },
        min_published: { type: "string", description: "ISO-8601 or ms-epoch lower bound (overrides window)." },
        max_published: { type: "string", description: "ISO-8601 or ms-epoch upper bound." },
      },
    },
  },
  {
    name: "scoopfeeds_get_article",
    description: `Fetch a single article by id (same shape as the article rows in scoopfeeds_query_articles). ${HONESTY}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["article_id"],
      properties: { article_id: { type: "string", description: "The article_id." } },
    },
  },
];

function runTool(name, args = {}) {
  switch (name) {
    case "scoopfeeds_health":        return service.getHealth();
    case "scoopfeeds_list_sources":  return service.getSources();
    case "scoopfeeds_query_articles":return service.getArticles(args);
    case "scoopfeeds_get_article":   return service.getArticleById(args.article_id);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "scoopfeeds-signal", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const result = runTool(name, args);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[signal] read-only MCP server ready on stdio");
