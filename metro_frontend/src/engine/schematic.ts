import type { MetroData } from './types';
export type Pt = { x: number; y: number };
/**
 * Derives an octilinear schematic from real topology: each line keeps its station order and geographic
 * bearings (smoothed, snapped to 45°, with hysteresis) at uniform station spacing. Purple is anchored at the
 * Majestic interchange, Green is pinned to it, and Yellow starts from the Green/Yellow interchange.
 */
export function schematicLayout(data: MetroData, spacing = 1): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const geoXY = (id: string): Pt => { const s = data.stations[id]; return { x: (s.lon - 77.6) * Math.cos(12.97 * Math.PI / 180), y: -(s.lat - 12.97) }; };
  const dirsFor = (ids: string[]): number[] => {
    const raw: number[] = ids.slice(1).map((id, i) => { const a = geoXY(ids[i]), b = geoXY(id); return Math.atan2(b.y - a.y, b.x - a.x); });
    const sm = raw.map((_, i) => { let sx = 0, sy = 0; for (let k = -3; k <= 3; k++) { const a = raw[Math.min(raw.length - 1, Math.max(0, i + k))]; sx += Math.cos(a); sy += Math.sin(a); } return Math.atan2(sy, sx); });
    const step = Math.PI / 4; let cur = Math.round(sm[0] / step) * step;
    return sm.map(a => { let d = Math.atan2(Math.sin(a - cur), Math.cos(a - cur)); if (Math.abs(d) > 0.56) cur = Math.round(a / step) * step; return cur; });
  };
  const layout = (ids: string[], anchorIdx: number, anchor: Pt) => {
    const dirs = dirsFor(ids);
    pos[ids[anchorIdx]] = pos[ids[anchorIdx]] ?? anchor;
    let p = pos[ids[anchorIdx]];
    for (let i = anchorIdx; i < ids.length - 1; i++) { const d = dirs[i]; p = { x: p.x + Math.cos(d) * spacing, y: p.y + Math.sin(d) * spacing }; if (!pos[ids[i + 1]]) pos[ids[i + 1]] = p; else p = pos[ids[i + 1]]; }
    p = pos[ids[anchorIdx]];
    for (let i = anchorIdx; i > 0; i--) { const d = dirs[i - 1]; p = { x: p.x - Math.cos(d) * spacing, y: p.y - Math.sin(d) * spacing }; if (!pos[ids[i - 1]]) pos[ids[i - 1]] = p; else p = pos[ids[i - 1]]; }
  };
  const L = data.lines; const hub = 'KGWA';
  const purple = L.PURPLE.stations, green = L.GREEN.stations, yellow = L.YELLOW.stations;
  layout(purple, purple.indexOf(hub), { x: 0, y: 0 });
  layout(green, green.indexOf(hub), pos[hub]);
  const jn = yellow.find(s => green.includes(s))!; // Rashtreeya Vidyalaya Road
  layout(yellow, yellow.indexOf(jn), pos[jn]);
  return pos;
}
