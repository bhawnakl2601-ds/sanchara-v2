"""Repeatable preprocessing: raw workbooks -> validated long-format hourly dataset + data-quality report.

Run:  python -m metro_backend.ml.preprocessing      (from the sanchara/ folder)
New monthly files: add an entry to SOURCES below (or drop a workbook in data/raw and register it) and re-run;
nothing downstream (features, training) needs to change.
"""
from __future__ import annotations
import json, re, datetime as dt
import numpy as np, pandas as pd
from .paths import RAW, PROCESSED, METADATA
from .stations import build_mapping, validate_mapping, hourly_id

HOURS = list(range(24))
# One entry per hourly workbook. `measure` for the August file is INFERRED (see data dictionary) and flagged as such.
SOURCES = [
    dict(name='sep2025_entry', file='station-hourly-sep2025.xlsx', sheet='Sep-2025 Entry', layout='H', measure='entries', measure_inferred=False),
    dict(name='sep2025_exit',  file='station-hourly-sep2025.xlsx', sheet='Sep-2025 Exit',  layout='H', measure='exits',   measure_inferred=False),
    dict(name='aug2025',       file='station-hourly-aug2025.xlsx', sheet=0,                layout='RANGE', measure='entries', measure_inferred=True),
]
# Dates verified as public holidays by the fare rules already in SANCHARA (metro.json: 15 Aug). Others are NOT assumed.
VERIFIED_HOLIDAYS = {'2025-08-15'}
ALIAS_FIX = {'111-Bangalore City Station': '111-KSR Railway Station'}   # same station, renamed between files

def _hour_cols(df: pd.DataFrame, layout: str):
    if layout == 'H': cols = {f'H{h:02d}': h for h in HOURS}
    else:
        cols = {}
        for c in df.columns:
            m = re.match(r'^\s*(\d{2}):00\s*Hrs\s*To\s+(?:\d{2}:00\s*Hrs|Last train)', str(c))
            if m: cols[c] = int(m.group(1))
    if sorted(cols.values()) != HOURS: raise ValueError(f'expected 24 hourly columns, got {sorted(cols.values())}')
    return cols

def load_source(src: dict):
    raw = pd.read_excel(RAW/src['file'], sheet_name=src['sheet'])
    raw['STATION'] = raw['STATION'].astype(str).str.strip().replace(ALIAS_FIX)
    raw['BUSINESS DATE'] = pd.to_datetime(raw['BUSINESS DATE'], errors='raise').dt.normalize()
    cols = _hour_cols(raw, src['layout'])
    long = raw.melt(id_vars=['BUSINESS DATE', 'STATION', 'TOTAL'], value_vars=list(cols), var_name='col', value_name='value')
    long['hour'] = long['col'].map(cols)
    long['partial_interval'] = (src['layout'] == 'RANGE') & (long['hour'] == 23)  # '23:00 Hrs To Last train' is not a full hour
    return raw, cols, long

