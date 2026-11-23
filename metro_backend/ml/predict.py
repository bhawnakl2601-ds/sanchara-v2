"""Prediction service for 'AI-Predicted Station Demand'. Falls back to a labelled historical baseline if the model cannot load.
Never returns random values. Predicts hourly ENTRY/EXIT counts, not occupancy."""
from __future__ import annotations
import datetime as dt, threading
import numpy as np, pandas as pd
from .paths import MODEL_DIR
from .features import MODEL_FEATURES, apply_frozen
from .preprocessing import VERIFIED_HOLIDAYS

LEVELS = ['LOW', 'MODERATE', 'HIGH', 'VERY HIGH']
READY, LOADING, UNAVAILABLE, ERROR = 'MODEL_READY', 'MODEL_LOADING', 'MODEL_UNAVAILABLE', 'MODEL_ERROR'
REMEDY = 'Run `PYTHONPATH=. python -m metro_backend.ml.train` (needs scikit-learn) to rebuild the model on this machine.'

class Predictor:
    """Loads the version-independent artefact (see artifact.py). State is explicit; there is no fallback that invents numbers."""
    def __init__(self, load_now: bool = True):
        self.bundle = None; self.error = None; self.state = LOADING; self._lock = threading.Lock(); self.loaded_at = None
        if load_now: self.load()
    def load(self):
        self.state = LOADING
        try:
            from . import artifact
            if not (MODEL_DIR/'meta.json').exists():
                self.bundle = None; self.state = UNAVAILABLE; self.error = f'No model artefact found. {REMEDY}'; return
            b = artifact.load(MODEL_DIR); b['station_index'] = b['meta']['station_index']; self.bundle = b
            self._self_check(); self.state = READY; self.error = None; self.loaded_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
        except Exception as e:      # damaged / incompatible artefact -> explicit MODEL_ERROR, never fake output
            self.bundle = None; self.state = ERROR; self.error = f'{type(e).__name__}: {e}. {REMEDY}'
    def _self_check(self):
        """Smoke-test a real prediction so a structurally loadable but broken artefact is reported as MODEL_ERROR."""
        sid = sorted(self.bundle['station_index'])[0]; res = self._run(dt.date(2025, 9, 10), [sid], [9])
        if res is None or not np.isfinite(res[1]['entries'][0]).all(): raise ValueError('self-check prediction was not finite')
    @property
    def meta(self) -> dict:
        m = (self.bundle or {}).get('meta')
        return dict(m) if m else dict(model_version=None, data_through=None, data_from=None)
    def status(self) -> dict:
        m = self.meta
        return dict(state=self.state, model_loaded=self.state == READY, mode='ml' if self.state == READY else 'unavailable', error=self.error, model_version=m.get('model_version'), data_from=m.get('data_from'), data_through=m.get('data_through'),
                    trained_utc=m.get('trained_utc'), training_environment=m.get('training_environment'), loaded_at=self.loaded_at, label='AI-Predicted Station Demand (historical entry/exit counts; not live occupancy)')
    def stations(self) -> list[str]: return sorted(self.bundle['station_index']) if self.bundle else []
    def _frame(self, date: dt.date, stations: list[str], hours: list[int]) -> pd.DataFrame:
        off = int(date.weekday() >= 5 or date.isoformat() in VERIFIED_HOLIDAYS)
        idx = self.bundle['station_index']
        return pd.DataFrame([dict(station_id=s, hour=h, dow=date.weekday(), is_off_day=off, station_idx=idx[s]) for s in stations for h in hours])
    def _frozen(self, t: str) -> dict: tb = self.bundle['tables']; return dict(sh_dt=tb[f'frozen_{t}_sh_dt'], sh_all=tb[f'frozen_{t}_sh_all'], smax=tb[f'frozen_{t}_smax'])
    def _run(self, date, stations, hours):
        b = self.bundle; out = {}
        if b is None: return None
        from .artifact import forest_predict
        fr = self._frame(date, stations, hours)
        for t in ('entries', 'exits'):
            f = apply_frozen(fr, self._frozen(t)); X = f[MODEL_FEATURES].fillna(0).values
            tree = np.clip(np.expm1(forest_predict(b['forests'][t], X)), 0, None); mean = tree.mean(0); cal = b['meta']['calibration'][t]; lp = np.log1p(mean)
            lo, hi = np.clip(np.expm1(lp + cal['q_lo']), 0, None), np.expm1(lp + cal['q_hi'])        # empirical, calibrated on out-of-sample residuals
            out[t] = (mean, lo, hi, f['hist_mean_sh_dt'].fillna(0).values)
        return fr, out
    def predict(self, station_id: str, date: dt.date, hours: list[int] | None = None) -> dict:
        hours = hours if hours is not None else list(range(5, 24))
        with self._lock: res = self._run(date, [station_id], hours)
        if res is None: return dict(available=False, state=self.state, reason=self.error or 'model not loaded', mode='unavailable')
        fr, o = res; th = self.bundle['tables']['thresholds']; th = th[th.station_id == station_id]
        rows = []
        for i, h in enumerate(hours):
            e, x = float(o['entries'][0][i]), float(o['exits'][0][i]); level = None
            if len(th):
                t = th.iloc[0]; v = e + x; level = LEVELS[0] if v < t.p40 else LEVELS[1] if v < t.p70 else LEVELS[2] if v < t.p90 else LEVELS[3]
            width = (o['entries'][2][i] - o['entries'][1][i]) / max(e, 20)
            rows.append(dict(hour=h, entries=round(e), exits=round(x), entries_range=[round(float(o['entries'][1][i])), round(float(o['entries'][2][i]))], exits_range=[round(float(o['exits'][1][i])), round(float(o['exits'][2][i]))],
                             level=level, hist_avg_entries=round(float(o['entries'][3][i])), hist_avg_exits=round(float(o['exits'][3][i])), uncertainty='LOW' if width < .35 else 'MEDIUM' if width < .8 else 'HIGH'))
        m = self.meta; return dict(available=True, mode='ml', station_id=station_id, date=date.isoformat(), daytype='off_day' if fr.is_off_day.iloc[0] else 'weekday', hours=rows,
            model_version=m.get('model_version'), data_from=m.get('data_from'), data_through=m.get('data_through'), generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            label='AI-Predicted Station Demand', disclaimer='Estimated hourly entries/exits from historical patterns (Aug 1-18 & Sep 1-30, 2025). Not live occupancy.',
            interval_note=self.interval_note())
    def interval_note(self) -> str:
        v = (self.meta.get('validation') or {}).get('entries', {}).get('random_forest', {}); c = v.get('interval80_coverage')
        return f"Range is an empirical 80% interval; on the final held-out week it contained {c*100:.0f}% of actual hourly entries." if c is not None else 'Range is an empirical 80% interval.'
    def heatmap(self, date: dt.date, hour: int) -> dict:
        with self._lock: res = self._run(date, self.stations(), [hour])
        if res is None: return dict(available=False, state=self.state, reason=self.error or 'model not loaded')
        fr, o = res; th = self.bundle['tables']['thresholds'].set_index('station_id'); items = []
        for i, s in enumerate(fr.station_id):
            e, x = float(o['entries'][0][i]), float(o['exits'][0][i]); v = e + x; lvl = None
            if s in th.index:
                t = th.loc[s]; lvl = LEVELS[0] if v < t.p40 else LEVELS[1] if v < t.p70 else LEVELS[2] if v < t.p90 else LEVELS[3]
            items.append(dict(station_id=s, entries=round(e), exits=round(x), demand=round(v), level=lvl))
        m = self.meta; return dict(available=True, date=date.isoformat(), hour=hour, items=items, model_version=m.get('model_version'), data_through=m.get('data_through'),
                                   generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), label='AI-Predicted Station Demand')
    def profile(self, station_id: str) -> dict:
        if not self.bundle: return dict(available=False)
        p = self.bundle['tables']['profiles']; p = p[p.station_id == station_id]
        return dict(available=True, station_id=station_id, profiles={dt_: [dict(hour=int(r.hour), entries=r.entries, exits=None if pd.isna(r.exits) else r.exits) for r in g.itertuples()] for dt_, g in p.groupby('daytype')})
    def validation(self) -> dict:
        return (self.bundle or {}).get('meta', {}).get('validation', {})
