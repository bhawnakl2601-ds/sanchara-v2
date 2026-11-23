import type { MetroData } from './types';
/** Slice a line's real track geometry between two of its stations (by nearest vertices). */
export function sliceGeometry(data: MetroData, lineId: string, a: string, b: string): [number, number][] {
  const line = data.lines[lineId]; const g = line.geometry;
  const near = (id: string) => { const s = data.stations[id]; let bi = 0, bd = Infinity; g.forEach(([la, lo], i) => { const d = (la - s.lat) ** 2 + (lo - s.lon) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i = near(a), j = near(b);
  const pts = i <= j ? g.slice(i, j + 1) : g.slice(j, i + 1).reverse();
  const sa = data.stations[a], sb = data.stations[b];
  return [[sa.lat, sa.lon], ...pts, [sb.lat, sb.lon]];
}
