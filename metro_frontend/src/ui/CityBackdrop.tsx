import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PAL as C, bez, blob, cloud, leaf, ridge, rng } from './illustrate';

/**
 * The illustrated Bengaluru of SANCHARA: flat vector, hand-painted-poster feel.
 * Three depth layers (far / middle / near) so the interface and the 3D coach always sit in front of calm scenery.
 * Palette: forest green (ground + sky), beige (clouds + masonry highlights), electric purple (route lines + flowers only).
 * Pure SVG, no raster assets: static after first paint except a few slow CSS motions that reduced-motion switches off.
 */

const W = 1600, H = 900;
const HZ = 376; // horizon: the skyline sits high, as in the reference, so the platform stands on calm parkland
const DECK: [number, number][] = [[-60, 478], [420, 462], [1000, 402], [1700, 306]];   // the elevated Namma Metro viaduct

/* ───────────── landmarks ───────────── */

/** Vidhana Soudha: symmetrical Neo-Dravidian facade, central dome on a drum, columned portico, corner kiosks. */
function Vidhana({ cx, base }: { cx: number; base: number }) {
  const wing = (side: 1 | -1) => {
    const x0 = side === 1 ? cx + 132 : cx - 132 - 190; const win = [];
    for (let i = 0; i < 9; i++) win.push(<rect key={i} x={x0 + 10 + i * 20} y={base - 54} width="9" height="20" rx="4.5" fill={C.tanD} opacity=".55" />);
    const kx = side === 1 ? cx + 132 + 190 - 20 : cx - 132 - 190 - 16;
    return (<g key={side}>
      <rect x={x0} y={base - 74} width="190" height="74" fill={C.beige} /><rect x={x0} y={base - 78} width="190" height="8" fill={C.tan} />
      <rect x={x0} y={base - 74} width="190" height="6" fill={C.beigeHi} opacity=".7" />{win}
      <rect x={x0} y={base - 22} width="190" height="22" fill={C.beigeSh} opacity=".7" />
      <rect x={kx} y={base - 106} width="36" height="106" fill={C.beigeHi} /><rect x={kx - 3} y={base - 110} width="42" height="8" fill={C.tan} />
      <path d={`M${kx + 2} ${base - 110}Q${kx + 18} ${base - 142} ${kx + 34} ${base - 110}Z`} fill={C.tan} /><path d={`M${kx + 18} ${base - 134}v-12`} stroke={C.tanD} strokeWidth="2" />
    </g>);
  };
  const pillars = []; for (let i = 0; i < 9; i++) pillars.push(<g key={i}><rect x={cx - 120 + i * 30} y={base - 100} width="12" height="82" fill={C.beigeHi} /><rect x={cx - 123 + i * 30} y={base - 106} width="18" height="7" fill={C.tan} /><rect x={cx - 123 + i * 30} y={base - 20} width="18" height="6" fill={C.tan} /></g>);
  const drumCols = []; for (let i = 0; i < 7; i++) drumCols.push(<rect key={i} x={cx - 41 + i * 13} y={base - 218} width="6" height="40" fill={C.tanD} opacity=".5" />);
  return (
    <g className="ink">
      <ellipse cx={cx} cy={base + 6} rx="420" ry="10" fill={C.deep} opacity=".28" />
      {wing(-1)}{wing(1)}
      <rect x={cx - 140} y={base - 112} width="280" height="112" fill={C.beige} />
      <path d={`M${cx - 148} ${base - 112}L${cx} ${base - 142}L${cx + 148} ${base - 112}Z`} fill={C.beigeHi} /><path d={`M${cx - 148} ${base - 112}L${cx} ${base - 142}L${cx + 148} ${base - 112}`} fill="none" stroke={C.tan} strokeWidth="4" />
      <rect x={cx - 130} y={base - 106} width="260" height="86" fill={C.beigeSh} opacity=".55" />{pillars}
      {[0, 1, 2, 3, 4].map(i => <rect key={i} x={cx - 150 + i * 4} y={base - 5 + i * 0} width={300 - i * 8} height="5" fill={i % 2 ? C.beigeSh : C.beigeHi} opacity=".9" />)}
      {Array.from({ length: 21 }, (_, i) => <path key={i} d={`M${cx - 140 + i * 14} ${base - 112}v-6a4 4 0 0 1 8 0v6z`} fill={C.tanD} opacity=".5" />)}
      <rect x={cx - 92} y={base - 172} width="184" height="62" fill={C.beigeHi} /><rect x={cx - 98} y={base - 178} width="196" height="9" fill={C.tan} />
      {[-66, -33, 0, 33, 66].map(o => <path key={o} d={`M${cx + o - 9} ${base - 124}v-26a9 9 0 0 1 18 0v26z`} fill={C.tanD} opacity=".5" />)}
      {[-1, 1].map(s => <g key={s}><rect x={cx + s * 78 - 14} y={base - 204} width="28" height="30" fill={C.beige} /><path d={`M${cx + s * 78 - 17} ${base - 204}Q${cx + s * 78} ${base - 232} ${cx + s * 78 + 17} ${base - 204}Z`} fill={C.tan} /></g>)}
      <rect x={cx - 50} y={base - 220} width="100" height="46" fill={C.beige} />{drumCols}<rect x={cx - 56} y={base - 226} width="112" height="8" fill={C.tan} />
      <path d={`M${cx - 50} ${base - 226}Q${cx - 52} ${base - 292} ${cx} ${base - 304}Q${cx + 52} ${base - 292} ${cx + 50} ${base - 226}Z`} fill={C.tan} />
      <path d={`M${cx - 36} ${base - 232}Q${cx - 38} ${base - 282} ${cx - 8} ${base - 296}Q${cx - 30} ${base - 274} ${cx - 28} ${base - 232}Z`} fill={C.beigeHi} opacity=".75" />
      <rect x={cx - 7} y={base - 322} width="14" height="20" fill={C.beige} /><path d={`M${cx - 9} ${base - 322}L${cx} ${base - 340}L${cx + 9} ${base - 322}Z`} fill={C.tan} /><path d={`M${cx} ${base - 340}v-16`} stroke={C.tanD} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  );
}

