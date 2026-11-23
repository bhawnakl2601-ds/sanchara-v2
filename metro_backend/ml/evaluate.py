"""Metrics. Percentage error is WAPE (sum|e| / sum y), which stays defined when individual hours have zero riders."""
from __future__ import annotations
import numpy as np, pandas as pd

def metrics(y, p) -> dict:
    y, p = np.asarray(y, float), np.asarray(p, float); e = p - y
    big = y >= 50      # MAPE only where it is meaningful (small counts blow it up)
    return dict(n=int(len(y)), mae=float(np.mean(np.abs(e))), rmse=float(np.sqrt(np.mean(e ** 2))), wape=float(np.abs(e).sum() / y.sum()) if y.sum() > 0 else None, bias=float(e.mean()),
                mape_ge50=float(np.mean(np.abs(e[big]) / y[big])) if big.any() else None)

def breakdown(df: pd.DataFrame, y='y', p='p') -> dict:
    out = {}
    for name, key in [('by_hour', 'hour'), ('by_daytype', 'daytype'), ('by_station', 'station_id')]:
        out[name] = {str(k): metrics(g[y], g[p]) for k, g in df.groupby(key)}
    return out

def interval_coverage(y, lo, hi) -> float: return float(np.mean((np.asarray(y) >= lo) & (np.asarray(y) <= hi)))

PEAK_HOURS = set(range(7, 11)) | set(range(17, 21))
def peak_breakdown(df: pd.DataFrame, y='y', p='p') -> dict:
    pk = df.hour.isin(PEAK_HOURS); return {'peak_07-10_17-20': metrics(df[pk][y], df[pk][p]), 'non_peak': metrics(df[~pk][y], df[~pk][p])}
