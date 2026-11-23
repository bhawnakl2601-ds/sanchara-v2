import type { Station } from './types';
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export function searchStations(stations: Station[], query: string, limit = 12): Station[] {
  const q = norm(query);
  if (!q) return [...stations].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const scored: [number, Station][] = [];
  for (const s of stations) {
    const code = s.code.toLowerCase();
    const name = norm(s.name);
    const al = s.aliases.map(norm);
    let sc = 0;
    if (code === q) sc = 100;
    else if (name === q) sc = 95;
    else if (al.includes(q)) sc = 90;
    else if (name.startsWith(q)) sc = 80;
    else if (name.split(' ').some(w => w.startsWith(q))) sc = 70;
    else if (al.some(a => a.startsWith(q))) sc = 65;
    else if (code.startsWith(q)) sc = 60;
    else if (name.includes(q)) sc = 50;
    else if (al.some(a => a.includes(q))) sc = 40;
    else if (s.kn && s.kn.includes(query.trim())) sc = 35;
    if (sc) scored.push([sc, s]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(x => x[1]);
}
export const shortName = (n: string) => n.split(',')[0].replace(/^Nadaprabhu Kempegowda Station$/, 'Majestic').trim();
