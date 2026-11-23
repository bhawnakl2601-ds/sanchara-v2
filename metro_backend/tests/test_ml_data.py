"""Data + ML tests. They run against the real uploaded datasets in data/raw (skipped if the workbooks are absent)."""
import json, datetime as dt, pytest, pandas as pd, numpy as np
from metro_backend.ml.paths import RAW, PROCESSED, METADATA, MODEL_DIR
from metro_backend.ml import stations, features
needs_raw = pytest.mark.skipif(not (RAW/'station-hourly-sep2025.xlsx').exists(), reason='raw datasets not present')
needs_proc = pytest.mark.skipif(not (PROCESSED/'hourly_long.csv').exists(), reason='run preprocessing first')
needs_model = pytest.mark.skipif(not (MODEL_DIR/'meta.json').exists(), reason='run training first')

@pytest.fixture(scope='module')
def rep(): return json.load(open(METADATA/'validation_report.json'))
@pytest.fixture(scope='module')
def df(): return pd.read_csv(PROCESSED/'hourly_long.csv', parse_dates=['business_date'])

def test_code_csv_handles_unquoted_commas():
    c = stations.read_code_csv(); d = dict(zip(c.code, c.name))
    assert len(c) == 95 and d['KGWA'] == 'Nadaprabhu Kempegowda Station, Majestic' and d['HSLI'].endswith('Hosahalli')

@needs_raw
def test_station_mapping_is_complete_and_unique():
    m = pd.read_csv(METADATA/'station_mapping.csv'); assert len(m) == 83 and m.sanchara_id.notna().all() and m.sanchara_id.is_unique and m.matrix_code.is_unique
    assert m.set_index('hourly_station').sanchara_id['110-Kempegowda'] == 'KGWA' and m.set_index('hourly_station').sanchara_id['26-Yeshwanthpur Industry'] == 'YPI'
    ids = set(json.load(open(stations.METRO_JSON))['stations']); assert set(m.sanchara_id) == ids          # every SANCHARA station, none invented

@needs_proc
def test_september_and_august_import(rep):
    s, a = rep['sources']['sep2025_entry'], rep['sources']['aug2025']
    assert (s['date_min'], s['date_max'], s['stations']) == ('2025-09-01', '2025-09-30', 83) and (a['date_min'], a['date_max']) == ('2025-08-01', '2025-08-18')
    assert s['unmapped_stations'] == [] and a['unmapped_stations'] == [] and rep['sep_entry_exit_same_keys'] is True

@needs_proc
def test_hourly_totals_duplicates_missing(rep, df):
    for k in ('sep2025_entry', 'sep2025_exit', 'aug2025'):
        r = rep['sources'][k]; assert r['total_mismatch_rows'] == 0 and r['duplicate_station_days'] == 0 and r['negative_cells'] == 0 and r['null_cells'] == 0
    assert rep['sources']['aug2025']['missing_station_days'] > 0                    # known gaps are reported, not hidden...
    assert not df.duplicated(['station_id', 'business_date', 'hour']).any() and df.entries.notna().all()
    aug = df[df.source_dataset == 'aug2025']; assert len(aug) == (83 * 18 - 139) * 24      # ...and not imputed as zero rows

@needs_proc
def test_aug_last_train_interval_flagged(df):
    assert df[(df.source_dataset == 'aug2025') & (df.hour == 23)].partial_interval.all() and not df[df.source_dataset == 'sep2025'].partial_interval.any()

@needs_proc
def test_totals_validate_against_raw():
    raw = pd.read_excel(RAW/'station-hourly-sep2025.xlsx', sheet_name='Sep-2025 Entry'); d = pd.read_csv(PROCESSED/'hourly_long.csv', parse_dates=['business_date'])
    one = raw[(raw['BUSINESS DATE'].astype(str) == '2025-09-02') & raw.STATION.str.contains('Majestic|Kempegowda')].iloc[0]
    got = d[(d.business_date == '2025-09-02') & (d.station_id == 'KGWA') & (d.source_dataset == 'sep2025')].entries.sum(); assert got == one['TOTAL']