def run() -> dict:
    PROCESSED.mkdir(parents=True, exist_ok=True); METADATA.mkdir(parents=True, exist_ok=True)
    report: dict = dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), sources={}, warnings=[])
    first_raw, _, _ = load_source(SOURCES[0])
    m_codes = list(pd.read_excel(RAW/'station-code-matrix-aug2025.xlsx', nrows=1).columns[2:])
    mapping = build_mapping(sorted(first_raw.STATION.unique()), m_codes)
    report['station_mapping_warnings'] = validate_mapping(mapping)
    mapping.to_csv(METADATA/'station_mapping.csv', index=False)
    key = dict(zip(mapping.hourly_station, mapping.sanchara_id)); dname = dict(zip(mapping.hourly_station, mapping.display_name))
    frames = {}
    for src in SOURCES:
        raw, cols, long = load_source(src); h = [c for c in cols]
        info = dict(file=src['file'], sheet=str(src['sheet']), rows=len(raw), date_min=str(raw['BUSINESS DATE'].min().date()), date_max=str(raw['BUSINESS DATE'].max().date()),
                    stations=int(raw.STATION.nunique()), duplicate_station_days=int(raw.duplicated(['BUSINESS DATE', 'STATION']).sum()),
                    null_cells=int(raw.isna().sum().sum()), negative_cells=int((raw[h] < 0).sum().sum()),
                    total_mismatch_rows=int((raw[h].sum(axis=1) != raw['TOTAL']).sum()), unmapped_stations=sorted(set(raw.STATION) - set(key)),
                    measure=src['measure'], measure_inferred=src['measure_inferred'])
        days = pd.date_range(raw['BUSINESS DATE'].min(), raw['BUSINESS DATE'].max())
        exp = len(days) * len(key); info['expected_station_days'] = exp; info['missing_station_days'] = exp - len(raw.drop_duplicates(['BUSINESS DATE', 'STATION']))
        miss = (pd.MultiIndex.from_product([days, sorted(key)]).difference(pd.MultiIndex.from_frame(raw[['BUSINESS DATE', 'STATION']].drop_duplicates())))
        info['missing_by_station'] = pd.Series([s for _, s in miss]).value_counts().to_dict() if len(miss) else {}
        info['missing_by_date'] = {str(d.date()): int(n) for d, n in pd.Series([d for d, _ in miss]).value_counts().sort_index().items()} if len(miss) else {}
        zero_days = raw[raw['TOTAL'] == 0]; info['all_zero_station_days'] = len(zero_days)
        if info['unmapped_stations']: report['warnings'].append(f"{src['name']}: unmapped stations {info['unmapped_stations']}")
        if info['missing_station_days']: report['warnings'].append(f"{src['name']}: {info['missing_station_days']} station-days absent (kept absent, NOT imputed as zero)")
        report['sources'][src['name']] = info
        long = long.drop_duplicates(['BUSINESS DATE', 'STATION', 'hour'])
        long['station_id'] = long.STATION.map(key); long['station_name'] = long.STATION.map(dname)
        long[src['measure']] = long['value']; long['source_dataset'] = src['name']; long['measure_inferred'] = src['measure_inferred']
        frames[src['name']] = long[['BUSINESS DATE', 'station_id', 'station_name', 'hour', src['measure'], 'source_dataset', 'partial_interval', 'measure_inferred']].rename(columns={'BUSINESS DATE': 'business_date'})
    # combine: entries and exits only after validating the two September sheets cover identical keys
    k = ['business_date', 'station_id', 'hour']
    se, sx = frames['sep2025_entry'], frames['sep2025_exit']
    report['sep_entry_exit_same_keys'] = bool(set(map(tuple, se[k].values)) == set(map(tuple, sx[k].values)))
    sep = se.drop(columns=['source_dataset']).merge(sx[k + ['exits']], on=k, how='outer').assign(source_dataset='sep2025')
    aug = frames['aug2025'].assign(exits=np.nan)
    df = pd.concat([aug[sep.columns], sep[sep.columns]], ignore_index=True)
    df['business_date'] = pd.to_datetime(df['business_date'])
    df = df.sort_values(['station_id', 'business_date', 'hour']).reset_index(drop=True)
    df['is_verified_holiday'] = df.business_date.dt.strftime('%Y-%m-%d').isin(VERIFIED_HOLIDAYS)
    # outliers: robust z-score of entries within (station, hour-of-day, weekend) groups; flagged, never deleted
    df['weekend'] = df.business_date.dt.dayofweek >= 5
    g = df.groupby(['station_id', 'hour', 'weekend'])['entries']
    med = g.transform('median'); mad = g.transform(lambda s: (s - s.median()).abs().median())
    df['entries_robust_z'] = (df.entries - med) / (1.4826 * mad.replace(0, np.nan))
    n_out = int((df.entries_robust_z.abs() > 6).sum()); report['outlier_cells_entries_|z|>6'] = n_out
    df.drop(columns=['weekend']).to_csv(PROCESSED/'hourly_long.csv', index=False)
    report['processed'] = dict(rows=len(df), date_min=str(df.business_date.min().date()), date_max=str(df.business_date.max().date()), stations=int(df.station_id.nunique()),
                               entries_rows=int(df.entries.notna().sum()), exits_rows=int(df.exits.notna().sum()))
    report['dates_without_data'] = [str(d.date()) for d in pd.date_range(df.business_date.min(), df.business_date.max()) if d not in set(df.business_date)]
    if report['dates_without_data']: report['warnings'].append(f"calendar gap with no data: {report['dates_without_data'][0]} .. {report['dates_without_data'][-1]} ({len(report['dates_without_data'])} days)")
    return report

if __name__ == '__main__':
    r = run(); json.dump(r, open(METADATA/'validation_report.json', 'w'), indent=2, default=str)
    print(json.dumps({k: r[k] for k in ('processed', 'warnings', 'station_mapping_warnings', 'sep_entry_exit_same_keys', 'outlier_cells_entries_|z|>6')}, indent=1, default=str))
