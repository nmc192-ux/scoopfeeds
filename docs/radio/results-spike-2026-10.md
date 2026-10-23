# Free election-results spike (GROUND, read-only), #204

Run 23 Oct 2026, 00:59–01:20 UTC, from the cloud build box (a datacentre IP, through
the session proxy), with the User-Agent `ScoopFeedsRadio/1.0 (+https://scoopfeeds.com)`.
Every request was a plain GET; nothing was written anywhere. Each source was tested
against a **past election's archive** (2024 general, plus NC's 2026 primary) and, where
it exists, against its 2026 listing.

**Sampling stated:** 15 state offices were probed, not 50. They were chosen because they
hold a 2026 Senate or governor race and have a known election-night results site. The
other states were not tested and are **UNVERIFIED**. Several "did not work" results are
HTTP 403s that look like bot protection on datacentre IPs; they may work from the Mac
mini's home connection, so they are listed under "to verify on the Mac", not as dead.

## 1. civicAPI (all states, one API)

| Test | Result |
|---|---|
| 2026 race list | **Works.** `/race/87528` lists Senate races in 35 states; `/race/87535` governors in 36. Both match the official lists. `/race/search?type=US%20Senate&startDate=2026-11-03&endDate=2026-11-03` returns the 35 per-state races plus a `US` roll-up. |
| 2024 archive, coverage | **Patchy.** `type=US Senate` / `Senate` for 2024 returned 11 Senate races (AZ, CA ×2, DE ×2, MD, MA ×2, TX, VT ×2) of the 34 held. `type=Governor` returned 3 (DE, NC, VT) of 11. MN Senate 2024 is missing. |
| 2024 archive, accuracy | **Mixed.** NC governor 2024 (Stein 3,069,496) matches the NC State Board file exactly. TX, AZ, MD, CA, DE winners match the official outcome. But **one entry is wrong**: race 95966, "Massachusetts US Senate" 2024, has Charles D. Baker, Jr. (R) beating Elizabeth Warren with `winner: true`. DE and VT each have two entries with different totals. |
| 2026 live data, 23 Oct | **Has impossible numbers before any vote is counted.** Pennsylvania governor (per-state race) showed Krawchuk 8,617,128 / Garrity 8,610,711 / Shapiro 8,604,294 and `percent_reporting` 76.1, eleven days before the election. All 35 Senate states showed 0 votes. |
| `major_candidate` flag | Inconsistent: `true` for every candidate in the national roll-up, `false` for every candidate in the per-state NC Senate race. |
| What `percent_reporting` measures | Not documented (precincts? expected vote?). |
| `winner` | The docs say the API provides "results and calls". Whose calls is not stated. |

**What the build does about it:** civicAPI numbers never colour a state; they are
shown only with "Source: civicAPI" and their time. A count is **held** (not shown):

- before that state's **last** polls close: the later of civicAPI's `polls_close` and the
  builder's last-close table (`races2026.js`, UNVERIFIED, rounded late);
- when its total is above a plausibility ceiling, 2020 presidential turnout × 1.5
  (`races2026.js`, figures UNVERIFIED; PA ceiling ≈ 10.4M against the 25.8M seen);
- when its total is above `registered_voters`, if civicAPI ever fills that field.

**Fields the real per-state payload carries (measured 23 Oct 2026, 10:01 UTC, all 35 Senate
and 36 governor per-state races fetched once each from the cloud box):** `polls_close` is
present in **71/71**; `registered_voters` is **null in 71/71**; every race showed 0 votes
(the PA 8.6M numbers seen earlier the same day were gone). So the registered-voters check
alone would never have fired; the ceiling is what catches the PA shape after polls close.
civicAPI's `polls_close` is often the *first* close, and some are plainly early: KY 17:00 ET,
DE 18:00 ET (DE closes at 20:00), AK 23:00 ET (the Aleutians close at 01:00 ET). That is
why the hold takes the later of the two times. Other top-level fields seen: `polls_open`,
`last_updated`, `is_disputed`, `round`, `test_data`, `region_results`, `maps`.

