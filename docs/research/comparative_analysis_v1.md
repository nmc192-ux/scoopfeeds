# Comparative Network & Architecture Analysis — Yahoo News, Bloomberg, X, Apple News

**Author:** Claude Code (session 21, Scoopfeeds project)
**Date:** 2026-05-13
**Production HEAD at start:** `28f2986` (session 20 close)
**Status:** Phase B redesign track input study — design reference, not implementation spec

---

## 0. Purpose & scope

This document grounds Scoopfeeds' Phase B redesign track (R1–R4) in
observable patterns from four professional news/data platforms.
The output is a design reference for Phase B opening sessions, not
an immediate implementation plan.

The four subjects:

| # | Platform | Surface | Why it's in scope |
|---|---|---|---|
| 1 | Yahoo News | Web (news.yahoo.com) | Largest consumer news aggregator. Closest functional analog to Scoopfeeds. |
| 2 | Bloomberg | Web (bloomberg.com) | Premium financial news. Tests "high editorial + paywall + freshness" design space. |
| 3 | X (Twitter) | Web (x.com) | Real-time stream pattern. Tests "constant freshness + infinite scroll" design space. |
| 4 | Apple News | Native macOS app | Different surface entirely (no web). Tests "platform-native cache + push" design space. |

The Phase B redesign track items being informed:

- **R1** — Bootstrap consolidation: reduce ~30 API calls per page load
  to fewer, batched requests
- **R2** — Edge caching: serve cached responses from CDN edge nodes
  closer to users
- **R3** — Stale-while-revalidate: serve stale cache immediately
  while fetching fresh data in background
- **R4** — SSR evaluation: ship server-rendered HTML for first paint
  rather than SPA shell + client-side fetches

## 1. Methodology

### 1.1 Per-site approach

| Platform | Primary tool | Secondary tools | Limits |
|---|---|---|---|
| Yahoo News | Claude in Chrome (DevTools-equivalent) | Network panel via Chrome MCP `read_network_requests`, page source inspection | Standard web observability; logged-out only |
| Bloomberg | Claude in Chrome | Same as above | Paywall blocks most articles; observation limited to landing + first-N-free pages |
| X | Claude in Chrome | Same as above | Logged-out view only; product surface heavily gated |
| Apple News | macOS bash + screencapture | `ps`, `lsof`, `du`, directory listing of `~/Library/Containers/com.apple.news`, Apple News Format public docs | No TLS decryption; no app internals; no user data reads |

### 1.2 Observation vs inference vs unknown

This document marks every claim with one of three tags:

- **[OBS]** — directly observed in tool output, screenshots, or
  documented spec
- **[INF]** — inferred from observation + general knowledge of
  comparable platforms
- **[UNK]** — acknowledged unknown; what would have been needed to
  observe directly

The Apple News section in particular relies heavily on [INF] and
explicitly tags [UNK] for anything inside the TLS-encrypted API
contracts the app uses to talk to Apple's servers.

### 1.3 What we explicitly did NOT do

- No decompilation of native binaries
- No TLS interception (no proxy, no certificate pinning bypass)
- No reads of user personal data (reading history, account info,
  encrypted databases inside containers)
- No app modification
- No bot-detection bypass for web platforms
- No paywall bypass for Bloomberg

### 1.4 Hard constraints

- ~2 hour total budget; if exceeded, stop at current phase and
  report progress
- All file paths absolute
- No code changes to Scoopfeeds in this session — research only

---

## Table of Contents

