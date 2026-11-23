"""Leakage-free feature engineering for hourly station demand.

Every history feature for a row on date D uses ONLY observations from dates < D (training rows, expanding window)
or only from the frozen training window (rows being forecast from a fixed origin). Nothing from the future leaks in.
Month is created (spec) but kept OUT of the model feature list: only Aug/Sep exist, so it would just memorise level shifts.
"""
from __future__ import annotations
import numpy as np, pandas as pd

HIST_FEATURES = ['hist_mean_sh_dt', 'hist_med_sh_dt', 'hist_max_station', 'hist_mean_sh_all', 'roll_last3_sh_dt']
CAL_FEATURES = ['hour', 'dow', 'is_off_day', 'station_idx']
MODEL_FEATURES = CAL_FEATURES + HIST_FEATURES
LAG_FEATURES = ['lag_1d_same_hour', 'lag_7d_same_hour']     # only valid for horizons <= 7 days; reported as a side experiment

def add_calendar(df: pd.DataFrame, station_index: dict[str, int]) -> pd.DataFrame:
    d = df.copy(); dt_ = pd.to_datetime(d.business_date)
    d['dow'] = dt_.dt.dayofweek; d['month'] = dt_.dt.month; d['is_weekend'] = (d.dow >= 5).astype(int)
    d['is_off_day'] = ((d.dow >= 5) | d.is_verified_holiday.astype(bool)).astype(int)   # weekend or verified holiday
    d['station_idx'] = d.station_id.map(station_index).astype(int)
    return d

def expanding_history(df: pd.DataFrame, target: str) -> pd.DataFrame:
    """Per-row stats from strictly earlier dates, grouped by station x hour x day-type."""
    d = df.sort_values(['station_id', 'hour', 'is_off_day', 'business_date']).copy()
    g = d.groupby(['station_id', 'hour', 'is_off_day'])[target]
    n = g.cumcount()
    d['hist_mean_sh_dt'] = (g.cumsum() - d[target]) / n.replace(0, np.nan)
    d['hist_med_sh_dt'] = g.transform(lambda s: s.shift(1).expanding().median())
    d['roll_last3_sh_dt'] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    g2 = d.sort_values(['station_id', 'hour', 'business_date']).groupby(['station_id', 'hour'])[target]
    d['hist_mean_sh_all'] = (g2.cumsum() - d.sort_values(['station_id', 'hour', 'business_date'])[target]) / g2.cumcount().replace(0, np.nan)
    d = d.sort_values(['station_id', 'business_date', 'hour'])
    gs = d.groupby('station_id')[target]
    # station peak so far: max over strictly earlier DAYS (whole earlier days only)
    day_max = d.groupby(['station_id', 'business_date'])[target].max().groupby(level=0).apply(lambda s: s.shift(1).cummax()).reset_index(level=0, drop=True)
    d = d.merge(day_max.rename('hist_max_station').reset_index(), on=['station_id', 'business_date'], how='left')
    return d

def frozen_history(train: pd.DataFrame, target: str) -> dict:
    """Stats frozen at a forecast origin (all training rows). Used for any future date."""
    t = train
    sh_dt = t.groupby(['station_id', 'hour', 'is_off_day'])[target].agg(hist_mean_sh_dt='mean', hist_med_sh_dt='median').reset_index()
    last3 = (t.sort_values('business_date').groupby(['station_id', 'hour', 'is_off_day'])[target].apply(lambda s: s.tail(3).mean()).rename('roll_last3_sh_dt').reset_index())
    sh_all = t.groupby(['station_id', 'hour'])[target].mean().rename('hist_mean_sh_all').reset_index()
    smax = t.groupby('station_id')[target].max().rename('hist_max_station').reset_index()
    return dict(sh_dt=sh_dt.merge(last3, on=['station_id', 'hour', 'is_off_day']), sh_all=sh_all, smax=smax)

def apply_frozen(rows: pd.DataFrame, fh: dict) -> pd.DataFrame:
    r = rows.merge(fh['sh_dt'], on=['station_id', 'hour', 'is_off_day'], how='left').merge(fh['sh_all'], on=['station_id', 'hour'], how='left').merge(fh['smax'], on='station_id', how='left')
    return r

def add_lags(df: pd.DataFrame, target: str) -> pd.DataFrame:
    """Observed value of the same station-hour 1 and 7 days earlier (NaN if that day is absent from the data)."""
    d = df.copy(); key = d[['station_id', 'hour']].astype(str).agg('|'.join, axis=1)
    s = pd.Series(d[target].values, index=pd.MultiIndex.from_arrays([key, pd.to_datetime(d.business_date)]))
    s = s[~s.index.duplicated()]
    for k, name in [(1, 'lag_1d_same_hour'), (7, 'lag_7d_same_hour')]:
        idx = pd.MultiIndex.from_arrays([key, pd.to_datetime(d.business_date) - pd.Timedelta(days=k)])
        d[name] = s.reindex(idx).values
    return d