/** UB City-style glass towers: stepped silhouettes with window grids. */
function Towers({ x, base }: { x: number; base: number }) {
  const T: [number, number, number, number][] = [[0, 96, 250, 0], [92, 118, 340, 1], [204, 88, 200, 0], [286, 70, 280, 2]];
  return (
    <g>{T.map(([dx, w, h, kind], i) => (
      <g key={i}>
        <path d={kind === 2 ? `M${x + dx} ${base}V${base - h + 26}L${x + dx + w} ${base - h}V${base}Z` : kind === 1 ? `M${x + dx} ${base}V${base - h + 18}H${x + dx + 14}V${base - h}H${x + dx + w - 14}V${base - h + 18}H${x + dx + w}V${base}Z` : `M${x + dx} ${base}V${base - h}H${x + dx + w}V${base}Z`} fill={i % 2 ? C.d1 : C.forest} />
        <path d={`M${x + dx} ${base}V${base - h}H${x + dx + w * 0.22}V${base}Z`} fill={C.lite} opacity=".35" />
        <rect x={x + dx + 6} y={base - h + 24} width={w - 12} height={h - 30} fill="url(#cb-win)" opacity=".8" />
        <rect x={x + dx + 6} y={base - 18} width={w - 12} height="18" fill={C.deep} opacity=".25" />
      </g>))}
      <rect x={x + 120} y={base - 372} width="3" height="32" fill={C.d1} />
    </g>
  );
}

/** Bengaluru TV (Doordarshan) tower: tapering lattice shaft, observation pod, mast. */
function TvTower({ x, base }: { x: number; base: number }) {
  const top = base - 440; const lat = []; for (let i = 0; i < 12; i++) { const y = base - 30 - i * 26; const half = 11 - i * 0.55; lat.push(<path key={i} d={`M${x - half} ${y}L${x + half} ${y - 26}M${x + half} ${y}L${x - half} ${y - 26}`} stroke={C.d2} strokeWidth="1.4" opacity=".7" />); }
  return (
    <g>
      <path d={`M${x - 20} ${base}L${x - 6} ${top + 120}H${x + 6}L${x + 20} ${base}Z`} fill={C.forest} />{lat}
      <path d={`M${x - 6} ${top + 120}L${x - 28} ${top + 96}H${x + 28}L${x + 6} ${top + 120}Z`} fill={C.d1} />
      <rect x={x - 30} y={top + 70} width="60" height="26" rx="6" fill={C.mid} /><rect x={x - 34} y={top + 62} width="68" height="9" rx="3" fill={C.d1} />
      <rect x={x - 26} y={top + 76} width="52" height="8" rx="3" fill={C.beige} opacity=".5" /><rect x={x - 20} y={top + 48} width="40" height="14" rx="5" fill={C.lite} />
      <path d={`M${x - 3} ${top + 48}L${x - 1} ${top - 40}H${x + 1}L${x + 3} ${top + 48}Z`} fill={C.d1} /><circle cx={x} cy={top - 42} r="3" fill={C.purple} />
    </g>
  );
}

