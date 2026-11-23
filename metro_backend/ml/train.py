"""Train + evaluate the station-demand models and save the artefact.

Run from sanchara/:   PYTHONPATH=. python -m metro_backend.ml.train
Compares (1) same-hour historical average, (2) 7-day moving average, (3) Random Forest, (4) HistGradientBoosting
(a sklearn stand-in; XGBoost is optional and not required) with CHRONOLOGICAL splits only (fixed forecast origin).
"""
from __future__ import annotations
import json, hashlib, datetime as dt, warnings
import sys, platform
import numpy as np, pandas as pd
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from .paths import PROCESSED, METADATA, MODEL_DIR
from .features import add_calendar, expanding_history, frozen_history, apply_frozen, add_lags, MODEL_FEATURES, LAG_FEATURES
from .evaluate import metrics, breakdown, interval_coverage, peak_breakdown
from . import artifact
warnings.filterwarnings('ignore')

FOLDS = [('2025-09-08', '2025-09-14'), ('2025-09-15', '2025-09-21'), ('2025-09-22', '2025-09-30')]   # last fold = headline test
RF_PARAMS = dict(n_estimators=60, min_samples_leaf=10, max_features=0.6, n_jobs=2, random_state=42)
LEVELS = ['LOW', 'MODERATE', 'HIGH', 'VERY HIGH']; PCTS = (40, 70, 90)

def load() -> pd.DataFrame:
    df = pd.read_csv(PROCESSED/'hourly_long.csv', parse_dates=['business_date'])
    df = df[~df.partial_interval.astype(bool)]            # '23:00 to Last train' is not a full hour -> excluded from training/stats
    idx = {s: i for i, s in enumerate(sorted(df.station_id.unique()))}
    return add_calendar(df, idx), idx

def daytype(d): return np.where(d.is_off_day == 1, 'off_day', 'weekday')

def fit_rf(X, y): m = RandomForestRegressor(**RF_PARAMS); m.fit(X, np.log1p(y)); return m
def predict_rf(m, X):
    tree = np.expm1(np.stack([t.predict(X.values) for t in m.estimators_])); tree = np.clip(tree, 0, None)
    return tree.mean(0), np.percentile(tree, 10, axis=0), np.percentile(tree, 90, axis=0)

NOMINAL = 0.80
def calibrate(tef: pd.DataFrame) -> dict:
    """Split-conformal style: quantiles of out-of-sample log-residuals (observed vs predicted), so the interval is empirical, not assumed."""
    r = np.log1p(tef.y.values) - np.log1p(np.clip(tef.p.values, 0, None)); lo, hi = np.quantile(r, [(1 - NOMINAL) / 2, 1 - (1 - NOMINAL) / 2])
    return dict(q_lo=float(lo), q_hi=float(hi), n=int(len(r)), nominal=NOMINAL)
def apply_cal(tef: pd.DataFrame, cal: dict) -> pd.DataFrame:
    t = tef.copy(); lp = np.log1p(np.clip(t.p.values, 0, None)); t['lo'] = np.clip(np.expm1(lp + cal['q_lo']), 0, None); t['hi'] = np.expm1(lp + cal['q_hi']); return t

