import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Supplied per-line train models (public/models/metro_<line>.glb). The hub shows the purple-line train. */
export type TrainLine = 'purple' | 'green' | 'yellow' | 'blue' | 'pink';
export const trainUrl = (line: TrainLine) => `${import.meta.env.BASE_URL}models/metro_${line}.glb`;
/** The supplied models have their cab face on +Z; the scene's travel direction is -Z, so they are turned 180°. */
export const GLB_FLIP = true; // (kept for reference; the 2-car set has a cab at both ends so heading is symmetric)
/** 1 model unit = 1 m. The set is drawn at 0.7× so it fits the stage; rails/gauge are derived from the same scale. */
export const MODEL_SCALE = 0.7;
export const CAR_LEN = 23, CAR_GAP = 0.3;
export const HALF_GAUGE = 0.72 * MODEL_SCALE, RAIL_TOP = 0.13 * MODEL_SCALE;
/** The hub train is ONE coach (the supplied GLB is a single car; it is no longer duplicated/coupled). */
export const COACHES = 1;
export const TRAIN_LENGTH = COACHES * CAR_LEN * MODEL_SCALE;
export const RAIL_Y = 0.32; // wheel centre height above rail head

export interface TrainRig { root: THREE.Group; headlights: THREE.Mesh[]; lamps: THREE.SpotLight[]; source: 'glb' | 'procedural' }

const C = { body: 0xe9dfc9, green: 0x027032, deep: 0x01290f, purple: 0xa855f7, light: 0xf4efe6 };

function proceduralCar(front: boolean, rear: boolean, mats: Record<string, THREE.Material>, headlights: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group(); const L = 5.8, W = 2.3, H = 2.4;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, L, 6, 0.28), mats.body); body.position.y = RAIL_Y + 0.55 + H / 2; body.castShadow = true; g.add(body);
  const skirt = new THREE.Mesh(new RoundedBoxGeometry(W + 0.03, 0.6, L + 0.02, 3, 0.1), mats.green); skirt.position.y = RAIL_Y + 0.55 + 0.3; g.add(skirt);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, 0.07, L - 0.1), mats.purple); stripe.position.y = RAIL_Y + 0.55 + 0.68; g.add(stripe);
  const win = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.78, L - 0.9), mats.glass); win.position.y = RAIL_Y + 0.55 + 1.55; g.add(win);
  for (let i = -2; i <= 2; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 1.5, 0.05), mats.body); d.position.set(0, RAIL_Y + 0.55 + 1.25, i * 1.1); g.add(d); }
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W * 0.7, 0.25, L * 0.6, 3, 0.1), mats.green); roof.position.y = RAIL_Y + 0.55 + H + 0.1; g.add(roof);
  for (const z of [-L / 2 + 1.1, L / 2 - 1.1]) { // bogies
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 1.8), mats.dark); b.position.set(0, RAIL_Y + 0.15, z); g.add(b);
    for (const sx of [-0.72, 0.72]) for (const dz of [-0.55, 0.55]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 20), mats.steel); w.rotation.z = Math.PI / 2; w.position.set(sx, RAIL_Y, z + dz); g.add(w); }
  }
  if (front) { // cab face on the -Z end
    const ws = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.95, 0.06), mats.glass); ws.position.set(0, RAIL_Y + 0.55 + 1.65, -L / 2 - 0.01); g.add(ws);
    const band = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.08, 0.07), mats.purple); band.position.set(0, RAIL_Y + 0.55 + 0.95, -L / 2 - 0.02); g.add(band);
    for (const sx of [-0.8, 0.8]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), mats.lamp.clone()); h.rotation.x = Math.PI / 2; h.position.set(sx, RAIL_Y + 0.55 + 0.45, -L / 2 - 0.04); g.add(h); headlights.push(h); }
  }
  if (rear) { const ws = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.95, 0.06), mats.glass); ws.position.set(0, RAIL_Y + 0.55 + 1.65, L / 2 + 0.01); g.add(ws); }
  return g;
}

export function buildProceduralTrain(): TrainRig {
  const mats: Record<string, THREE.Material> = {
    body: new THREE.MeshPhysicalMaterial({ color: C.body, metalness: 0.7, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    green: new THREE.MeshStandardMaterial({ color: C.green, metalness: 0.5, roughness: 0.4 }),
    purple: new THREE.MeshStandardMaterial({ color: C.purple, emissive: C.purple, emissiveIntensity: 0.9, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: C.deep, metalness: 0.95, roughness: 0.08 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a1511, metalness: 0.6, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa59f, metalness: 1, roughness: 0.3 }),
    lamp: new THREE.MeshStandardMaterial({ color: C.light, emissive: C.light, emissiveIntensity: 1, roughness: 0.2 }),
  };
  const root = new THREE.Group(); const headlights: THREE.Mesh[] = []; const carL = 5.8, gap = 0.3; const n = 3;
  const total = n * carL + (n - 1) * gap;
  for (let i = 0; i < n; i++) { const car = proceduralCar(i === 0, i === n - 1, mats, headlights); car.position.z = -total / 2 + carL / 2 + i * (carL + gap); root.add(car);
    if (i < n - 1) { const gw = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, gap + 0.2), mats.dark); gw.position.set(0, RAIL_Y + 0.55 + 1.2, car.position.z + carL / 2 + gap / 2); root.add(gw); } }
  const lamps = makeLamps(root, total);
  return { root, headlights, lamps, source: 'procedural' };
}