/** Nandi on a stone pedestal, in the manner of the Bull Temple statue: reclining, garlanded, polished dark granite. */
function Nandi({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="4" rx="118" ry="8" fill={C.deep} opacity=".35" />
      <rect x="-104" y="-14" width="208" height="14" rx="2" fill={C.tanD} /><rect x="-92" y="-30" width="184" height="16" rx="2" fill={C.tan} /><rect x="-80" y="-46" width="160" height="16" rx="2" fill={C.beigeSh} />
      {[-62, -20, 22, 64].map(o => <rect key={o} x={o} y="-44" width="14" height="12" rx="3" fill={C.tanD} opacity=".45" />)}
      <path d="M-70 -46C-74 -80 -40 -100 4 -94C42 -90 66 -78 72 -58V-46Z" fill={C.d2} />
      <path d="M-34 -92C-20 -116 16 -112 26 -90C8 -98 -14 -98 -34 -92Z" fill={C.d1} />
      <path d="M-56 -78C-44 -92 -22 -98 4 -96C-20 -90 -42 -84 -56 -64Z" fill={C.mid} opacity=".45" />
      <path d="M30 -58C44 -62 58 -60 70 -64L84 -80C96 -88 112 -82 118 -70C122 -62 116 -54 104 -52C98 -44 84 -42 74 -46L64 -46Z" fill={C.d2} />
      <path d="M84 -80C94 -112 120 -118 128 -104C118 -108 104 -102 98 -86Z" fill={C.beigeSh} /><path d="M80 -84C74 -100 62 -104 56 -98C62 -94 68 -90 72 -82Z" fill={C.d1} />
      <circle cx="100" cy="-70" r="2.6" fill={C.beige} /><circle cx="116" cy="-66" r="1.8" fill={C.deep} />
      {[0, 1, 2, 3, 4, 5].map(i => <circle key={i} cx={36 + i * 6} cy={-50 + Math.sin(i * 1.1) * 6} r="4.2" fill={i % 2 ? C.beige : C.purple} />)}
      <path d="M-60 -62C-84 -66 -92 -50 -86 -36" fill="none" stroke={C.d2} strokeWidth="5" strokeLinecap="round" />
      <rect x="22" y="-50" width="48" height="12" rx="6" fill={C.d1} /><path d="M70 -46l14 0" stroke={C.d2} strokeWidth="6" strokeLinecap="round" />
    </g>
  );
}

/** Small elevated train for the viaduct (the hero coach stays in the 3D scene). */
function MiniTrain() {
  const [px, py] = bez(0.57, DECK); const [qx, qy] = bez(0.58, DECK); const ang = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
  return (
    <g transform={`translate(${px} ${py - 3}) rotate(${ang})`}><g transform="translate(-48 -17) scale(.68)">
      {[0, 1].map(i => (<g key={i} transform={`translate(${i * 70} 0)`}>
        <rect width="68" height="18" rx="5" fill={C.beige} /><rect y="9" width="68" height="3.6" fill={C.purple} />
        {[8, 24, 40, 54].map(w => <rect key={w} x={w} y="3" width="8" height="5.5" rx="1.5" fill={C.d2} opacity=".85" />)}<rect y="14.5" width="68" height="3.5" rx="1.6" fill={C.tan} opacity=".8" />
      </g>))}
    </g></g>
  );
}

