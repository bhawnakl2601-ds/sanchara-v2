# Data dictionary

Raw files (read-only, never edited) live in `data/raw/`. `python -m backend.ml.preprocessing` produces `data/processed/hourly_long.csv` (92,280 rows) and the reports in `data/metadata/`.

## Sources
| File | Content | Notes |
|---|---|---|
| `station_codes.csv` | station name ↔ code | Four names contain unquoted commas; parsed by splitting on the **first** comma only. |
| `station-hourly-sep2025.xlsx` | Sep 2025 hourly, sheets **Entry** and **Exit** | Hourly passenger counts per station. |
| `station-hourly-aug2025.xlsx` | Aug 2025 hourly | Single series. **Inferred to be entries** (from its profile vs. Sep entries); not stated by the file. 139 station-days absent, kept absent (not imputed as 0). |
| `station-code-matrix-aug2025.xlsx` | station × station grid | Looks origin–destination-like. Status uncertain; **not used for ML**, exploratory only. |

## `hourly_long.csv`
`date, hour, station_id (SANCHARA id), station_code, entries, exits, source, month, dow, is_weekend, is_holiday`
- `exits` is empty for August (no exit series). Hour 23 is a partial interval in the source.
- Dates 2025-08-19 … 2025-08-31 have no data. Only 2025-08-15 is flagged a verified holiday.

## Station mapping (`station_mapping.csv`)
Source-name → code → SANCHARA station id. Manual override: `KRMA → KRAM`. Warnings in `validation_report.json`.

## Model (`model_report.json`, `backend/models_store/model_card.json`)
Random Forest on log1p(entries/exits); features: calendar, station, expanding-window history means/medians/max, rolling last-3 (leakage-free, month excluded). Chronological split with expanding folds; metrics MAE/RMSE/WAPE vs. baselines (same-hour mean, last-week-style baselines, random). Levels LOW/MODERATE/HIGH/VERY HIGH use each station's own P40/P70/P90 of hourly entries+exits.
