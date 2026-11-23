import type { MetroData, Route, RouteLeg, RoutePreference, Transfer, LineId, Restrictions } from './types';

/** Min binary heap keyed by number. */
class Heap<T> {
  private a: { k: number; v: T }[] = [];
  get size() { return this.a.length; }
  push(k: number, v: T) { const a = this.a; a.push({ k, v }); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): { k: number; v: T } | undefined {
    const a = this.a; if (!a.length) return; const top = a[0]; const last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l].k < a[m].k) m = l; if (r < a.length && a[r].k < a[m].k) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}
interface Edge { to: number; cost: number; time: number; km: number; kind: 'ride' | 'transfer'; walk?: number; wait?: number }
export interface Graph { nodes: { station: string; line: LineId }[]; index: Map<string, number>; adj: Edge[][]; data: MetroData }
const key = (s: string, l: string) => s + '|' + l;
export const CHANGE_PENALTY_SEC = 1_000_000; // "fewest changes" = lexicographic: changes first, time second

export type Period = 'peak' | 'offpeak';
export function periodFor(d: Date): Period {
  const h = d.getHours() + d.getMinutes() / 60;
  return (h >= 8 && h < 12) || (h >= 16 && h < 21) ? 'peak' : 'offpeak';
}
function headway(data: MetroData, line: LineId, period: Period): number {
  const h = data.lines[line].headwaySec; return (period === 'peak' ? h.peak : h.offpeak) ?? h.offpeak ?? h.peak ?? 480;
}
export function buildGraph(data: MetroData, pref: RoutePreference, when: Date = new Date(), restr?: Restrictions | null): Graph {
  const nodes: Graph['nodes'] = []; const index = new Map<string, number>();
  const period = periodFor(when);
  const liftOut = new Set(restr?.liftOutages?.map(l => l.id) ?? []);
  const usable = (id: string) => pref !== 'accessible' || (data.stations[id]?.wheelchair && !liftOut.has(id));
  // --- verified closures (Smart Alerts) -> which edges exist. Applied inside the SAME Dijkstra; no second route engine. ---
  const R = restr ?? null;
  const noBoard = new Set(R?.closedStations.map(c => c.id) ?? []);                         // no boarding/alighting/transfer
  const noPass = new Set(R?.closedStations.filter(c => !c.passThrough).map(c => c.id) ?? []); // trains do not run through either
  const suspended = new Set(R?.suspendedLines.map(l => l.line) ?? []);
  const blockedSeg = new Set((R?.closedSegments ?? []).flatMap(g => [key(g.from, g.line) + '>' + key(g.to, g.line), key(g.to, g.line) + '>' + key(g.from, g.line)]));
  const partial = new Map((R?.partialLines ?? []).map(p => { const st = data.lines[p.line].stations; const a = st.indexOf(p.from), b = st.indexOf(p.to); return [p.line, [Math.min(a, b), Math.max(a, b)] as [number, number]]; }));
  const noXfer = new Set(R?.noTransfer.map(t => t.id) ?? []);
  const inService = (line: string, st: string) => { if (suspended.has(line)) return false; const r = partial.get(line); if (!r) return true; const i = data.lines[line].stations.indexOf(st); return i >= r[0] && i <= r[1]; };
  for (const l of Object.values(data.lines)) for (const s of l.stations) { if (!data.stations[s]) continue; index.set(key(s, l.id), nodes.length); nodes.push({ station: s, line: l.id }); }
  const adj: Edge[][] = nodes.map(() => []);
  for (const l of Object.values(data.lines)) {
    for (const seg of l.segments) {
      const a = index.get(key(seg.from, l.id)), b = index.get(key(seg.to, l.id));
      if (a === undefined || b === undefined) continue; // prevents invalid connections: only declared segments become edges
      if (!usable(seg.from) || !usable(seg.to)) continue;
      if (suspended.has(l.id) || noPass.has(seg.from) || noPass.has(seg.to) || blockedSeg.has(key(seg.from, l.id) + '>' + key(seg.to, l.id)) || !inService(l.id, seg.from) || !inService(l.id, seg.to)) continue;
      // dwell is charged when leaving an intermediate station (applied on arrival at b unless b is the line end; handled in post-processing)
      adj[a].push({ to: b, cost: seg.sec, time: seg.sec, km: seg.km, kind: 'ride' });
      adj[b].push({ to: a, cost: seg.sec, time: seg.sec, km: seg.km, kind: 'ride' });
    }
  }
  for (const st of Object.values(data.stations)) {
    if (st.lines.length < 2 || !usable(st.id) || noBoard.has(st.id) || noXfer.has(st.id)) continue;
    const walk = data.transferSeconds[st.id] ?? 120;
    for (const la of st.lines) for (const lb of st.lines) {
      if (la === lb || !inService(la, st.id) || !inService(lb, st.id)) continue;
      const wait = Math.round(headway(data, lb, period) / 2); // expected wait for the next train
      const t = walk + wait;
      adj[index.get(key(st.id, la))!].push({ to: index.get(key(st.id, lb))!, cost: t + (pref === 'fewest-changes' ? CHANGE_PENALTY_SEC : 0), time: t, km: 0, kind: 'transfer', walk, wait });
    }
  }
  return { nodes, index, adj, data };
}

