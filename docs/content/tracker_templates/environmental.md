# Tracker Template — Environmental

**Signal type:** `environmental`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** `conflict.md` / `outbreak.md` / `incident.md` (parallel
7-section structure)

> This is a markdown specification of what an *environmental* tracker
> captures and displays for natural hazards — earthquakes, floods, storms,
> wildfires, and volcanic activity. It is **not** a schema or code artifact
> — schema follows in Sprint 1.2 once all 8 templates are reviewed.

---

## 1. Purpose + Trigger

**Purpose.** An environmental tracker quantifies a single natural-hazard
event so a reader can see *magnitude, geographic reach, human/economic
impact, and current alert level* — without being misled by early-instrument
readings that get revised within hours.

**Trigger.** Auto-detected when:
- A USGS / NOAA / national meteorological agency alert exceeds a
  configurable per-hazard threshold (e.g., M5.5+ earthquake, Saffir-Simpson
  Cat 3+ storm, NWS major-flood designation, VEI 3+ volcanic event),
  **OR**
- Articles in `environment` / `international` / `top` clusters surface ≥ 5
  distinct dispatches naming the same hazard event within 24h, **OR**
- Editorial seed (DrJ flags an emergent hazard where official thresholds
  haven't fired but ground reports indicate developing impact).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (environmental-specific):
- **preliminary-reading** — first official instrument readings, typically
  within the first hour. Magnitude figures in particular are routinely
  revised in the first 6–24h as more stations report.
- **revised** — official agency has issued one or more revisions; figure
  is stabilizing but not finalized.
- **confirmed** — agency has issued a final / authoritative value (USGS
  ComCat final magnitude, NHC final tropical-cyclone report, etc.).

Metrics tracked:

1. **Magnitude / intensity** — per-hazard scale: Richter (Mw for modern
   USGS) for earthquakes, Saffir-Simpson for tropical cyclones, EF for
   tornadoes, NWS flood-stage tiers, VEI for volcanic eruptions, fire-
   weather indices and acreage for wildfires. Confidence flag is
   especially important here — earthquake magnitudes routinely move
   ±0.3–0.5 in the first 24h.
2. **Affected area** — geographic extent: bounding region, list of
   affected administrative units (country → state/province → county /
   district granularity where reliable).
3. **Affected population** — integer estimate; confidence; source.
   Distinct from casualties; covers people within the impact zone.
4. **Casualties (killed / injured / missing)** — three integers; per-
   metric confidence; source. Often lags the hazard event by days as
   search-and-rescue progresses.
5. **Damage estimate** — currency value or qualitative; confidence;
   source. Insurance-industry figures, NOAA NCEI billion-dollar disaster
   estimates, and government-issued figures differ; attribute all clearly.
6. **Alert / warning level** — current official designation (NWS
   warning/watch/advisory, JTWC tropical-cyclone advisory level, USGS
   PAGER alert color, agency-specific evacuation order); confidence
   typically `confirmed` once issued; source: issuing agency.
7. **Hazard-chain status** — qualitative flag for cascading-hazard
   awareness (e.g., quake → tsunami watch active, storm → inland-flood
   forecast, wildfire → air-quality emergency); confidence; source.

Per-hazard scale choice matters: do **not** synthesize a cross-hazard
"severity" score (a M6 quake is not "the same as" a Cat 3 hurricane).
Display the mode-appropriate scale and let the reader read it.

---

## 3. Data Sources

Primary (authoritative):
- **USGS** — earthquakes (ComCat catalog), volcanoes (VHP / VAACs),
  landslides, ground-failure modeling. Already ingested at Scoopfeeds.
- **NOAA** — tropical cyclones (NHC, CPHC, JTWC for Western Pacific),
  severe weather (SPC), flood forecasting (NWS RFCs), tsunami centers
  (NTWC, PTWC). Already ingested.
- **National meteorological agencies** for non-US geographies: ECMWF /
  Met Office (UK), JMA (Japan), IMD (India), PMD (Pakistan), BMKG
  (Indonesia), etc.
- **Volcano observatories** — country-specific (USGS HVO for Hawaii,
  INGV for Italy, PHIVOLCS for Philippines, etc.).

Secondary (corroboration):
- Reuters, AP, AFP wires for on-the-ground impact reporting.
- Disaster-management agencies (FEMA, NDMA-Pakistan, NDRF-India,
  Indonesia's BNPB) for response-status updates.
- Specialist outlets (Wired Science, Eos.org for AGU coverage) for
  context.

Excluded by default:
- Social-media-only magnitude / casualty claims without USGS / NOAA / NMA
  corroboration.
- Climate-attribution claims made within the first 72h of an event
  (rapid-attribution science exists but takes weeks; surface only when
  formally published, see §7).

---

## 4. Update Cadence

- **Acute phase** (first 24–72h): every 1–6h tied to agency-update
  cadence. Magnitude / intensity figures especially get re-checked
  aggressively as readings are revised.
- **Impact-emergence phase** (days 3–14): daily, focusing on casualty +
  damage figures as search-and-rescue and damage assessment progress.
- **Recovery / closeout phase**: weekly, until either an agency final
  report drops or the event drops out of the news cycle for ≥ 30 days.
- **Hazard-chain triggers** (tsunami warning issued post-quake; volcanic
  eruption ash plume reaching aviation routes): immediate update flagged
  `breaking`.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "M7.2 earthquake — Türkiye–Syria border").
- Magnitude / intensity as the headline figure with the
  hazard-appropriate scale (do not auto-convert to a generic "severity").
- Confidence flag prominently.
- Current alert/warning level if applicable.
- Last-updated timestamp.

For ongoing storms / fires / floods where the situation is evolving, the
Layer 1 card should make `last-updated` visually loud — a 6h-stale storm
card is misleading.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source
  attribution.
- Map view: affected-area outline at administrative granularity (not
  pseudo-precise epicenter dots when the hazard footprint is regional).
- Time-series chart for evolving hazards (storm intensity over forecast
  cone; wildfire acreage over time; floodwater stage gauge).
- Revision history for magnitude / intensity — earthquakes especially
  benefit from "first reading M6.8, revised to M7.2" being visible.
- Source-attribution panel with agency feed timestamps.
- Hazard-chain panel when relevant (e.g., tsunami advisory status under
  the earthquake tracker).
- Related-articles list.

---

## 6. Validation Source

**Authoritative.** Hazard-specific:
- Earthquakes → USGS ComCat (final magnitude, location, depth).
- Tropical cyclones → NHC / CPHC / JTWC final reports.
- Severe weather → NWS (US), national equivalents elsewhere.
- Wildfires → NIFC / Cal Fire (US), national equivalents.
- Volcanic activity → relevant volcano observatory + Smithsonian GVP.

**Cross-reference.** National meteorological agencies and disaster-
management bodies validate impact figures (affected population, damage,
casualties) that don't show up in geophysical instrument feeds.

**Editorial override.** DrJ may downgrade magnitude confidence manually
when wire reports are running ahead of agency revisions — the default
should follow the agency, not the headline.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **Magnitude-revision convention.** USGS revises earthquake magnitudes
  quickly (often within hours) as more seismic stations report. Tracker
  proposal: show current value + most-recent revision timestamp +
  optional "first reading" footnote when material. Acceptable display
  pattern?
- **Per-hazard scale heterogeneity.** Richter / Mw, Saffir-Simpson, EF,
  Beaufort, VEI, NWS-flood-stage tiers, Bortle (for non-event but related
  observability), AQI for air-quality cascade. No unified "severity"
  exists; tracker must display the mode-appropriate scale and not coerce.
- **Multi-hazard chains.** Earthquake → tsunami → coastal flooding →
  nuclear cooling failure (Tōhoku 2011) is one event in lived experience
  but multiple events in instrument feeds. One umbrella tracker with
  hazard-child entries, or separate trackers cross-linked? Lean umbrella;
  defer schema decision to Sprint 1.2.
- **Casualty vs affected-population distinction.** Often blurred in early
  reporting. Tracker must keep these as separate metrics with explicit
  definitions — affected = within impact zone; casualties = killed /
  injured / missing.
- **Damage estimate sources.** Insurance-industry, government, and NOAA
  NCEI billion-dollar-disaster figures use different methodologies and
  often differ by 2–10×. Capture multiple when available with attribution;
  do not pick one as canonical without flagging.
- **Climate-attribution claims.** Rapid-attribution science (World Weather
  Attribution etc.) publishes credible event-attribution analyses within
  weeks of events. Tracker should accept these as a Layer-2 panel when
  formally published, with explicit "this is attribution science, not
  the event itself" framing. Do not relay informal hot-take attributions
  in early reporting.
- **Wildfire acreage volatility.** Fire perimeter changes hourly during
  active spread; the headline figure goes stale fast. Tracker needs an
  explicit "as of HH:MM" badge tighter than other hazards.
- **Volcanic-event ambiguity.** Continuous low-level activity (Kīlauea,
  Stromboli) doesn't fit single-event tracker framing. Long-running
  volcanic-activity trackers vs episode-specific ones — defer scope
  decision to Sprint 1.5.
- **Cross-border events.** A storm crossing 4 countries needs each
  national meteorological agency's local impact figures aggregated
  without losing per-country attribution. Defer schema mechanics to
  Sprint 1.2.
