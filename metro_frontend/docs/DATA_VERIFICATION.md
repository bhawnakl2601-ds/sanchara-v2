# Data verification (checked 2026-11-16)

## Fares
- In app: BMRCL chart effective **14 Feb 2025** (slabs ₹10…₹90, stations travelled excluding the origin). Station-pair fares are in `src/data/metro.json`; slabs, discounts and passes in `src/engine/fareConfig.ts`.
- Automated checks: all 6,806 ordered station pairs have a fare in {10…90}, symmetric; slab boundaries; token = QR; smart-card 5% peak / 10% off-peak / 10% Sunday & 26 Jan, 15 Aug, 2 Oct.
- **Not confirmed:** press reports (Feb 2026) describe a 5% annual revision (₹10→11 … ₹90→95; tourist cards ₹313/₹628/₹943 on smart card) announced for 9 Feb 2026, then reported "on hold". I could not find an official BMRCL notification showing whether it took effect, so **the 2025 values were not changed**. Check https://english.bmrc.co.in.
- **Discrepancy:** the app lists the 5-day tourist card at ₹800; one secondary source lists the previous 5-day smart-card price as ₹900. Unresolved — verify at a BMRCL counter.

## Stations
- Tested: 83 stations, 3 lines, every station on a line, segments connect declared stations only, graph connected, 6,806 pairs routable.
- Not re-verified against BMRCL: spelling, coordinates, Kannada names, aliases, interchange walk times (`transferSeconds` has two entries; others default to 120 s).
- Source of the dataset: BMRCL GTFS (feed 2026-08-17) + OSM KML + BMRCL fare chart, as recorded in `metro.json`.

## Accessibility
- All 83 stations carry `wheelchair: true` in the dataset. This is a **station-level flag only**. The app treats every station as `unverified` and says so in the route result.
- Lifts, escalators, step-free entrances, accessible toilets, tactile paving, audio assistance: **no data**. Add verified records to `src/data/accessibility.json` (format in its `_readme`).

## Crowd model
- Stored holdout metrics (entry MAE 41.73 / WAPE 11.29%, exit MAE 43.76 / WAPE 11.88%) come from `data/metadata/model_report.json`. They describe station-level hourly demand, not coach occupancy or live counts. Not re-evaluated in this pass.
