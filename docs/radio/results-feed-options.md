# Paid election-results feeds: options note (#204)

DrJ, 22 Oct 2026: a paid results feed is possible later, **depending on cost**; try free
sources first (see `results-spike-2026-10.md`). This note is research only. **No sign-up,
no request for a quote, no spend.** Every price is **UNVERIFIED**: both vendors sell on
quotes, not public price lists.

## AP Elections API (The Associated Press)

- **What it is:** AP's vote count and AP race calls ("AP declares a winner"), the feed most
  US newsrooms use. AP counts votes through its own stringers in every county.
- **What it includes (from AP's published developer guide and the open-source `elex`
  client):** results by state, county and reporting unit for federal, statewide and
  many down-ballot races; candidate, party, votes, precincts reporting; AP's `winner`
  flag with the call time; an "expected vote" / estimated turnout figure in newer
  versions (UNVERIFIED: confirm with AP); test data runs before election night; incremental updates.
- **Integration:** an API key from AP; REST JSON (or XML); poll at the rate the contract
  allows. The `elex` Python client is the usual reference. On our side: one adapter that
  turns AP's race rows into the map's two shapes, an AP call into a
  `{ kind: "projection", outlet: "AP", … }` item (projections.js) and AP votes into a count
  (civicApi.js `parseRace` shape), with "Source: AP".
- **Licence points to check before buying:** on-air display rights for a live stream,
  attribution wording, and whether re-broadcast to X / YouTube is covered.
- **Price:** quote-only. **UNVERIFIED.**

## Decision Desk HQ (DDHQ)

- **What it is:** an independent results and race-call service; used by several broadcast
  groups and digital outlets as their decision desk.
- **What it includes (from DDHQ's product pages):** a real-time results API (votes,
  reporting, race calls) for federal, state and many local races, plus broadcast
  graphics partners (e.g. a Bannister Lake integration for on-air graphics).
- **Integration:** API key; JSON; same adapter pattern as AP (DDHQ call →
  `outlet: "Decision Desk HQ"` projection item; votes → count).
- **Price:** quote-only. **UNVERIFIED.**

## What either would change

- A paid feed's **calls** still go through `projections.js`, named by outlet, so the map
  stays "Projected by <outlet>". Conflicting calls with other tracked outlets still show
  side by side.
- A paid feed would fill the counts gap the spike found (official feeds worked in 3 of 15
  tested states) and give a real "% of expected vote".
- Buying either is stop-list item 3 (cost) for DrJ.

Sources: [AP Elections API developer guide (DocumentCloud copy)](https://assets.documentcloud.org/documents/3130745/AP-Elections-API-Developer-Guide-v2-1.txt),
[elex CLI docs](https://elex.readthedocs.io/en/master/reference/cli.html),
[DDHQ products](https://ddhq.io/products),
[Bannister Lake and DDHQ](https://tvtechnology.com/news/bannister-lake-and-decision-desk-hq-team-up-for-election-coverage).