function Viaduct() {
  const d = `M${DECK[0]}C${DECK[1]} ${DECK[2]} ${DECK[3]}`; const pillars = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; const [px, py] = bez(t, DECK); const sc = 0.62 + t * 0.2; pillars.push(<g key={i}><rect x={px - 7 * sc} y={py + 6} width={14 * sc} height={120} fill={C.d1} /><rect x={px - 7 * sc} y={py + 6} width={5 * sc} height={120} fill={C.forest} opacity=".8" /><path d={`M${px - 24 * sc} ${py + 4}H${px + 24 * sc}L${px + 12 * sc} ${py + 24}H${px - 12 * sc}Z`} fill={C.d2} /></g>); }
  return (
    <g>{pillars}
      <path d={d} fill="none" stroke={C.deep} strokeWidth="15" strokeLinecap="round" opacity=".9" />
      <path d={d} fill="none" stroke={C.d1} strokeWidth="10" strokeLinecap="round" />
      <path d={d} fill="none" stroke={C.beige} strokeWidth="2.4" opacity=".7" transform="translate(0 -7)" />
      <path d={d} fill="none" stroke={C.purple} strokeWidth="2.2" strokeDasharray="14 10" opacity=".9" transform="translate(0 -2)" />
    </g>
  );
}

/* ───────────── foliage ───────────── */

function Tree({ x, y, s, seed, tone = 0 }: { x: number; y: number; s: number; seed: number; tone?: number }) {
  const cols = [[C.d1, C.forest, C.mid], [C.forest, C.mid, C.lite], [C.mid, C.lite, C.xl], [C.d2, C.d1, C.forest]][tone];
  const r = rng(seed); const dots = Array.from({ length: 5 }, () => [(r() - 0.5) * 70, -70 - r() * 60, 3 + r() * 4]);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={`M-5 0L-3 -52L-1 -86L5 -86L4 -52L8 0Z`} fill={C.deep} opacity=".85" />
      <path d={blob(0, -92, 46, 36, seed, 9)} fill={cols[0]} /><path d={blob(-24, -78, 30, 26, seed + 1, 8)} fill={cols[0]} /><path d={blob(26, -80, 30, 26, seed + 2, 8)} fill={cols[0]} />
      <path d={blob(-6, -100, 34, 26, seed + 3, 9)} fill={cols[1]} /><path d={blob(-14, -110, 20, 15, seed + 4, 8)} fill={cols[2]} opacity=".9" />
      {dots.map((d, i) => <circle key={i} cx={d[0]} cy={d[1]} r={d[2]} fill={cols[2]} opacity=".55" />)}
    </g>
  );
}

function Flower({ x, y, s = 1, seed }: { x: number; y: number; s?: number; seed: number }) {
  const r = rng(seed); const a0 = r() * 72;
  return (<g transform={`translate(${x} ${y}) scale(${s})`}><path d={`M0 0Q${(r() - 0.5) * 8} -16 0 -34`} stroke={C.mid} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    <g transform="translate(0 -36)">{[0, 1, 2, 3, 4].map(i => <ellipse key={i} cx="0" cy="-8" rx="5.2" ry="8" fill={i % 2 ? C.purple : C.purpleL} transform={`rotate(${a0 + i * 72})`} />)}<circle r="4" fill={C.beigeHi} /></g></g>);
}

function Bushes({ y, amp, seed, dark = false, step = 120, skip }: { y: number; amp: number; seed: number; dark?: boolean; step?: number; skip?: [number, number] }) {
  const r = rng(seed); const items = [];
  for (let x = -40, i = 0; x < W + 60; x += step * (0.7 + r() * 0.6), i++) { if (skip && x > skip[0] && x < skip[1]) continue; const ry = 36 + r() * 34; const cy = y + (r() - 0.5) * amp; items.push(<g key={i}><path d={blob(x, cy, 70 + r() * 40, ry, seed + i * 3, 9)} fill={dark ? C.d2 : C.d1} /><path d={blob(x - 14, cy - ry * 0.35, 40, ry * 0.5, seed + i * 3 + 1, 8)} fill={dark ? C.d1 : C.forest} opacity=".9" /></g>); }
  return <g>{items}</g>;
}

function Leaves({ x, y, n, seed, dir = 1 }: { x: number; y: number; n: number; seed: number; dir?: 1 | -1 }) {
  const r = rng(seed);
  return <g>{Array.from({ length: n }, (_, i) => { const ang = -90 + (i / (n - 1) - 0.5) * 130 * dir + (r() - 0.5) * 14; const len = 120 + r() * 120; const c = [C.d2, C.d1, C.forest, C.mid][i % 4]; return <g key={i}><path d={leaf(x, y, len, 22 + r() * 12, ang, 0.18 * dir)} fill={c} /><path d={`M${x} ${y}L${x + Math.cos((ang * Math.PI) / 180) * len * 0.88} ${y + Math.sin((ang * Math.PI) / 180) * len * 0.88}`} stroke={C.lite} strokeWidth="1.6" opacity=".4" /></g>; })}</g>;
}

