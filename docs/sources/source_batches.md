# Source batches

The record of every source step batch (full-throttle.md §4). The 20:00 daily report reads this file
and the batch PR. Newest batch first. Each batch lists what was admitted and what was rejected, with
the reason.

Rules (#251): a candidate joins `backend/src/config/sources.js` only if it passes the probe (HTTP 200
and parses, at least 5 items, newest item under 72 h, English, host not already listed) **and** the
scorer measured it (status `scored`, at least 3 components at or above `MIN_COVERAGE`) with
`quality_score` at or above the floor (`SOURCE_QUALITY_FLOOR`, code default 60). Unscored is not
admitted. Tool: `backend/scripts/sources/source-step.mjs` (probe / score / floor).

---

## Source step 1, batch 1: probe stage only (2026-10-25, #251)

**Admitted: 0. Active RSS sources: 125 before, 125 after.**

Probed 80 candidates from the cloud build engine on 2026-10-25 23:11 UTC:
**42 passed the probe, 38 failed it.** None was scored, so none is admitted.

Why none was scored: most scoring components are LLM judgments, and the cloud build session has no
LLM key. A grounding run on BBC News and The Guardian there measured only one component (ET) of the
three a score needs, so every candidate would have come back "insufficient data". That is unmeasured,
not a rejection. The `score` stage refuses to run without the key for that reason.

**Next step (follow-up issue):** where `ANTHROPIC_API_KEY` is set (the Mac mini or the VPS), run

```bash
cd backend
node scripts/sources/source-step.mjs floor --db <a COPY of news.db>       # the floor, from current active sources
node scripts/sources/source-step.mjs probe --out probe.json                 # re-probe: freshness changes
node scripts/sources/source-step.mjs score --probed probe.json --out scored.json
```

`score` builds its own scratch database in a temp dir; it never opens the production DB. It does
not edit `config/sources.js`: the admitted entries go in through a normal PR, with this file updated.

Known limit, UNVERIFIED: a candidate ingested minutes before scoring has no history, so the
sustained-coverage part of DE may stay pending. If that leaves good outlets "insufficient data",
the follow-up should say so with the numbers rather than lower the bar.

Probe pass, by region: global 10, us 8, uk 6, eu 6, ca 3, in 2, us-east 1, us-midwest 1, de 1, fr 1, au 1, ae 1, za 1.

### Passed the probe (not yet scored, not admitted)

