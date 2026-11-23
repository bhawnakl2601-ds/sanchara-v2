/** Screen-space label placement: labels never sit on a metro line, on another station dot, or on another label. */
export interface LabelInput { id: string; x: number; y: number; r: number; text: string; prio: number }
export interface Placed { id: string; x: number; y: number; w: number; h: number; tx: number; ty: number; text: string }
type Seg = [number, number, number, number];
type Rect = [number, number, number, number];

let ctx: CanvasRenderingContext2D | null = null; const widthCache = new Map<string, number>();
export function textWidth(t: string): number {
  const c = widthCache.get(t); if (c !== undefined) return c;
  try { ctx ??= document.createElement('canvas').getContext('2d'); if (ctx) { ctx.font = '500 11px "Inter Tight", system-ui, sans-serif'; const w = ctx.measureText(t).width; widthCache.set(t, w); return w; } } catch { /* ignore */ }
  const w = t.length * 5.8; widthCache.set(t, w); return w;
}
/** Liang–Barsky: does segment a→b intersect rect? */
export function segHitsRect(s: Seg, r: Rect): boolean {
  const [x0, y0, x1, y1] = s; if (Math.max(x0, x1) < r[0] || Math.min(x0, x1) > r[2] || Math.max(y0, y1) < r[1] || Math.min(y0, y1) > r[3]) return false;
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy], q = [x0 - r[0], r[2] - x0, y0 - r[1], r[3] - y0];
  for (let i = 0; i < 4; i++) { if (p[i] === 0) { if (q[i] < 0) return false; } else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } } }
  return true;
}
const overlap = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const circleHitsRect = (cx: number, cy: number, rad: number, r: Rect) => { const x = Math.max(r[0], Math.min(cx, r[2])), y = Math.max(r[1], Math.min(cy, r[3])); return (x - cx) ** 2 + (y - cy) ** 2 < rad * rad; };

export function placeLabels(items: LabelInput[], segs: Seg[], dots: { x: number; y: number; r: number }[], view: { w: number; h: number }, forceAll = false): Placed[] {
  const out: Placed[] = []; const placed: Rect[] = []; const H = 18, PAD = 6;
  const sorted = [...items].sort((a, b) => a.prio - b.prio);
  const near = (x: number, y: number) => segs.filter(s => Math.min(s[0], s[2]) < x + 160 && Math.max(s[0], s[2]) > x - 160 && Math.min(s[1], s[3]) < y + 60 && Math.max(s[1], s[3]) > y - 60);
  for (const it of sorted) {
    if (it.x < -30 || it.y < -20 || it.x > view.w + 30 || it.y > view.h + 20) continue;
    const w = textWidth(it.text) + PAD * 2; const local = near(it.x, it.y); const d = it.r + 9;
    // local line direction → try the perpendicular sides first
    let tx = 1, ty = 0, best = Infinity; for (const s of local) { const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; const dd = (mx - it.x) ** 2 + (my - it.y) ** 2; if (dd < best) { best = dd; const l = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1; tx = (s[2] - s[0]) / l; ty = (s[3] - s[1]) / l; } }
    const cands: { dx: number; dy: number; rect: Rect }[] = [];
    // hubs/terminals/route stops may step further out if the first ring is crowded
    const rings = it.prio <= 4 ? [d, d + 14, d + 30] : [d];
    for (const dist of rings) {
      const ring: { dx: number; dy: number; rect: Rect }[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4; const ux = Math.cos(a), uy = Math.sin(a);
        const cx = it.x + ux * (dist + (Math.abs(ux) > 0.3 ? (w / 2) * Math.sign(ux) : 0)), cy = it.y + uy * (dist + H / 2);
        ring.push({ dx: ux, dy: uy, rect: [cx - w / 2, cy - H / 2, cx + w / 2, cy + H / 2] });
      }
      ring.sort((a, b) => Math.abs(a.dx * tx + a.dy * ty) - Math.abs(b.dx * tx + b.dy * ty) + (a.dx > 0 ? -0.01 : 0));
      cands.push(...ring);
    }
    let pick: Rect | null = null;
    for (const c of cands) {
      const r = c.rect; if (r[0] < 4 || r[2] > view.w - 4 || r[1] < 4 || r[3] > view.h - 4) continue;
      if (placed.some(p => overlap(p, r))) continue;
      if (local.some(s => segHitsRect(s, r))) continue;
      if (dots.some(o => o.x > r[0] - 14 && o.x < r[2] + 14 && o.y > r[1] - 14 && o.y < r[3] + 14 && circleHitsRect(o.x, o.y, o.r + 2, r))) continue;
      pick = r; break;
    }
    if (!pick && forceAll) { const c = cands.find(c => !placed.some(p => overlap(p, c.rect))) ?? cands[0]; pick = c.rect; }
    if (!pick) continue;
    placed.push(pick); out.push({ id: it.id, x: pick[0], y: pick[1], w: pick[2] - pick[0], h: H, tx: pick[0] + PAD, ty: pick[1] + H / 2 + 4, text: it.text });
  }
  return out;
}