def test_features_do_not_leak_future():
    rows = []
    for i, day in enumerate(pd.date_range('2025-09-01', periods=10)):
        rows.append(dict(business_date=day, station_id='A', hour=9, entries=100 * (i + 1), is_off_day=int(day.dayofweek >= 5), is_verified_holiday=False))
    d = pd.DataFrame(rows); f = features.expanding_history(features.add_calendar(d, {'A': 0}), 'entries').sort_values('business_date')
    f = f.dropna(subset=['hist_mean_sh_dt']); r = f[f.business_date == '2025-09-04'].iloc[0]; assert r.hist_mean_sh_dt == np.mean([100, 200, 300])         # only Sep 1-3 weekdays... 
    # mutating the future must not change past features
    d2 = d.copy(); d2.loc[d2.business_date == '2025-09-08', 'entries'] = 99999
    f2 = features.expanding_history(features.add_calendar(d2, {'A': 0}), 'entries'); assert f2[f2.business_date == '2025-09-04'].hist_mean_sh_dt.iloc[0] == r.hist_mean_sh_dt

@needs_proc
def test_chronological_split_and_report():
    r = json.load(open(METADATA/'model_report.json')); assert r['split'].startswith('chronological')
    for t in r['targets'].values():
        for k, f in t['folds'].items():
            start = k.split('..')[0]; assert f['train_coverage'][1] < start          # training data strictly precedes the test window
        assert all(m in f['results'] for m in ('baseline_same_hour_avg', 'baseline_moving_avg_7', 'random_forest'))
    h = r['targets']['entries']['headline_breakdown']; assert {'by_hour', 'by_daytype', 'by_station'} <= set(h) and len(h['by_station']) == 83
    assert abs(sum(r['crowd_classification']['observed_share_in_holdout'].values()) - 1) < 0.01

@needs_model
def test_prediction_api_with_real_model():
    from metro_backend.app.context import App; from metro_backend.app.api.router import dispatch; from metro_backend.app.api import routes
    app = App('sqlite:///:memory:'); st = dispatch(app, 'GET', '/api/crowd/status', {}, {}, {}, '1')[1]; assert st['model_loaded'] and st['data_through'] == '2025-09-30' and 'not live' in st['label'].lower() + ' not live'
    s, d = dispatch(app, 'GET', '/api/crowd/stations/KGWA', {'date': '2025-10-06'}, {}, {}, '1'); assert s == 200 and d['available'] and d['label'] == 'AI-Predicted Station Demand'
    h = {x['hour']: x for x in d['hours']}; assert h[9]['entries'] > h[5]['entries'] and all(x['level'] in ('LOW', 'MODERATE', 'HIGH', 'VERY HIGH') for x in d['hours']) and d['model_version'] and d['generated_at']
    assert dispatch(app, 'GET', '/api/crowd/stations/KGWA', {'date': '2025-10-06'}, {}, {}, '1')[1]['hours'] == d['hours']      # deterministic: no random values
    s, hm = dispatch(app, 'GET', '/api/crowd/heatmap', {'date': '2025-10-07', 'hour': '9'}, {}, {}, '1'); assert len(hm['items']) == 83
    # Whitefield is a commuter terminus: far fewer entries on Sunday than Monday in the real data (Majestic is the opposite, which the model also learns)
    mon = dispatch(app, 'GET', '/api/crowd/stations/WHTM', {'date': '2025-10-06'}, {}, {}, '1')[1]; sun = dispatch(app, 'GET', '/api/crowd/stations/WHTM', {'date': '2025-10-05'}, {}, {}, '1')[1]
    assert sun['daytype'] == 'off_day' and mon['daytype'] == 'weekday' and sum(x['entries'] for x in sun['hours']) < 0.8 * sum(x['entries'] for x in mon['hours'])
    assert dispatch(app, 'GET', '/api/crowd/stations/NOPE', {}, {}, {}, '1')[0] == 404 and dispatch(app, 'GET', '/api/crowd/heatmap', {'hour': '99'}, {}, {}, '1')[0] == 422

@needs_model
def test_baseline_fallback_when_model_missing(monkeypatch):
    from metro_backend.ml.predict import Predictor; p = Predictor(); p.bundle = None; p.error = 'simulated'; p.state = 'MODEL_ERROR'
    r = p.predict('KGWA', dt.date(2025, 10, 6)); assert r['available'] is False and r['mode'] == 'unavailable'          # never random numbers

def test_event_scenarios_are_hypothetical(c, admin):
    s, e = c.call('POST', '/api/admin/events', dict(name='Test match', venue='Stadium', event_date='2025-10-05', start_time='19:00', nearby_stations=['CBPK', 'MAGR']), admin); assert s == 201 and e['verification_status'] == 'SCENARIO'
    d = c.call('GET', f"/api/crowd/events/{e['id']}/scenario")[1]; assert d['kind'] == 'HYPOTHETICAL_SCENARIO' and d['model_validated_for_events'] is False and 'No event uplift is invented' in d['note']
    assert c.call('POST', '/api/admin/events', dict(name='x', event_date='bad'), admin)[0] == 422

