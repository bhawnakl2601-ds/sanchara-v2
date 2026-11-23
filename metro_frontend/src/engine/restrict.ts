import type { MetroData, Restrictions, Route, RoutePreference } from './types';
import { findRoute } from './graph';
import { calculateFare } from './fare';

export interface ImpactHit { kind: 'station' | 'section' | 'line' | 'partial' | 'interchange'; closureId?: number; station?: string; line?: string; segment?: [string, string] }
/** Does a route touch an active restriction? (mirror of the backend's journey_impact, used to highlight affected sections on the map). */
export function routeImpact(data: MetroData, route: Route, r: Restrictions): { affected: boolean; hits: ImpactHit[]; affectedStations: string[]; affectedSegments: [string, string][] } {
  const hits: ImpactHit[] = []; const stations = new Set<string>(); const segs: [string, string][] = [];
  for (const l of route.legs) {
    const st = l.stops; const ends = new Set([st[0], st[st.length - 1]]);
    for (const c of r.closedStations) if (st.includes(c.id) && (ends.has(c.id) || !c.passThrough)) { hits.push({ kind: 'station', closureId: c.closureId, station: c.id }); stations.add(c.id); }
    for (let i = 0; i + 1 < st.length; i++) for (const g of r.closedSegments) if (g.line === l.lineId && ((g.from === st[i] && g.to === st[i + 1]) || (g.to === st[i] && g.from === st[i + 1]))) { hits.push({ kind: 'section', closureId: g.closureId, line: l.lineId, segment: [st[i], st[i + 1]] }); segs.push([st[i], st[i + 1]]); }
    for (const s of r.suspendedLines) if (s.line === l.lineId) { hits.push({ kind: 'line', closureId: s.closureId, line: s.line }); st.forEach(x => stations.add(x)); }
    for (const p of r.partialLines) if (p.line === l.lineId) { const o = data.lines[p.line].stations; const a = o.indexOf(p.from), b = o.indexOf(p.to); if (st.some(x => { const i = o.indexOf(x); return i < Math.min(a, b) || i > Math.max(a, b); })) { hits.push({ kind: 'partial', closureId: p.closureId, line: p.line }); st.forEach(x => stations.add(x)); } }
  }
  for (const t of route.transfers) if (r.noTransfer.some(n => n.id === t.stationId)) { hits.push({ kind: 'interchange', station: t.stationId }); stations.add(t.stationId); }
  return { affected: hits.length > 0, hits, affectedStations: [...stations], affectedSegments: segs };
}

export interface Recommendation { kind: 'fastest' | 'cheapest' | 'least-crowded'; route: Route | null; fare: number | null; reason: string; available: boolean }
export type CrowdRank = (stationId: string) => number | null; // 0 LOW .. 3 VERY HIGH, null = no reliable estimate

/** Candidate routes come from the existing Dijkstra (fastest, fewest-changes, and "avoid each interchange"), then are compared. */
export function recommend(data: MetroData, o: string, d: string, when: Date, r: Restrictions, crowd?: CrowdRank | null): Recommendation[] {
  const cands = new Map<string, Route>(); const add = (x: Route | null) => { if (x) cands.set(x.sequence.join('>') + '|' + x.legs.map(l => l.lineId).join(), x); };
  const prefs: RoutePreference[] = ['fastest', 'fewest-changes']; for (const p of prefs) add(findRoute(data, o, d, p, when, r));
  for (const base of [...cands.values()]) for (const t of base.transfers) add(findRoute(data, o, d, 'fastest', when, { ...r, noTransfer: [...r.noTransfer, { id: t.stationId }] }));
  const all = [...cands.values()]; if (!all.length) return ['fastest', 'cheapest', 'least-crowded'].map(k => ({ kind: k as Recommendation['kind'], route: null, fare: null, available: false, reason: 'No route is available with the current verified closures.' }));
  const fare = (x: Route) => calculateFare(data, x, when)?.base ?? Infinity; const byTime = [...all].sort((a, b) => a.totalSec - b.totalSec); const fastest = byTime[0];
  const cheapest = [...all].sort((a, b) => fare(a) - fare(b) || a.totalSec - b.totalSec)[0];
  const mins = (x: Route) => Math.round(x.totalSec / 60);
  const out: Recommendation[] = [
    { kind: 'fastest', route: fastest, fare: fare(fastest), available: true, reason: `Lowest total time (${mins(fastest)} min incl. transfers) of ${all.length} candidate route${all.length > 1 ? 's' : ''}.` },
    { kind: 'cheapest', route: cheapest, fare: fare(cheapest), available: true, reason: cheapest === fastest ? `Also the cheapest: fare depends on stations travelled, and no candidate is shorter.` : `Lowest token fare (₹${fare(cheapest)}), ${mins(cheapest) - mins(fastest)} min slower than the fastest.` },
  ];
  if (crowd) {
    const score = (x: Route) => { let s = 0, n = 0; for (const st of x.sequence) { const v = crowd(st); if (v === null) return null; s += v; n++; } return n ? s / n : null; };
    const scored = all.map(x => ({ x, s: score(x) })).filter((v): v is { x: Route; s: number } => v.s !== null).sort((a, b) => a.s - b.s || a.x.totalSec - b.x.totalSec);
    if (scored.length) { const b = scored[0]; out.push({ kind: 'least-crowded', route: b.x, fare: fare(b.x), available: true, reason: scored.length === 1 || b.x === fastest ? 'Lowest average predicted station demand among the candidates (it is also the fastest). Based on historical patterns, not live occupancy.' : `Lowest average predicted station demand along the route, ${mins(b.x) - mins(fastest)} min slower than the fastest. Historical-pattern estimate, not live occupancy.` }); }
  }
  if (!out.find(x => x.kind === 'least-crowded')) out.push({ kind: 'least-crowded', route: null, fare: null, available: false, reason: 'Not shown: no reliable crowd estimate is available for this route and time.' });
  return out;
}