`RADIO_ELECTION_COUNTS=off` drops all civicAPI numbers and
`RADIO_ELECTION_COUNTS_BLOCK=PA,…` drops single states on the night (blocked states are not
fetched at all). The label says
"% reporting", never "% of expected vote", because no free source tested gives expected
vote. A wrong civicAPI number that is plausible and after polls close (the MA 2024 kind)
is **not** caught by any automatic check; that risk is why counts are a fallback below
projections, and why the block switch exists.

## 2. Official state feeds

| State | 2026 race | Feed tested (2024 archive unless noted) | Result |
|---|---|---|---|
| North Carolina | Senate | `er.ncsbe.gov/enr/20241105/data/results_0.txt` (JSON despite the name) | **Works.** Statewide rows (`cid` 0) with candidate, party, votes, share, precincts reporting / total. 2024 governor numbers match civicAPI. The 2026 primary file (`/enr/20260303/…`) also works, so the 2026 general path will be `/enr/20261103/data/results_0.txt` (expected, unverified until it is published). |
| Minnesota | Senate, governor | `electionresultsfiles.sos.mn.gov/20241105/ussenate.txt` | **Works.** Semicolon text: candidate, party, precincts reporting / total, votes, share, total votes. 2026 path expected `/20261103/ussenate.txt` and a governor file (name unverified). |
| Colorado | Senate, governor | Clarity ENR `results.enr.clarityelections.com/CO/122598/current_ver.txt` → `/367167/json/en/summary.json` | **Works.** Contest summaries in JSON. The 2026 election id is not known until the county/state publishes it. |
| Georgia | Senate, governor | `results.sos.ga.gov/results/public/api/elections/Georgia/` | **Did not work** (404 at that path; the correct 2024 path was not found). |
| Pennsylvania | governor | `electionreturns.pa.gov/api/ElectionReturn/…` | **Did not work** (404 for the guessed parameters). |
| Virginia | Senate | `enr.elections.virginia.gov/results/public/api/elections` | **Did not work** (404). |
| Ohio | Senate, governor | `liveresults.ohiosos.gov/Api/v1/download?filename=SummaryResults.json` | **Did not work** (403, HTML page: bot protection). |
| Texas | Senate, governor | `results.texas-election.com/static/data/election/49664/en/electionInfo.json` | **Did not work** (403, bot protection). |
| Arizona | governor | `results.arizona.vote` | **Did not work** (403). |
| Wisconsin | governor | `elections.wi.gov/elections/election-results` | **Did not work** (403). Wisconsin has no statewide election-night feed in any case (results come from counties). |
| New Hampshire | Senate, governor | `sos.nh.gov/elections/elections/election-results` | **Did not work** (403). |
| Kentucky | Senate | Clarity `results.enr.clarityelections.com/KY/122681/current_ver.txt` | **Did not work** (403). |
| Florida | Senate, governor | `fldoselectionfiles.elections.myflorida.com/enightfilespublic/20241105_ElecResultsFL.txt` | **Did not work** (proxy could not connect, 502). |
| Michigan | Senate, governor | `mielections.us/election/results/2024GEN_CENR.html` | **Did not work** (connection reset). |
| Iowa | Senate, governor | `electionresults.iowa.gov` | Page answers (200), no machine-readable feed found. |

**Coverage:** 3 of 15 tested states have a free official feed that worked from here
(NC, MN, CO). civicAPI lists all 35 Senate and 36 governor states, with the accuracy
problems above. No free source gives "% of expected vote".

**Not built yet:** readers for the NC, MN and CO feeds. The map takes counts from any
source through one shape (`civicApi.js` `parseRace` output: state, source, time, %
reporting, shares), so each reader is a small parser; they were left out of this build
because their 2026 URLs do not exist yet and could not be tested.

## 3. To verify on the Mac

- [ ] Re-run the 403 probes (OH, TX, AZ, WI, NH, KY, FL, MI) from the Mac mini's connection.
- [ ] On 3 Nov, check that `er.ncsbe.gov/enr/20261103/data/results_0.txt` and the MN files appear.
- [ ] Run `node backend/src/radio/election/cli.js civic --race governor` on 1 Nov (dress
      rehearsal) and on the night; any `HELD` line is a count the map refused.
