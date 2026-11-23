"""Network facts for impact analysis. The route ENGINE stays the existing TypeScript Dijkstra (src/engine); this module only
(1) turns closures into the restriction object that engine consumes and (2) tests saved journeys against them."""
from __future__ import annotations
import json
from ..core.database import DB
from ..core.config import ROOT

class Network:
    def __init__(self):
        m = json.load(open(ROOT/'metro_frontend'/'src'/'data'/'metro.json', encoding='utf-8')); self.stations = m['stations']
        L = list(m['lines'].values()) if isinstance(m['lines'], dict) else m['lines']
        self.lines = {l['id']: l for l in L}
        self.order = {l['id']: l['stations'] for l in L}
        self.pos = {lid: {s: i for i, s in enumerate(o)} for lid, o in self.order.items()}
    def between(self, line: str, a: str, b: str) -> list[str]:
        p = self.pos[line]; i, j = sorted((p[a], p[b])); return self.order[line][i:j + 1]
    def segments_between(self, line: str, a: str, b: str) -> list[tuple[str, str]]:
        s = self.between(line, a, b); return [(s[i], s[i + 1]) for i in range(len(s) - 1)]
    def valid_station(self, sid: str) -> bool: return sid in self.stations

def restrictions(db: DB, net: Network, when_iso: str | None = None) -> dict:
    """Active closures -> the restriction object understood by src/engine (closedStations, closedSegments, suspendedLines, partialLines, noTransfer)."""
    rows = db.q("SELECT * FROM closures WHERE status IN ('ACTIVE','EXTENDED')")
    r = dict(closedStations=[], closedSegments=[], suspendedLines=[], partialLines=[], noTransfer=[], liftOutages=[], closureIds=[c['id'] for c in rows])
    for c in rows:
        s = c['scope']
        if c['type'] == 'LIFT_OUTAGE': r['liftOutages'].append(dict(id=c['station_id'], closureId=c['id']))   # step-free access only; the station stays open
        elif c['type'] == 'ESCALATOR_OUTAGE': pass                                                              # informational: escalators are not step-free access
        elif s == 'station': r['closedStations'].append(dict(id=c['station_id'], passThrough=bool(c['trains_pass_through']), closureId=c['id']))
        elif s == 'section':
            for a, b in net.segments_between(c['line_id'], c['from_station'], c['to_station']): r['closedSegments'].append(dict(line=c['line_id'], **{'from': a, 'to': b}, closureId=c['id']))
        elif s == 'line': r['suspendedLines'].append(dict(line=c['line_id'], closureId=c['id']))
        elif s == 'partial': r['partialLines'].append(dict(line=c['line_id'], **{'from': c['from_station'], 'to': c['to_station']}, closureId=c['id']))
        elif s == 'interchange': r['noTransfer'].append(dict(id=c['station_id'], closureId=c['id']))
    return r

def journey_impact(net: Network, legs: list[dict], res: dict) -> dict:
    """legs: [{line, stations:[ordered ids board..alight]}]. Returns which closures hit this journey and why."""
    hits = []; ids = [l['stations'] for l in legs]; first, last = legs[0]['stations'][0], legs[-1]['stations'][-1]
    for cs in res['closedStations']:
        for li, l in enumerate(legs):
            st = l['stations']
            if cs['id'] not in st: continue
            endpoint = cs['id'] in (st[0], st[-1])           # boarding / alighting / transferring here
            if endpoint or not cs['passThrough']: hits.append(dict(closureId=cs['closureId'], kind='station', station=cs['id'], reason='cannot board/alight/transfer' if endpoint else 'trains do not run through'))
    for l in legs:
        segs = {frozenset(p) for p in zip(l['stations'], l['stations'][1:])}
        for cg in res['closedSegments']:
            if cg['line'] == l['line'] and frozenset((cg['from'], cg['to'])) in segs: hits.append(dict(closureId=cg['closureId'], kind='section', line=l['line'], segment=[cg['from'], cg['to']]))
        for sl in res['suspendedLines']:
            if sl['line'] == l['line']: hits.append(dict(closureId=sl['closureId'], kind='line', line=l['line']))
        for pl in res['partialLines']:
            if pl['line'] == l['line']:
                allowed = set(net.between(l['line'], pl['from'], pl['to']))
                if any(s not in allowed for s in l['stations']): hits.append(dict(closureId=pl['closureId'], kind='partial', line=l['line']))
    for nt in res['noTransfer']:
        for a, b in zip(legs, legs[1:]):
            if a['stations'][-1] == nt['id']: hits.append(dict(closureId=nt['closureId'], kind='interchange', station=nt['id']))
    seen, out = set(), []
    for h in hits:
        k = json.dumps(h, sort_keys=True)
        if k not in seen: seen.add(k); out.append(h)
    return dict(affected=bool(out), hits=out)