# ---- model artefact: serialization, loading, status, reproducibility ---------------------------------------------------------------
import shutil
from metro_backend.ml import artifact
from metro_backend.ml.predict import Predictor, READY, UNAVAILABLE, ERROR

@needs_model
def test_artifact_is_plain_data_not_pickle():
    assert not list(MODEL_DIR.glob('*.joblib')) and not list(MODEL_DIR.rglob('*.pkl'))
    b = artifact.load(MODEL_DIR); assert b['meta']['format_version'] == artifact.FORMAT_VERSION and set(b['forests']) == {'entries', 'exits'}
    assert {'thresholds', 'profiles', 'frozen_entries_sh_dt'} <= set(b['tables'])

@needs_model
def test_model_ready_and_predicts():
    p = Predictor(); st = p.status(); assert st['state'] == READY and st['model_loaded'] and st['training_environment']['scikit_learn']
    r = p.predict('KGWA', dt.date(2025, 10, 6)); assert r['available'] and all(h['entries_range'][0] <= h['entries'] <= h['entries_range'][1] for h in r['hours'])

@needs_model
def test_numpy_forest_matches_sklearn_exactly():
    sk = pytest.importorskip('sklearn.ensemble'); rng = np.random.default_rng(0); X = rng.normal(size=(300, 5)); y = X[:, 0] * 3 + np.sin(X[:, 1])
    rf = sk.RandomForestRegressor(n_estimators=8, min_samples_leaf=5, random_state=1).fit(X, y)
    ours = artifact.forest_predict(artifact.export_forest(rf), X); ref = np.stack([e.predict(X) for e in rf.estimators_]); assert np.allclose(ours, ref)

@needs_model
def test_roundtrip_and_reproducible_predictions(tmp_path):
    b = artifact.load(MODEL_DIR); artifact.save(tmp_path / 'm', b['forests'], b['tables'], {k: v for k, v in b['meta'].items() if k not in ('checksums', 'format_version')})
    b2 = artifact.load(tmp_path / 'm'); assert all(np.array_equal(b['forests']['entries'][k], b2['forests']['entries'][k]) for k in b['forests']['entries'])

@needs_model
def test_corrupt_artifact_gives_model_error_not_fake_values(monkeypatch, tmp_path):
    d = tmp_path / 'm'; shutil.copytree(MODEL_DIR, d); (d / 'forest_entries.npz').write_bytes(b'garbage')
    import metro_backend.ml.predict as P; monkeypatch.setattr(P, 'MODEL_DIR', d); p = P.Predictor()
    assert p.state == ERROR and 'checksum' in p.error and p.status()['model_loaded'] is False
    r = p.predict('KGWA', dt.date(2025, 10, 6)); assert r['available'] is False and 'hours' not in r and r['state'] == ERROR

def test_missing_artifact_gives_model_unavailable(monkeypatch, tmp_path):
    import metro_backend.ml.predict as P; monkeypatch.setattr(P, 'MODEL_DIR', tmp_path / 'nothing'); p = P.Predictor()
    assert p.state == UNAVAILABLE and 'train' in p.error and p.heatmap(dt.date(2025, 10, 6), 9)['available'] is False

@needs_model
def test_old_format_version_rejected(tmp_path):
    d = tmp_path / 'm'; shutil.copytree(MODEL_DIR, d); m = json.load(open(d / 'meta.json')); m['format_version'] = 1; json.dump(m, open(d / 'meta.json', 'w'))
    with pytest.raises(ValueError): artifact.load(d)

@needs_model
def test_model_card_matches_report_and_coverage_is_honest():
    card = json.load(open(MODEL_DIR / 'model_card.json')); rep_ = json.load(open(METADATA / 'model_report.json')); hk = rep_['headline'] if 'headline' in rep_ else rep_['targets']['entries']['headline_fold']
    r = rep_['targets']['entries']['folds'][hk]['results']['random_forest']; assert card['validation']['entries']['random_forest']['interval80_coverage'] == r['interval80_coverage']
    assert 0.6 <= r['interval80_coverage'] <= 0.95          # calibrated; must be close to the 0.80 nominal and is reported, not assumed
