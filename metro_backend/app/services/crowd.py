"""Crowd/demand service: thin layer over ml.predict plus events and hypothetical scenarios. Everything is labelled 'AI-Predicted Station Demand'."""
from __future__ import annotations
import datetime as dt, json
from ..core.database import DB, utcnow
from .common import ApiError, need, clip, parse_ts
from .network import Network

class Crowd:
    def __init__(self, db: DB, net: Network, predictor): self.db, self.net, self.p = db, net, predictor
    def _date(self, s: str | None) -> dt.date:
        try: return dt.date.fromisoformat(s) if s else dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
        except ValueError: raise ApiError(422, 'date must be YYYY-MM-DD')
    def _sid(self, sid): 
        if not self.net.valid_station(sid): raise ApiError(404, 'unknown station')
        return sid
    def status(self) -> dict:
        st = self.p.status(); st['validation_summary'] = self.validation_summary(); st['message'] = None if st['state'] == 'MODEL_READY' else ('Demand predictions are unavailable: ' + (st.get('error') or 'model not loaded') + ' No estimates are shown.')
        st['coverage_warning'] = 'Built from Aug 1-18 and Sep 1-30 2025 hourly entry/exit records only. Predictions describe historical patterns, not live conditions.'; return st
    def validation_summary(self) -> dict:
        v = self.p.validation(); out = {}
        for t in ('entries', 'exits'):
            r = v.get(t, {})
            if r: out[t] = {k: dict(mae=round(x['mae'], 1), rmse=round(x['rmse'], 1), wape=round(x['wape'], 3), mape_ge50=None if x.get('mape_ge50') is None else round(x['mape_ge50'], 3), interval80_coverage=x.get('interval80_coverage'), interval80_mean_width=x.get('interval80_mean_width'), n=x.get('n')) for k, x in r.items() if isinstance(x, dict) and 'mae' in x}
        return out
    def validation(self) -> dict:
        """Actual validation metrics straight from data/metadata/model_report.json (single source of truth) + the data audit. Nothing hard-coded."""
        import json
        from ..core.config import ROOT
        out = dict(state=self.p.state, validation_split='chronological, fixed forecast origin (expanding history); last fold is the untouched headline test')
        rp, ap = ROOT/'data'/'metro'/'metadata'/'model_report.json', ROOT/'data'/'metro'/'metadata'/'data_audit.json'
        if rp.exists():
            r = json.load(open(rp)); out['folds'] = r.get('folds'); out['interval_note'] = r.get('interval_note'); out['calibration'] = r.get('calibration')
            out['breakdown'] = {t: dict(headline_fold=v['headline_fold'], by_hour=v['headline_breakdown'].get('by_hour'), by_daytype=v['headline_breakdown'].get('by_daytype'), by_peak=v['headline_breakdown'].get('by_peak'),
                                      worst_stations=sorted(((k, x['mae']) for k, x in v['headline_breakdown'].get('by_station', {}).items()), key=lambda kv: -kv[1])[:8], rf_vs_baseline_mae_improvement_pct=v.get('rf_vs_baseline_mae_improvement_pct')) for t, v in r['targets'].items()}
        else: out['note'] = 'model_report.json not found; run the training script.'
        if ap.exists(): a = json.load(open(ap)); out['data_coverage'] = {k: a[k] for k in ('date_range', 'calendar_days_without_any_data', 'rows', 'stations_in_data', 'duplicate_station_hour_rows', 'imputation', 'direction_notes', 'datasets')}
        out['not_validated_for'] = ['festivals', 'major events', 'emergencies', 'service disruptions', 'public holidays other than 2025-08-15']
        return out
    def station(self, sid: str, date: str | None) -> dict:
        d = self._date(date); r = self.p.predict(self._sid(sid), d)
        if not r.get('available'): return dict(r, fallback='Model unavailable; no random values are generated.')
        return dict(r, station_name=self.net.stations[sid]['name'], profile=self.p.profile(sid))
    def heatmap(self, date, hour) -> dict:
        try: h = int(hour)
        except (TypeError, ValueError): raise ApiError(422, 'hour must be 0-23')
        if not 0 <= h <= 23: raise ApiError(422, 'hour must be 0-23')
        r = self.p.heatmap(self._date(date), h)
        if r.get('available'):
            for i in r['items']: i['station_name'] = self.net.stations[i['station_id']]['name']
        return r
    def busiest(self, date, hour, n=8) -> list[dict]:
        r = self.heatmap(date, hour)
        return sorted(r.get('items', []), key=lambda i: -i['demand'])[:n]
    def quiet_windows(self, sid: str, date: str | None) -> list[dict]:
        r = self.station(sid, date)
        if not r.get('available'): return []
        hrs = [h for h in r['hours'] if 6 <= h['hour'] <= 22 and h['level'] in ('LOW', 'MODERATE') and h['uncertainty'] != 'HIGH']
        return [dict(hour=h['hour'], level=h['level']) for h in hrs]
    # events ---------------------------------------------------------------------------------------------------------------
    def create_event(self, actor: dict, d: dict) -> dict:
        need(d, 'name', 'event_date'); st = d.get('nearby_stations') or []
        bad = [s for s in st if not self.net.valid_station(s)]
        if bad: raise ApiError(422, f'unknown stations {bad}')
        try: dt.date.fromisoformat(d['event_date'])
        except ValueError: raise ApiError(422, 'event_date must be YYYY-MM-DD')
        ver = 'VERIFIED' if d.get('source_url') and d.get('verified') else 'UNVERIFIED' if d.get('source_url') else 'SCENARIO'
        att = d.get('expected_attendance'); att = int(att) if att not in (None, '') else None
        if att is not None and att < 0: raise ApiError(422, 'attendance must be positive')
        eid = self.db.x('INSERT INTO events(name,venue,event_date,start_time,end_time,expected_attendance,nearby_stations,source_url,verification_status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (clip(d['name'], 120), clip(d.get('venue'), 120), d['event_date'], clip(d.get('start_time'), 5), clip(d.get('end_time'), 5), att, json.dumps(st), clip(d.get('source_url'), 500), ver, actor['id'], utcnow()))
        self.db.audit(actor['id'], 'event.create', 'event', eid, d); return self.event(eid)
    def event(self, eid: int) -> dict:
        r = self.db.one('SELECT * FROM events WHERE id=?', (eid,))
        if not r: raise ApiError(404, 'event not found')
        r['nearby_stations'] = json.loads(r['nearby_stations'] or '[]'); return r
    def events(self) -> list[dict]: return [self.event(r['id']) for r in self.db.q('SELECT id FROM events ORDER BY event_date DESC LIMIT 100')]
    def scenario(self, eid: int, metro_share: float | None = None, arrival_hours: int = 2) -> dict:
        """Hypothetical only. Extra riders = attendance x metro_share (an ASSUMPTION the admin must supply), split evenly across nearby stations and the arrival window.
        The ML model is NOT validated for events, so it is never used to estimate event demand; we show model baseline + this explicit what-if."""
        e = self.event(eid); out = dict(event=e, kind='HYPOTHETICAL_SCENARIO', model_validated_for_events=False, stations=[])
        if not e['nearby_stations']: out['note'] = 'No nearby stations set.'; return out
        d = dt.date.fromisoformat(e['event_date']); start = int((e['start_time'] or '18:00').split(':')[0])
        hours = list(range(max(5, start - arrival_hours), start + 1))
        extra = None
        if e['expected_attendance'] and metro_share is not None:
            if not 0 < metro_share <= 1: raise ApiError(422, 'metro_share must be between 0 and 1')
            extra = e['expected_attendance'] * metro_share / len(e['nearby_stations']) / len(hours)
        else: out['note'] = 'No attendance or metro share supplied: showing baseline predictions only. No event uplift is invented.'
        for s in e['nearby_stations']:
            p = self.p.predict(s, d, hours)
            if not p.get('available'): out['stations'].append(dict(station_id=s, available=False)); continue
            out['stations'].append(dict(station_id=s, station_name=self.net.stations[s]['name'], hours=[dict(h, scenario_extra_entries=round(extra) if extra else None, scenario_total_entries=round(h['entries'] + extra) if extra else None) for h in p['hours']]))
        out['assumption'] = dict(metro_share=metro_share, arrival_hours=arrival_hours, attendance=e['expected_attendance']); return out