function makeLamps(root: THREE.Group, total: number, y = RAIL_Y + 1.0): THREE.SpotLight[] {
  const out: THREE.SpotLight[] = [];
  for (const sx of [-0.8, 0.8]) {
    const s = new THREE.SpotLight(C.light, 0, 90, 0.42, 0.55, 1.2); s.position.set(sx, y, -total / 2 - 0.2);
    s.target.position.set(sx * 0.6, 0.2, -total / 2 - 30); root.add(s); root.add(s.target); out.push(s);
  }
  return out;
}

/** Parts of the supplied model that are track fixtures or stray geometry rather than train – they float beside/under the car and flicker. */
function isArtifact(m: THREE.Mesh, name: string, b: THREE.Box3, sz: THREE.Vector3): boolean {
  if (name.startsWith('track_') || name.startsWith('third_rail')) return true;                       // model's own track (scene has its own)
  if (name === 'coupler_steel' && Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) > 1.75) return true; // plates sticking out sideways at the cab end
  if (name === 'bogie_cast_metal' && sz.x < 0.3 && sz.y < 0.3 && sz.z < 0.3) return true;             // loose rail-clip cubes
  if (name === 'stainless_dark' && b.min.y < 0.05) return true;                                       // post that pokes below the wheels
  return false;
}

/** Loads a supplied GLB, removes stray parts, and couples two cars cab-to-cab-end into a realistic set. Falls back to the procedural train. */
export async function loadTrain(line: TrainLine = 'purple'): Promise<TrainRig> {
  try {
    const gltf = await new GLTFLoader().loadAsync(trainUrl(line));
    const car = gltf.scene; car.updateMatrixWorld(true);
    const drop: THREE.Mesh[] = [];
    car.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material; const b = new THREE.Box3().setFromObject(m); if (isArtifact(m, mat?.name ?? '', b, b.getSize(new THREE.Vector3()))) drop.push(m); });
    drop.forEach(o => { o.parent?.remove(o); o.geometry?.dispose(); });
    // materials: realistic metals, glass, and z-fight-free decals
    car.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial; const n = mat.name;
      if (n === 'stainless_steel') { mat.color.set(0xd9ccaf); mat.metalness = 0.5; mat.roughness = 0.42; mat.envMapIntensity = 0.7; }
      else if (n === 'stainless_dark') { mat.metalness = 0.6; mat.roughness = 0.45; mat.envMapIntensity = 1.2; }
      else if (n === 'line_livery') { mat.color.set(0xa855f7); mat.metalness = 0.25; mat.roughness = 0.3; mat.envMapIntensity = 1.2; }
      else if (n === 'tinted_glass') { mat.transparent = true; mat.opacity = 0.62; mat.metalness = 0.9; mat.roughness = 0.05; mat.envMapIntensity = 2; mat.depthWrite = false; m.renderOrder = 2; m.castShadow = false; }
      else if (n === 'bogie_cast_metal' || n === 'wheel_machined_steel' || n === 'coupler_steel') { mat.metalness = 0.8; mat.roughness = 0.4; }
      if (n === 'rubber_gasket') { m.visible = false; return; } /* a slab under the body skin: it only ever showed as ragged dark patches through the steel */
      if (/^(line_livery|logo_|dest_|unit_|marker_)/.test(n)) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2; m.castShadow = false; /* decals lie on the body: letting them cast shadows made ragged self-shadow patches */ }
    });
    // centre the single car, wheels on the rail head
    let wheelMinY = Infinity; car.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'wheel_machined_steel') wheelMinY = Math.min(wheelMinY, new THREE.Box3().setFromObject(m).min.y); });
    const box = new THREE.Box3().setFromObject(car); const c = box.getCenter(new THREE.Vector3());
    const inner = new THREE.Group(); inner.add(car); car.position.set(-c.x, -wheelMinY, -c.z); inner.scale.setScalar(MODEL_SCALE);
    const place = (g: THREE.Object3D, z: number, flip: boolean) => { const w = new THREE.Group(); w.add(g); g.rotation.y = flip ? Math.PI : 0; w.position.set(0, RAIL_TOP, z); return w; };
    // one coach, cab at the leading (-Z) end, centred on the origin so the turntable rotates it about its own middle
    const root = new THREE.Group(); root.add(place(inner, 0, true));
    const lead: THREE.Mesh[] = [];
    inner.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'headlight_beam') { m.material = (m.material as THREE.Material).clone(); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1; lead.push(m); } });
    const height = CAR_LEN * 0; void height;
    return { root, headlights: lead, lamps: makeLamps(root, TRAIN_LENGTH, 1.5 * MODEL_SCALE + RAIL_TOP), source: 'glb' };
  } catch (e) { console.warn('[SANCHARA] train GLB failed, using procedural train', e); const r = buildProceduralTrain(); r.root.scale.setScalar(TRAIN_LENGTH / 18.6); return r; }
}