/* ───────────── sky ───────────── */

function Clouds({ list, seed }: { list: [number, number, number][]; seed: number }) {
  return <g>{list.map(([x, y, w0], i) => { let w = w0; w = w0 * 0.5; const parts = cloud(x, y, w, seed + i * 13); return <g key={i}><g transform="translate(5 9)" opacity=".5">{parts.map((d, k) => <path key={k} d={d} fill={C.tanD} />)}</g>{parts.map((d, k) => <path key={k} d={d} fill={C.beige} />)}<path d={blob(x - w * 0.12, y - w * 0.16, w * 0.16, w * 0.06, seed + i, 7)} fill={C.beigeHi} opacity=".7" /><path d={blob(x + w * 0.12, y + w * 0.035, w * 0.38, w * 0.03, seed + i + 4, 7)} fill={C.beigeSh} opacity=".6" /></g>; })}</g>;
}
const Bird = ({ x, y, s, d }: { x: number; y: number; s: number; d: number }) => <g transform={`translate(${x} ${y}) scale(${s})`}><g data-d={d}><path d="M-12 0Q-6 -9 0 0Q6 -9 12 0" fill="none" stroke={C.d2} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></g></g>;

/* ───────────── street life & cultural details ───────────── */

/** Auto-rickshaw, in Bengaluru's green livery with a beige hood. Faces left. */
function Rickshaw({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`} filter="url(#cb-wob)">
      <ellipse cx="2" cy="2" rx="56" ry="5" fill={C.deep} opacity=".3" />
      <path d="M-50 -22L-46 -52Q-42 -68 -22 -68H30Q48 -68 52 -46L56 -22Z" fill={C.forest} stroke={C.deep} strokeWidth="1.6" strokeOpacity=".5" />
      <path d="M-48 -56Q4 -92 56 -58L56 -50L-48 -50Z" fill={C.beige} stroke={C.deep} strokeWidth="1.4" strokeOpacity=".45" />
      <path d="M-47 -48L-41 -32H-14V-48Z" fill={C.beigeHi} opacity=".85" /><rect x="-10" y="-46" width="40" height="22" rx="3" fill={C.d2} opacity=".55" />
      <rect x="-50" y="-30" width="106" height="4.5" fill={C.purple} />
      <circle cx="-34" cy="-9" r="10.5" fill={C.deep} /><circle cx="-34" cy="-9" r="4" fill={C.beigeSh} /><circle cx="32" cy="-9" r="10.5" fill={C.deep} /><circle cx="32" cy="-9" r="4" fill={C.beigeSh} />
      <circle cx="-53" cy="-34" r="3.6" fill={C.beigeHi} />
    </g>
  );
}

const Lamp = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}><rect x="-2.2" y="-86" width="4.4" height="86" rx="2" fill={C.deep} /><path d="M0 -86Q0 -98 12 -98" stroke={C.deep} strokeWidth="3.4" fill="none" strokeLinecap="round" /><path d="M6 -98h14l-3 7h-8z" fill={C.beige} stroke={C.deep} strokeWidth="1.4" /><rect x="-6" y="-6" width="12" height="6" rx="2" fill={C.d1} /></g>
);

function Person({ x, y, s = 1, tone = 0 }: { x: number; y: number; s?: number; tone?: number }) {
  const cloth = [C.purple, C.beige, C.lite][tone % 3];
  return <g transform={`translate(${x} ${y}) scale(${s})`}><circle cx="0" cy="-34" r="5" fill={C.deep} /><path d="M-6 -28Q0 -32 6 -28L8 -8H-8Z" fill={cloth} stroke={C.deep} strokeWidth="1.2" strokeOpacity=".5" /><path d="M-5 -8l-2 9M5 -8l2 9" stroke={C.deep} strokeWidth="3" strokeLinecap="round" /></g>;
}

/** A flowering tree (purple blossom) for park corners. */
function BloomTree({ x, y, s, seed }: { x: number; y: number; s: number; seed: number }) {
  const r = rng(seed);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-4 0L-2 -50L-8 -78M-2 -50L10 -80" stroke={C.deep} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d={blob(0, -96, 50, 34, seed, 10, 0.16)} fill={C.d1} /><path d={blob(-12, -104, 36, 24, seed + 1, 9, 0.16)} fill={C.forest} />
      {Array.from({ length: 16 }, (_, i) => <circle key={i} cx={(r() - 0.5) * 92} cy={-96 + (r() - 0.5) * 54} r={3 + r() * 3.4} fill={i % 3 ? C.purple : C.purpleL} opacity=".92" />)}
    </g>
  );
}

/** Winding beige garden path: a ribbon along a centre line, widening toward the viewer. */
function Path({ pts, w0, w1, seed }: { pts: [number, number][]; w0: number; w1: number; seed: number }) {
  const r = rng(seed); const L: string[] = [], R: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24; const [x, y] = bez(t, pts); const [x2, y2] = bez(Math.min(1, t + 0.02), pts); const [x1, y1] = bez(Math.max(0, t - 0.02), pts);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1; const w = (w0 + (w1 - w0) * t * t) / 2 * (1 + (r() - 0.5) * 0.08);
    L.push(`${(x - (dy / len) * w).toFixed(1)} ${(y + (dx / len) * w).toFixed(1)}`); R.push(`${(x + (dy / len) * w).toFixed(1)} ${(y - (dx / len) * w).toFixed(1)}`);
  }
  const d = `M${L.join('L')}L${R.reverse().join('L')}Z`;
  return <g><path d={d} fill={C.beige} /><path d={d} fill="none" stroke={C.deep} strokeOpacity=".28" strokeWidth="2" strokeLinejoin="round" /></g>;
}

function Sign({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`} filter="url(#cb-wob)"><rect x="-26" y="-8" width="7" height="58" fill={C.tanD} /><rect x="26" y="-8" width="7" height="58" fill={C.tanD} /><g transform="rotate(-1.5)"><rect x="-62" y="-70" width="128" height="62" rx="9" fill={C.beige} stroke={C.deep} strokeWidth="3" strokeOpacity=".7" /><rect x="-55" y="-63" width="114" height="48" rx="5" fill="none" stroke={C.forest} strokeWidth="1.6" strokeDasharray="5 3" /><text x="2" y="-40" textAnchor="middle" className="cb-sign" textLength="102" lengthAdjust="spacingAndGlyphs">BENGALURU</text><text x="2" y="-21" textAnchor="middle" className="cb-sign cb-sign--kn" lang="kn" textLength="78" lengthAdjust="spacingAndGlyphs">ಬೆಂಗಳೂರು</text></g></g>;
}

