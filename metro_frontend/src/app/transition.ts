export type Dest = 'planner' | 'map' | 'alerts' | 'guide' | 'assist';
export type AppView =
  | 'home' | 'transitioning-to-planner' | 'planner' | 'transitioning-to-map' | 'map'
  | 'transitioning-to-alerts' | 'alerts' | 'transitioning-to-guide' | 'guide' | 'transitioning-to-assist' | 'assist'
  | 'transitioning-to-coming-soon-4' | 'coming-soon-4' | 'returning-home';
export const viewFor = (d: Dest, settled: boolean): AppView => ({
  planner: settled ? 'planner' : 'transitioning-to-planner', map: settled ? 'map' : 'transitioning-to-map',
  alerts: settled ? 'alerts' : 'transitioning-to-alerts', guide: settled ? 'guide' : 'transitioning-to-guide', assist: settled ? 'assist' : 'transitioning-to-assist',
} as const)[d] as AppView;
export const isBusy = (v: AppView) => v.startsWith('transitioning') || v === 'returning-home';

export type Kind = 'hub' | 'forward' | 'soon' | 'return' | 'warp' | 'hold';
export type Variant = 'planner' | 'map' | 'alerts' | 'soon';
export interface Pose {
  trainZ: number; facing: 'idle' | 'forward' | 'back' | 'turn'; rotMix: number; turn: number; headlight: number; rings: number; tunnel: number;
  particleSpeed: number; fov: number; camX: number; camY: number; camDist: number; lookAhead: number;
  flash: number; canvasOpacity: number; anchorMix: number; trackScroll: number;
}
/** Hub camera used as the "anchor" shot. While anchorMix=1 the scene frames the train inside its hub slot and the absolute camera numbers below are ignored. */
export const HUB_CAM = { y: 3.2, dist: 13, fov: 38 };
export const HOLD_Z = -120;
/** Half the train length in scene units (one 23 m coach x 0.7, / 2). TrainScene warns in dev if trainModel disagrees. */
export const TRAIN_HALF = 8.05;
/** Closest the camera ever gets to the train centre: front windshield close-up. Must stay > TRAIN_HALF + margin so it can never clip into the model, even while the turntable swings the ends round. */
export const CLOSE_DIST = 14;
export const MIN_SAFE_DIST = TRAIN_HALF + 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t: number, k = 3) => 1 - Math.pow(1 - clamp01(t), k);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const DURATION: Record<Exclude<Kind, 'hub' | 'hold'>, number> = { forward: 2400, soon: 2100, return: 1900, warp: 600 };
export const SWAP_AT: Record<Exclude<Kind, 'hub' | 'hold'>, number> = { forward: 0.82, soon: 0.78, return: 0.74, warp: 0.5 };
export const REDUCED_MS = 420;

const base: Pose = { trainZ: 0, facing: 'idle', rotMix: 0, turn: 0, headlight: 0.55, rings: 0, tunnel: 0, particleSpeed: 1, fov: HUB_CAM.fov, camX: 0, camY: HUB_CAM.y, camDist: HUB_CAM.dist, lookAhead: 0, flash: 0, canvasOpacity: 1, anchorMix: 1, trackScroll: 0 };

/** Departure, shared by every destination so the four journeys speak one visual language:
 *   1 select      front of the train turns to the camera, headlights intensify
 *   2 zoom-in     real dolly + longer lens from the hub shot to a windshield close-up (never closer than CLOSE_DIST)
 *   3 align       the turntable swings the train round onto the tunnel track while the camera drifts out and up
 *   4 depart      the train accelerates down the track; chase camera lags behind it
 *   5 zoom-out    camera pulls away, lens widens, tunnel rings give depth, tunnel light brightens
 *   6 reveal      page fades in over the tunnel; canvas fades last
 * Destination flavour: map = higher, three-quarter-from-above camera; alerts = same shot, pulsed rings (scene); soon = train stops far down the tunnel. */
function departure(p: number, v: Variant): Pose {
  const map = v === 'map', stop = v === 'soon';
  const zoom = smooth(0.03, 0.34, p), tn = smooth(0.36, 0.56, p), go = clamp01((p - 0.56) / 0.44), out = smooth(0.58, 0.97, p);
  const total = map ? 250 : 220; const side = map ? -1 : 1;
  const trainZ = stop ? HOLD_Z * easeOut(go, 2.4) : -total * Math.pow(go, 2.2);
  const open = smooth(0, 0.03, p);              // keeps t=0 identical to the hub pose
  return {
    ...base, trainZ, facing: 'turn', rotMix: smooth(0.02, 0.24, p), turn: tn,
    headlight: lerp(0.55, 1.9, smooth(0, 0.2, p)),
    rings: smooth(0.40, 0.62, p), tunnel: smooth(0.40, 0.66, p),
    particleSpeed: 1 + 6 * smooth(0.1, 0.5, p) + (stop ? 24 : 40) * smooth(0.56, 0.9, p) * (stop ? 1 - smooth(0.9, 1, p) : 1),
    fov: lerp(HUB_CAM.fov, 30, smooth(0.03, 0.30, p)) + 4 * tn + (stop ? 8 : 18) * out,
    camX: side * 3.2 * (1 - tn) * zoom + side * (map ? 3 : 0) * smooth(0.6, 0.95, p),
    camY: lerp(HUB_CAM.y, map ? 5.2 : 2.4, open) + (map ? 1.3 : 1.8) * tn + (map ? 4.5 : 2.8) * out,
    camDist: lerp(HUB_CAM.dist, CLOSE_DIST, open) + 9 * tn + (stop ? 6 : 18) * out,
    lookAhead: -8 * (1 - tn) * zoom + 4 * smooth(0.6, 0.9, p),
    flash: 0.55 * smooth(0.72, 0.82, p) * (1 - smooth(0.82, 0.95, p)),     // a soft bloom, never a strobe
    canvasOpacity: 1 - smooth(0.9, 1, p), anchorMix: 1 - zoom,
  };
}

