"""Service alerts (delays, disruptions, restorations...). Only VERIFIED / OFFICIAL_FEED alerts are shown to passengers and can notify."""
from __future__ import annotations
import hashlib, json, datetime as dt
from ..core.config import settings
from ..core.database import DB, utcnow
from .common import ApiError, parse_ts, need, clip
from .network import Network
from .notifications import Notifier

CATEGORIES = ['DELAY', 'DISRUPTION', 'PARTIAL_DISRUPTION', 'SHORT_LOOP', 'RESTORATION', 'ARRIVAL_CHANGE', 'ROUTE_CHANGE', 'CLOSURE', 'FACILITY', 'INFO']
PUBLIC_V = ('VERIFIED', 'OFFICIAL_FEED')

def delay_label(minutes: float | None) -> str | None:
    """SANCHARA display thresholds (configurable) - not official BMRCL categories."""
    if minutes is None: return None
    s = settings
    return 'NORMAL' if minutes < s.DELAY_MINOR_MIN else 'MINOR' if minutes < s.DELAY_MODERATE_MIN else 'MODERATE' if minutes < s.DELAY_MAJOR_MIN else 'MAJOR'

def compute_delay(scheduled_iso: str, predicted_iso: str) -> float:
    """Delay = predicted arrival - scheduled arrival (minutes). Only valid when BOTH come from a real feed; never inferred from the timetable alone."""
    a = dt.datetime.fromisoformat(scheduled_iso); b = dt.datetime.fromisoformat(predicted_iso); return round((b - a).total_seconds() / 60, 1)