def evaluate_fold(df, target, start, end, with_extras=True):
    d = df[df[target].notna()]
    tr, te = d[d.business_date < start], d[(d.business_date >= start) & (d.business_date <= end)].copy()
    trf = expanding_history(tr, target).dropna(subset=['hist_mean_sh_dt', 'hist_med_sh_dt', 'hist_mean_sh_all', 'hist_max_station', 'roll_last3_sh_dt'])
    fh = frozen_history(tr, target); tef = apply_frozen(te, fh)
    ok = tef[MODEL_FEATURES].notna().all(axis=1); tef = tef[ok].copy()
    y = tef[target].values; res = {}
    res['baseline_same_hour_avg'] = metrics(y, tef.hist_mean_sh_dt)
    ma7 = tr.sort_values('business_date').groupby(['station_id', 'hour', 'is_off_day'])[target].apply(lambda s: s.tail(7).mean()).rename('ma7').reset_index()
    tef = tef.merge(ma7, on=['station_id', 'hour', 'is_off_day'], how='left'); res['baseline_moving_avg_7'] = metrics(y, tef.ma7)
    rf = fit_rf(trf[MODEL_FEATURES], trf[target]); mean, lo, hi = predict_rf(rf, tef[MODEL_FEATURES]); res['random_forest'] = metrics(y, mean)
    res['random_forest']['interval80_coverage'] = interval_coverage(y, lo, hi)
    if with_extras:
        hgb = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, random_state=42).fit(trf[MODEL_FEATURES], np.log1p(trf[target]))
        res['hist_gradient_boosting'] = metrics(y, np.clip(np.expm1(hgb.predict(tef[MODEL_FEATURES])), 0, None))
        # day-ahead variant (uses the previous day's / previous week's ACTUALS, so only valid for short horizons)
        a = add_lags(pd.concat([tr, te]), target)
        trl = expanding_history(a[a.business_date < start], target).dropna(subset=MODEL_FEATURES + LAG_FEATURES[1:])
        tel = apply_frozen(a[(a.business_date >= start) & (a.business_date <= end)], fh).dropna(subset=MODEL_FEATURES + LAG_FEATURES[1:])
        trl = add_lags(pd.concat([tr, te]), target).merge(trl[['station_id', 'business_date', 'hour'] + [c for c in trl.columns if c.startswith('hist_') or c.startswith('roll_')]], on=['station_id', 'business_date', 'hour'], how='inner')
        feats = MODEL_FEATURES + LAG_FEATURES[1:]
        try:
            rfl = fit_rf(trl[feats].fillna(0) if False else trl.dropna(subset=feats)[feats], trl.dropna(subset=feats)[target])
            ml, _, _ = predict_rf(rfl, tel[feats]); res['random_forest_with_lag7_(horizon<=7d)'] = metrics(tel[target], ml)
        except Exception as e: res['random_forest_with_lag7_(horizon<=7d)'] = dict(error=str(e))
    tef['p'] = mean; tef['lo'] = lo[ok.values[ok.values]] if False else lo; tef['hi'] = hi; tef['y'] = y; tef['daytype'] = daytype(tef)
    return res, tef, (tr.business_date.min(), tr.business_date.max())

def class_thresholds(d: pd.DataFrame) -> pd.DataFrame:
    """Per-station percentiles of hourly demand (entries+exits) over operating hours 05-23. Uses only rows having both measures."""
    x = d[d.entries.notna() & d.exits.notna() & d.hour.between(5, 23)].copy(); x['demand'] = x.entries + x.exits
    return x.groupby('station_id').demand.quantile([p / 100 for p in PCTS]).unstack().rename(columns={p / 100: f'p{p}' for p in PCTS}).reset_index()

def classify(v, p40, p70, p90): return np.select([v < p40, v < p70, v < p90], LEVELS[:3], LEVELS[3])

