# ScoopFeeds Radio — the channel grid

**What this is.** ScoopFeeds Radio runs like a TV news channel, on the Bloomberg and Al Jazeera model (DrJ, 22 Oct
2026): a fixed 24-hour grid, a catalogue of segments, and a set of screen elements that are always on. Some
programmes are live, most are produced, some are pre-recorded. This page is the grid in plain English. The same grid
is code in `backend/src/radio/programme/grid.js`, and a test (`grid.test.js`) reads this page and fails if the two
disagree, so change both together. (#200; it feeds #195, the 24/7 hours.)

**Status.** Built and tested, **not on air**. The producer builds an hour from the grid only when it is started with
`--grid` or `RADIO_GRID_ENABLED=1`. Without that, every hour is today's running order, unchanged.

## How an hour is built

Every produced hour keeps today's running order (`clock.js`): the top ident and ping on :00:00, The Hour, Markets
Now, The News, Compared, the desks, a Short from a ScoopFeeds film, the half-hour ident and headlines, sign-off. The
grid then changes four things for the hour:

1. **Crypto, in every hour.** The first 90 seconds of the first music break become the Crypto segment (prices from
   CoinGecko). Crypto trades around the clock, so the overnight repeats carry it too (#283): the repeated hour's
   Crypto is cut to music (its prices are old by then) and a Crypto segment written fresh against the repeat's own air
   time is spliced in its place.
2. **Weather every two hours**, on even New York hours. In the other hours its 90 seconds go to the half-hour
   headlines, which then read seven stories instead of five.
3. **Business follows the open exchange.** Markets Now and the Business desk are titled by the stock exchanges
   trading at that moment ("Markets Now: New York, London and Frankfurt trading") and lead with those markets. Only
   exchanges we carry figures for are named in the title (US and Europe today).
4. **The film airs at a fixed time**, 9 pm New York, every day, so it can be promoted as "tonight at 9 ET". A film
   offered for any other hour is held back for its slot.

**Breaking news and live events override the grid.** The segment on air is cut where the override starts. When the
override ends, the grid picks up at the start of the next segment, never in the middle of one; any time in between
is headlines and music.

## The 24 hours (New York time)

London, Dubai and Karachi times are for a day in US summer time (until 1 November); after that the US clock moves
back an hour, and so do these columns. The grid itself is always set in New York time.

| ET hour | Daypart | Format | Audience | Weather | Crypto | Film | London | Dubai | Karachi |
|---|---|---|---|---|---|---|---|---|---|
| 00:00 | Overnight: Middle East morning | repeat | middle-east-morning | yes | yes | no | 04:00 | 08:00 | 09:00 |
| 01:00 | Overnight: Middle East morning | repeat | middle-east-morning | no | yes | no | 05:00 | 09:00 | 10:00 |
| 02:00 | Overnight: UK and Europe morning | repeat | uk-europe-morning | yes | yes | no | 06:00 | 10:00 | 11:00 |
| 03:00 | Overnight: UK and Europe morning | repeat | uk-europe-morning | no | yes | no | 07:00 | 11:00 | 12:00 |
| 04:00 | Overnight: UK and Europe morning | repeat | uk-europe-morning | yes | yes | no | 08:00 | 12:00 | 13:00 |
| 05:00 | Overnight: UK and Europe morning | repeat | uk-europe-morning | no | yes | no | 09:00 | 13:00 | 14:00 |
| 06:00 | US morning | produced | us | yes | yes | no | 10:00 | 14:00 | 15:00 |
| 07:00 | US morning | produced | us | no | yes | no | 11:00 | 15:00 | 16:00 |
| 08:00 | US morning | produced | us | yes | yes | no | 12:00 | 16:00 | 17:00 |
| 09:00 | US morning | produced | us | no | yes | no | 13:00 | 17:00 | 18:00 |
| 10:00 | US daytime, markets open | produced | us | yes | yes | no | 14:00 | 18:00 | 19:00 |
| 11:00 | US daytime, markets open | produced | us | no | yes | no | 15:00 | 19:00 | 20:00 |
| 12:00 | US daytime, markets open | produced | us | yes | yes | no | 16:00 | 20:00 | 21:00 |
| 13:00 | US daytime, markets open | produced | us | no | yes | no | 17:00 | 21:00 | 22:00 |
| 14:00 | US daytime, markets open | produced | us | yes | yes | no | 18:00 | 22:00 | 23:00 |
| 15:00 | US daytime, markets open | produced | us | no | yes | no | 19:00 | 23:00 | 00:00 |
| 16:00 | US evening | produced | us | yes | yes | no | 20:00 | 00:00 | 01:00 |
| 17:00 | US evening | produced | us | no | yes | no | 21:00 | 01:00 | 02:00 |
| 18:00 | US evening | produced | us | yes | yes | no | 22:00 | 02:00 | 03:00 |
| 19:00 | US evening | produced | us | no | yes | no | 23:00 | 03:00 | 04:00 |
| 20:00 | US evening | produced | us | yes | yes | no | 00:00 | 04:00 | 05:00 |
| 21:00 | Prime time: the ScoopFeeds film | produced | us | no | yes | yes | 01:00 | 05:00 | 06:00 |
| 22:00 | Late US evening, South Asia morning | produced | south-asia-morning | yes | yes | no | 02:00 | 06:00 | 07:00 |
| 23:00 | Late US evening, South Asia morning | produced | south-asia-morning | no | yes | no | 03:00 | 07:00 | 08:00 |

- **Produced** (6 am to midnight New York): a full hour written from the live feed.
- **Repeat** (overnight New York): the strongest recent produced hour again, with freshly written top-of-hour
  headlines and a freshly written Crypto segment. Midnight to 2 am is timed for the Middle East morning, 2 am to 6 am for the UK and Europe morning. The
  repeat itself is built by #195's rolling station; the grid only says which hours are repeats.
- **South Asia** gets its own slot, 10 pm to midnight New York (7 to 9 am Karachi in US summer time, 8 to 10 am in
  winter). It is a produced hour; Rule 0 and the Pakistan-politics rules apply to it like every other hour.

## The v1.5 clock (RADIO_CLOCK_V15, #285)

DrJ's rehearsal notes of 28 October (#281, note 1): the same stories came round too often, and after each update the
screen looped the same headlines over music. The v1.5 clock is the quick fix before election night. It is **off**
unless `RADIO_CLOCK_V15` is literally `1` on the Mac; off, every hour is today's running order, unchanged.

- **The Hour reads 7 stories**, world news first, then business, then one sport story. Each is the headline plus three
  or four sentences of context: what happened, who said what (attributed to the outlet), and why it matters. About
  60 to 80 seconds a story.
- **Sport**, 3 minutes, straight after The Hour, from a Sport desk (the site's sports tab). No sport stories (fewer
  than two), no Sport slot: its time goes back to The Hour, which then reads two more stories.
- **The half-hour reads only new or changed stories**: never a story The Hour read (by story id, or the same story
  under another id). With fewer than three, it says "No major changes since the top of the hour." and moves on.
- **Less music.** Every music block is 90 seconds at most: 4.5 minutes an hour, 5.5 when there is no Short for the
  film slot, 3 in a grid hour (Crypto takes the first block whole). It was about 19 minutes.
- **Music shows what is coming up**, with a countdown, beside the markets and weather rail; it no longer loops the
  headline cards.
- The Tech and AI desk is **Science, Tech and AI**, and its stories include the site's science tab.
- The US desk moves to the second half. In election season the Midterms desk (and on the days after, the counting
  desk) takes the US desk's slot, because no music block is long enough to give it 3 minutes.
- The second half opens as today (half, weather, the science and tech desk), so the 9 pm film still starts at 37:30
  and may still run 16 minutes. The election night special (#198), the film slot and the idents are not changed.
- **Repeats** (midnight to 6 am New York) take the clock of the hour they repeat; a fresh top of the hour over a v1.5
  hour is written in the long format, with a fresh Sport slot.

| Slot | id | Starts | Ends | Kind |
|---|---|---|---|---|
| Countdown | countdown | -15:00 | -00:04 | countdown |
| Top ident and ping | ident-top | -00:04 | 00:06 | ident |
| The Hour | the-hour | 00:06 | 10:06 | spoken |
| Sport | sport | 10:06 | 13:06 | spoken |
| Markets Now | markets-1 | 13:06 | 15:36 | spoken |
| The News, Compared | compared-1 | 15:36 | 21:36 | spoken |
| Music (Crypto in a grid hour) | music-1 | 21:36 | 23:06 | music |
| Middle East desk | desk-me | 23:06 | 27:06 | spoken |
| From the films | film | 27:06 | 28:06 | film |
| This week on ScoopFeeds | series | 28:06 | 29:52 | series |
| Half-hour ident | ident-half | 29:52 | 30:00 | ident |
| Headlines at the half hour | half | 30:00 | 33:00 | spoken |
| Weather around the world | weather | 33:00 | 34:30 | spoken |
| Science, Tech and AI | desk-tech | 34:30 | 37:30 | spoken |
| Music | music-3 | 37:30 | 39:00 | music |
| Business desk | desk-biz | 39:00 | 45:00 | spoken |
| US desk: politics and economy | desk-us | 45:00 | 48:00 | spoken |
| The News, Compared | compared-2 | 48:00 | 54:00 | spoken |
| Music | music-4 | 54:00 | 55:30 | music |
| Markets Now | markets-2 | 55:30 | 58:00 | spoken |
| Sign-off | signoff | 58:00 | 58:45 | spoken |
| Closing ident | ident-end | 58:45 | 58:53 | ident |
| End card | endcard | 58:53 | 60:30 | endcard |

## The segment catalogue

Each segment is a format with its own fact pack, writer prompt, checks and screen layout. Every spoken line is
checked against its fact pack before it is voiced: no figure, quote or outlet that is not in the pack airs (the same
Rule 0, figure, quote and outlet checks as every other segment).

| Segment | id | Kind | When | Status |
|---|---|---|---|---|
| Top-of-hour headlines | the-hour | produced | every hour at :00, after the top ident and ping | on-air |
| Half-hour headlines | half | produced | every hour at :30 | on-air |
| The News, Compared | compared | produced | twice an hour | on-air |
| Business & Markets | markets | produced + live data | twice an hour, led by the exchanges in session | on-air |
| Desks: Middle East, US, Tech and AI, Business | desk | produced | once an hour each | on-air |
| Sport | sport | produced | once an hour, after The Hour (v1.5 clock; no sport stories, no slot) | #285 |
| Crypto | crypto | produced + live data | once an hour, every hour (repeats get a fresh one) | on-air |
| Weather | weather | produced + live data | every 2 hours (even New York hours) | on-air |
| ScoopFeeds showcase | showcase | pre-recorded | a Short every hour; the film at 9 ET | on-air |
| Developing and emerging stories | developing | live-produced | breaks into the grid | #201 |
| The Midterms / election desk | midterms | produced | election season | #197 |
| Live events | live | live | breaks into the grid | #202 |

"on-air" means the grid places it today. The last three are catalogued here and placed by their own issues; until
they land, they do not air from the grid.

**Crypto** reads only the CRYPTO rows of the pack (Bitcoin first, then Ether, then at most three others): price and
24-hour change. It never predicts prices or advises buying or selling. With fewer than two crypto rows the slot is
headlines and music, and the hour still airs; it is never silent about it (#283): the produce log says
`crypto: feed unavailable (...)` with the reason, `programme.json` records it under `crypto`, and the hour's air-check
report carries it (`stats.crypto` and a note). No crypto scene and no placeholder go on screen. The right rail's
markets block shows Bitcoin, Ether and the biggest 24-hour mover among the other coins after two market rows (five
rows, as before) in every grid hour that has crypto rows.

## Screen elements (always on, earn-render)

All in the Signal identity. An element is drawn only when it has real data; there are no placeholders.

| Element | id | Shows when |
|---|---|---|
| LIVE bug | live-bug | always |
| Channel clock: New York, London, Dubai, Karachi | clocks | always |
| Programme name | programme-name | the slot has a title |
| Headline ticker | headline-ticker | there are headlines |
| Markets ticker by open session | markets-ticker | there are market figures |
| Weather scroller of major capitals | weather-scroller | there is weather |
| Lower third: headline and outlet, verbatim from articles | lower-third | a story is on screen |
| Coming up next | coming-up | something is coming up |

The programme screen and the 24/7 headline screen share one frame: the same top bar (logo, LIVE, the four clocks)
and the same bottom ticker, so a failed hour falling back to the 24/7 screen does not look like a different
channel. The story and headline-break scenes carry a right-hand rail (Coming up, markets, weather). No text on either
screen is smaller than the ticker text, 26 px at 1080p.
