import assert from 'node:assert/strict';
import { poseFor, TransitionManager, HUB_CAM, HOLD_Z, TRAIN_HALF, MIN_SAFE_DIST, CLOSE_DIST, type Kind, type Variant } from '../src/app/transition';
const near = (a: number, b: number, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} vs ${b}`);
// continuity at the seams: hub -> forward start, return end -> hub
const h = poseFor('hub', 0), f0 = poseFor('forward', 0), r1 = poseFor('return', 1);
for (const k of ['trainZ', 'camX', 'camY', 'camDist', 'fov', 'headlight', 'anchorMix'] as const) { near(h[k], f0[k]); near(h[k], r1[k], 1e-6); }
for (const v of ['planner', 'map', 'alerts'] as Variant[]) { const a = poseFor('forward', 0, v); near(a.camDist, h.camDist); near(a.anchorMix, 1); }
const f1 = poseFor('forward', 1); assert(f1.trainZ < -150 && f1.canvasOpacity === 0 && f1.flash < 0.01);
assert(poseFor('forward', 0.82).flash > 0.5 && poseFor('forward', 0.82).flash <= 0.55); // soft bloom around the content swap, never a strobe
// monotone forward motion; train never moves backwards while advancing
let z = 0; for (let i = 0; i <= 100; i++) { const p = poseFor('forward', i / 100); assert(p.trainZ <= z + 1e-9); z = p.trainZ; }
near(poseFor('soon', 1).trainZ, HOLD_Z); near(poseFor('hold', 0).trainZ, HOLD_Z); near(poseFor('return', 0, 'planner', HOLD_Z).trainZ, HOLD_Z);
// manager: single transition at a time, swap once, done once, kind rollover
const m = new TransitionManager(); let swaps = 0, done = 0;
assert(m.start('forward', 'planner', { onSwap: () => swaps++, onDone: () => done++ })); assert(!m.start('forward', 'map', {}));
for (let i = 0; i < 400; i++) m.update(16);
assert.equal(swaps, 1); assert.equal(done, 1); assert(!m.active); assert(m.start('soon', 'soon', { onDone: () => done++ })); for (let i = 0; i < 400; i++) m.update(16); assert.equal(m.kind, 'hold');
assert(m.start('return', 'planner', { onDone: () => done++ }, HOLD_Z)); for (let i = 0; i < 400; i++) m.update(16); assert.equal(m.kind, 'hub'); assert.equal(done, 3);
console.log('✓ transition math + manager (continuity, flash timing, monotone motion, double-trigger guard, kind rollover)');

// ---- cinematic guarantees, every journey, every frame --------------------------------------------------------------------------------
const journeys: [Kind, Variant, number][] = [['forward', 'planner', -150], ['forward', 'map', -150], ['forward', 'alerts', -150], ['soon', 'soon', -150], ['return', 'planner', -150], ['return', 'planner', HOLD_Z]];
for (const [kind, v, z0] of journeys) {
  let prevZ = poseFor(kind, 0, v, z0).trainZ, prev = poseFor(kind, 0, v, z0);
  for (let i = 0; i <= 600; i++) {
    const p = poseFor(kind, i / 600, v, z0);
    // 1. camera never inside the train's swing circle while framing is absolute (hb<0.5) and the train is in the hub area
    if (p.anchorMix < 0.5 && p.trainZ > -40) assert(p.camDist >= MIN_SAFE_DIST - 1e-9, `${kind}/${v} camDist ${p.camDist} < safe at p=${i / 600}`);
    // 2. no teleporting: per-frame (1/600 of the journey) change is small for every continuous channel
    assert(Math.abs(p.camDist - prev.camDist) < 4 && Math.abs(p.camY - prev.camY) < 2 && Math.abs(p.fov - prev.fov) < 3 && Math.abs(p.camX - prev.camX) < 1.2, `${kind}/${v} jump at p=${i / 600}`);
    assert(Math.abs(p.trainZ - prevZ) < 6, `${kind}/${v} train jump at p=${i / 600}`);
    assert(Math.abs(p.anchorMix - prev.anchorMix) < 0.08 && Math.abs(p.rotMix - prev.rotMix) < 0.08 && Math.abs(p.turn - prev.turn) < 0.08);
    // 3. flashes are soft: no strobe
    assert(p.flash <= 0.56 && Math.abs(p.flash - prev.flash) < 0.08, `${kind}/${v} flash`);
    // 4. the train is never hidden by the canvas except at the page-reveal end of a forward journey
    if (kind !== 'forward' && kind !== 'soon' && i > 84) assert(p.canvasOpacity > 0.99);
    prev = p; prevZ = p.trainZ;
  }
}
assert(CLOSE_DIST > TRAIN_HALF + 4, 'close-up must leave a gap in front of the windshield');
// the zoom-in really is a dolly: hub-to-close distance ratio is big and monotone while the lens narrows (not a CSS scale)
const mid = poseFor('forward', 0.3, 'planner'); assert(mid.fov < HUB_CAM.fov && mid.camDist === CLOSE_DIST && mid.anchorMix < 0.25 && mid.trainZ === 0);
// turntable: the train only starts to travel after it has turned onto the tunnel track
for (let i = 0; i <= 100; i++) { const p = poseFor('forward', i / 100); if (p.trainZ < -1e-6) assert(p.turn > 0.99, 'train moved before finishing its turn'); }
// zoom-out: camera distance and fov widen during departure, and the train is smaller on screen at the end than at the close-up
const d0 = poseFor('forward', 0.58), d1 = poseFor('forward', 0.97); assert(d1.camDist > d0.camDist + 15 && d1.fov > d0.fov + 10);
// tunnel is visible before the page is revealed; canvas is not removed before the reveal begins
assert(poseFor('forward', 0.82).tunnel > 0.99 && poseFor('forward', 0.82).canvasOpacity > 0.9);
// reduced motion: a short fade only, no camera or train movement
for (const k of ['forward', 'soon', 'return'] as Kind[]) for (let i = 0; i <= 10; i++) { const p = poseFor(k, i / 10, 'planner', -150, true); assert(p.trainZ === 0 && p.camDist === HUB_CAM.dist && p.anchorMix === 1 && p.rings === 0); }
const rm = new TransitionManager(); rm.reduced = true; rm.start('forward', 'planner', {}); let n = 0; while (rm.active && n < 100) { rm.update(16); n++; } assert(n <= 30, 'reduced-motion transition must be short');
console.log('✓ cinematic guarantees (no clipping, no jumps, soft flashes, turn-before-travel, zoom-in dolly, zoom-out, reduced motion)');
