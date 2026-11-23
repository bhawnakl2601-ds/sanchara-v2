/** Tiny helpers for the hand-drawn look of the Bengaluru illustration: seeded randomness (stable between renders) and wobbly, slightly imperfect shapes. */
export const PAL = {
  deep: '#01290F', d2: '#023A19', d1: '#035024', forest: '#027032', mid: '#2E8B4A', lite: '#5FA85F', xl: '#9CC77A',
  beige: '#E9DFC6', beigeHi: '#F3EDDA', beigeSh: '#CDC4A6', tan: '#B2AB8B', tanD: '#7C8466', purple: '#B34BE8', purpleD: '#8E2FC0', purpleL: '#CF8CF3',
};

export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const f = (n: number) => n.toFixed(1);

/** Closed, softly irregular ellipse (a cloud puff, a canopy, a bush). */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, n = 9, jitter = 0.13): string {
  const r = rng(seed); const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.25; const k = 1 + (r() - 0.5) * 2 * jitter; pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]); let d = `M${f(m0[0])} ${f(m0[1])}`;
  for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`; }
  return d + 'Z';
}

/** A cloud: a flat-ish base with several rounded puffs. Returns one path per puff so the caller can shade them. */
export function cloud(x: number, y: number, w: number, seed: number): string[] {
  const r = rng(seed); const out: string[] = []; const n = 5;
  for (let i = 0; i < n; i++) { const t = i / (n - 1); const px = x + (t - 0.5) * w * 0.8; const rr = w * (0.13 + 0.12 * Math.sin(Math.PI * t) + r() * 0.03); out.push(blob(px, y - rr * 0.55 * Math.sin(Math.PI * t), rr * 1.15, rr, seed * 7 + i, 8, 0.07)); }
  out.push(blob(x, y + w * 0.02, w * 0.5, w * 0.075, seed + 99, 8, 0.05));
  return out;
}

/** Rolling ridge line closed to the bottom of the canvas. */
export function ridge(y: number, amp: number, seed: number, w = 1600, h = 900, steps = 8): string {
  const r = rng(seed); let d = `M-20 ${h + 20}L-20 ${f(y)}`; const dx = (w + 40) / steps;
  let px = -20, py = y;
  for (let i = 1; i <= steps; i++) { const nx = -20 + dx * i; const ny = y + (r() - 0.5) * 2 * amp; d += `C${f(px + dx / 2)} ${f(py)} ${f(nx - dx / 2)} ${f(ny)} ${f(nx)} ${f(ny)}`; px = nx; py = ny; }
  return d + `L${w + 20} ${h + 20}Z`;
}

/** A leaf blade (banana / palm style): pointed ellipse from base to tip with a gentle bend. */
export function leaf(x: number, y: number, len: number, wid: number, angle: number, bend = 0.2): string {
  const a = (angle * Math.PI) / 180; const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const tip = [x + ux * len + nx * len * bend, y + uy * len + ny * len * bend]; const m1 = [x + ux * len * 0.5 + nx * (wid + len * bend * 0.5), y + uy * len * 0.5 + ny * (wid + len * bend * 0.5)]; const m2 = [x + ux * len * 0.5 - nx * wid + nx * len * bend * 0.5, y + uy * len * 0.5 - ny * wid + ny * len * bend * 0.5];
  return `M${f(x)} ${f(y)}Q${f(m1[0])} ${f(m1[1])} ${f(tip[0])} ${f(tip[1])}Q${f(m2[0])} ${f(m2[1])} ${f(x)} ${f(y)}Z`;
}

/** Point on a cubic Bézier, used to stand viaduct pillars on a curved deck. */
export function bez(t: number, p: [number, number][]): [number, number] {
  const u = 1 - t; return [u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0], u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1]];
}