const Scaled = ({ x, y, s, children }: { x: number; y: number; s: number; children: ReactNode }) => <g transform={`translate(${x} ${y}) scale(${s}) translate(${-x} ${-y})`}>{children}</g>;

/* ───────────── composition ───────────── */

/** The scene is framed from the window shape (like object-fit: cover, but the skyline stays at the same screen height as in the reference), then never moves. */
function frame(w: number, h: number): string {
  const asp = w / Math.max(h, 1);
  if (asp >= 16 / 9) { const vh = 1600 / asp; const y0 = Math.min(Math.max(HZ - 0.36 * vh, 0), 900 - vh); return `0 ${y0.toFixed(1)} 1600 ${vh.toFixed(1)}`; }
  const vw = 900 * asp; const cx = asp < 1 ? 700 : 800; const x0 = Math.min(Math.max(cx - vw / 2, 0), 1600 - vw); return `${x0.toFixed(1)} 0 ${vw.toFixed(1)} 900`;
}
function useFrame() {
  const [vb, setVb] = useState(() => (typeof window === 'undefined' ? '0 0 1600 900' : frame(window.innerWidth, window.innerHeight)));
  useEffect(() => { let t = 0; const f = () => { window.clearTimeout(t); t = window.setTimeout(() => setVb(frame(window.innerWidth, window.innerHeight)), 60); }; f(); window.addEventListener('resize', f); return () => { window.removeEventListener('resize', f); window.clearTimeout(t); }; }, []);
  return vb;
}