export function findRoute(data: MetroData, origin: string, destination: string, pref: RoutePreference = 'fastest', when: Date = new Date(), restr?: Restrictions | null): Route | null {
  if (!data.stations[origin] || !data.stations[destination]) return null;
  if (origin === destination) return null;
  if (pref === 'accessible' && [origin, destination].some(s => !data.stations[s].wheelchair || restr?.liftOutages?.some(l => l.id === s))) return null;
  if (restr && restr.closedStations.some(c => c.id === origin || c.id === destination)) return null; // cannot board/alight at a closed station
  const g = buildGraph(data, pref, when, restr);
  const dist = new Array<number>(g.nodes.length).fill(Infinity);
  const prev = new Array<{ n: number; e: Edge } | null>(g.nodes.length).fill(null);
  const h = new Heap<number>();
  for (const l of data.stations[origin].lines) { const i = g.index.get(key(origin, l)); if (i !== undefined) { dist[i] = 0; h.push(0, i); } }
  if (restr && data.stations[origin].lines.every(l => restr.suspendedLines.some(s => s.line === l))) return null;
  let end = -1;
  while (h.size) {
    const { k, v } = h.pop()!;
    if (k > dist[v]) continue;
    if (g.nodes[v].station === destination) { end = v; break; }
    for (const e of g.adj[v]) { const nd = k + e.cost; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { n: v, e }; h.push(nd, e.to); } }
  }
  if (end < 0) return null;
  const path: { n: number; e: Edge | null }[] = [];
  for (let c: number | null = end; c !== null;) { const p: { n: number; e: Edge } | null = prev[c]; path.push({ n: c, e: p ? p.e : null }); c = p ? p.n : null; }
  path.reverse();
  return assemble(g, path, origin, destination, pref, when);
}

function assemble(g: Graph, path: { n: number; e: Edge | null }[], origin: string, destination: string, pref: RoutePreference, when: Date): Route {
  const data = g.data; const period = periodFor(when);
  const legs: RouteLeg[] = []; const transfers: Transfer[] = [];
  let cur: RouteLeg | null = null;
  for (let i = 0; i < path.length; i++) {
    const node = g.nodes[path[i].n]; const e = path[i].e;
    if (i === 0) { cur = { lineId: node.line, from: node.station, to: node.station, stops: [node.station], km: 0, rideSec: 0, stationsTravelled: 0 }; continue; }
    if (e!.kind === 'ride') { cur!.stops.push(node.station); cur!.to = node.station; cur!.km += e!.km; cur!.rideSec += e!.time; cur!.stationsTravelled += 1; }
    else { legs.push(cur!); transfers.push({ stationId: node.station, fromLine: cur!.lineId, toLine: node.line, walkSec: e!.walk!, waitSec: e!.wait! }); cur = { lineId: node.line, from: node.station, to: node.station, stops: [node.station], km: 0, rideSec: 0, stationsTravelled: 0 }; }
  }
  legs.push(cur!);
  // dwell time at each intermediate stop within a leg
  for (const leg of legs) leg.rideSec += Math.max(0, leg.stops.length - 2) * data.lines[leg.lineId].dwellSec;
  const sequence: string[] = []; legs.forEach((l, i) => l.stops.forEach((s, j) => { if (!(i > 0 && j === 0)) sequence.push(s); }));
  const rideSec = legs.reduce((a, l) => a + l.rideSec, 0);
  const transferSec = transfers.reduce((a, t) => a + t.walkSec + t.waitSec, 0);
  return {
    origin, destination, preference: pref, legs, transfers,
    totalKm: Math.round(legs.reduce((a, l) => a + l.km, 0) * 100) / 100, rideSec, transferSec, totalSec: rideSec + transferSec,
    stationCount: sequence.length - 1, lineChanges: transfers.length, sequence,
    boardingLine: legs[0].lineId, finalLine: legs[legs.length - 1].lineId,
    boardingWaitSec: Math.round(headway(data, legs[0].lineId, period) / 2),
  };
}
