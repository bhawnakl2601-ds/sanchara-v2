import * as THREE from 'three';
import { isReducedMotion } from '../a11y/store';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TransitionManager, HUB_CAM, TRAIN_HALF, MIN_SAFE_DIST, type Pose } from '../app/transition';
import { loadTrain, type TrainRig, TRAIN_LENGTH, HALF_GAUGE, MODEL_SCALE } from './trainModel';

export type SceneMode = 'hub' | 'transition' | 'hold' | 'off';
export interface FrameUi { flash: number; canvasOpacity: number }
const C = { green: 0x01290f, mid: 0x035024, beige: 0xe9dfc9, light: 0xf6f1e4, purple: 0xa855f7, violet: 0x9333ea };
const TUBE_R = 10, TUBE_Y = 3.2, RING_N = 24, RING_GAP = 12, TRACK_LEN = 330;
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches; const PARTICLES = COARSE ? 420 : 900;   // lighter on touch devices
const TAU = Math.PI * 2;

export class TrainScene {
  readonly renderer: THREE.WebGLRenderer; readonly scene = new THREE.Scene(); readonly camera: THREE.PerspectiveCamera;
  private pivot = new THREE.Group(); private turntable = new THREE.Group(); private rig: TrainRig | null = null;
  private floor!: THREE.Group; private rings: THREE.Mesh[] = []; private tube!: THREE.Mesh; private trails!: THREE.LineSegments;
  private track!: THREE.Group; private trackMats: THREE.MeshStandardMaterial[] = []; private nodes!: THREE.Points; private particles!: THREE.Points; private ppos!: Float32Array; private glow!: THREE.PointLight; private rim!: THREE.DirectionalLight;
  private raf = 0; private last = 0; private mode: SceneMode = 'off'; private disposed = false; private time = 0;
  private rotY = 0.6; private rotFrom = 0; private lastKind = ''; private pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private anchor = { dx: 0, dy: 0, fit: 1 }; private reduced = false; private lastFov = -1; private w = 1; private h = 1; private ringTint = new THREE.Color(C.purple);
  private ro: ResizeObserver; private cleanup: (() => void)[] = [];
  onFrameUi: (u: FrameUi) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, readonly tm: TransitionManager) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(HUB_CAM.fov, 1, 1.2, 600);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; tm.reduced = this.reduced;
    if (Math.abs(TRAIN_LENGTH / 2 - TRAIN_HALF) > 0.3) console.warn('[SANCHARA] TRAIN_HALF (' + TRAIN_HALF + ') differs from the model (' + TRAIN_LENGTH / 2 + '); update transition.ts so the camera clip guard stays correct');
    this.buildEnvironment(); this.buildTrack(); this.buildTunnel(); this.buildParticles(); this.buildLights();
    this.scene.add(this.pivot, this.turntable);
    this.pivot.visible = false; this.turntable.visible = false; // nothing is drawn until the supplied train model is ready (no placeholder flash)
    loadTrain('purple').then(r => { if (this.disposed) return; this.setTrain(r); this.pivot.visible = true; this.turntable.visible = true; this.kick(); });
    const mv = (e: PointerEvent) => { this.pointer.x = (e.clientX / innerWidth) * 2 - 1; this.pointer.y = (e.clientY / innerHeight) * 2 - 1; };
    addEventListener('pointermove', mv); this.cleanup.push(() => removeEventListener('pointermove', mv));
    const onVis = () => { if (document.hidden) cancelAnimationFrame(this.raf); else this.kick(); };
    document.addEventListener('visibilitychange', onVis); this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas.parentElement ?? canvas); this.resize();
  }

  private setTrain(r: TrainRig) {
    if (this.rig) { this.pivot.remove(this.rig.root); this.disposeObject(this.rig.root); }
    this.rig = r; this.pivot.add(r.root);
    r.root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }

  private buildEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.5; pm.dispose();
    this.scene.fog = new THREE.FogExp2(C.green, 0.0075);
    this.floor = new THREE.Group();
    // The illustrated Bengaluru is drawn behind the canvas, so the ground no longer paints an opaque mirror + dark veil over it: only the soft contact shadow remains.
    const catcher = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.ShadowMaterial({ opacity: 0.5 })); catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0; catcher.receiveShadow = true; this.floor.add(catcher);
    this.scene.add(this.floor);
  }

  private buildTrack() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bfb9, metalness: 1, roughness: 0.25 });
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x173d32, roughness: 0.8 });
    // long running track toward the tunnel (-Z)
    const track = new THREE.Group();
    const G = HALF_GAUGE, S = MODEL_SCALE, RH = 0.13 * S;
    for (const x of [-G, G]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.1 * S, RH, TRACK_LEN), railMat); r.position.set(x, RH / 2, -TRACK_LEN / 2 - 6); track.add(r); }
    const n = Math.floor(TRACK_LEN / (1.1 * S)); const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4 * S, 0.08 * S, 0.3 * S), tieMat, n); const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m.makeTranslation(0, 0.03 * S, -6 - i * 1.1 * S); ties.setMatrixAt(i, m); } ties.receiveShadow = true; track.add(ties);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3.4 * S, 0.03, TRACK_LEN), new THREE.MeshStandardMaterial({ color: 0x02381a, roughness: 0.9 })); bed.position.set(0, 0.0, -TRACK_LEN / 2 - 6); track.add(bed);
    this.track = track; this.trackMats = [railMat, tieMat, bed.material as THREE.MeshStandardMaterial]; for (const tm of this.trackMats) { tm.transparent = true; tm.opacity = 0; } track.visible = false;
    this.scene.add(track);
    const TT = TRAIN_LENGTH / 2 + 1.6; // turntable radius
    // turntable: the train sits on it and rotates with it, so it is always physically on rails
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(TT, TT + 0.4, 0.18, 96), new THREE.MeshBasicMaterial({ color: 0x02381a })); disk.position.y = -0.02; this.turntable.add(disk);
    const diskShadow = new THREE.Mesh(new THREE.CircleGeometry(TT, 64), new THREE.ShadowMaterial({ opacity: 0.5 })); diskShadow.rotation.x = -Math.PI / 2; diskShadow.position.y = 0.075; diskShadow.receiveShadow = true; this.turntable.add(diskShadow);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(TT + 0.2, 0.06, 8, 128), new THREE.MeshBasicMaterial({ color: C.purple })); edge.rotation.x = Math.PI / 2; edge.position.y = 0.08; this.turntable.add(edge);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(TT - 0.8, 0.025, 6, 128), new THREE.MeshBasicMaterial({ color: C.beige, transparent: true, opacity: 0.5 })); inner.rotation.x = Math.PI / 2; inner.position.y = 0.08; this.turntable.add(inner);
    for (const x of [-G, G]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.1 * S, RH, TT * 2), railMat); r.position.set(x, 0.07 + RH / 2, 0); this.turntable.add(r); }
    const nt = Math.floor((TT * 2) / (1.1 * S)); for (let i = 0; i < nt; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(2.4 * S, 0.08 * S, 0.3 * S), tieMat); t.position.set(0, 0.07 + 0.04 * S, -TT + i * 1.1 * S); this.turntable.add(t); }
    for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; const tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, i % 4 === 0 ? 0.7 : 0.3), new THREE.MeshBasicMaterial({ color: C.beige, transparent: true, opacity: 0.45 })); tick.position.set(Math.sin(a) * (TT - 1.2), 0.08, Math.cos(a) * (TT - 1.2)); tick.rotation.y = a; this.turntable.add(tick); }
  }

  private buildTunnel() {
    this.tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R + 0.6, TUBE_R + 0.6, 340, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x011a0a, side: THREE.BackSide, transparent: true, opacity: 0, fog: false }));
    this.tube.rotation.x = Math.PI / 2; this.tube.position.set(0, TUBE_Y, -170); this.tube.visible = false; this.scene.add(this.tube);
    const ringGeo = new THREE.TorusGeometry(TUBE_R, 0.07, 8, 72);
    for (let i = 0; i < RING_N; i++) { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i % 3 === 2 ? C.beige : C.purple, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set(0, TUBE_Y, -8 - i * RING_GAP); m.visible = false; this.rings.push(m); this.scene.add(m); }
    const pts: number[] = []; for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; const x = Math.cos(a) * (TUBE_R - 0.8), y = TUBE_Y + Math.sin(a) * (TUBE_R - 0.8); pts.push(x, y, -4, x, y, -330); }
    this.trails = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: C.purple, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trails.visible = false; this.scene.add(this.trails);
    // station-node lights along the track (visible in the Map journey): one soft node per ring, like stops on a line
    const np: number[] = []; for (let i = 0; i < RING_N; i++) np.push(0, 0.35, -8 - i * RING_GAP);
    this.nodes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(np, 3)), new THREE.PointsMaterial({ color: C.beige, size: 0.9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.nodes.frustumCulled = false; this.nodes.visible = false; this.scene.add(this.nodes);
  }

  private buildParticles() {
    const g = new THREE.BufferGeometry(); this.ppos = new Float32Array(PARTICLES * 3); const col = new Float32Array(PARTICLES * 3); const a = new THREE.Color(C.beige), b = new THREE.Color(C.purple);
    for (let i = 0; i < PARTICLES; i++) { this.respawn(i, true); (Math.random() < 0.35 ? b : a).toArray(col, i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(this.ppos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.particles.frustumCulled = false; this.scene.add(this.particles);
  }
  private respawn(i: number, init = false, camZ = 0) {
    const r = Math.sqrt(Math.random()) * (TUBE_R - 1) * 1.3, a = Math.random() * TAU;
    this.ppos[i * 3] = Math.cos(a) * r; this.ppos[i * 3 + 1] = Math.max(0.1, TUBE_Y + Math.sin(a) * r * 0.8); this.ppos[i * 3 + 2] = init ? camZ + 8 - Math.random() * 150 : camZ - 140 - Math.random() * 10;
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(C.light, C.green, 0.6));
    const key = new THREE.DirectionalLight(C.light, 2.2); key.position.set(-14, 26, 16); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 }); key.shadow.normalBias = 0.04; key.shadow.camera.updateProjectionMatrix(); this.scene.add(key);
    this.rim = new THREE.DirectionalLight(C.purple, 0.9); this.rim.position.set(9, 5, -10); this.scene.add(this.rim);
    const rim2 = new THREE.DirectionalLight(C.purple, 0.35); rim2.position.set(-10, 3, -8); this.scene.add(rim2);
    this.glow = new THREE.PointLight(C.purple, 6, 40, 1.6); this.glow.position.set(0, 3, 0); this.scene.add(this.glow);
  }

  /** Anchor: where the central slot sits on screen, so the train is centred in its column at every breakpoint. */
  setAnchor(slot: DOMRect) {
    this.anchorSlot = slot; this.applyAnchor();
  }
  private anchorSlot: DOMRect | null = null;
  private applyAnchor() {
    const s = this.anchorSlot; if (!s || !this.w) return;
    this.anchor.dx = s.left + s.width / 2 - this.w / 2; this.anchor.dy = s.top + s.height / 2 - this.h / 2;
    // fit: the train's turning circle (radius = length/2 + margin) must stay inside the slot
    const R = TRAIN_LENGTH / 2 + 0.2, target = Math.min(s.width * 1.02, s.height * 1.25) * 0.96;
    const D = (R * this.h) / (Math.max(target, 120) * Math.tan((HUB_CAM.fov * Math.PI) / 360));
    this.anchor.fit = Math.min(12, Math.max(0.55, D / HUB_CAM.dist));
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight); this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE || w < 700 ? 1.5 : 2)); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.lastFov = -1; this.applyAnchor(); this.kick();
  }

  setMode(m: SceneMode) { this.mode = m; if (m === 'off') { cancelAnimationFrame(this.raf); this.raf = 0; } else this.kick(); }
  kick() { if (this.disposed || this.raf || this.mode === 'off' || document.hidden) return; this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }

  private frame = (now: number) => {
    this.raf = 0; if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.time += dt;
    this.tm.update(dt * 1000);
    const pose = this.tm.pose();
    this.apply(pose, dt);
    this.renderer.render(this.scene, this.camera);
    if (this.mode !== 'off') this.raf = requestAnimationFrame(this.frame);
  };

  private apply(p: Pose, dt: number) {
    const tm = this.tm;
    this.reduced = isReducedMotion(); tm.reduced = this.reduced; // honours the in-app Accessibility switch as well as the OS setting
    // --- train heading ---
    if (tm.kind !== this.lastKind) { this.rotFrom = this.rotY; this.lastKind = tm.kind; }
    if (p.facing === 'idle') { this.rotY += dt * (this.reduced ? 0.04 : 0.16); }
    else if (p.facing === 'turn') {
      // front to camera first (nearest heading that faces +Z), then the turntable swings the train round by 180 degrees onto the tunnel track
      const toCam = Math.round((this.rotFrom - Math.PI) / TAU) * TAU + Math.PI;
      this.rotY = this.rotFrom + (toCam - this.rotFrom) * p.rotMix + Math.PI * p.turn;
    } else {
      const target = p.facing === 'forward' ? Math.round(this.rotFrom / TAU) * TAU : Math.round((this.rotFrom - Math.PI) / TAU) * TAU + Math.PI;
      this.rotY = this.rotFrom + (target - this.rotFrom) * p.rotMix;
    }
    if (tm.kind === 'hub') this.rotFrom = this.rotY;
    this.pointer.sx += (this.pointer.x - this.pointer.sx) * 0.05; this.pointer.sy += (this.pointer.y - this.pointer.sy) * 0.05;
    const idleW = p.facing === 'idle' ? 1 : 0; const hover = this.reduced ? 0 : Math.sin(this.time * 0.9) * 0.05 * idleW;
    this.pivot.position.set(0, hover, p.trainZ); this.pivot.rotation.set(this.pointer.sy * 0.02 * idleW, this.rotY + this.pointer.sx * 0.12 * idleW, this.pointer.sx * -0.01 * idleW);
    this.turntable.rotation.y = this.rotY; this.turntable.visible = p.tunnel < 0.9 && p.trainZ > -40;
    this.floor.visible = p.tunnel < 0.5 && p.trainZ > -30;
    // --- lights ---
    if (this.rig) { for (const l of this.rig.lamps) l.intensity = p.headlight * 90 * Math.min(1, Math.max(0, (p.headlight - 0.55) / 1.1)); /* headlamp pools stay off at the hub (they lit the whole tunnel track into a bright spike) and come up as the train is selected */ for (const h of this.rig.headlights) { const m = h.material as THREE.MeshStandardMaterial; m.emissiveIntensity = 0.4 + p.headlight * 2.2; } }
    this.glow.position.set(0, 6, p.trainZ + 2); this.glow.intensity = 6 + 70 * p.tunnel * (0.85 + 0.15 * Math.sin(this.time * 6)) + 60 * p.flash;
    this.rim.intensity = 0.9 + 0.4 * p.headlight;
    // --- tunnel ---
    const show = p.tunnel > 0.001 || p.rings > 0.001; this.tube.visible = this.rings[0].visible = show; this.trails.visible = show;
    (this.tube.material as THREE.MeshBasicMaterial).opacity = 0.75 * p.tunnel;
    const pulse = tm.kind === 'hold' ? 0.75 + 0.25 * Math.sin(this.time * 1.6) : 1;
    const alerts = tm.variant === 'alerts' && !this.reduced, mapV = tm.variant === 'map';
    this.rings.forEach((r, i) => { r.visible = show; const m = r.material as THREE.MeshBasicMaterial; const near = Math.abs(r.position.z - p.trainZ); const lit = Math.max(0.25, 1 - near / 120);
      const wave = alerts ? 0.5 + 0.5 * Math.sin(this.time * 2.4 - i * 0.7) : 1;     // restrained pulse travelling down the tunnel
      m.opacity = Math.min(1, p.rings * lit * pulse * wave * (mapV && i % 2 ? 0.55 : 1)); });
    const nm = this.nodes.material as THREE.PointsMaterial; this.nodes.visible = mapV && show; nm.opacity = 0.9 * p.rings * (0.7 + 0.3 * Math.sin(this.time * 2));
    (this.trails.material as THREE.LineBasicMaterial).opacity = 0.55 * p.rings * pulse;
    (this.scene.fog as THREE.FogExp2).density = 0.0075 * (1 - 0.6 * p.tunnel);
    // --- camera ---
    // anchorMix blends from the pose's ABSOLUTE camera to the hub framing (train fitted to its slot). Distance blends geometrically so the dolly feels even.
    const hb = p.anchorMix, fit = this.anchor.fit; const px = this.pointer.sx * 0.6 * idleW, py = this.pointer.sy * 0.25 * idleW;
    const hubDist = HUB_CAM.dist * fit, dist = Math.exp(THREE.MathUtils.lerp(Math.log(Math.max(1, p.camDist)), Math.log(hubDist), hb));
    this.camera.position.set(p.camX * (1 - hb) + (p.camX + px) * hb * fit, THREE.MathUtils.lerp(p.camY, HUB_CAM.y * fit, hb) - py, p.trainZ + dist);
    // never clip into the model: outside the turntable swing circle whenever the train is near the camera's x/z neighbourhood
    if (hb < 0.5 && p.trainZ > -40 && dist < MIN_SAFE_DIST) this.camera.position.z = p.trainZ + MIN_SAFE_DIST;
    this.camera.lookAt(0, 1.6, p.trainZ - p.lookAhead);
    if (Math.abs(p.fov - this.lastFov) > 0.01) { this.camera.fov = p.fov; this.lastFov = p.fov; this.camera.updateProjectionMatrix(); }
    const m = p.anchorMix; this.camera.setViewOffset(this.w, this.h, -this.anchor.dx * m, -this.anchor.dy * m, this.w, this.h);
    // --- particles: stream past the camera at pose speed ---
    const sp = (this.reduced ? 0.2 : 1) * p.particleSpeed; const camZ = this.camera.position.z;
    for (let i = 0; i < PARTICLES; i++) {
      const k = i * 3; this.ppos[k + 2] += dt * sp * (1.2 + (i % 7) * 0.25);
      if (this.ppos[k + 2] > camZ + 12 || this.ppos[k + 2] < camZ - 160) this.respawn(i, false, camZ);
      if (sp < 2) this.ppos[k + 1] += Math.sin(this.time + i) * dt * 0.02;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    /* the long tunnel track only exists once the journey starts; at the hub it would read as a bright spike running off to the horizon */
    const ta = Math.min(1, p.tunnel * 2.5); this.track.visible = ta > 0.01; for (const tm of this.trackMats) tm.opacity = ta;
    const pm = this.particles.material as THREE.PointsMaterial; pm.size = 0.06 + 0.05 * Math.min(1, sp / 30);
    // at the hub the particle tube would converge into a dense glowing cone behind the train, so it is only a faint dust there and builds up as the journey starts
    pm.opacity = 0.05 + 0.65 * Math.max(p.tunnel, Math.min(1, Math.max(0, sp - 1.5) / 6));
    this.onFrameUi({ flash: this.reduced ? 0 : p.flash, canvasOpacity: p.canvasOpacity });
  }

  private disposeObject(o: THREE.Object3D) {
    o.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh || (n as THREE.Points).isPoints || (n as THREE.LineSegments).isLineSegments) {
      (m.geometry as THREE.BufferGeometry | undefined)?.dispose(); const mat = m.material as THREE.Material | THREE.Material[]; (Array.isArray(mat) ? mat : [mat]).forEach(x => { if (!x) return; Object.values(x).forEach(v => { if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose(); }); x.dispose(); }); } });
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); this.cleanup.forEach(f => f());
    this.disposeObject(this.scene); this.scene.environment?.dispose(); this.renderer.dispose();
  }
}