def main():
    df, idx = load(); report = dict(trained_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), split='chronological, fixed forecast origin', folds=FOLDS, targets={})
    cals = {}
    for target in ['entries', 'exits']:
        folds = {}; fold_tefs = []
        for i, (s, e) in enumerate(FOLDS):
            r, tef, cov = evaluate_fold(df, target, s, e, with_extras=(i == len(FOLDS) - 1)); folds[f'{s}..{e}'] = dict(train_coverage=[str(cov[0].date()), str(cov[1].date())], results=r); fold_tefs.append(tef)
        # Calibrate the 80% interval on EARLIER folds' out-of-sample residuals, then measure coverage on the final, untouched fold.
        cal = calibrate(pd.concat(fold_tefs[:-1])); final_tef = apply_cal(fold_tefs[-1], cal)
        key = f'{FOLDS[-1][0]}..{FOLDS[-1][1]}'
        folds[key]['results']['random_forest']['interval80_coverage_raw_tree_percentiles'] = folds[key]['results']['random_forest'].pop('interval80_coverage')
        folds[key]['results']['random_forest']['interval80_coverage'] = interval_coverage(final_tef.y, final_tef.lo, final_tef.hi)
        folds[key]['results']['random_forest']['interval80_mean_width'] = float((final_tef.hi - final_tef.lo).mean())
        bd = breakdown(final_tef); bd['by_peak'] = peak_breakdown(final_tef)
        final_cal = calibrate(pd.concat(fold_tefs)); cals[target] = final_cal
        report['targets'][target] = dict(folds=folds, headline_fold=f'{FOLDS[-1][0]}..{FOLDS[-1][1]}', headline_breakdown=bd)
        rf, b1 = folds[f'{FOLDS[-1][0]}..{FOLDS[-1][1]}']['results']['random_forest'], folds[f'{FOLDS[-1][0]}..{FOLDS[-1][1]}']['results']['baseline_same_hour_avg']
        report['targets'][target]['rf_vs_baseline_mae_improvement_pct'] = round(100 * (b1['mae'] - rf['mae']) / b1['mae'], 1)
        if target == 'entries': keep_tef = final_tef
    # --- classification thresholds: fit on data BEFORE the headline fold, validate on the headline fold --------------------------------
    pre = df[df.business_date < FOLDS[-1][0]]; th = class_thresholds(pre)
    test = df[(df.business_date >= FOLDS[-1][0]) & df.entries.notna() & df.exits.notna() & df.hour.between(5, 23)].copy(); test['demand'] = test.entries + test.exits
    test = test.merge(th, on='station_id'); test['cls'] = classify(test.demand, test.p40, test.p70, test.p90)
    dist = test.cls.value_counts(normalize=True).reindex(LEVELS).fillna(0).round(3).to_dict()
    report['crowd_classification'] = dict(thresholds_percentiles=PCTS, validated_on=FOLDS[-1], observed_share_in_holdout=dist, nominal_share=dict(zip(LEVELS, [.4, .3, .2, .1])),
        note='Relative demand index (percentile of each station\'s own historical hourly entries+exits). Not occupancy, not capacity.')
    # --- final models on ALL data -------------------------------------------------------------------------------------------------
    cov_all = dict(date_min=str(df.business_date.min().date()), date_max=str(df.business_date.max().date()))
    forests, tables, coverage = {}, {}, {}
    for target in ['entries', 'exits']:
        d = df[df[target].notna()]; f = expanding_history(d, target).dropna(subset=['hist_mean_sh_dt', 'hist_med_sh_dt', 'hist_mean_sh_all', 'hist_max_station', 'roll_last3_sh_dt'])
        forests[target] = artifact.export_forest(fit_rf(f[MODEL_FEATURES], f[target]))
        for k, v in frozen_history(d, target).items(): tables[f'frozen_{target}_{k}'] = v
        coverage[target] = dict(date_min=str(d.business_date.min().date()), date_max=str(d.business_date.max().date()), rows=int(len(d)), station_days=int(d.groupby(['station_id', 'business_date']).ngroups))
    tables['thresholds'] = class_thresholds(df)
    tables['profiles'] = df.assign(daytype=daytype(df)).groupby(['station_id', 'daytype', 'hour'])[['entries', 'exits']].mean().round(1).reset_index()
    ver = 'crowd-rf-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d') + '-' + hashlib.sha1(json.dumps(report['targets'], sort_keys=True, default=str).encode()).hexdigest()[:6]
    hk = f'{FOLDS[-1][0]}..{FOLDS[-1][1]}'
    meta = dict(model_version=ver, trained_utc=report['trained_utc'], data_through=cov_all['date_max'], data_from=cov_all['date_min'], station_index=idx, features=MODEL_FEATURES, rf_params=RF_PARAMS, calibration=cals, coverage=coverage,
                preprocessing='metro_backend/ml/preprocessing.py (partial 23:00-last-train intervals excluded)', validation=dict(entries=report['targets']['entries']['folds'][hk]['results'], exits=report['targets']['exits']['folds'][hk]['results']),
                training_environment=dict(python=platform.python_version(), numpy=np.__version__, pandas=pd.__version__, scikit_learn=__import__('sklearn').__version__),
                limitations=['Predicts hourly station ENTRY/EXIT counts from only Aug 1-18 and Sep 1-30 2025; no data for 19-31 Aug.', 'August has a single series that is INFERRED to be entries (source does not label it).', 'Not live occupancy and not coach crowding.', 'No event, weather or disruption data; not validated for festivals, emergencies or disruptions.', 'Only 15 Aug 2025 is flagged as a holiday.'])
    artifact.save(MODEL_DIR, forests, tables, meta)
    (MODEL_DIR/'model_card.json').write_text(json.dumps({k: v for k, v in meta.items() if k not in ('station_index', 'checksums')}, indent=2, default=str))
    report['model_version'] = ver; report['calibration'] = cals; report['interval_note'] = f'{int(NOMINAL*100)}% interval = empirical quantiles of out-of-sample log-residuals from earlier folds; coverage measured on the final fold.'
    json.dump(report, open(METADATA/'model_report.json', 'w'), indent=2, default=str)
    keep_tef.to_csv(PROCESSED/'holdout_predictions_entries.csv', index=False)
    print(json.dumps({'version': ver, **{t: {k: v['results'] for k, v in report['targets'][t]['folds'].items()} for t in report['targets']}, 'class': report['crowd_classification']}, indent=1, default=str))

if __name__ == '__main__': main()
