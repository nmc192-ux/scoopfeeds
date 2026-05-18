// Pinterest API v5 publisher.
//
// Creates a Pin on a specified board. Pinterest is a discovery platform with
// strong long-tail SEO value — pins are indexed by Google and resurface for
// years, unlike Twitter/Bluesky posts. News + analysis pins with good images
// consistently drive low-volume, high-intent traffic.
//
// Required env vars:
//   PINTEREST_ACCESS_TOKEN — OAuth2 bearer token with boards:write + pins:write scope.
//                            Obtain via https://developers.pinterest.com/ by creating
//                            an app, connecting a business account, and running the
//                            OAuth flow. Token is valid indefinitely if the user
//                            doesn't revoke it; refresh using the refresh_token flow.
//   PINTEREST_BOARD_ID     — numeric or string board ID to pin to (e.g. "123456789")
//                            visible in the board's URL: pinterest.com/<user>/<board>/<id>
//
// Optional:
//   PINTEREST_SECTION_ID   — section ID within the board for category-specific pins.
//
// API reference:
//   https://developers.pinterest.com/docs/api/v5/pins-create/

import { logger } from "./logger.js";

// API base URL. Defaults to production; override with PINTEREST_API_BASE_URL
// to route through the Trial-access sandbox at https://api-sandbox.pinterest.com.
const API_BASE = `${process.env.PINTEREST_API_BASE_URL || "https://api.pinterest.com"}/v5`;

const getToken    = () => process.env.PINTEREST_ACCESS_TOKEN || "";
const getBoardId  = () => process.env.PINTEREST_BOARD_ID     || "";
const getSectionId = () => process.env.PINTEREST_SECTION_ID  || "";

export function isPinterestConfigured() {
  return Boolean(getToken() && getBoardId());
}

async function apiCall(path, { method = "POST", body } = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.error_description || text || "unknown";
    const err = new Error(`pinterest ${path} → ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Create a pin with an image sourced from a URL.
// `imageUrl`   — the OG card PNG (1200×630) from /api/cards/og/:id.png.
// `description`— the caption (≤500 chars, Pinterest limit).
// `link`       — the UTM-tagged article URL the pin clicks through to.
// `title`      — short title shown on the pin card (≤100 chars).
export async function postToPinterest({ imageUrl, description, link, title = "" }) {
  if (!isPinterestConfigured()) throw new Error("pinterest not configured");

  const body = {
    board_id: getBoardId(),
    media_source: {
      source_type: "image_url",
      url: imageUrl,
    },
    link,
    title: title.slice(0, 100),
    description: description.slice(0, 500),
    ...(getSectionId() ? { board_section_id: getSectionId() } : {}),
  };

  const json = await apiCall("/pins", { method: "POST", body });

  const pinId = json.id || "";
  const url = pinId ? `https://www.pinterest.com/pin/${pinId}/` : "";

  logger.info(`pinterest: pinned ${pinId}`);
  return { id: pinId, url };
}