| Name | URL | Region | Category | quality_score | Probe |
|---|---|---|---|---|---|
| ProPublica | https://www.propublica.org/feeds/propublica/main | us | politics | not scored | 20 items, newest 19.2 h |
| The Texas Tribune | https://feeds.texastribune.org/feeds/main/ | us | local | not scored | 20 items, newest 19.2 h |
| Boston Globe | https://www.bostonglobe.com/arc/outboundfeeds/rss/?outputType=xml | us-east | local | not scored | 100 items, newest 0.2 h |
| Star Tribune | https://www.startribune.com/local/index.rss2 | us-midwest | local | not scored | 10 items, newest 2.2 h |
| Roll Call | https://rollcall.com/feed/ | us | politics | not scored | 10 items, newest 52.2 h |
| The Dispatch | https://thedispatch.com/feed/ | us | politics | not scored | 10 items, newest 12.2 h |
| Vox | https://www.vox.com/rss/index.xml | us | politics | not scored | 10 items, newest 10.7 h |
| Semafor | https://www.semafor.com/rss.xml | global | international | not scored | 207 items, newest 0.6 h |
| Christian Science Monitor | https://rss.csmonitor.com/feeds/all | global | international | not scored | 10 items, newest 2.1 h |
| Kiplinger | https://www.kiplinger.com/feeds/all | us | business | not scored | 50 items, newest 8.2 h |
| The Telegraph | https://www.telegraph.co.uk/rss.xml | uk | top | not scored | 120 items, newest 0.1 h |
| Evening Standard | https://www.standard.co.uk/rss | uk | local | not scored | 70 items, newest 0.3 h |
| The Scotsman | https://www.scotsman.com/rss | uk | local | not scored | 44 items, newest 1.6 h |
| inews | https://inews.co.uk/feed | uk | top | not scored | 10 items, newest 0.8 h |
| City AM | https://www.cityam.com/feed/ | uk | business | not scored | 30 items, newest 7.7 h |
| New Statesman | https://www.newstatesman.com/feed | uk | politics | not scored | 20 items, newest 23.3 h |
| Irish Independent | https://www.independent.ie/rss | eu | top | not scored | 50 items, newest 1.1 h |
| The Journal (Ireland) | https://www.thejournal.ie/feed/ | eu | top | not scored | 40 items, newest 1.2 h |
| The Local Sweden | https://www.thelocal.se/feeds/rss.php | eu | international | not scored | 20 items, newest 37.1 h |
| The Local Germany | https://www.thelocal.de/feeds/rss.php | de | international | not scored | 20 items, newest 6.9 h |
| The Local France | https://www.thelocal.fr/feeds/rss.php | fr | international | not scored | 20 items, newest 6.9 h |
| Notes from Poland | https://notesfrompoland.com/feed/ | eu | international | not scored | 12 items, newest 9 h |
| Balkan Insight | https://balkaninsight.com/feed/ | eu | international | not scored | 90 items, newest 1.1 h |
| ANSA English | https://www.ansa.it/english/news/english_nr_rss.xml | eu | international | not scored | 100 items, newest 37.1 h |
| Global News | https://globalnews.ca/feed/ | ca | top | not scored | 10 items, newest 1.2 h |
| Toronto Star | https://www.thestar.com/search/?f=rss&t=article&c=news*&l=50&s=start_time&sd=desc | ca | top | not scored | 50 items, newest 0.4 h |
| The Globe and Mail | https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/ | ca | top | not scored | 100 items, newest 0.3 h |
| Sydney Morning Herald | https://www.smh.com.au/rss/feed.xml | au | top | not scored | 20 items, newest 0 h |
| RNZ | https://www.rnz.co.nz/rss/national.xml | global | top | not scored | 38 items, newest 0.3 h |
| The National (UAE) | https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml | ae | international | not scored | 86 items, newest 3.7 h |
| Hindustan Times | https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml | in | international | not scored | 100 items, newest 4.2 h |
| NDTV | https://feeds.feedburner.com/ndtvnews-top-stories | in | international | not scored | 20 items, newest 3.9 h |
| Premium Times | https://www.premiumtimesng.com/feed | global | international | not scored | 15 items, newest 1 h |
| Daily Maverick | https://www.dailymaverick.co.za/dmrss/ | za | international | not scored | 53 items, newest 0.2 h |
| South China Morning Post | https://www.scmp.com/rss/91/feed | global | international | not scored | 50 items, newest 0.2 h |
| Science News | https://www.sciencenews.org/feed | global | science | not scored | 20 items, newest 36.2 h |
| Science (AAAS) News | https://www.science.org/rss/news_current.xml | global | science | not scored | 10 items, newest 66.3 h |
| The Lancet | https://www.thelancet.com/rssfeed/lancet_current.xml | global | medicine | not scored | 35 items, newest 47.2 h |
| Undark | https://undark.org/feed/ | global | science | not scored | 10 items, newest 64.1 h |
| Knowable Magazine | https://knowablemagazine.org/rss | global | science | not scored | 20 items, newest 71.2 h |
| Defense One | https://www.defenseone.com/rss/all/ | us | politics | not scored | 23 items, newest 13.2 h |
| SCOTUSblog | https://www.scotusblog.com/feed/ | us | politics | not scored | 25 items, newest 57.2 h |

### Rejected at the probe