class Alerts:
    def __init__(self, db: DB, net: Network, notifier: Notifier): self.db, self.net, self.n = db, net, notifier
    def _fp(self, d: dict, stations: list[str]) -> str: return hashlib.sha1(f"{d['category']}|{d.get('line_id')}|{','.join(sorted(stations))}|{(d['title'] or '').lower().strip()}".encode()).hexdigest()
    def _src_status(self, source_id):
        r = self.db.one('SELECT status,last_success FROM data_sources WHERE id=?', (source_id,)) if source_id else None
        return r['status'] if r else None
    def hydrate(self, a: dict, public=True) -> dict:
        a['stations'] = [r['station_id'] for r in self.db.q('SELECT station_id FROM affected_stations WHERE alert_id=?', (a['id'],))]
        a['segments'] = self.db.q('SELECT line_id,from_station,to_station FROM affected_segments WHERE alert_id=?', (a['id'],))
        a['delay_level'] = delay_label(a['delay_minutes']); a['source_status'] = self._src_status(a['source_id'])
        a['source_label'] = (self.db.one('SELECT name FROM data_sources WHERE id=?', (a['source_id'],)) or {}).get('name') if a['source_id'] else 'Administrator-entered'
        a['station_names'] = [self.net.stations[s]['name'] for s in a['stations'] if s in self.net.stations]
        if a['source_status'] in ('STALE', 'UNAVAILABLE', 'ERROR'): a['stale_warning'] = 'Source feed is stale or unavailable; this is the latest verified information.'
        return a
    def list(self, *, line=None, status=None, public=True, limit=200) -> list[dict]:
        w, a = [], []
        if public: w.append("verification_status IN ('VERIFIED','OFFICIAL_FEED')")
        if line: w.append('line_id=?'); a.append(line.upper())
        if status in ('ACTIVE', 'RESOLVED', 'CANCELLED'): w.append('status=?'); a.append(status)
        rows = self.db.q(f"SELECT * FROM service_alerts {'WHERE ' + ' AND '.join(w) if w else ''} ORDER BY (status='ACTIVE') DESC, last_updated_at DESC LIMIT ?", (*a, limit))
        return [self.hydrate(r) for r in rows]
    def get(self, aid: int, public=True) -> dict:
        r = self.db.one('SELECT * FROM service_alerts WHERE id=?', (aid,))
        if not r or (public and r['verification_status'] not in PUBLIC_V): raise ApiError(404, 'alert not found')
        return self.hydrate(r)
    def _validate(self, d: dict) -> tuple[dict, list[str], list[dict]]:
        need(d, 'category', 'title')
        if d['category'] not in CATEGORIES: raise ApiError(422, f'category must be one of {CATEGORIES}')
        line = d.get('line_id'); line = line.upper() if line else None
        if line and line not in self.net.lines: raise ApiError(422, f'unknown line {line}')
        st = list(dict.fromkeys(d.get('stations') or []))
        bad = [s for s in st if not self.net.valid_station(s)]
        if bad: raise ApiError(422, f'unknown stations: {bad}')
        segs = d.get('segments') or []
        for g in segs:
            if g.get('line_id') not in self.net.lines or not (self.net.valid_station(g.get('from_station', '')) and self.net.valid_station(g.get('to_station', ''))): raise ApiError(422, 'invalid segment')
        dm = d.get('delay_minutes')
        if dm is not None:
            try: dm = float(dm)
            except (TypeError, ValueError): raise ApiError(422, 'delay_minutes must be a number')
            if dm < 0 or dm > 24 * 60: raise ApiError(422, 'delay_minutes out of range')
        return dict(category=d['category'], title=clip(d['title'], 160), description=clip(d.get('description'), 2000), line_id=line, delay_minutes=dm, severity=delay_label(dm) or d.get('severity'),
                    reason=clip(d.get('reason'), 500), source_url=clip(d.get('source_url'), 500), source_id=d.get('source_id') or ('bmrcl_announcements' if d.get('source_url') else None)), st, segs
    def create(self, actor: dict, d: dict) -> dict:
        v, st, segs = self._validate(d)
        verify = bool(d.get('verify'))
        if verify and not (v['source_url'] or d.get('source_note')): raise ApiError(422, 'verifying an alert requires a source link or source note')
        fp = self._fp(v, st)
        dup = self.db.one("SELECT id FROM service_alerts WHERE fingerprint=? AND status='ACTIVE'", (fp,))
        if dup: raise ApiError(409, 'an identical active alert already exists', existing_id=dup['id'])
        now = utcnow()
        aid = self.db.x('INSERT INTO service_alerts(category,title,description,line_id,delay_minutes,severity,reason,start_at,expected_end_at,last_updated_at,source_id,source_url,published_at,verification_status,status,fingerprint,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (v['category'], v['title'], v['description'], v['line_id'], v['delay_minutes'], v['severity'], v['reason'], parse_ts(d.get('start_at') or now, 'start_at'), parse_ts(d.get('expected_end_at'), 'expected_end_at', False), now, v['source_id'], v['source_url'],
             parse_ts(d.get('published_at'), 'published_at', False), 'VERIFIED' if verify else 'UNVERIFIED', 'ACTIVE', fp, actor['id'], now))
        for s in st: self.db.x('INSERT OR IGNORE INTO affected_stations VALUES(?,?)', (aid, s))
        for g in segs: self.db.x('INSERT INTO affected_segments VALUES(?,?,?,?)', (aid, g['line_id'], g['from_station'], g['to_station']))
        self.db.audit(actor['id'], 'alert.create', 'alert', aid, dict(verify=verify, title=v['title']))
        if verify: self.notify(aid, 'created')
        return self.get(aid, public=False)
    def update(self, actor: dict, aid: int, d: dict) -> dict:
        cur = self.get(aid, public=False)
        if cur['status'] != 'ACTIVE' and not d.get('reopen'): raise ApiError(409, 'alert is not active')
        sets, args = [], []
        for k in ('title', 'description', 'reason', 'source_url'):
            if k in d: sets.append(f'{k}=?'); args.append(clip(d[k], 2000))
        if 'delay_minutes' in d:
            dm = None if d['delay_minutes'] in (None, '') else float(d['delay_minutes']); sets += ['delay_minutes=?', 'severity=?']; args += [dm, delay_label(dm)]
        if 'expected_end_at' in d: sets.append('expected_end_at=?'); args.append(parse_ts(d['expected_end_at'], 'expected_end_at', False))
        verified_now = False
        if d.get('verify') and cur['verification_status'] == 'UNVERIFIED':
            if not (cur['source_url'] or d.get('source_url') or d.get('source_note')): raise ApiError(422, 'verifying an alert requires a source link or source note')
            sets.append("verification_status='VERIFIED'"); verified_now = True
        if not sets: raise ApiError(422, 'nothing to update')
        sets.append('last_updated_at=?'); args.append(utcnow()); self.db.x(f"UPDATE service_alerts SET {', '.join(sets)} WHERE id=?", (*args, aid))
        self.db.audit(actor['id'], 'alert.update', 'alert', aid, {k: d[k] for k in d if k != 'verify'})
        self.notify(aid, 'verified' if verified_now else 'updated'); return self.get(aid, public=False)
    def resolve(self, actor: dict, aid: int, note: str | None = None) -> dict:
        a = self.get(aid, public=False)
        if a['status'] != 'ACTIVE': raise ApiError(409, 'alert already closed')
        self.db.x("UPDATE service_alerts SET status='RESOLVED', last_updated_at=?, description=COALESCE(description,'') || ? WHERE id=?", (utcnow(), f"\n[Resolved: {clip(note, 300)}]" if note else '', aid))
        self.db.audit(actor['id'], 'alert.resolve', 'alert', aid, dict(note=note)); self.notify(aid, 'resolved'); return self.get(aid, public=False)
    def expire(self) -> int:
        """Alerts whose officially supplied expected end has passed are closed as RESOLVED (auto-expired)."""
        rows = self.db.q("SELECT id FROM service_alerts WHERE status='ACTIVE' AND expected_end_at IS NOT NULL AND expected_end_at<=? AND closure_id IS NULL", (utcnow(),))
        for r in rows: self.db.x("UPDATE service_alerts SET status='RESOLVED', last_updated_at=?, description=COALESCE(description,'') || '\n[Auto-expired at expected end time]' WHERE id=?", (utcnow(), r['id']))
        return len(rows)
    # --- notifications ------------------------------------------------------------------------------------------------------
    def notify(self, aid: int, event: str) -> list[dict]:
        a = self.get(aid, public=False)
        if a['verification_status'] not in PUBLIC_V: return []          # passengers never get unverified alerts
        cat = 'DELAY' if a['category'] in ('DELAY', 'ARRIVAL_CHANGE', 'SHORT_LOOP') else 'LINE_CLOSURE' if a['category'] in ('DISRUPTION', 'PARTIAL_DISRUPTION') else 'STATION_CLOSURE' if a['category'] == 'CLOSURE' else 'FACILITY_ISSUE' if a['category'] == 'FACILITY' else 'ROUTE_CHANGE'
        kinds = ('station', 'line', 'delays') if cat == 'DELAY' else ('station', 'line', 'closures')
        uids = self.n.audience(stations=a['stations'], line=a['line_id'], kinds=kinds)
        uids |= self.affected_journey_users(a)
        title = {'created': a['title'], 'updated': 'Update: ' + a['title'], 'verified': a['title'], 'resolved': 'Resolved: ' + a['title']}[event]
        key = f"alert{aid}#{event}|{a['status']}|{a['delay_minutes']}|{a['expected_end_at']}|{a['last_updated_at'] if event == 'updated' else ''}"
        out = []
        for u in uids:
            out.append(self.n.send(u, cat, title, (a['description'] or a['reason'] or '')[:300], key=key, verification=a['verification_status'], source_label=a['source_label'], payload=dict(alert_id=aid, line=a['line_id']),
                                   expires_at=a['expected_end_at'] if event != 'resolved' else None, force=event == 'resolved'))
        return out
    def affected_journey_users(self, a: dict) -> set[int]:
        out = set()
        for j in self.db.q('SELECT user_id,legs FROM saved_journeys'):
            for leg in json.loads(j['legs']):
                st = leg['stations']
                if a['line_id'] and leg['line'] != a['line_id'] and a['category'] not in ('CLOSURE',): continue
                if set(st) & set(a['stations']) or any(frozenset((g['from_station'], g['to_station'])) in {frozenset(p) for p in zip(st, st[1:])} for g in a['segments']): out.add(j['user_id'])
        return out
