"""Data-quality audit of data/processed/hourly_long.csv -> data/metadata/data_audit.json (documented in docs/DATA_VALIDATION.md).
Run: PYTHONPATH=. python -m metro_backend.ml.audit"""
from __future__ import annotations
import json, datetime as dt
import pandas as pd
from .paths import PROCESSED, METADATA, METRO_JSON

def run() -> dict:
    d = pd.read_csv(PROCESSED/'hourly_long.csv'); metro = json.load(open(METRO_JSON)); ids = set(metro['stations'])
    dates = pd.to_datetime(d.business_date); full = pd.date_range(dates.min(), dates.max()); present = set(dates.dt.normalize())
    missing_days = [str(x.date()) for x in full if x not in present]
    key = ['business_date', 'station_id', 'hour']; dup = int(d.duplicated(key).sum())
    per_day = d.groupby('business_date').station_id.nunique(); expected = len(ids)
    short = {k: int(v) for k, v in per_day[per_day < expected].items()}
    obs = d.groupby('source_dataset').agg(rows=('entries', 'size'), inferred=('measure_inferred', 'any'), has_exits=('exits', lambda s: bool(s.notna().any())), first=('business_date', 'min'), last=('business_date', 'max')).reset_index().to_dict('records')
    rep = dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), rows=int(len(d)), stations_in_data=int(d.station_id.nunique()), stations_in_network=expected,
        unknown_station_ids=sorted(set(d.station_id) - ids), network_stations_without_data=sorted(ids - set(d.station_id)),
        date_range=[str(dates.min().date()), str(dates.max().date())], calendar_days_without_any_data=missing_days, duplicate_station_hour_rows=dup,
        hours_outside_0_23=int((~d.hour.between(0, 23)).sum()), negative_values=int((d.entries < 0).sum() + (d.exits.fillna(0) < 0).sum()), null_entries=int(d.entries.isna().sum()),
        station_days_below_full_station_count=short, datasets=obs,
        direction_notes=['sep2025: separate Entry and Exit sheets (labelled by the source).', 'aug2025: ONE series, not labelled. Treated as ENTRIES by inference (flag measure_inferred=True on every row); exits are not available for August.'],
        observed_vs_estimated='Every value in hourly_long.csv is an OBSERVED figure from the source files; nothing is imputed. Absent station-days stay absent. Model outputs are stored separately (models_store).',
        imputation='none', partial_intervals=int(d.partial_interval.astype(bool).sum()), partial_interval_note="'23:00 to Last train' is not a full hour; excluded from training and statistics.")
    METADATA.mkdir(parents=True, exist_ok=True); json.dump(rep, open(METADATA/'data_audit.json', 'w'), indent=2); return rep
if __name__ == '__main__': print(json.dumps(run(), indent=1)[:3000])