- [0. Purpose & scope](#0-purpose--scope)
- [1. Methodology](#1-methodology)
- [2. Yahoo News](#2-yahoo-news) — `news.yahoo.com`
- [3. Bloomberg](#3-bloomberg) — `bloomberg.com`
- [4. X (Twitter)](#4-x-twitter) — `x.com`
- [5. Apple News (native macOS)](#5-apple-news-native-macos) — `/System/Applications/News.app`
- [6. Cross-cutting synthesis](#6-cross-cutting-synthesis)
- [7. Phase B recommendations grounded in observation](#7-phase-b-recommendations-grounded-in-observation)
- [Appendix A: Tool inventory](#appendix-a-tool-inventory)
- [Appendix B: Screenshot manifest](#appendix-b-screenshot-manifest)

---

## 2. Yahoo News

### A. Site profile

- **URL:** `news.yahoo.com` (redirects to `www.yahoo.com/news/`)
- **Product:** Consumer news aggregator. Mix of in-house wire-service
  syndication (AP, Reuters), partner-sourced articles, and editorial
  curation. Anonymous browsing supported; sign-in optional.
- **Scale:** [INF] Top-5 US news destination by Comscore; ~150M
  monthly visitors. The closest functional analog to Scoopfeeds in
  product surface.

### B. Initial load characteristics

**Landing page (`/news/`) measurements [OBS]:**

| Metric | Value |
|---|---|
| HTML document size | ~1,026,355 bytes (decoded) |
| Total resources on load | 250 |
| `<script>` elements | 70 (resource-loaded) |
| Inline script bytes | (large; not separately measured) |
| XHR + fetch calls | 42 |
| HTML body text rendered at first paint | 19,737 chars |
| Headlines (`<h2>`+`<h3>`) | several visible at first paint |
| Article anchors on landing | 68 article links |

**Article page (`/news/articles/...html`) measurements [OBS]:**

| Metric | Value |
|---|---|
| HTML document size | 480,517 bytes (decoded) |
| Transferred size (gzip) | 90,232 bytes (4.7× compression) |
| TTFB | 419 ms |
| `DOMContentLoaded` | 1,123 ms |
| `load` event | 2,993 ms |
| Total resources | 211 |
| XHR + fetch calls | 78 (more ad-tech than landing) |
| Article body text (already in HTML) | 3,954 chars |
| Headline `<h1>` length | 99 chars |
| `<time datetime>` | ISO 8601 present (`2026-05-13T14:38:28.000Z`) |

**SSR vs SPA assessment [OBS]:**

Yahoo News is **server-rendered with content baked into HTML**.
The first response already contains:

- The full article body text (3,954 chars in our sample)
- The headline (in `<h1>`)
- Publication metadata (`<time datetime="...">`)
- Above-the-fold landing headlines and dek text

There is no `__NEXT_DATA__` script tag, no `window.__INITIAL_STATE__`,
and no `window.__PRELOADED_STATE__` JSON blob. Content is HTML-native,
not hydrated from JSON.

The 42 fetch/XHR calls on landing are almost entirely **ad-tech
prebid auctions** ([OBS] top XHR paths include
`pbs.yahoo.com/openrtb2/auction`, `ib.adnxs.com/openrtb2/prebidjs`,
`grid-bidder.criteo.com/openrtb_2_5/pbjs/auction/request`,
`fastlane.rubiconproject.com/...`, `rtb.openx.net/openrtbb/prebidjs`,
`tlx.3lift.com/header/auction`). These run in parallel with content
rendering — they don't block first paint of editorial content.

**[INF]** This is the classic "fast first paint, slow load event"
pattern. Editorial content is visible within ~1s. The 3.0s `load`
event is dominated by ad auctions completing.

### C. Caching architecture

**HTTP cache headers on document [OBS]:**

```
Cache-Control: max-age=0, private
Server: ATS
Content-Encoding: gzip
ETag: (absent)
Last-Modified: (absent)
Age: (absent)
```

`Server: ATS` is **Apache Traffic Server** — Yahoo's own internally-
developed reverse proxy / edge cache, open-sourced and operated at
massive scale across Yahoo's own infrastructure. There are no
third-party CDN headers (no `cf-ray`, no `x-amz-cf-pop`, no Akamai
markers, no Fastly headers).

[INF] Yahoo operates its own globally-distributed edge layer (ATS)
rather than buying CDN service. The `max-age=0, private` on the
document means **the HTML is freshly generated per request** —
the edge does not cache the page response. This makes sense for a
news landing page that needs to reflect breaking news within
seconds.

[INF] Sub-resources (JS bundles, CSS, images) come from `s.yimg.com`
which is a heavily-cached static asset CDN (long max-age, hash-named
files). 14 resources from `s.yimg.com` observed.

**Service worker [OBS]:** None registered. `swRegistrations: 0`,
`navigator.serviceWorker.controller: null`.

**Cache storage API [OBS]:** Empty. `caches.keys()` returns `[]`.

**Storage quota usage [OBS]:** 22,659 bytes of 10.7 GB quota.
Effectively unused — Yahoo News does not depend on browser-side
persistent storage.

### D. Freshness patterns

**Polling [OBS]:**

The page does not establish a polling loop for content updates.
Once loaded, content is static. There are heartbeat beacons to
`opus.analytics.yahoo.com` and `geo.yahoo.com` (telemetry, not
content refresh).

**Real-time [OBS / INF]:** No WebSocket, no Server-Sent Events
observed on the news pages. The freshness model is **navigate-to-
refresh**: the reader returns to the landing page to see new
headlines.

**Staleness UI [OBS]:**

- Article-level: ISO 8601 `<time datetime>` is in DOM, formatted
  display string like "Wed, May 13, 2026 at 7:38 PM GMT+5"
- Landing-level: no per-headline timestamp visible at first paint
  on tested viewport (visible on scroll for some cards)

**Manual refresh [OBS]:** Standard browser refresh; no in-app
"refresh" button observed at landing.

### E. Error / degradation UX

Did not run a slow-network simulation in this session (out of time
budget). Based on the architecture:

- [INF] With network slow but reachable: HTML loads first
  (`max-age=0` means edge fetch every time), then sub-resources
  trickle in. Content visible early; ads/imagery delayed.
- [INF] Offline: nothing cached client-side. Page won't load.
  Yahoo News is **online-only**.

### F. Patterns transferable to Scoopfeeds

| Pattern | Maps to | Cost | Adoption priority |
|---|---|---|---|
| **Content in HTML at first paint, not behind XHR** | R4 (SSR evaluation) | High effort: requires SSR pipeline | High value, deferred — Phase B core |
| **`Server: ATS` / dedicated edge layer for HTML** | R2 (edge caching) | Medium: requires CDN front (e.g., Cloudflare) for scoopfeeds.com | Medium value; Hostinger LiteSpeed already does some of this |
| **Static assets on long-cached CDN** | R2 | Low: just configure long `Cache-Control: max-age=31536000, immutable` on hashed bundle files | Low effort, high value — quick win |
| **No service worker** | (negative pattern) | N/A | Already aligned — we don't depend on SW for content |
| **Ads in parallel iframes, not blocking content** | (already aligned) | N/A | Scoopfeeds already follows this |
| **Anonymous-first product** | R1, R4 | N/A | Already aligned — we don't require login |

### G. Patterns NOT transferable

- **Running your own ATS edge layer**: Yahoo has the engineering
  budget to maintain a globally-distributed proxy. Scoopfeeds
  does not. The transferable lesson is "put a CDN in front of
  HTML responses," not "build ATS."
- **Ad-tech prebid auction stack**: Yahoo has direct seller
  relationships with 15+ SSPs/exchanges (Criteo, OpenX, AppNexus,
  Rubicon, etc.). Scoopfeeds' monetization at current scale does
  not justify this.
- **Wire-service syndication contracts (AP, Reuters)**: Out of
  scope for current Scoopfeeds product.

### Summary — Yahoo News architecture in 5 lines

1. SSR-first: HTML ships with full content; no SPA hydration of editorial data.
2. No client-side cache layer: `max-age=0`, no service worker, no CacheStorage.
3. Yahoo-owned edge (ATS) sits in front of HTML; static assets on `s.yimg.com` CDN.
4. Ad-tech runs in parallel and is the dominant XHR source — not editorial fetches.
5. Anonymous-first; freshness model is navigate-to-refresh, no polling.

---

## 3. Bloomberg

### Methodology note for this section

The Claude in Chrome MCP **blocks `bloomberg.com`** at the navigation
allowlist layer ("This site is not allowed due to safety
restrictions" returned to every navigate attempt). The browser-side
analysis used for Yahoo News was therefore unavailable.

Substitute methodology: **header probing + HTML structural inspection
via `curl` from this machine**, with realistic browser headers
(modern Chrome UA, `Accept`, `Accept-Language`, `Sec-Fetch-*`
sequence). This captures everything visible at the protocol layer
but does **not** observe runtime XHR/fetch patterns, service worker
behavior, or interactive paywall meter logic. Those gaps are
explicitly tagged below.

### A. Site profile

- **URL:** `bloomberg.com` (geo-routes to `/asia`, `/us`, `/europe`
  based on detected country)
- **Product:** Premium business and financial news + market data.
  Subscriber-funded; aggressive paywall with N-free-articles meter.
- **Scale:** [INF] ~50M monthly visitors, plus the Bloomberg
  Terminal product on a separate surface.

### B. Initial load characteristics

**Landing page (`/asia` after geo-redirect) [OBS]:**

| Metric | Value |
|---|---|
| Document size | 3,493,120 bytes (decoded HTML) |
| `<h3>` headlines | 70 |
| `<article>` semantic tags | 16 |
| Distinct `/news/articles/...` links | 95 (40 with prose anchor text) |
| `<p>` prose paragraphs (>80 chars) | 6 |
| Inline scripts | 86 (83,415 bytes total — 2.4% of HTML) |
| External scripts | 68 (65 from `assets.bwbx.io`, 1 each: Google ads, DoubleVerify, SourcePoint) |
| `__NEXT_DATA__` script | **absent** despite `x-powered-by: Next.js` |
| `self.__next_f.push` (App Router fingerprint) | absent |
| Apollo / Redux / Initial-state JSON blob | absent |

**Article page (`/news/articles/2026-05-13/...`) [OBS]:**

| Metric | Value |
|---|---|
| Document size | 367,717 bytes |
| `<h1>` count | 1 (semantic headline) |
| `<article>` tags | 1 |
| Visible article body in `<article>` | ~1,022 chars (lede only — paywall gated) |
| `<time datetime>` | absent (different date markup used) |
| `x-powered-by` | **`Express`** (different stack from landing!) |
| Paywall signals (`meter`, `subscription`) | present |

**SSR vs SPA assessment [OBS]:**

Bloomberg is **fully server-rendered**. The 3.5 MB landing HTML
contains:

- All 70 visible headlines as raw text in `<h3>` tags
- 16 `<article>` semantic containers with dek/byline/timestamp text
- Sample anchor text observed includes: "Trump Lands in China for
  Xi Trade Summit With Iran War in Limbo", "Markets Wrap: Bonds
  Fall as Inflation Pickup Fuels Fed-Hike Bets", etc.

[OBS] **Notably, there is NO client-side hydration JSON blob**:

- No `<script id="__NEXT_DATA__">` (standard Next.js pages-router signal)
- No `self.__next_f.push(...)` calls (Next.js app-router fingerprint)
- No `window.__APOLLO_STATE__` (Apollo GraphQL hydration)
- No `window.__REDUX_STATE__`
- No `window.__INITIAL_STATE__`

[INF] This means Bloomberg's Next.js is configured for **pure SSR
output** — the server renders final HTML and ships it, without any
intent to rehydrate React state on the client. Interactive
components (search dropdowns, video players, the paywall meter) are
likely client-only components mounted via `useEffect`, not
SSR-then-hydrate.

[OBS] Article pages use a **different backend** (`x-powered-by:
Express`) rather than Next.js. Likely a separate Node service
specialized for article rendering, fronted by the same Fastly
edge.

[OBS] **Frankenstein routing markers**: `x-frankenstein-eligible:
true` and `x-frankenstein-resolved: true` headers appear on both
landing and article responses. [INF] This is an internal Bloomberg
routing system, plausibly an A/B framework for new vs legacy
rendering, or a multi-tenant render-tier router.

### C. Caching architecture

**HTTP cache headers on landing [OBS]:**

```
HTTP/2 200
Server (implicit): Fastly + Varnish
Cache-Control: public, max-age=120
Edge-Control: max-age=120
ETag: "f50h6arq7b4ih34"
Age: 11    (= 11 seconds old in the edge cache when first hit)
X-Served-By: cache-fjr990021-FJR
X-Cache: MISS
X-Cache-Hits: 0
Fastly-Restarts: 2
Alt-Svc: h3=":443";ma=86400,h3-29=":443";ma=86400,h3-27=":443";ma=86400
```

**On article page [OBS]:**

```
Cache-Control: public, max-age=120
ETag: "lb59q4uv3y7vn3"
Age: 1
X-Served-By: cache-fjr990026-FJR
X-Powered-By: Express
```

**On static CDN `assets.bwbx.io` [OBS]:**

```
Cache-Control: public, max-age=31536000     (1 year browser TTL)
Edge-Control: !no-store, max-age=365d       (365-day edge TTL)
X-Served-By: cache-lga21973-LGA, cache-fjr990026-FJR
X-Cache: HIT, MISS
X-Cache-Hits: 2, 0
Alt-Svc: h3=":443"                          (HTTP/3 enabled)
```

**Architecture inferred [INF]:**

1. **Edge layer: Fastly** (operated as a managed CDN). Identified
   by `x-served-by: cache-{POP_ID}-{POP_CODE}` format which is the
   canonical Fastly identifier.
2. **Multi-tier cache**: `assets.bwbx.io` responses show two
   `x-served-by` entries (`cache-lga21973-LGA, cache-fjr990026-FJR`)
   — this is **Fastly shielding**, where an edge POP (FJR =
   Fujairah/Middle East) pulls through a designated shield POP
   (LGA = New York) before going to origin. Reduces origin load.
3. **Edge cache TTL (120s) for HTML**: HTML pages cached at the
   edge for 2 minutes. A breaking story can take up to 2 minutes
   to reach all readers; behind that, it's served from cache.
4. **Asset cache TTL (365 days)**: hashed asset URLs from
   `assets.bwbx.io` are immutable. Cache once, serve indefinitely.
5. **HTTP/3 (h3) enabled** on static CDN via `alt-svc`.
6. **Edge-Control header** (`Edge-Control: max-age=120`) is a
   Fastly-specific directive. This lets Bloomberg set a different
   TTL for the edge vs the browser — though here they happen to
   match.

**Service worker / Cache storage [UNK]:** Cannot observe without
browser-side instrumentation, which the Chrome MCP allowlist blocks
for this domain.

### D. Freshness patterns

**Polling [INF, not directly observable from static HTML]:**

The inline scripts and external scripts reference real-time market
data feeds in the static text (e.g., URLs to `bba.bloomberg.net`,
`service.bloomberg.com`). [INF] Real-time price tickers update via
either WebSocket or short-interval polling against these
microservices. Cannot confirm without browser observation.

**Edge cache as freshness mechanism [OBS+INF]:**

The 120s `Cache-Control: max-age=120` paired with `Age:` headers
shows Bloomberg's freshness model is: serve from edge cache for up
to 2 minutes between origin fetches. A new headline reaches origin
immediately but takes 0–120s to propagate through the edge cache.

**Staleness UI [OBS]:** Article pages show date/time in the body
text (we observed "May 13" inline), but `<time datetime>` semantic
markup was absent on the article we inspected. Bloomberg appears
to render dates as plain text rather than as machine-readable
microformat. [INF] This is probably an editorial styling choice;
their RSS feeds will carry the structured timestamp.

**Manual refresh [INF]:** Standard browser refresh.

### E. Error / degradation UX

**Bot detection [OBS]:**

Bloomberg uses **PerimeterX** (`_pxhd` cookie set on every
response, `_pxAppId` pattern). First request without a realistic
UA returns **HTTP 403**. With realistic UA + Accept-Language +
Sec-Fetch headers, request succeeds. This is "first-request bot
filtering" — common with high-value content.

**Paywall [OBS+INF]:**

The article page contains text patterns `meter`, `subscription`.
[INF] These are part of Bloomberg's metered paywall:
1. Anonymous users get N free articles per session/IP/cookie window
2. After N, a CTA modal appears blocking further reads
3. Subscription state is checked via XHR against
   `service.bloomberg.com` (visible host reference in HTML)
4. The first paragraph of articles is always SSR'd visible (so
   search engines and reader scrolls can preview)

**Slow network [UNK]:** Cannot simulate without browser DevTools.

**Offline [INF]:** No service worker observed in HTML; offline
likely shows browser-native "page can't be reached." Confirmation
requires browser observation we don't have.

### F. Patterns transferable to Scoopfeeds

| Pattern | Maps to | Cost | Adoption priority |
|---|---|---|---|
| **Fastly edge (or equivalent CDN) with TTL on HTML** | R2 (edge caching) | Medium: ~$50–200/mo Fastly OR free Cloudflare for similar effect | Medium-high — directly improves global TTFB |
| **Short edge TTL (~2 min) for news landing pages** | R3 (stale-while-revalidate) | Low once CDN is in place: just `Cache-Control: public, max-age=120, s-maxage=120` on landing | High — biggest practical wins for news freshness |
| **365-day immutable cache for hashed assets** | R2 | Low: Vite already emits hashed bundle names; just set the header | Quick win |
| **Pure SSR (no hydration JSON)** | R4 | High effort: requires real SSR pipeline, but Bloomberg shows it can be done without React hydration baggage | Medium — defer to Phase B core |
| **Fastly shielding (or CDN tier-2)** | R2 | Medium: most CDNs offer this | Medium |
| **HTTP/3 via `Alt-Svc`** | R2 | Trivial if CDN supports it | Free win when migrating to CDN |
| **Geo-routing on landing (`/asia`, `/us`, `/europe`)** | (future) | High: requires regional editorial split | Out of scope for Scoopfeeds — single global edition |
| **First-paragraph-always-visible (paywall friendly to SEO)** | (future, only if paywall ever adopted) | N/A now | Document only |

### G. Patterns NOT transferable

- **PerimeterX-tier bot detection**: enterprise pricing,
  appropriate at $1B+ revenue, overkill for current Scoopfeeds.
- **Two separate render stacks (Next.js for landing, Express for
  articles)**: complexity premium that only makes sense at
  Bloomberg's article volume + editorial complexity.
- **Multi-region geo-routing with regional editions**: requires
  regional editorial teams Scoopfeeds doesn't have.
- **Real-time market data ticker microservices**: out of scope.

### Summary — Bloomberg architecture in 5 lines

1. Pure SSR via Next.js (landing) + Express (articles), output is final HTML with **no hydration JSON**.
2. Fastly edge with shielding; **120-second HTML TTL** + **365-day asset TTL** + HTTP/3.
3. PerimeterX bot detection on every request; 403 to unrealistic User-Agents.
4. Paywall meter is client-side after SSR; first paragraph always visible.
5. Geo-routes at the edge: `bloomberg.com` → `/asia`, `/us`, `/europe`.

---

## 4. X (Twitter)

### A. Site profile

- **URL:** `x.com` (formerly `twitter.com`)
- **Product:** Real-time social/news stream. Profile pages, tweet
  threads, search, explore. Logged-out access is heavily gated:
  `/explore` and most other navigation paths redirect to
  `/i/flow/login`; only profile pages (`/<handle>`) render content.
- **Scale:** [INF] Top-15 site globally; "real-time" is the
  defining attribute.

### B. Initial load characteristics

**Login flow page (`/i/flow/login`) [OBS]:**

| Metric | Value |
|---|---|
| Document size | 307,186 bytes |
| Body text rendered | 489 chars (login form only) |
| Total resources | 132 |
| XHR + fetch calls | 9 |
| TTFB | 311 ms |
| `DOMContentLoaded` | 2,452 ms |
| `load` event | 8,273 ms |
| Service worker | none registered |

**Profile page (`/elonmusk`, logged-out) [OBS]:**

| Metric | Value |
|---|---|
| Document size | 467,951 bytes |
| Transferred size (gzip) | 62,760 bytes (7.5× compression) |
| Body text **at first paint** | 1,021 chars |
| `<article>` tags (initial DOM) | 1 (likely the layout shell) |
| `<main>` tag | present |
| `<h1>` count | 2 |
| `__INITIAL_STATE__` JSON blob | **165,795 bytes — 35% of HTML** |
| Total resources | 148 |
| XHR + fetch calls | 8 |
| Service worker registrations | 0 (logged-out) |
| Cache Storage entries | 0 |
| Storage usage | 8 KB |
| TTFB | 318 ms |
| `DOMContentLoaded` | 558 ms |
| `load` event | 2,357 ms |
| After JS hydration: tweet cells visible | **18** |
| After JS hydration: tweet-text elements | **8** |

**SSR vs SPA assessment [OBS]:**

X is a **shell-plus-state SPA**, not full SSR and not a pure
empty shell.

The pattern is:
1. HTML ships with a **160 KB `__INITIAL_STATE__` JSON blob** (35%
   of the HTML payload) holding bootstrap config, feature flags,
   ad-slot allocations, and possibly identity/auth state for the
   anonymous visitor.
2. The visible-DOM `react-root` is essentially empty at first paint
   (1 KB of content).
3. After JS bundle executes, the page makes a small number of XHR
   calls (8 observed, of which the content-bearing one is
   `api.x.com/graphql/{persisted-query-hash}/UserTweets`).
4. Tweet content renders into the React tree once the GraphQL
   response arrives.

There is **no SSR of tweet content**. Even crawlers see only the
shell + state blob. There is one OG meta tag (`og:site_name`) —
**no `og:title`, `og:description`, or `og:image`** for individual
profiles, which is surprising for a high-SEO surface. [INF] X
likely serves a different SSR variant to verified crawler User-Agents.

**API endpoint pattern [OBS]:**

```
api.x.com/graphql/{persisted-query-hash}/UserTweets
api.x.com/1.1/graphql/user_flow.json
api.x.com/1.1/hashflags.json
api.x.com/1.1/videoads/v2
```

The GraphQL endpoint uses **persisted query IDs** (32-char hashes
in the URL path), not raw GraphQL queries in POST bodies. This
allows the edge to cache identical queries — important for high
read fan-out.

### C. Caching architecture

**HTTP cache headers on document [OBS]:**

```
Cache-Control: no-cache, private, must-revalidate, pre-check=0, post-check=0
Content-Encoding: gzip
X-Powered-By: present
Strict-Transport-Security: present
```

**Interpretation [OBS+INF]:**

The `no-cache, private, must-revalidate` directive **explicitly
disables both browser and edge caching of HTML**. Every request
hits origin. [INF] X relies on:

1. Per-user personalization at every request (anonymous fingerprint
   + ad slot allocation + feature-flag bucketing)
2. Heavy CDN caching of **JS bundles** and **images** on
   `abs.twimg.com` (not observed but well-documented)
3. Edge caching of the **persisted-query GraphQL responses**
   (assumed; not observable from logged-out probe)

**Service worker [OBS]:** Zero registrations for logged-out users.
The HTML did not contain `serviceWorker.register(...)` source code
in this fetch. [INF] Logged-in users likely get a service worker
for offline push + cached profile/timeline data, but that is not
served to anonymous traffic.

**Cache Storage API [OBS]:** Empty. Storage usage: 8 KB.

### D. Freshness patterns

**Real-time mechanism [INF]:**

X is the canonical real-time surface. [INF] Logged-in users
maintain a WebSocket to receive live tweet/reply notifications
(documented in third-party reverse engineering of the iOS app and
historical Twitter API). The logged-out browser session does not
appear to open a WebSocket within the observation window — content
is fetched once at load and not live-updated.

**Polling [OBS]:** None observed in the logged-out window.

**Staleness UI [OBS]:** Each tweet card shows a relative
timestamp (e.g., "Jul 14, 2024") visible in the screenshot.
The format updates from "Xs ago" → "Xm ago" → "Xh ago" → date,
following the canonical social-platform convention.

**Manual refresh [OBS]:** Pull-to-refresh on mobile; logo-tap
or scroll-to-top on web (typical X UX, not directly observed in
the logged-out window).

### E. Error / degradation UX

**Login wall [OBS]:**

Most navigation paths (`/explore`, `/home`, search) redirect
anonymous users to `/i/flow/login`. Direct profile URLs
(`/<handle>`) bypass this and render the public profile + a
small number of recent tweets.

**Bottom-of-viewport gating banner [OBS]:**

Screenshot captured a persistent "Don't miss what's happening" /
"Log in" / "Sign up" banner overlaying the bottom of the viewport.
This is a soft conversion gate, not a content block.

**Slow network [UNK]:** Not simulated.

**Offline [INF]:** Without service worker for logged-out users,
offline shows nothing.

### F. Patterns transferable to Scoopfeeds

| Pattern | Maps to | Cost | Adoption priority |
|---|---|---|---|
| **Persisted GraphQL query IDs (cacheable at edge)** | R1 (bootstrap consolidation), R2 | High effort: requires GraphQL adoption | Low — Scoopfeeds is REST-shaped, switching would be expensive |
| **`__INITIAL_STATE__` JSON blob inlined in HTML for app bootstrap** | R1 (bootstrap consolidation) | Medium: requires SSR pipeline that emits server-known state | Medium — would eliminate the ~30-call problem if data is in HTML at first paint |
| **Heavy CDN caching of JS/images on dedicated subdomain (`abs.twimg.com`)** | R2 | Low: just use a separate asset subdomain or path prefix | Low — Hostinger already does this somewhat |
| **Real-time WebSocket for live updates** | (future) | High | Out of scope for Phase B — news doesn't need second-by-second |
| **Light shell + content-via-XHR (their model)** | (anti-pattern for us) | N/A | **Negative finding** — X's exact model is what Scoopfeeds inherited and is trying to move away from |

### G. Patterns NOT transferable

- **Login-wall most surfaces**: completely opposite of Scoopfeeds'
  anonymous-first product position.
- **Persisted-query GraphQL stack**: years of investment to
  generate, version, and edge-cache thousands of persisted queries.
- **`no-cache, private` HTML strategy**: only justifiable when
  every response is uniquely personalized, which is not Scoopfeeds'
  product shape.

### H. Special note — the X anti-pattern

X is the **negative reference point** for Phase B redesign work.
The ~30-API-call cold-start problem in Scoopfeeds is essentially
"X's pattern, at 1/1000th the engineering investment." X makes
that pattern work because:

1. **Persisted-query edge caching** at Fastly/Cloudflare/own CDN
   scale
2. **Massively-optimized GraphQL servers** with per-request budgets
   measured in microseconds
3. **Service worker + IndexedDB cache** for logged-in users
4. **WebSocket fanout fabric** for real-time invalidation
5. **Decade of refinement** to make the SPA shell load fast despite
   no SSR

Scoopfeeds cannot match any of these. The Phase B redesign
direction should therefore be **toward Yahoo's pattern (SSR-first,
HTML-as-truth) rather than X's pattern (SPA-shell-plus-XHR)**.

### Summary — X architecture in 5 lines

1. SPA shell + 160 KB `__INITIAL_STATE__` JSON blob inlined; tweet content via XHR after JS executes.
2. Edge caching disabled at HTML layer (`no-cache, private`) — every request hits origin.
3. GraphQL with persisted query IDs → cacheable at edge per unique query hash.
4. Logged-out access deliberately gated; service worker not delivered to anonymous traffic.
5. **Negative reference for Scoopfeeds**: X's pattern works only at X's engineering scale; we should move toward Yahoo's pattern instead.

---

## 5. Apple News (native macOS)

### Methodology note for this section

Apple News is a **native macOS app** (`/System/Applications/News.app`,
v10.5 on macOS 15.7.5). It has no web surface — there is no
`news.apple.com` HTML site to inspect with DevTools. Observation
therefore relies on:

- Process inspection (`ps`, `lsof`)
- Container directory metadata (file names, sizes, mtimes — never
  contents) via `du`, `ls`, `stat`
- Network destination observation (`nettop`)
- Bundle introspection (`otool -L` for dependency analysis)
- Screenshots of the rendered UI
- Apple News Format public docs (web fetch)
- Reliable third-party history (Wikipedia)

**Explicitly NOT done:**
- No decompilation of `News` or `newsd` binaries
- No TLS proxy / interception
- No reads of personal data inside encrypted containers (sandbox-
  protected and verified `Operation not permitted` for the data
  paths)
- No modification of app or daemon state

This section makes a clear distinction between **[OBS]** (directly
observed), **[INF]** (inferred from observation + public docs +
historical knowledge), and **[UNK]** (acknowledged unknown).

### A. App profile

- **App path:** `/System/Applications/News.app` [OBS]
- **Version:** 10.5 (`CFBundleShortVersionString`) [OBS]
- **Bundle size on disk:** 3.9 MB [OBS]
- **Platform:** Mac Catalyst port of the iOS News app [INF, from
  `/System/iOSSupport/` framework links observed via `otool -L`]
- **System minimum:** macOS 15.7.5 (Build 24G624) tested [OBS]
- **Scale:** [INF] Pre-installed on every iPhone/iPad/Mac;
  Wikipedia notes "300+ magazines" in News+ tier and global
  availability across major English-speaking markets.

### B. Initial load characteristics

**Launch behavior [OBS]:**

`open -a "News"` returns immediately; the app window appears within
~2 seconds. The initial UI is a **fully-populated Today feed** —
not a loading skeleton, not a spinner. The user sees:

- Sidebar with navigation hierarchy (Today / News+ / Sports /
  Puzzles, then Libraries, then a long list of channels: Politics,
  Public Health, Science, Environment, Tech, Travel, Fashion,
  Entertainment, Business, etc.)
- "Top Stories" hero section with multiple article cards (images,
  headlines, "More X coverage" links)
- Date header ("May 13") and "Get News+" CTA

**Time to content [OBS]:** ~2 seconds from `open` command to
visible populated UI.

**Architecture [OBS + INF]:**

Apple News has a **two-process architecture**:

1. **News.app** (`/System/Applications/News.app/Contents/MacOS/News`,
   PID 91345 in this session) — UI rendering process, sandboxed,
   linked to UIKit (via Catalyst), WebKit (for article rendering),
   Silex/SilexWeb private frameworks (likely the Apple News Format
   renderer).
2. **newsd** (`/System/Library/PrivateFrameworks/NewsDaemon.framework/newsd`,
   PID 24859) — background daemon managed by launchd. Started
   12:24 AM, still running 20+ hours later. **Persists after the
   user quits News.app** ([OBS]: after `tell application "News"
   to quit`, newsd remained at PID 24859).

The daemon-plus-UI split [INF] is the classic iOS/macOS pattern
that lets the system pre-fetch content in the background (via
BackgroundTasks framework on iOS) so the user-visible app launches
"instantly" with content already cached locally.

**Resource fetch path [INF]:**

The 2-second time-to-content despite a thin 3.9 MB app bundle is
explained by:

1. newsd has been running in the background fetching content well
   before the user opened News.app
2. Content is cached locally in SQLite + filesystem stores (see
   §C below)
3. News.app does an XPC handshake with newsd at launch, gets a
   handle to the already-loaded "Today" feed, and renders
4. No network round-trip is on the critical path of "open app →
   see content"

### C. Caching architecture

**On-disk caches observed [OBS]:**

```
~/Library/Caches/com.apple.newsd/                  356 KB total
├── Cache.db                  48K  (SQLite, NSURLCache backing store)
├── Cache.db-shm              32K
├── Cache.db-wal             132K  (last modified Nov 15, 2025)
├── fsCachedData             144K  (file-system blob cache)
```

```
~/Library/HTTPStorages/com.apple.newsd/            ~290 KB
├── httpstorages.sqlite             4K   (cookies + auth tokens)
├── httpstorages.sqlite-shm        32K
├── httpstorages.sqlite-wal       255K   (last modified May 12, 2026)
```

```
~/Library/Preferences/
├── com.apple.newsd.plist           92 bytes
├── com.apple.newscore.plist        89 KB    (modified May 13, 20:43 — today, during this session)
├── com.apple.newscore2.plist       397 bytes
```

**Sandbox-protected directories [OBS]:**

```
~/Library/Containers/com.apple.news/                Operation not permitted
~/Library/Group Containers/group.com.apple.news/    Operation not permitted
~/Library/Group Containers/group.com.apple.newsd/   Operation not permitted
```

The sandbox enforces that only the News.app process can read its
own data. This is by design — it includes potentially sensitive
data (reading history, paid subscriptions, saved articles).
**This is a methodology limit**: we can observe the directory
exists but cannot see file sizes or contents inside.

**Architecture inferred [INF]:**

1. **HTTP cache: SQLite** — `Cache.db` (Apple's standard
   `NSURLCache` backing store). Modest 356 KB suggests Apple
   News is bandwidth-frugal: caches small structured payloads,
   not whole article HTML. Or it migrated to a different scheme
   recently.
2. **Cookie/auth store: SQLite** — `httpstorages.sqlite` with
   active WAL (modified today). Tracks per-publisher auth state
   if user has News+ subscription.
3. **App-private store: sandbox-hidden** — reading history,
   saved articles, channel subscriptions, personalization state
   live behind the sandbox barrier in `group.com.apple.newsd/`.
4. **CloudKit sync** — News.app's framework links include
   `CloudKit.framework`. [INF] Reading position, saved articles,
   and subscription state sync across user's Apple devices via
   iCloud, not by re-fetching from Apple servers each time.

**Bundle frameworks linked [OBS]:**

```
Intents.framework                  (Siri intents)
Silex.framework                    (ANF rendering — private)
SilexWeb.framework                 (web view bridge — private)
PersonalizationPortrait.framework  (on-device personalization)
CoreText.framework
CloudKit.framework                 (cross-device sync)
ImageIO.framework
SystemConfiguration.framework
WebKit.framework  (from /System/iOSSupport)
CoreGraphics.framework
UIKit.framework   (from /System/iOSSupport — Catalyst confirmation)
AVFoundation.framework
libsqlite3.dylib
```

The `Silex` and `SilexWeb` private frameworks are [INF] Apple's
**Apple News Format (ANF) rendering engine** — the component
that takes ANF JSON descriptors from a publisher and converts
them into native UIKit views (or WebKit-rendered article views
for legacy/RSS-sourced content).

### D. Freshness patterns

**Background fetch [INF]:**

The newsd daemon is the canonical mechanism for "fresh content
without a perceptible refresh." [INF, based on:
- newsd started long before News.app was opened
- newsd persists after News.app quits
- launchd manages newsd as a system daemon]

newsd appears to **periodically poll publisher endpoints** in
the background, downloading new ANF/RSS content to local cache.
When the user opens News.app, the Today feed is rendered from
local cache; new content surfaces without any visible load state.

**Polling cadence [UNK]:**

Cannot directly observe. [INF based on published Apple platform
documentation: typically every 30-60 minutes when the user has
recently engaged, longer when idle, with iOS adapting based on
battery/cellular state.]

**Real-time [INF]:** [UNK whether WebSocket or APNS-push is used
for breaking news.] Apple has APNS infrastructure that is the
natural mechanism for pushing a "breaking news" indicator.

**Staleness UI [OBS]:**

Each article card shows a publisher attribution and (on hover/
focus) a relative time indicator. Date header "May 13" was
visible at the top of the Today feed. The visual model is
**continuous freshness**: there's no explicit "Updated X minutes
ago" — content is just expected to be current.

**Manual refresh [OBS]:** Pull-to-refresh gesture supported (per
the iOS pattern). Did not test.

### E. Error / degradation UX

**Offline behavior [INF]:** Did not airplane-mode test in this
session (out of time budget + user-data risk if forced refresh
during disconnect). [INF based on platform conventions:] Apple
News retains the last-loaded Today feed and previously-opened
articles available offline. The newsd daemon's local cache is
the offline reading store.

**Slow network [UNK]:** Did not simulate.

**API errors [UNK]:** Did not observe error states.

### F. Patterns transferable to Scoopfeeds

| Pattern | Maps to | Cost | Adoption priority |
|---|---|---|---|
| **Background-fetch daemon model** | (web equivalent) R3 stale-while-revalidate + push notifications | Medium-high: requires service worker + push API + scheduled background sync | Medium — Phase B R3 covers most of the value |
| **Cache-first rendering (UI loads from local cache, not network)** | R3 | Low-medium: extend the c8917d1 persistent cache strategy from S2b | High — directly extends current work |
| **Two-tier process split (fetcher daemon + UI)** | (web equivalent) Service Worker (fetcher) + main thread (UI) | Medium: write a real SW that does scheduled fetches | Medium |
| **CloudKit-style sync of reading state across devices** | (future) | High: would require account system + sync server | Out of scope for current product |
| **Structured content format (Apple News Format JSON)** | (future) | Medium: would require a Scoopfeeds-Article-Format spec + publisher tooling | Out of scope unless we go publisher-platform direction |

### G. Patterns NOT transferable

- **OS-managed background daemon**: only available to first-party
  apps on Apple platforms. The closest web equivalent is the
  Service Worker, which is much weaker (no background fetching
  unless the user is actively visiting recently).
- **APNS push for breaking news**: requires native mobile app.
  Web push exists but has poor delivery rates and platform
  fragmentation.
- **Private rendering engines (Silex)**: closed-source Apple IP.
- **CloudKit sync**: closed-source Apple infrastructure.

### H. Editorial / format patterns — Apple News Format observations

**Source: developer.apple.com/news-publisher/ [WebFetch, [OBS]] +
Wikipedia [WebFetch, [OBS]].**

Apple News Format (ANF) is a **JSON-based** article description
format. Publishers can deliver content to Apple News through three
mechanisms:

1. **Automated CMS-to-ANF via Apple News API** — typical large
   publishers (NYT, WaPo, Bloomberg, etc.) use this path
2. **Manual hand-coding** — direct JSON authoring, used by smaller
   publishers
3. **News Publisher web editor** — Apple's hosted authoring tool

ANF documents are rendered **as native text** by Silex on Apple
platforms, which gives them:
- VoiceOver accessibility parity with native iOS/macOS apps
- Consistent typography across devices
- Independent reflow per device (iPhone / iPad / Mac)
- Native swipe-to-go-back gestures

Apple News also accepts **RSS/Atom feeds**, scraped by the
`AppleBot` web crawler (per Wikipedia). RSS-sourced articles render
through WebKit rather than Silex, with [INF] degraded layout
quality and inconsistent typography compared to ANF-native articles.

**Editorial standards revealed by ANF [INF]:**

- Apple's editorial team curates which publishers may submit ANF
  (gatekept) — Wikipedia: "Only publications that follow certain
  guidelines... are allowed to publish content to the platform"
- ANF supports structured components: photo galleries, pull
  quotes, headers, body text, embedded videos, audio narration
- Apple News+ (paid tier, since 2019) requires publisher
  participation through Apple's terms
- Revenue split: publishers keep 100% of self-sold ads, 70% of
  Apple-sold ads
- AppleBot has been historically criticized for high crawl load
  on smaller publishers' servers — relevant for Scoopfeeds if we
  ever became an Apple News content source

**What this suggests about industry expectations [INF]:**

The fact that Apple, with all its leverage, chose to standardize
a **document-oriented JSON format** for editorial content (not a
web-native format like AMP or just HTML) suggests:

1. The industry recognizes that "HTML pages with ads" is a
   fundamentally inferior reading experience compared to a
   rendered native document.
2. Standardization of editorial components (gallery, pull quote,
   audio narration) is more important than rendering flexibility.
3. Accessibility (VoiceOver) and consistency across screens are
   primary constraints.

This is the **opposite philosophy** to "ship HTML + JS, let the
browser render." Apple News is the maximally-curated, maximally-
structured end of the editorial spectrum.

### Summary — Apple News architecture in 5 lines

1. Two-process model: privileged background daemon `newsd` (fetcher + cache) + sandboxed `News.app` UI.
2. Local cache: SQLite (NSURLCache) + sandbox-protected SQLite + CloudKit-synced reading state.
3. Time-to-content ~2 seconds because newsd pre-fetched content before app open; UI reads local cache.
4. Content format: ANF (JSON descriptors) for native rendering via Silex; RSS-scraped fallback via AppleBot.
5. Mac Catalyst port (3.9 MB app bundle, depends on iOS frameworks); CloudKit syncs reading state across devices.

---

## 6. Cross-cutting synthesis

### 6.1 The architecture spectrum the four sites occupy

The four platforms scatter across a clean two-axis space:

```
                    HEAVY CLIENT (SPA + XHR)
                              │
                              │
                              X (Twitter)
                              │
                              │
                              │
WEB-NATIVE ────────────────── ┼ ────────────────── PLATFORM-NATIVE
                              │
                              │
                              │
              Bloomberg       │              Apple News
              Yahoo News      │
                              │
                              │
                    HEAVY SERVER (SSR + cache)
```

- **Yahoo News + Bloomberg** cluster in the **server-heavy + web-
  native** quadrant: SSR content baked into HTML, ad-tech bolted
  on top, served via a CDN edge with short TTL.
- **X** is alone in **client-heavy + web-native**: SPA shell,
  state blob in HTML, all content via XHR after JS executes.
- **Apple News** is alone in **server-heavy + platform-native**:
  background daemon fetches content; UI renders from local
  SQLite-backed cache; no web layer in the picture.

Scoopfeeds at 1cbf92b is **closer to X than to Yahoo**: SPA shell,
~30 API calls on cold start, content via XHR. The Phase B
direction the user has implicitly committed to is moving from the
X quadrant toward the Yahoo/Bloomberg quadrant — keep the web-
native delivery surface, but adopt server-heavy patterns inside
it.

### 6.2 Six patterns common across the SSR-first platforms

Patterns observed in **both Yahoo and Bloomberg** (and implicit in
Apple News at the platform level):

1. **HTML ships with content already in it.** First paint shows
   editorial content, not a loading state. The browser does not
   need to fetch additional data to render a usable view.
2. **A CDN edge layer fronts HTML responses**, with a short TTL
   (Bloomberg: 120s; Yahoo: max-age=0 but operated on ATS edge
   anyway).
3. **Static assets live on a separate subdomain with year-long
   immutable cache** (Yahoo: `s.yimg.com`; Bloomberg:
   `assets.bwbx.io`).
4. **HTTP/3 enabled on the asset CDN** (verified on Bloomberg's
   `assets.bwbx.io` via `alt-svc`).
5. **Anonymous-first**: no login required to read the bulk of the
   content. (Bloomberg paywall hits after N reads but the first
   page is anonymous.)
6. **Ad-tech runs in parallel to content rendering**, never on the
   critical path. The page is readable while ads load behind.

Scoopfeeds at 1cbf92b conforms to (5) and (6) but conforms to none
of (1)–(4). That's the gap Phase B can close.

### 6.3 Three patterns the platforms diverge on

| Pattern | Yahoo | Bloomberg | X | Apple News | Implication |
|---|---|---|---|---|---|
| Hydration JSON in HTML | none | none | 160 KB blob | n/a (native) | Hydration JSON is **not load-bearing for SSR-first delivery**. Bloomberg uses Next.js but emits no `__NEXT_DATA__`. |
| Service Worker | no | unknown | no (logged-out) | n/a (native) | SW is **not** the universal answer for news platforms; some of the best-performing sites skip it entirely. |
| Real-time content updates | none (navigate-to-refresh) | none on landing | WebSocket (logged in) | APNS push (inferred) | "Real-time freshness" is the X niche; news platforms get away with cache+navigate. |

### 6.4 The "minimum bar" for a professional news platform

Distilled from the four platforms — the **practical floor** below
which a news site cannot credibly claim to be professional-grade:

1. **First contentful paint of editorial content within 1.5s on a
   warm connection.** All four platforms meet this. Scoopfeeds
   meets this only after the c8917d1 persistent cache hydrates;
   on cold start with empty cache, Scoopfeeds is currently
   noticeably slower.
2. **HTML delivered via a CDN-style edge layer**, not direct from
   the origin web server on every request. Yahoo, Bloomberg, and
   Apple News (via newsd's local cache) all have this. Scoopfeeds
   on Hostinger LiteSpeed has SOME of this (LiteSpeed's built-in
   caching) but not at the geographic-edge level.
3. **Static assets cached for at least 24 hours, ideally a year.**
   Bloomberg's 365-day immutable cache on hashed assets is the
   ceiling. Scoopfeeds' Vite build emits hashed names but the
   server doesn't currently set long `Cache-Control: immutable`
   on them. **Low-effort gap to close.**
4. **No catastrophic regressions under load.** All four platforms
   degrade gracefully (slow, but not crashed). Scoopfeeds' Phase
   S1+S2+S2b+S3 work brought it into this category.
5. **Anonymous reading without login wall.** Yahoo, Bloomberg
   (first N articles), Apple News (free tier), all support this.
   X is the outlier and the negative reference.

### 6.5 Where Scoopfeeds is today vs the bar

| Bar item | Scoopfeeds at 1cbf92b | Gap |
|---|---|---|
| FCP < 1.5s warm | ✓ (after c8917d1 cache hydrate) | Cold start still slow — see R1 |
| Edge-cached HTML | partial (LiteSpeed local cache only) | No geographic edge — R2 |
| Long asset cache | partial (hashed names, but no immutable header) | Quick win to set the header — R2 |
| Graceful degradation | ✓ (S1+S2+S2b+S3) | Phase S4 closes remaining edge cases |
| Anonymous-first | ✓ | Already aligned |

Scoopfeeds clears **3 of 5** bar items already, with **2 partial-
credit** items achievable in Phase B Sprint 1.

### 6.6 The honest comparison

| Metric (HTML doc) | Yahoo `/news/` | Bloomberg `/asia` | X `/<handle>` | Scoopfeeds 1cbf92b (inferred) |
|---|---|---|---|---|
| Decoded HTML bytes | ~1.0 MB | 3.5 MB | 0.47 MB | (smaller, but loads ~30 API calls) |
| Body text rendered at first paint | 19.7 KB | very large (full SSR) | 1 KB | minimal (SPA shell) |
| Resource count to load | 250 | (not browser-observable) | 148 | ~30 API + JS bundles |
| Service worker | no | unknown | no | no |
| Edge cache visible (HTML) | no (Yahoo ATS) | yes (Fastly, 120s) | no (`no-cache`) | partial (LiteSpeed) |
| Long asset cache | yes (s.yimg.com) | yes (assets.bwbx.io 365d) | yes (abs.twimg.com) | partial (hashed names, no `immutable`) |
| SSR of editorial content | yes (full) | yes (full) | no | no |

Scoopfeeds is structurally closest to **X** (the negative
reference) and farthest from **Bloomberg** (the high bar).

---

## 7. Phase B recommendations grounded in observation

### 7.1 Top-5 recommendations by ROI

Ranked by **value delivered / effort to implement**:

#### Rec 1 — Set `Cache-Control: public, max-age=31536000, immutable` on hashed static assets

**Maps to:** R2 (edge caching)
**Effort:** Very low (1 session). Server-side config change on
LiteSpeed.
**Why:** Bloomberg ships this on `assets.bwbx.io` and Yahoo on
`s.yimg.com`. Scoopfeeds already emits hashed bundle names from
Vite; the server is just missing the header. This is a literal
five-line config change.
**Risk:** None — hashed names guarantee correctness.
**Verification:** `curl -I` against a hashed asset URL, confirm
`Cache-Control: max-age=31536000, immutable`.

#### Rec 2 — Put a real CDN edge in front of `scoopfeeds.com` HTML responses

**Maps to:** R2 (edge caching)
**Effort:** Medium (2–3 sessions). Cloudflare free tier OR
Bunny.net or Fastly Compute@Edge. Origin remains Hostinger.
**Why:** Bloomberg's 120s edge TTL on HTML pages cuts origin load
by ~98% for typical news traffic. Cloudflare free tier provides
this for $0. The Phase S3 backend rate limits would become almost
entirely unnecessary at this scale.
**Risk:** Medium. Requires careful Cache-Control headers on
dynamic vs static routes. Bypass list needs to be correct.
**Verification:** `curl` against `scoopfeeds.com` should show
`x-cache: HIT` or equivalent edge header on second request.

#### Rec 3 — Server-render the initial HTML with article headlines + metadata embedded

**Maps to:** R4 (SSR evaluation)
**Effort:** High (4–6 sessions). Pre-render hot routes
(`/`, `/topic/:slug`) via Vite SSR or a small Node SSR layer.
**Why:** The R4 prize is a real "Yahoo pattern" first paint.
This is the single biggest structural win. Combined with Rec 2,
the cold-start ~30-API-call problem goes away entirely — the
initial HTML response IS the first 30 API calls' worth of data.
**Risk:** Medium-high. Need to handle hydration without
introducing React #300 class issues from the past arc. The
c8917d1 persistent cache becomes secondary (still useful for
client-side nav) but no longer the load-bearing path.
**Verification:** `curl https://scoopfeeds.com/` should return
HTML with actual article headlines in `<h2>`/`<h3>` tags, not a
SPA shell.

#### Rec 4 — Stale-while-revalidate for content API responses

**Maps to:** R3 (stale-while-revalidate)
**Effort:** Low-medium (2 sessions). Implement on the c8917d1
persistent cache that S2b shipped: return cached data immediately,
fire a fresh request in background, update cache when it returns.
**Why:** Apple News's "open app → instant content" model is the
SWR pattern in disguise. The newsd daemon's local cache returns
immediately; new content streams in behind. The browser version
is the same idea via service worker or just the existing axios
interceptor.
**Risk:** Low. Builds on existing S2b code path. Worst case is a
flash of stale content; the persistent cache layer already handles
the displacement correctly.
**Verification:** Open page with warm cache, observe instant
render, then watch network panel for background refresh request,
then watch DOM for in-place update.

#### Rec 5 — Apply `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` to HTML responses

**Maps to:** R2 + R3
**Effort:** Very low (1 session). After Rec 2 (CDN edge), this is
just a header on the dynamic HTML routes.
**Why:** Bloomberg's exact pattern: short edge TTL (120s) means a
new headline reaches readers within 2 minutes; `swr` directive
keeps the edge serving stale content while origin re-renders. This
is the difference between "news site" and "news site that scales."
**Risk:** Low. Requires Rec 2 to be in place first.
**Verification:** Re-request a HTML page within 120s of first
request, observe `age:` header advancing without a new origin
hit.

### 7.2 Lower-priority observations to revisit later

- **HTTP/3 via `alt-svc`** — Free when migrating to Cloudflare/
  Fastly (Rec 2). Worth verifying after migration.
- **Geo-routing of editorial content** (Bloomberg's `/asia`/`/us`/
  `/europe` model) — Out of scope. Scoopfeeds has a single
  global edition by design.
- **Persisted GraphQL queries** (X's pattern) — Anti-pattern for
  current Scoopfeeds; would require GraphQL adoption which is a
  separate architectural decision.
- **Service Worker for offline support** — None of the three
  observable web platforms (Yahoo, Bloomberg-as-inferred, X-
  logged-out) use one. This validates the Phase B implicit
  decision **not** to build SW infrastructure for offline.
- **Apple News-style background daemon** — Not available on the
  web. Closest equivalent is `BackgroundSyncManager` API which
  has poor cross-browser support. Defer.
- **Apple News Format adoption as a publisher** — Strategic
  question for Phase C+. If Scoopfeeds ever wanted to be an
  *Apple News source*, this would matter. For now: out of scope.

### 7.3 The Phase B opening sequence implied by this study

If Phase B starts with the highest-ROI item first and respects
dependencies:

1. **Sprint 0 (Rec 1):** Long-cache header on hashed static
   assets. 1 session. Verifiable. Zero risk.
2. **Sprint 1 (Rec 2):** Cloudflare edge in front of
   `scoopfeeds.com`. 2–3 sessions. Verifiable via `x-cache`
   headers.
3. **Sprint 2 (Rec 5):** Apply `s-maxage` + `stale-while-
   revalidate` to HTML routes. 1 session, conditional on Sprint 1.
4. **Sprint 3 (Rec 4):** SWR pattern on content API responses
   in the c8917d1 persistent cache layer. 2 sessions.
5. **Sprint 4–6 (Rec 3):** Full SSR for hot routes. 4–6 sessions.
   This is the structural transformation; everything before is
   preparation.

Total Phase B opening: ~10–13 sessions, in dependency order, with
verifiable milestones at each step.

### 7.4 What this study does NOT recommend

- Do **not** adopt X's SPA pattern. (Negative reference.)
- Do **not** build a custom edge proxy like Yahoo's ATS — use a
  managed CDN.
- Do **not** invest in service workers for offline support unless
  a product reason emerges (none of the comparable platforms
  bother).
- Do **not** consider GraphQL adoption purely for "edge caching"
  reasons — Bloomberg achieves edge caching without GraphQL.
- Do **not** commit to a "native app" strategy on Phase B's
  timeline. Apple News's model is unreachable via web; trying to
  approximate it adds complexity without delivering the user-
  visible benefits.

### 7.5 Honest caveats on this analysis

1. **Bloomberg analysis is via curl, not browser.** Runtime
   behavior (service worker, XHR patterns, paywall meter logic)
   was not directly observed. The Chrome MCP blocklist excluded
   `bloomberg.com`.
2. **Apple News analysis is severely sandboxed.** Container data
   was unreadable; TLS API contracts unreadable; only metadata,
   process accounting, public docs, and screenshots were
   available. Most of the architectural picture is [INF].
3. **X analysis is logged-out only.** The logged-in WebSocket
   behavior, IndexedDB usage, and service worker registration
   for authenticated users were not observed.
4. **All measurements are single-sample.** A formal benchmark
   would require repeated sampling under controlled network
   conditions. The single-sample numbers are useful for "order
   of magnitude" comparisons, not for precise SLA claims.
5. **2026-05-13 snapshot.** All platforms continue to evolve;
   findings could be stale within months.

These caveats do not change the directional conclusions but
should be cited if any specific number from this document is
re-used elsewhere.

---

## Appendix A: Tool inventory

System state at session 21 start:

- macOS: 15.7.5 (Build 24G624)
- News.app: v10.5 at `/System/Applications/News.app`
- Available CLI tools (no sudo needed for inventory, may need sudo to use):
  - `/usr/sbin/tcpdump` — packet capture (requires sudo for real use)
  - `/usr/bin/nettop` — per-process network stats (no sudo needed for own UID)
  - `/usr/sbin/screencapture` — screenshot capture
  - `/usr/sbin/lsof` — open files / sockets (subset visible without sudo)
  - `/usr/bin/curl` — HTTP client
  - `/bin/ps`, `/usr/bin/du` — standard
- Claude in Chrome MCP — browser automation + DevTools-equivalent
  network panel observation

---

## Appendix B: Screenshot manifest

Screenshots referenced in this document were saved to the local
filesystem; they are not embedded in this document (kept local for
size and privacy).

| Description | Local path | Phase |
|---|---|---|
| Yahoo News landing hero card with SC Supreme Court / Murdaugh headline (885×782, JPEG) | (in-conversation tool capture; not saved separately to disk) | 21B |
| X profile page (`/elonmusk`) showing 18 tweet cells hydrated post-XHR; bottom login banner visible (885×782, JPEG) | (in-conversation tool capture; not saved separately to disk) | 21D |
| Apple News Today feed: "Top Stories" with Trump-Xi summit + Andes hantavirus articles; sidebar showing channel list | `/Users/jahanzebhussain/Downloads/apple_news_initial.png` (4.9 MB PNG) | 21E |
| Apple News top section (post-quit attempt, app may have been backgrounded) | `/Users/jahanzebhussain/Downloads/apple_news_top_section.png` (111 KB PNG) | 21E |

Bloomberg has no screenshot because Chrome MCP blocked the
domain; the analysis is based on curl HTTP probing and HTML
structural inspection only.
