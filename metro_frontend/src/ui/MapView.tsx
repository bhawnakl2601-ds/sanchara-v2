import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../app/state';
import { FeatureShell, rise } from './FeatureShell';
import { StationSelect, LinePips } from './StationSelect';
import { metro, schematicLayout, shortName, sliceGeometry } from '../engine';
import { placeLabels, type LabelInput } from './mapLabels';
import { useLive } from '../live/LiveProvider';
import { get } from '../api/client';
import { hasRestrictions } from '../engine';

const LV_FILL: Record<string, string> = { LOW: '#9DBB9E', MODERATE: '#CFC2A4', HIGH: '#CF8CF3', 'VERY HIGH': '#8E2FC0' };
const todayISO = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
type AlertFilter = 'all' | 'delay' | 'closure' | 'other';
const alertGroup = (c: string): AlertFilter => (['DELAY', 'DISRUPTION', 'PARTIAL_DISRUPTION', 'SHORT_LOOP', 'ARRIVAL_CHANGE'].includes(c) ? 'delay' : ['CLOSURE', 'ROUTE_CHANGE'].includes(c) ? 'closure' : 'other');

type Mode = 'geo' | 'schematic'; type View = { k: number; x: number; y: number };
const GEO = 4200, SCH = 46, LAT0 = 12.99, LON0 = 77.6;
const SCHEM = schematicLayout(metro);
const STATIONS = Object.values(metro.stations); const LINES = Object.values(metro.lines);
const geoPt = (lat: number, lon: number): [number, number] => [(lon - LON0) * Math.cos((LAT0 * Math.PI) / 180) * GEO, -(lat - LAT0) * GEO];
const worldOf = (id: string, mode: Mode): [number, number] => { if (mode === 'geo') { const s = metro.stations[id]; return geoPt(s.lat, s.lon); } const p = SCHEM[id]; return [p.x * SCH, p.y * SCH]; };
const pathOf = (pts: [number, number][]) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');