const Defs = () => (
  <defs>
    <linearGradient id="cb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#03622C" /><stop offset=".26" stopColor="#3F8F52" /><stop offset=".42" stopColor="#9DB98A" /><stop offset=".5" stopColor="#D3D2B3" /></linearGradient>
    <radialGradient id="cb-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={C.beigeHi} stopOpacity=".7" /><stop offset=".5" stopColor={C.beige} stopOpacity=".28" /><stop offset="1" stopColor={C.beige} stopOpacity="0" /></radialGradient>
    <radialGradient id="cb-lawn" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={C.lite} stopOpacity=".85" /><stop offset="1" stopColor={C.lite} stopOpacity="0" /></radialGradient>
    <pattern id="cb-win" width="13" height="15" patternUnits="userSpaceOnUse"><rect x="2.5" y="3.5" width="8" height="8" rx="1.2" fill="#9CC77A" opacity=".5" /></pattern>
    {/* a few units of wobble make straight edges read as drawn rather than computed */}
    <filter id="cb-wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency=".03" numOctaves="2" seed="4" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" /></filter>
    <filter id="cb-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="7" stitchTiles="stitch" /><feColorMatrix values="0 0 0 0 .93  0 0 0 0 .88  0 0 0 0 .75  0 0 0 .75 -.28" /></filter>
  </defs>
);


