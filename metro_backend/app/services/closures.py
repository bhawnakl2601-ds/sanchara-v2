"""Planned/unplanned closures with an automatic lifecycle: SCHEDULED -> ACTIVE -> (EXTENDED) -> RESOLVED, or CANCELLED. Only administrators create them."""
from __future__ import annotations
import json
from ..core.database import DB, utcnow
from .common import ApiError, parse_ts, need, clip
from .network import Network, restrictions, journey_impact
from .notifications import Notifier

TYPES = {'PLANNED_MAINTENANCE': None, 'STATION_CLOSURE': 'station', 'TRACK_SECTION_CLOSURE': 'section', 'LINE_SUSPENSION': 'line', 'INTERCHANGE_CLOSURE': 'interchange', 'EMERGENCY_CLOSURE': None, 'PARTIAL_SERVICE': 'partial', 'LIFT_OUTAGE': 'station', 'ESCALATOR_OUTAGE': 'station'}
LIVE = ('ACTIVE', 'EXTENDED')

class Closures:
    def __init__(self, db: DB, net: Network, notifier: Notifier): self.db, self.net, self.n = db, net, notifier
    def _validate(self, d: dict) -> dict:
        need(d, 'type', 'reason', 'start_at')
        t = d['type']
        if t not in TYPES: raise ApiError(422, f'type must be one of {list(TYPES)}')
        scope = TYPES[t] or d.get('scope')
        if scope not in ('station', 'section', 'line', 'partial', 'interchange'): raise ApiError(422, 'scope is required for this closure type (station|section|line|partial|interchange)')
        v = dict(type=t, scope=scope, reason=clip(d['reason'], 500), start_at=parse_ts(d['start_at'], 'start_at'), end_at=parse_ts(d.get('end_at'), 'end_at', False), station_id=None, line_id=None, from_station=None, to_station=None,
                 trains_pass_through=int(bool(d.get('trains_pass_through', True))), source_url=clip(d.get('source_url'), 500), source_note=clip(d.get('source_note'), 500))
        if v['end_at'] and v['end_at'] <= v['start_at']: raise ApiError(422, 'end_at must be after start_at')
        if not (v['source_url'] or v['source_note']): raise ApiError(422, 'an official source link or note is required to publish a closure')
        if scope in ('station', 'interchange'):
            need(d, 'station_id')
            if not self.net.valid_station(d['station_id']): raise ApiError(422, 'unknown station'); 
            v['station_id'] = d['station_id']
            if scope == 'interchange' and not self.net.stations[d['station_id']]['interchange']: raise ApiError(422, 'station is not an interchange')
        else:
            need(d, 'line_id'); line = d['line_id'].upper()
            if line not in self.net.lines: raise ApiError(422, 'unknown line')
            v['line_id'] = line
            if scope in ('section', 'partial'):
                need(d, 'from_station', 'to_station'); p = self.net.pos[line]
                if d['from_station'] not in p or d['to_station'] not in p: raise ApiError(422, 'stations must be on the selected line')
                if d['from_station'] == d['to_station']: raise ApiError(422, 'from and to must differ')
                v['from_station'], v['to_station'] = d['from_station'], d['to_station']
        return v
    def preview(self, d: dict) -> dict:
        """Admin preview BEFORE publishing: which saved journeys would be affected, and the restriction the route engine would receive."""
        v = self._validate(d); res = dict(closedStations=[], closedSegments=[], suspendedLines=[], partialLines=[], noTransfer=[], closureIds=[0])
        s = v['scope']
        if s == 'station': res['closedStations'].append(dict(id=v['station_id'], passThrough=bool(v['trains_pass_through']), closureId=0))
        elif s == 'section':
            for a, b in self.net.segments_between(v['line_id'], v['from_station'], v['to_station']): res['closedSegments'].append(dict(line=v['line_id'], **{'from': a, 'to': b}, closureId=0))
        elif s == 'line': res['suspendedLines'].append(dict(line=v['line_id'], closureId=0))
        elif s == 'partial': res['partialLines'].append(dict(line=v['line_id'], **{'from': v['from_station'], 'to': v['to_station']}, closureId=0))
        else: res['noTransfer'].append(dict(id=v['station_id'], closureId=0))
        hit = [j for j in self.db.q('SELECT id,user_id,origin,destination,legs FROM saved_journeys') if journey_impact(self.net, json.loads(j['legs']), res)['affected']]
        return dict(restrictions=res, scope=s, saved_journeys_affected=len(hit), affected_stations=self.affected_stations(v),
                    note='Trains may still pass through a closed station when trains_pass_through is true; boarding/alighting/transfer is blocked.' if s == 'station' else None)
    def affected_stations(self, v: dict) -> list[str]:
        s = v['scope']
        if s in ('station', 'interchange'): return [v['station_id']]
        if s == 'line': return list(self.net.order[v['line_id']])
        if s == 'section': return self.net.between(v['line_id'], v['from_station'], v['to_station'])
        allowed = set(self.net.between(v['line_id'], v['from_station'], v['to_station'])); return [x for x in self.net.order[v['line_id']] if x not in allowed]
    def create(self, actor: dict, d: dict) -> dict:
        v = self._validate(d); now = utcnow()
        cid = self.db.x('INSERT INTO closures(type,scope,station_id,line_id,from_station,to_station,reason,start_at,end_at,status,trains_pass_through,source_id,source_url,source_note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (v['type'], v['scope'], v['station_id'], v['line_id'], v['from_station'], v['to_station'], v['reason'], v['start_at'], v['end_at'], 'SCHEDULED', v['trains_pass_through'], 'bmrcl_announcements', v['source_url'], v['source_note'], actor['id'], now, now))
        self.db.audit(actor['id'], 'closure.create', 'closure', cid, v); self.refresh(); return self.get(cid)
    def get(self, cid: int) -> dict:
        r = self.db.one('SELECT * FROM closures WHERE id=?', (cid,))
        if not r: raise ApiError(404, 'closure not found')
        r['affected_stations'] = self.affected_stations(r); r['station_names'] = [self.net.stations[s]['name'] for s in r['affected_stations']][:40]; return r
    def list(self, status: str | None = None) -> list[dict]:
        self.refresh()
        rows = self.db.q('SELECT id FROM closures ' + ('WHERE status=? ' if status else '') + 'ORDER BY start_at DESC', (status,) if status else ())
        return [self.get(r['id']) for r in rows]
    def active(self) -> dict:
        self.refresh(); return dict(closures=[self.get(r['id']) for r in self.db.q("SELECT id FROM closures WHERE status IN ('ACTIVE','EXTENDED')")], restrictions=restrictions(self.db, self.net))
    def modify(self, actor: dict, cid: int, d: dict) -> dict:
        c = self.get(cid)
        if c['status'] in ('RESOLVED', 'CANCELLED'): raise ApiError(409, f"closure is {c['status']}")
        sets, args, ext = [], [], False
        if 'reason' in d: sets.append('reason=?'); args.append(clip(d['reason'], 500))
        if 'end_at' in d:
            e = parse_ts(d['end_at'], 'end_at', False)
            if e and e <= c['start_at']: raise ApiError(422, 'end_at must be after start_at')
            ext = bool(e and c['end_at'] and e > c['end_at']); sets.append('end_at=?'); args.append(e)
            if ext and c['status'] in LIVE: sets += ["status='EXTENDED'", 'extended_count=extended_count+1']
        if 'start_at' in d and c['status'] == 'SCHEDULED': sets.append('start_at=?'); args.append(parse_ts(d['start_at'], 'start_at'))
        if not sets: raise ApiError(422, 'nothing to update')
        sets.append('updated_at=?'); args.append(utcnow()); self.db.x(f"UPDATE closures SET {', '.join(sets)} WHERE id=?", (*args, cid))
        self.db.audit(actor['id'], 'closure.modify', 'closure', cid, d); self.refresh(); self._announce(cid, 'extended' if ext else 'updated'); return self.get(cid)
    def cancel(self, actor: dict, cid: int) -> dict:
        c = self.get(cid)
        if c['status'] in ('RESOLVED', 'CANCELLED'): raise ApiError(409, f"closure is {c['status']}")
        self.db.x("UPDATE closures SET status='CANCELLED', updated_at=? WHERE id=?", (utcnow(), cid)); self.db.audit(actor['id'], 'closure.cancel', 'closure', cid); self._sync_alert(cid); self._announce(cid, 'cancelled'); return self.get(cid)
    def resolve(self, actor: dict, cid: int) -> dict:
        c = self.get(cid)
        if c['status'] not in LIVE: raise ApiError(409, 'only active closures can be resolved (cancel scheduled ones)')
        self.db.x("UPDATE closures SET status='RESOLVED', end_at=COALESCE(end_at,?), updated_at=? WHERE id=?", (utcnow(), utcnow(), cid)); self.db.audit(actor['id'], 'closure.resolve', 'closure', cid); self._sync_alert(cid); self._announce(cid, 'resolved'); return self.get(cid)
    def refresh(self) -> dict:
        """Auto-activate and auto-expire by time. Safe to call often."""
        now, changed = utcnow(), dict(activated=[], expired=[])
        for r in self.db.q("SELECT id FROM closures WHERE status='SCHEDULED' AND start_at<=? AND (end_at IS NULL OR end_at>?)", (now, now)):
            self.db.x("UPDATE closures SET status='ACTIVE', updated_at=? WHERE id=?", (now, r['id'])); changed['activated'].append(r['id']); self._sync_alert(r['id']); self._announce(r['id'], 'activated')
        for r in self.db.q("SELECT id FROM closures WHERE status IN ('SCHEDULED','ACTIVE','EXTENDED') AND end_at IS NOT NULL AND end_at<=?", (now,)):
            self.db.x("UPDATE closures SET status='RESOLVED', updated_at=? WHERE id=?", (now, r['id'])); changed['expired'].append(r['id']); self._sync_alert(r['id']); self._announce(r['id'], 'resolved')
        return changed
    def _sync_alert(self, cid: int):
        """Every live closure is mirrored by one verified alert so it shows in the alert feed; it closes with the closure."""
        c = self.get(cid); a = self.db.one('SELECT id FROM service_alerts WHERE closure_id=?', (cid,)); now = utcnow()
        title = f"{c['type'].replace('_', ' ').title()}: " + (self.net.stations[c['station_id']]['name'] if c['station_id'] else f"{c['line_id'].title()} Line" + (f" ({self.net.stations[c['from_station']]['name']} - {self.net.stations[c['to_station']]['name']})" if c['from_station'] else ''))
        if c['status'] in LIVE or c['status'] == 'SCHEDULED':
            if not a:
                aid = self.db.x("INSERT INTO service_alerts(category,title,description,line_id,reason,start_at,expected_end_at,last_updated_at,source_id,source_url,verification_status,status,closure_id,created_by,created_at) VALUES('CLOSURE',?,?,?,?,?,?,?,?,?,'VERIFIED','ACTIVE',?,?,?)",
                    (title, c['reason'], c['line_id'], c['reason'], c['start_at'], c['end_at'], now, 'bmrcl_announcements', c['source_url'], cid, c['created_by'], now))
                for s in c['affected_stations']: self.db.x('INSERT OR IGNORE INTO affected_stations VALUES(?,?)', (aid, s))
            else: self.db.x('UPDATE service_alerts SET expected_end_at=?, last_updated_at=?, description=? WHERE id=?', (c['end_at'], now, c['reason'], a['id']))
        elif a: self.db.x("UPDATE service_alerts SET status=?, last_updated_at=? WHERE id=?", ('CANCELLED' if c['status'] == 'CANCELLED' else 'RESOLVED', now, a['id']))
    def _announce(self, cid: int, event: str):
        c = self.get(cid); line = c['line_id'] or (self.net.stations[c['station_id']]['lines'][0] if c['station_id'] else None)
        cat = 'STATION_CLOSURE' if c['scope'] in ('station', 'interchange') else 'LINE_CLOSURE'
        uids = self.n.audience(stations=c['affected_stations'], line=c['line_id'], kinds=('station', 'line', 'closures'))
        res = dict(closedStations=[], closedSegments=[], suspendedLines=[], partialLines=[], noTransfer=[], closureIds=[cid])
        for j in self.db.q('SELECT user_id,legs FROM saved_journeys'):
            legs = json.loads(j['legs']); aff = set(c['affected_stations'])
            if any(set(l['stations']) & aff for l in legs) and (c['scope'] != 'line' or any(l['line'] == c['line_id'] for l in legs)): uids.add(j['user_id'])
        word = dict(activated='is now in effect', extended='has been extended', resolved='has ended - service resumed', cancelled='has been cancelled', updated='was updated')[event]
        for u in uids:
            self.n.send(u, cat, f"Closure {word}", f"{c['type'].replace('_', ' ').title()}: {c['reason']}", key=f"closure{cid}#{event}|{c['end_at']}", verification='VERIFIED', source_label='Administrator-verified (official source attached)',
                        payload=dict(closure_id=cid), force=True)
    def pre_notice(self, hours_ahead: int = 24) -> int:
        """Notify subscribers/journeys before a scheduled closure starts (once per closure)."""
        import datetime as dt
        lim = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=hours_ahead)).isoformat(timespec='seconds'); n = 0
        for r in self.db.q("SELECT id FROM closures WHERE status='SCHEDULED' AND start_at<=?", (lim,)):
            c = self.get(r['id']); uids = self.n.audience(stations=c['affected_stations'], line=c['line_id'], kinds=('station', 'line', 'closures'))
            for u in uids: n += int(self.n.send(u, 'STATION_CLOSURE' if c['scope'] in ('station', 'interchange') else 'LINE_CLOSURE', 'Planned closure coming up', f"{c['type'].replace('_', ' ').title()} from {c['start_at']}: {c['reason']}", key=f"closure{r['id']}#preannounce", verification='VERIFIED', source_label='Administrator-verified', payload=dict(closure_id=r['id']), expires_at=c['start_at'])['sent'])
        return n