export function MapView() {
  const { planner, mapSelected, setMapSelected, setOrigin, setDestination, lateral } = useApp();
  const planRoute = planner.route;
  const [showRoute, setShowRoute] = useState(true); // map display state, kept apart from the planner's saved journey
  const route = showRoute ? planRoute : null;
  useEffect(() => { setShowRoute(true); }, [planRoute]);
  const { restrictions, alertStations, online } = useLive();
  const [showAlerts, setShowAlerts] = useState(true); const [alertFilter, setAlertFilter] = useState<AlertFilter>('all'); const [heat, setHeat] = useState(false); const [heatHour, setHeatHour] = useState(9);
  const [heatData, setHeatData] = useState<Map<string, any> | null>(null); const [heatNote, setHeatNote] = useState<string | null>(null); const [demand, setDemand] = useState<any>(null);
  useEffect(() => { if (!heat) return; let live = true; setHeatNote(null); get<any>('/api/crowd/heatmap', { date: todayISO(), hour: heatHour }).then(r => { if (!live) return; if (!r.available) { setHeatData(null); setHeatNote('Demand model unavailable; no estimate shown.'); } else setHeatData(new Map(r.items.map((i: any) => [i.station_id, i]))); }).catch(() => { if (live) { setHeatData(null); setHeatNote('Backend offline; no estimate shown.'); } }); return () => { live = false; }; }, [heat, heatHour, online]);
  const [hover, setHover] = useState<string | null>(null); const [mode, setMode] = useState<Mode>('geo'); const [labels, setLabels] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 }); const [size, setSize] = useState({ w: 800, h: 600 });
  const wrap = useRef<HTMLDivElement>(null); const drag = useRef<{ moved: number }>({ moved: 0 }); const ptrs = useRef(new Map<number, { x: number; y: number }>()); const pinch = useRef(0);

  useLayoutEffect(() => {
    const el = wrap.current!; let raf = 0; const timers: number[] = [];
    const measure = () => { const w = el.clientWidth, h = el.clientHeight; if (w > 0 && h > 0) setSize(s => (s.w === w && s.h === h ? s : { w, h })); }; // ignore transient 0×0 reads while the page is animating in
    const ro = new ResizeObserver(measure); ro.observe(el); addEventListener('resize', measure); measure();
    raf = requestAnimationFrame(measure); timers.push(window.setTimeout(measure, 250), window.setTimeout(measure, 900));
    return () => { ro.disconnect(); removeEventListener('resize', measure); cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, []);

  const world = useMemo(() => Object.fromEntries(STATIONS.map(s => [s.id, worldOf(s.id, mode)])) as Record<string, [number, number]>, [mode]);
  const boundsOf = useCallback((ids: string[], pad = 70): View => {
    const xs = ids.map(i => world[i][0]), ys = ids.map(i => world[i][1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0); const k = Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h, 14);
    return { k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k };
  }, [world, size]);
  const fitK = useRef(1); const anim = useRef(0); const viewRef = useRef(view); viewRef.current = view;
  const clampK = useCallback((k: number) => Math.min(fitK.current * 60, Math.max(fitK.current * 0.55, k)), []);
  const animateTo = useCallback((to: View, ms = 420) => {
    cancelAnimationFrame(anim.current); const from = viewRef.current; const t0 = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(to); return; }
    const step = (t: number) => { const u = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - u, 3); setView({ k: from.k * Math.pow(to.k / from.k, e), x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }); if (u < 1) anim.current = requestAnimationFrame(step); };
    anim.current = requestAnimationFrame(step);
  }, []);
  const fit = useCallback((animate = false) => { const v = boundsOf(STATIONS.map(s => s.id)); fitK.current = v.k; animate ? animateTo(v) : setView(v); }, [boundsOf, animateTo]);
  const backToFull = useCallback(() => { setShowRoute(false); setHidden(new Set()); setFocus(null); fit(true); }, [fit]);
  const showSelectedRoute = useCallback(() => { setShowRoute(true); if (planRoute) animateTo(boundsOf(planRoute.sequence, 110)); }, [planRoute, boundsOf, animateTo]);
  useEffect(() => { fit(); }, [mode, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Zoom by factor about a screen point. `smooth` animates (buttons/keys); wheel applies instantly. */
  const zoomAt = useCallback((f: number, cx = size.w / 2, cy = size.h / 2, smooth = false) => {
    const v = viewRef.current; const k = clampK(v.k * f); const r = k / v.k; const to = { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
    smooth ? animateTo(to, 320) : (cancelAnimationFrame(anim.current), setView(to));
  }, [size, clampK, animateTo]);
  useEffect(() => { const el = wrap.current!; const h = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }; el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h); }, [zoomAt]);
  const centerOn = useCallback((id: string, rel = 6) => { const [x, y] = world[id]; const k = clampK(fitK.current * rel); animateTo({ k, x: size.w / 2 - x * k, y: size.h / 2 - y * k }); }, [world, size, clampK, animateTo]);

  // selection from outside (planner) is preserved; zoom to the route when the map opens with one
  useEffect(() => { if (route) setView(boundsOf(route.sequence, 110)); else if (mapSelected) centerOn(mapSelected, 4); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (route) setView(boundsOf(route.sequence, 110)); }, [size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => { cancelAnimationFrame(anim.current); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag.current.moved = 0; pinch.current = 0; };
  const onMove = (e: React.PointerEvent) => {
    const p = ptrs.current.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (ptrs.current.size === 2) { ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...ptrs.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch.current) { const r = wrap.current!.getBoundingClientRect(); zoomAt(d / pinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); } pinch.current = d; drag.current.moved = 99; return; }
    drag.current.moved += Math.abs(dx) + Math.abs(dy); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (drag.current.moved > 4) { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ } setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })); }
  };
  const onUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = 0; };

  const screen = useMemo(() => Object.fromEntries(STATIONS.map(s => [s.id, [world[s.id][0] * view.k + view.x, world[s.id][1] * view.k + view.y] as [number, number]])), [world, view]);
  const routeSet = useMemo(() => new Set(route?.sequence ?? []), [route]);
  const visibleLine = (l: string) => !hidden.has(l);
  const isVisible = (id: string) => metro.stations[id].lines.some(visibleLine);

  // label placement: collision-free in screen space (never on a line, a dot or another label), with zoom-based level of detail
  const z = view.k / fitK.current; const dotR = (id: string) => (metro.stations[id].interchange ? 7.5 : 4.2 + Math.min(2.2, Math.log2(Math.max(1, z)) * 0.8));
  const screenSegs = useMemo(() => {
    const segs: [number, number, number, number][] = [];
    for (const l of LINES) { if (!visibleLine(l.id)) continue; const pts = mode === 'geo' ? l.geometry.map(([la, lo]) => { const w = geoPt(la, lo); return [w[0] * view.k + view.x, w[1] * view.k + view.y] as [number, number]; }) : l.stations.map(id => screen[id]);
      let last = pts[0]; for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (i === pts.length - 1 || Math.hypot(p[0] - last[0], p[1] - last[1]) > 5) { segs.push([last[0], last[1], p[0], p[1]]); last = p; } } }
    return segs;
  }, [mode, view, hidden, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelPos = useMemo(() => {
    const termini = new Set(LINES.flatMap(l => [l.stations[0], l.stations.at(-1)!]));
    const prio = (id: string) => (id === mapSelected || id === hover ? 0 : id === planner.origin || id === planner.destination ? 1 : routeSet.has(id) ? 2 : metro.stations[id].interchange ? 3 : termini.has(id) ? 4 : 5 + (STATIONS.findIndex(s => s.id === id) % 4));
    const items: LabelInput[] = [];
    for (const s of STATIONS) {
      if (!isVisible(s.id)) continue; const pr = prio(s.id); const [x, y] = screen[s.id];
      // level of detail: far out show hubs/terminals only; zooming in progressively reveals every station
      const lod = pr <= 4 ? true : z > 1.5 + (pr - 5) * 0.55; if (!labels && pr > 2) continue; if (!lod) continue;
      items.push({ id: s.id, x, y, r: dotR(s.id), text: shortName(s.name), prio: pr });
    }
    const dots = STATIONS.filter(s => isVisible(s.id)).map(s => ({ x: screen[s.id][0], y: screen[s.id][1], r: dotR(s.id) }));
    return placeLabels(items, screenSegs, dots, { w: size.w, h: size.h - 58 }, false); // keep clear of the bottom control bar
  }, [screen, screenSegs, labels, hidden, mapSelected, hover, planner.origin, planner.destination, routeSet, size, z]); // eslint-disable-line react-hooks/exhaustive-deps

  const linePath = (id: string) => { const l = metro.lines[id]; return pathOf(mode === 'geo' ? l.geometry.map(([la, lo]) => geoPt(la, lo)) : l.stations.map(s => world[s])); };
  const routePaths = useMemo(() => route?.legs.map(leg => ({ color: metro.lines[leg.lineId].color, d: pathOf(mode === 'geo' ? sliceGeometry(metro, leg.lineId, leg.from, leg.to).map(([la, lo]) => geoPt(la, lo)) : leg.stops.map(s => world[s])) })) ?? [], [route, mode, world]);
  const sel = mapSelected ? metro.stations[mapSelected] : null;
  useEffect(() => { setDemand(null); if (!mapSelected || !online) return; let live = true; get<any>(`/api/crowd/stations/${mapSelected}`, { date: todayISO() }).then(r => { if (live) setDemand(r); }).catch(() => { /* leave unavailable */ }); return () => { live = false; }; }, [mapSelected, online]);
  const stAlerts = (id: string) => (alertStations.get(id) ?? []).filter(a => alertFilter === 'all' || alertGroup(a.category) === alertFilter);
  const closedIds = useMemo(() => new Map(restrictions.closedStations.map(c => [c.id, c])), [restrictions]);
  const blockedPairs = useMemo(() => {
    const out: [string, string][] = [];
    for (const c of restrictions.closedSegments) { const st = metro.lines[c.line]?.stations ?? []; const i = st.indexOf(c.from), j = st.indexOf(c.to); if (i < 0 || j < 0) continue; for (let k = Math.min(i, j); k < Math.max(i, j); k++) out.push([st[k], st[k + 1]]); }
    for (const c of restrictions.suspendedLines) { const st = metro.lines[c.line]?.stations ?? []; for (let k = 0; k < st.length - 1; k++) out.push([st[k], st[k + 1]]); }
    for (const c of restrictions.partialLines) { const st = metro.lines[c.line]?.stations ?? []; const i = st.indexOf(c.from), j = st.indexOf(c.to); if (i < 0 || j < 0) continue; const a = Math.min(i, j), b = Math.max(i, j); for (let k = 0; k < st.length - 1; k++) if (k < a || k + 1 > b) out.push([st[k], st[k + 1]]); }
    return out;
  }, [restrictions]);
  const toggle = (l: string) => setHidden(h => { const n = new Set(h); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const lineDim = (l: string) => (focus && focus !== l) || (route && !focus) ? 0.28 : 1;
  const key = (e: React.KeyboardEvent) => { const s = 60; if (e.key === '+' || e.key === '=') zoomAt(1.5, undefined, undefined, true); else if (e.key === '-') zoomAt(1 / 1.5, undefined, undefined, true); else if (e.key === 'ArrowLeft') setView(v => ({ ...v, x: v.x + s })); else if (e.key === 'ArrowRight') setView(v => ({ ...v, x: v.x - s })); else if (e.key === 'ArrowUp') setView(v => ({ ...v, y: v.y + s })); else if (e.key === 'ArrowDown') setView(v => ({ ...v, y: v.y - s })); else if (e.key === '0') fit(true); };

  return (
    <FeatureShell kicker="02 · Network explorer" title="Explore the network." className="mapview">
      <motion.div variants={rise} className="map-layout">
        <div className="map-stage" ref={wrap} tabIndex={0} onKeyDown={key} aria-label="Bengaluru Metro map. Drag to pan, scroll or pinch to zoom, plus and minus keys zoom, arrow keys pan.">
          <svg width={size.w} height={size.h} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onClick={() => { if (drag.current.moved <= 4) setMapSelected(null); }} onDoubleClick={e => { const r = wrap.current!.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top, true); }}>
            <defs>
              <pattern id="mgrid" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x % 40} ${view.y % 40})`}><path d="M40 0H0V40" fill="none" stroke="#E9DFC6" strokeOpacity=".045" /></pattern>
              <radialGradient id="mglow" cx="50%" cy="50%" r="60%"><stop offset="0" stopColor="#B34BE8" stopOpacity=".10" /><stop offset="1" stopColor="#B34BE8" stopOpacity="0" /></radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#mgrid)" /><rect width="100%" height="100%" fill="url(#mglow)" />
            {mode === 'geo' && [5, 10, 15].map(km => { const c = world['KGWA']; const rr = (km / 111.32) * GEO * view.k; return <g key={km} opacity=".7"><circle cx={c[0] * view.k + view.x} cy={c[1] * view.k + view.y} r={rr} fill="none" stroke="#E9DFC6" strokeOpacity=".09" strokeDasharray="2 6" /><text x={c[0] * view.k + view.x + rr * 0.707 + 4} y={c[1] * view.k + view.y - rr * 0.707} className="map-ring">{km} km</text></g>; })}
            <g key={mode} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {LINES.filter(l => visibleLine(l.id)).map(l => <path key={'c' + l.id} d={linePath(l.id)} fill="none" stroke="#01290F" strokeOpacity={0.9 * lineDim(l.id) + 0.05} strokeWidth={focus === l.id ? 10.5 : 8.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
              {blockedPairs.filter(([a, b]) => visibleLine(metro.stations[a].lines[0]) || visibleLine(metro.stations[b].lines[0])).map(([a, b], i) => <line key={'x' + i} x1={world[a][0]} y1={world[a][1]} x2={world[b][0]} y2={world[b][1]} stroke="#01290F" strokeWidth={7} strokeOpacity=".85" vectorEffect="non-scaling-stroke" />)}
              {route && routePaths.map((r, i) => <motion.path key={'g' + i} d={r.d} fill="none" stroke="#B34BE8" strokeOpacity=".5" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 } as never} animate={{ pathLength: 1 } as never} transition={{ delay: 0.8 + i * 0.5, duration: 1 }} />)}
              {LINES.filter(l => visibleLine(l.id)).map((l, i) => <motion.path key={l.id} d={linePath(l.id)} fill="none" stroke={l.color} strokeWidth={focus === l.id ? 6.5 : 4.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0, opacity: 0 } as never} animate={{ pathLength: 1, opacity: lineDim(l.id) } as never} transition={{ pathLength: { delay: 0.2 + i * 0.3, duration: 1.5, ease: 'easeInOut' }, opacity: { duration: 0.3 } }} />)}
              {route && routePaths.map((r, i) => <motion.path key={'r' + i} d={r.d} fill="none" stroke={r.color} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 } as never} animate={{ pathLength: 1 } as never} transition={{ delay: 0.8 + i * 0.5, duration: 1 }} />)}
              {blockedPairs.map(([a, b], i) => <line key={'bx' + i} x1={world[a][0]} y1={world[a][1]} x2={world[b][0]} y2={world[b][1]} stroke="#CF8CF3" strokeWidth={3} strokeDasharray="5 6" vectorEffect="non-scaling-stroke"><title>Closed or not operating (verified closure)</title></line>)}
            </g>
            {heat && heatData && STATIONS.filter(s => isVisible(s.id)).map(s => { const h = heatData.get(s.id); if (!h) return null; const [x, y] = screen[s.id]; return <circle key={'h' + s.id} cx={x} cy={y} r={dotR(s.id) + 9} fill={LV_FILL[h.level] ?? '#9DBB9E'} fillOpacity=".55" pointerEvents="none"><title>{`${s.name}: ${h.level} (AI-predicted)`}</title></circle>; })}
            {STATIONS.filter(s => isVisible(s.id)).map((s, i) => {
              const [x, y] = screen[s.id]; if (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20) return null;
              const on = s.id === mapSelected, inRoute = routeSet.has(s.id), end = s.id === planner.origin || s.id === planner.destination; const dim = (route && !inRoute) || (focus && !s.lines.includes(focus)) ? 0.3 : 1;
              const r = dotR(s.id) + (on ? 1.5 : 0) + (end ? 1.5 : 0); const col = metro.lines[s.lines[0]].color;
              return (
                <motion.g key={mode + s.id} initial={{ opacity: 0 }} animate={{ opacity: dim }} transition={{ delay: 0.7 + i * 0.01, duration: 0.35 }} style={{ cursor: 'pointer' }}
                  tabIndex={0} role="button" aria-label={`${s.name}, ${s.lines.map(l => metro.lines[l].name).join(' and ')} line${s.interchange ? ', interchange' : ''}`}
                  onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(h => (h === s.id ? null : h))} onFocus={() => setHover(s.id)} onBlur={() => setHover(h => (h === s.id ? null : h))}
                  onClick={e => { e.stopPropagation(); if (drag.current.moved <= 4) setMapSelected(s.id); }} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMapSelected(s.id); } }}>
                  {(on || end) && <circle cx={x} cy={y} r={r + 8} fill="none" stroke="#B34BE8" strokeWidth={1.5} className="pulse-ring" />}
                  <circle cx={x} cy={y} r={r + 9} fill="transparent" />
                  {s.interchange ? <><circle cx={x} cy={y} r={r} fill="#F4EEDB" stroke="#01290F" strokeWidth={2.5} /><circle cx={x} cy={y} r={r - 3.4} fill="#B34BE8" /></>
                    : <><circle cx={x} cy={y} r={r} fill="#F4EEDB" stroke="#01290F" strokeWidth={2} /><circle cx={x} cy={y} r={Math.max(1.4, r - 2.8)} fill={col} /></>}
                  {end && <text x={x} y={y - r - 7} textAnchor="middle" className="map-badge">{s.id === planner.origin ? 'A' : 'B'}</text>}
                  {closedIds.has(s.id) && <g pointerEvents="none"><circle cx={x} cy={y} r={r + 3} fill="#01290F" fillOpacity=".7" /><path d={`M${x - r * .7} ${y - r * .7}L${x + r * .7} ${y + r * .7}M${x + r * .7} ${y - r * .7}L${x - r * .7} ${y + r * .7}`} stroke="#CF8CF3" strokeWidth={2.4} strokeLinecap="round" /></g>}
                  {showAlerts && stAlerts(s.id).length > 0 && <g pointerEvents="none"><circle cx={x + r + 3} cy={y - r - 3} r={6.5} fill="#B34BE8" stroke="#01290F" strokeWidth={1.5} /><text x={x + r + 3} y={y - r - 3 + 3.4} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#01290F">!</text></g>}
                </motion.g>);
            })}
            <g className="map-labels" pointerEvents="none">{labelPos.map(l => { const hot = l.id === mapSelected || l.id === hover || routeSet.has(l.id); return <g key={l.id} className={hot ? 'is-hot' : ''}><rect x={l.x} y={l.y} width={l.w} height={l.h} rx={4} /><text x={l.tx} y={l.ty}>{l.text}</text></g>; })}</g>
          </svg>
          {planRoute && <div className="map-route-bar">{route
            ? <button type="button" className="btn btn--p" onClick={backToFull}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" /></svg>Back to Full Map</button>
            : <button type="button" className="btn btn--g" onClick={showSelectedRoute}>Show selected route</button>}</div>}
          <div className="map-tools" role="toolbar" aria-label="Map controls">
            <button onClick={() => zoomAt(1.6, undefined, undefined, true)} aria-label="Zoom in">+</button><button onClick={() => zoomAt(1 / 1.6, undefined, undefined, true)} aria-label="Zoom out">−</button>
            <button onClick={() => fit(true)} aria-label="Fit entire network" title="Fit entire network"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" /></svg></button>
            <button onClick={() => { setHidden(new Set()); setFocus(null); fit(true); }} aria-label="Reset map" title="Reset map"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 8a6 6 0 1 0 2-4.5M2 2v3h3" /></svg></button>
            <button className={labels ? 'on' : ''} onClick={() => setLabels(v => !v)} aria-pressed={labels} aria-label="Toggle station labels" title="Station labels">Aa</button>
            <button className={showAlerts ? 'on' : ''} onClick={() => setShowAlerts(v => !v)} aria-pressed={showAlerts} aria-label="Toggle alert markers" title="Alert markers">!</button>
            <button className={heat ? 'on' : ''} onClick={() => setHeat(v => !v)} aria-pressed={heat} aria-label="Toggle AI-predicted demand heatmap" title="AI-predicted demand">▦</button>
          </div>
          <div className="map-bar">
            {(showAlerts || heat) && <div className="map-ov" role="group" aria-label="Overlay options">
              {showAlerts && <label>Alerts <select value={alertFilter} onChange={e => setAlertFilter(e.target.value as AlertFilter)}><option value="all">all types</option><option value="delay">delays</option><option value="closure">closures &amp; route changes</option><option value="other">other</option></select></label>}
              {heat && <label>Demand hour {String(heatHour).padStart(2, '0')}:00 <input type="range" min={5} max={23} value={heatHour} onChange={e => setHeatHour(+e.target.value)} /></label>}
              {heat && <span className="fine">AI-predicted station demand (historical pattern, not live occupancy){heatNote ? ' · ' + heatNote : ''}</span>}
              {hasRestrictions(restrictions) && <span className="fine">Dashed purple = closed / not operating</span>}
            </div>}
            <div className="seg" role="tablist" aria-label="Map mode">{(['geo', 'schematic'] as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'geo' ? 'Geographic' : 'Schematic'}</button>)}</div>
            <div className="lines" role="group" aria-label="Metro lines">{LINES.map(l => (
              <span key={l.id} className={`lchip${hidden.has(l.id) ? ' off' : ''}${focus === l.id ? ' focus' : ''}`}>
                <button onClick={() => toggle(l.id)} aria-pressed={!hidden.has(l.id)} aria-label={`${hidden.has(l.id) ? 'Show' : 'Hide'} ${l.name} line`}><i style={{ background: l.color }} />{l.name}</button>
                <button className="lf" onClick={() => setFocus(f => (f === l.id ? null : l.id))} aria-pressed={focus === l.id} aria-label={`Highlight ${l.name} line`} title="Highlight line">◎</button>
              </span>))}</div>
          </div>
        </div>
        <aside className="map-side" aria-live="polite">
          <StationSelect label="Find station" value={null} onChange={id => { if (id) { setMapSelected(id); centerOn(id, 6); } }} compact placeholder="Search name or code…" />
          {!sel && <div className="panel side-empty"><h3>{route ? 'Your route' : 'Select a station'}</h3>
            {route ? <p>{shortName(metro.stations[route.origin].name)} → {shortName(metro.stations[route.destination].name)} · {route.stationCount} stations · {route.lineChanges} change{route.lineChanges === 1 ? '' : 's'}. Highlighted on the map.</p> : <p>Tap any station to see its lines, coordinates and interchange details, then set it as your source or destination.</p>}
            {route && <button type="button" className="btn btn--g" onClick={backToFull}>Show entire network</button>}
            <p className="fine">{STATIONS.length} stations · {LINES.length} lines · {mode === 'geo' ? 'real track geometry' : 'schematic derived from line topology'}</p></div>}
          {sel && (
            <motion.div key={sel.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="panel station">
              <LinePips ids={sel.lines} /><h3>{shortName(sel.name)}</h3>{shortName(sel.name) !== sel.name && <p className="fine">{sel.name}</p>}
              {sel.kn && <p className="kn" lang="kn">{sel.kn}</p>}
              <dl>
                <div><dt>Code</dt><dd>{sel.code}{sel.aliases.length ? <small> · also {sel.aliases.join(', ')}</small> : null}</dd></div>
                <div><dt>Line{sel.lines.length > 1 ? 's' : ''}</dt><dd>{sel.lines.map(l => metro.lines[l].name).join(' · ')}</dd></div>
                <div><dt>Coordinates</dt><dd>{sel.lat.toFixed(5)}° N, {sel.lon.toFixed(5)}° E</dd></div>
                <div><dt>Interchange</dt><dd>{sel.interchange ? `Yes — ${sel.lines.map(l => metro.lines[l].name).join(' ⇄ ')}, min. transfer ${Math.round((metro.transferSeconds[sel.id] ?? 120) / 60)} min` : 'No'}</dd></div>
                <div><dt>Accessibility</dt><dd>{sel.wheelchair ? 'Wheelchair accessible' : 'Not listed'}</dd></div>
              </dl>
              <div className="map-status">
                {closedIds.has(sel.id) && <p className="sa-banner bad">Closed for boarding/alighting{closedIds.get(sel.id)!.passThrough ? ' (trains pass without stopping)' : ''}.</p>}
                {stAlerts(sel.id).map(a => <p key={a.id} className="sa-banner"><b>{a.title}</b>{a.delay_minutes != null ? ` · ${a.delay_minutes} min` : ''}<br /><small>{a.source_label ?? 'Verified'}</small></p>)}
                {online && (demand?.available ? (() => { const h = demand.hours.find((x: any) => x.hour === Math.min(23, Math.max(5, heat ? heatHour : new Date().getHours()))); return h ? <p className="fine">AI-predicted demand at {String(h.hour).padStart(2, '0')}:00: <b>{h.level}</b> (≈{h.entries} entries, range {h.entries_range[0]}–{h.entries_range[1]}). Historical pattern, not live occupancy.</p> : null; })() : <p className="fine">Predicted demand unavailable.</p>)}
              </div>
              <div className="actions">
                <button className="btn btn--g" onClick={() => setOrigin(sel.id)}>{planner.origin === sel.id ? '✓ Source' : 'Set as source'}</button>
                <button className="btn btn--g" onClick={() => setDestination(sel.id)}>{planner.destination === sel.id ? '✓ Destination' : 'Set as destination'}</button>
                <button className="btn btn--p" onClick={() => lateral('planner')}>Open Travel Planner →</button>
              </div>
            </motion.div>)}
        </aside>
      </motion.div>
    </FeatureShell>
  );
}