export const CityBackdrop = memo(function CityBackdrop() {
  const vb = useFrame();
  const farTrees = useMemo(() => { const r = rng(11); return Array.from({ length: 52 }, (_, i) => ({ x: -20 + i * 32 + r() * 20, y: HZ + 10 + r() * 10, s: 0.2 + r() * 0.12, seed: 100 + i })); }, []);
  const blocks = useMemo(() => { const r = rng(5); const out: { x: number; w: number; h: number }[] = []; for (let x = 10; x < 330; x += 34 + r() * 26) out.push({ x, w: 26 + r() * 22, h: 30 + r() * 70 }); for (let x = 1430; x < 1640; x += 32 + r() * 22) out.push({ x, w: 24 + r() * 18, h: 28 + r() * 54 }); return out; }, []);
  const left = useMemo(() => { const r = rng(23); return [[-30, 520, 1.1, 0], [60, 540, 0.95, 1], [150, 506, 0.8, 3], [250, 528, 0.9, 2], [330, 500, 0.62, 1], [395, 520, 0.7, 0]].map(([x, y, s, tone], i) => ({ x: x + r() * 14, y: y + r() * 8, s: s as number, seed: 300 + i, tone: tone as number })); }, []);
  const right = useMemo(() => { const r = rng(29); return [[1240, 498, 0.6, 2], [1310, 520, 0.85, 0], [1400, 540, 1, 1], [1480, 510, 0.8, 3], [1560, 535, 1.05, 0], [1640, 520, 0.9, 2]].map(([x, y, s, tone], i) => ({ x: x + r() * 14, y: y + r() * 8, s: s as number, seed: 400 + i, tone: tone as number })); }, []);
  const flowers = useMemo(() => { const r = rng(41); const out: { x: number; y: number; s: number; seed: number }[] = []; for (let i = 0; i < 22; i++) { const side = i % 2 ? 1 : -1; out.push({ x: 800 + side * (120 + r() * 340), y: 800 + r() * 70, s: 0.55 + r() * 0.5, seed: 500 + i }); } return out; }, []);
  const PATH: [number, number][] = [[832, 590], [748, 690], [904, 764], [772, 912]];

  return (
    <div className="backdrop cityscape" aria-hidden="true">
      <svg viewBox={vb} preserveAspectRatio="xMidYMax slice" role="presentation" focusable="false">
        <Defs />
        <rect x="-600" y="-600" width="2800" height="1100" fill="url(#cb-sky)" /><rect x="-600" y="880" width="2800" height="500" fill={C.d2} />
        <circle cx="700" cy={HZ - 20} r="470" fill="url(#cb-sun)" />

        {/* sky */}
        <Clouds seed={3} list={[[470, 118, 330], [1000, 70, 270], [150, 56, 260], [790, 222, 190], [1540, 330, 220]]} />

        {/* distant city */}
        <path d={ridge(HZ, 8, 2)} fill={C.lite} opacity=".9" />
        {blocks.map((b, i) => <g key={i}><rect x={b.x} y={HZ + 4 - b.h} width={b.w} height={b.h} fill={C.mid} opacity=".85" /><rect x={b.x + 4} y={HZ + 4 - b.h + 7} width={b.w - 8} height={b.h - 12} fill="url(#cb-win)" opacity=".6" /></g>)}
        <g filter="url(#cb-wob)"><Scaled x={1210} y={HZ + 6} s={0.5}><TvTower x={1210} base={HZ + 6} /></Scaled></g>
        <g filter="url(#cb-wob)"><Scaled x={900} y={HZ + 8} s={0.58}><Towers x={900} base={HZ + 8} /></Scaled></g>
        {farTrees.map(t => <Tree key={t.seed} {...t} tone={2} />)}
        <g filter="url(#cb-wob)"><Scaled x={700} y={HZ} s={0.54}><Vidhana cx={700} base={HZ} /></Scaled></g>

        {/* parkland: Cubbon-Park-inspired greens, kept calm and light behind the platform */}
        <path d={ridge(HZ + 36, 9, 6)} fill={C.mid} />
        <Viaduct />
        <path d={ridge(HZ + 78, 14, 8)} fill={C.forest} />
        <ellipse cx="800" cy="620" rx="560" ry="170" fill="url(#cb-lawn)" />
        <path d="M-20 574C120 546 260 590 430 552" stroke={C.beige} strokeWidth="6" fill="none" strokeLinecap="round" opacity=".32" /><path d="M1180 556C1330 590 1470 548 1640 580" stroke={C.beige} strokeWidth="6" fill="none" strokeLinecap="round" opacity=".32" />
        {left.map(t => <Tree key={t.seed} {...t} />)}<BloomTree x={440} y={548} s={0.55} seed={77} />
        {right.map(t => <Tree key={t.seed} {...t} />)}<BloomTree x={1190} y={556} s={0.6} seed={79} />
        <Person x={250} y={566} s={0.34} tone={0} /><Person x={278} y={567} s={0.3} tone={1} /><Person x={1346} y={578} s={0.34} tone={2} />
        <Lamp x={340} y={574} s={0.5} /><Lamp x={1250} y={582} s={0.5} />

        {/* near ground */}
        <path d={ridge(676, 12, 12)} fill={C.d1} />
        <Path pts={PATH} w0={30} w1={190} seed={9} />
        <Bushes y={744} amp={20} seed={31} step={100} skip={[560, 1040]} />
        <Lamp x={690} y={735} s={0.78} /><Lamp x={955} y={722} s={0.7} />
        <g className="ink" filter="url(#cb-wob)"><Nandi x={1066} y={790} s={0.46} /></g>
        <Rickshaw x={904} y={858} s={0.5} flip />
        <Sign x={340} y={836} />
        <Bushes y={862} amp={20} seed={57} step={120} skip={[600, 980]} />
        {flowers.map(f => <Flower key={f.seed} {...f} />)}
        <Bushes y={910} amp={22} seed={63} dark step={150} skip={[560, 1040]} />
        <Leaves x={90} y={920} n={7} seed={5} dir={1} /><Leaves x={1510} y={920} n={7} seed={8} dir={-1} />

        <Bird x={880} y={196} s={1.1} d={0} /><Bird x={1010} y={150} s={0.9} d={1.3} /><Bird x={560} y={238} s={0.8} d={2.1} /><Bird x={960} y={262} s={0.7} d={0.6} />
        <MiniTrain />
        <rect x="-600" y="-600" width="2800" height="2000" filter="url(#cb-grain)" opacity=".12" style={{ mixBlendMode: 'soft-light' }} pointerEvents="none" />
      </svg>

    </div>
  );
});

/** Quiet scenery for feature pages: only clouds and foreground foliage so the content area stays calm and readable. */
export const SceneryStrip = memo(function SceneryStrip() {
  const flowers = useMemo(() => { const r = rng(77); return Array.from({ length: 9 }, (_, i) => ({ x: 120 + i * 170 + r() * 60, y: 880 + r() * 14, s: 0.7 + r() * 0.4, seed: 900 + i })); }, []);
  return (
    <div className="scenery" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" role="presentation" focusable="false">
        <Defs />
        <g opacity=".5"><Clouds seed={21} list={[[260, 130, 340], [1240, 90, 380]]} /></g>
        <path d={ridge(800, 20, 14)} fill={C.d1} opacity=".55" />
        <Bushes y={880} amp={20} seed={61} step={130} />{flowers.map(f => <Flower key={f.seed} {...f} />)}
        <Bushes y={920} amp={20} seed={67} dark step={160} />
        <Leaves x={60} y={930} n={7} seed={4} dir={1} /><Leaves x={1540} y={930} n={7} seed={6} dir={-1} />
      </svg>
    </div>
  );
});