| Name | URL | Reason |
|---|---|---|
| CNN | http://rss.cnn.com/rss/cnn_topstories.rss | newest item 30552.1 h old |
| USA Today | https://rssfeeds.usatoday.com/usatoday-NewsTopStories | fetch/parse failed: Status code 402 |
| Washington Post | https://feeds.washingtonpost.com/rss/national | fetch/parse failed: Status code 502 |
| Washington Post World | https://feeds.washingtonpost.com/rss/world | fetch/parse failed: Status code 502 |
| Wall Street Journal World | https://feeds.a.dj.com/rss/RSSWorldNews.xml | newest item 15267.8 h old |
| Wall Street Journal Markets | https://feeds.a.dj.com/rss/RSSMarketsMain.xml | newest item 15267.7 h old |
| CBS News Politics | https://www.cbsnews.com/latest/rss/politics | host already listed (cbsnews.com) |
| Miami Herald | https://www.miamiherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true | fetch/parse failed: Request timed out after 20000ms |
| Denver Post | https://www.denverpost.com/feed/ | fetch/parse failed: Status code 403 |
| Axios Politics | https://api.axios.com/feed/politics | host already listed (api.axios.com) |
| Yahoo Finance | https://finance.yahoo.com/news/rssindex | fetch/parse failed: Status code 404 |
| Barron's | https://www.barrons.com/xml/rss/3_7510.xml | fetch/parse failed: Status code 403 |
| Quartz | https://qz.com/rss | only 0 item(s) |
| Harvard Business Review | https://feeds.hbr.org/harvardbusiness | fetch/parse failed: Client network socket disconnected before secure TLS connection was established |
| The Independent | https://www.independent.co.uk/news/uk/rss | fetch/parse failed: Non-whitespace before first tag. Line: 0 Column: 1 Char:  |
| The Independent World | https://www.independent.co.uk/news/world/rss | fetch/parse failed: Unable to parse XML. |
| The Spectator | https://www.spectator.co.uk/feed | fetch/parse failed: Status code 404 |
| BBC Business | https://feeds.bbci.co.uk/news/business/rss.xml | host already listed (feeds.bbci.co.uk) |
| Guardian Business | https://www.theguardian.com/uk/business/rss | host already listed (theguardian.com) |
| Yle News | https://yle.fi/rss/uutiset/englanti | fetch/parse failed: Status code 404 |
| NL Times | https://nltimes.nl/rss | no item dates (freshness unmeasured) |
| Brussels Times | https://www.brusselstimes.com/feed | fetch/parse failed: Unexpected close tag Line: 58 Column: 3592 Char: > |
| Kyiv Independent | https://kyivindependent.com/rss/ | fetch/parse failed: Status code 404 |
| RFE/RL | https://www.rferl.org/api/zrqiteuuir | only 0 item(s) |
| Swissinfo | https://www.swissinfo.ch/eng/rss | fetch/parse failed: Status code 410 |
| CBC News | https://www.cbc.ca/webfeed/rss/rss-topstories | fetch/parse failed: Request timed out after 20000ms |
| The Conversation AU | https://theconversation.com/au/articles.atom | host already listed (theconversation.com) |
| Guardian Australia | https://www.theguardian.com/australia-news/rss | host already listed (theguardian.com) |
| Middle East Eye | https://www.middleeasteye.net/rss | fetch/parse failed: Status code 404 |
| The Express Tribune Business | https://tribune.com.pk/feed/business | host already listed (tribune.com.pk) |
| Scroll.in | https://feeds.feedburner.com/ScrollinArticles.rss | host already in this batch (feeds.feedburner.com) |
| The Daily Star (Bangladesh) | https://www.thedailystar.net/frontpage/rss.xml | newest item 37355.2 h old |
| The East African | https://www.theeastafrican.co.ke/rss | fetch/parse failed: Status code 403 |
| Nikkei Asia | https://asia.nikkei.com/rss/feed/nar | no item dates (freshness unmeasured) |
| Rest of World | https://restofworld.org/feed/latest | fetch/parse failed: Invalid character in entity name Line: 25 Column: 131 Char: = |
| Ars Technica Science | https://feeds.arstechnica.com/arstechnica/science | host already listed (feeds.arstechnica.com) |
| Lawfare | https://www.lawfaremedia.org/feeds/articles | only 1 item(s) |
| Devex | https://www.devex.com/news/rss | fetch/parse failed: Status code 403 |

Dead feeds already in `config/sources.js`: none found by this batch (the probe checks candidates
only). Load check (step 6 of the spec): not measured, because nothing was added. It belongs to the
batch that adds sources.

## Source step 2 readiness (#292)

Growing to 400 sources waits on two preconditions. The first is shipped in #292: the RI compose
cycle's per-event snapshot writes are batched (`SNAPSHOT_WRITE_BATCH`, default 200 events per
transaction). The second is this read-only readout, which says whether the event promoter and the
RI compose cycle keep up today:

```bash
cd backend && node scripts/sources/load-readiness.mjs --db <a COPY of news.db> [--days 7]
```

It opens the copy read-only and prints JSON: `events.promote` and `reality-index.compose` runs,
completed / failed, p50 / p95 / max `duration_ms` from `background_job_runs`; eligible clusters
now (the promoter's step-1 predicate without its `LIMIT 300`); active events; active RSS sources;
and a verdict. **READY** only if promoter p95 ≤ 1,200,000 ms, failure rate < 5%, runs ≥ 90% of the
48/day expected, and eligible clusters < 300. **UNVERIFIED** with fewer than 24 promoter runs in
the window or no `background_job_runs` table. Otherwise **NOT READY**, naming the failed tests.

**Readout: UNVERIFIED.** The cloud build engine has no prod DB copy, so it has not been run on
real data. The VPS run script is in the #292 PR.