/** Pure function: the whole cinematic is a deterministic function of (kind, progress). reduced = short, still crossfade instead of the journey. */
export function poseFor(kind: Kind, p: number, variant: Variant = 'planner', startZ = -150, reduced = false): Pose {
  p = clamp01(p);
  if (reduced) {
    if (kind === 'hub') return { ...base };
    if (kind === 'forward' || kind === 'warp') return { ...base, headlight: 0.9, canvasOpacity: 1 - smooth(0.4, 1, p) };
    if (kind === 'soon' || kind === 'hold') return { ...base, headlight: 0.9 };
    return { ...base, canvasOpacity: smooth(0, 0.7, p) };
  }
  switch (kind) {
    case 'hub': return { ...base };
    case 'forward': return departure(p, variant === 'soon' ? 'planner' : variant);
    case 'soon': return departure(p, 'soon');
    case 'hold': return { ...departure(1, 'soon'), flash: 0, canvasOpacity: 1, facing: 'forward', rotMix: 1, turn: 0 };
    case 'return': {
      // Reverse journey in one continuous shot: the camera waits in the tunnel, the train emerges and approaches, the camera pushes in to the
      // windshield, then pulls back and out to the hub framing as the train decelerates and settles on its turntable.
      const e = easeOut(smooth(0.06, 0.86, p), 3.2); const hb = smooth(0.60, 1, p); const end = smooth(0.985, 1, p);
      return {
        ...base, trainZ: startZ * (1 - e), facing: 'back', rotMix: 1, turn: 0, headlight: lerp(1.9, 0.55, smooth(0.6, 1, p)),
        rings: 1 - smooth(0.72, 0.98, p), tunnel: 1 - smooth(0.72, 0.98, p), particleSpeed: 1 + 40 * (1 - smooth(0.05, 0.85, p)),
        fov: lerp(50, 31, smooth(0.15, 0.55, p)) * (1 - hb) + HUB_CAM.fov * hb,
        camX: lerp(-2, 3, smooth(0.2, 0.55, p)) * (1 - smooth(0.62, 0.95, p)), camY: lerp(7, 2.6, smooth(0.15, 0.55, p)) * (1 - end) + HUB_CAM.y * end,
        camDist: lerp(34, CLOSE_DIST, smooth(0.1, 0.58, p)) * (1 - end) + HUB_CAM.dist * end, lookAhead: -8 * smooth(0.3, 0.6, p) * (1 - hb),
        flash: 0.3 * smooth(0, 0.06, p) * (1 - smooth(0.06, 0.2, p)), canvasOpacity: smooth(0, 0.14, p), anchorMix: hb,
      };
    }
    case 'warp': return {
      ...base, trainZ: -60 - 90 * p, facing: 'forward', rotMix: 1, headlight: 1.6, rings: 1, tunnel: 1, particleSpeed: 45, fov: 50, camX: 3, camY: 6, camDist: 32,
      lookAhead: 4, flash: 0.4 * smooth(0.38, 0.5, p) * (1 - smooth(0.5, 0.7, p)), canvasOpacity: smooth(0, 0.22, p) * (1 - smooth(0.8, 1, p)), anchorMix: 0,
    };
  }
}

export interface TransitionHooks { onSwap?: () => void; onDone?: () => void }
/** Shared transition manager: owns kind, progress, direction and completion callbacks. Driven by the scene's single render loop. */
export class TransitionManager {
  kind: Kind = 'hub'; variant: Variant = 'planner'; progress = 0; startZ = -150;
  private dur = 1; private swapAt = 1; private swapped = false; private hooks: TransitionHooks = {}; private running = false;
  reduced = false;
  get active() { return this.running; }
  start(kind: Exclude<Kind, 'hub' | 'hold'>, variant: Variant, hooks: TransitionHooks, startZ?: number) {
    if (this.running) return false; // guards double triggers
    this.kind = kind; this.variant = variant; this.progress = 0; this.swapped = false; this.hooks = hooks; this.running = true;
    this.dur = this.reduced ? REDUCED_MS : DURATION[kind]; this.swapAt = SWAP_AT[kind]; if (startZ !== undefined) this.startZ = startZ; return true;
  }
  update(dtMs: number) {
    if (!this.running) return;
    this.progress = Math.min(1, this.progress + dtMs / this.dur);
    if (!this.swapped && this.progress >= this.swapAt) { this.swapped = true; this.hooks.onSwap?.(); }
    if (this.progress >= 1) { this.running = false; const d = this.hooks.onDone; this.hooks = {}; if (this.kind === 'soon') this.kind = 'hold'; else if (this.kind === 'return') this.kind = 'hub'; d?.(); }
  }
  pose(): Pose { return poseFor(this.kind, this.progress, this.variant, this.startZ, this.reduced); }
  setKind(k: Kind) { if (!this.running) { this.kind = k; this.progress = 1; } }
}
