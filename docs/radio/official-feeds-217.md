# Radio official feeds, round 2 (#217)

DrJ approved this list on 23 Oct 2026. Every publisher on it was checked against its own reuse terms on 23 Oct 2026.

**How the terms were read.** The pages were read through a web-fetch tool that returns fragments of each clause, not the raw page. Each quote below is exact text, but `...` marks a cut. Read the full clause at the URL before relying on it.

**Monetisation.** DrJ, 23 Oct: the radio stream carries no ads and is not monetised. That is why the `nonCommercialOnly` entries are allowed. `RADIO_STREAM_MONETISED` turns them off again (see `docs/reference/env_reference.md`).

**None of these entries can air yet.** Each one is added with `macCheck: null`. It goes to air only after `node backend/src/radio/live/cli.js check <url>` has passed **on the Mac** and the result is written into the entry: `macCheck: { passedAt, url, by }`. The probe needs a live stream, so run it while the publisher is actually broadcasting.

**Every entry also airs only through the #218 content-safety gate.** That gate is not built yet.

## Added (each with `macCheck: null`)

| id | Feed (narrowest form) | Licence (URL) | Commercial use | On-screen credit |
|---|---|---|---|---|
| `federal-reserve` | `@federalreserve`; `federalreserve.gov/live-broadcast.htm` | Public domain: "information on Board's website is in the public domain ... may be copied and distributed without permission" ([disclaimer](https://www.federalreserve.gov/disclaimer.htm)) | allowed | Source: Federal Reserve Board |
| `cdc` | `@CDC` (no cdc.gov live page found) | Public domain, with attribution, no substantive change, a no-endorsement line and "available free" ([agencymaterials](https://www.cdc.gov/other/agencymaterials.html)) | allowed | Source: CDC. Available free at cdc.gov. Does not imply endorsement… |
| `us-dod-dvids` | `dvidshub.net/webcast/` | "newsworthy purposes"; advertising and promotion count as commercial use; a non-endorsement disclaimer is requested ([DVIDS copyright](https://dvidshub.net/about/copyright)) | **non-commercial only** | DVIDS / DoD + the non-endorsement disclaimer |
| `eu-commission` | `audiovisual.ec.europa.eu/en/ebs/live/` (EbS and EbS+ players) | CC BY 4.0 notice; "free of charge for EU-related information and education purposes" ([conditions](https://audiovisual.ec.europa.eu/en/conditions-of-use), [about](https://audiovisual.ec.europa.eu/en/about)) | **non-commercial only** (from the purpose limit) | © European Union, {year}, licensed under CC BY 4.0 |
| `eu-parliament` | `@europeanparliament`; `multimedia.europarl.europa.eu/en/webstreaming` | "reuse ... authorised ... non-commercial or commercial dissemination, provided that the entire item is reproduced and the source is acknowledged" ([legal notice](https://www.europarl.europa.eu/legal-notice/en/)) | allowed | © European Union, {year} – Source: European Parliament |
| `nato` | `@NATO` | "free of charge, for use in objective and balanced content ... No material ... used for outside advertising or promotional purposes" ([NATO](https://nato.int/en/about-us/official-texts-and-resources/use-of-nato-content-and-brand)) | **non-commercial only** | Source: NATO |
| `esa` | `@EuropeanSpaceAgency` | "broadcasted ... for educational, editorial or informational purposes ... without requesting a separate authorisation ... A commercial use requires a separate written authorisation" ([ESA](https://www.esa.int/esatv/Terms_and_Conditions)) | **non-commercial only** | European Space Agency - ESA |

**Caveats by entry:**
- **Fed.** The terms say "information on Board's website" and do not mention video by name. The Fed seal is excluded.
- **DVIDS.** It also carries other agencies' webcasts, such as State Department briefings. Check who originated each event. Our reading of the "internet-based capability" sentence as part of the advertising clause needs a human read.
- **EbS.** Each file can carry its own conditions. The `/ebs/live/1` page body could not be read (it returned only an app shell).
- **European Parliament.** The Multimedia Centre's own rules PDF was blocked (robots.txt), so any extra conditions are **unverified**. The terms require the "entire item" to be reproduced: air whole sessions, not cut-downs.
- **ESA and NATO.** Third-party footage inside a stream may need its own clearance. NATO may request removal.

## Left out: unverified or needs permission

| Publisher | Status | Why |
|---|---|---|
| US Department of State (`@StateDept`) | **unverified** | The current state.gov/copyright-information page returned an error. Its public-domain wording was read only on the 2017–2021 archive and on travel.state.gov. Add once the current page has been read. |
| ECB (`@ecbeuro`; `ecb.europa.eu/press/tvservices/webcast/`) | **unverified** | The disclaimer allows "free use of the information" with the ECB cited, but nothing confirms that it covers video. The TV-services footage page could not be read. |
| WHO (`@WHO`) | **unverified** | CC BY-NC-SA 3.0 IGO is stated for "publications"; neither page mentions video or briefings. |
| IMF (`@imf`) | **needs permission** | Fair use is capped at "no more than one-quarter of the content"; anything more needs written permission (copyright@imf.org or the Copyright Clearance Center). |
| World Bank | **unverified** | Non-commercial use is allowed, but "you may not make any derivative work". Our framed screen with lower thirds may count as a derivative work. The YouTube handle was not confirmed. |
| UK Parliament | **needs permission** | parliamentlive.tv terms cover clips "only to make a fair and accurate report"; live broadcast needs the Parliamentary Recording Unit licence (pru@parliament.uk). Clause 3.2 also requires written takedown confirmation from the platform. |
| No10 (`@10DowningStreet`) | **unverified** | OGL v3.0 covers content on GOV.UK. No page says the YouTube livestreams are under OGL, and pool-camera footage is third-party. |
| Voice of America | **needs permission** | VOA's own reuse page requires "a Usage Request for each piece of original VOA content" from US domestic outlets. Its live English output was not found (Oct 2026). Only Learning English is stated as public domain. |

## Proposed for DrJ to pick (not added)

These come from the desk research in the issue comment of 23 Oct. Each one needs the same checks before it can be added.

- **Tier A, public domain or open licence:**
  - US federal agencies, each with its own narrow entry: NOAA / National Hurricane Center briefings, FEMA, NTSB, Treasury, DOJ, and House and Senate committee hearings published on the committees' own sites.
  - Japan, Kantei, under Public Data License 1.0. Confirm that PDL 1.0 allows commercial use.
  - Norway, government press conferences. These are free, but embedding the live video requires contacting them.
- **Tier B, free to broadcasters but booked or with separate terms:**
  - UN transmission feed (the public UN Web TV is already on the list).
  - Bank of England, which typically grants non-commercial reuse on request.
- **Tier C, written permission needed:**
  - Australian Parliament.
  - Bundestag (live signal).
- **Not researched:**
  - Central banks: Bank of Japan, Bank of Canada, Reserve Bank of Australia, and RBI. RBI is a central bank, not a broadcaster, so whether the India state-media exclusion covers it is for DrJ to decide.
  - International organisations: UNICEF, UNHCR, WTO, OECD, ICRC, African Union, and G7/G20 host presidencies.
  - US government-funded broadcasters: Radio Free Asia, MBN/Alhurra, Radio/TV Martí.
  - Businesses: none found whose terms allow live rebroadcast.

**Unchanged exclusions:**
- Pakistan government and political feeds.
- Pakistan and India state media.
- Sports.
- News organisations (pending DrJ's decision).
- Outlets that YouTube has removed or that are under sanctions (RT, Sputnik): flagged for DrJ, never added.

`NEVER_AIR_HOSTS` is unchanged.
