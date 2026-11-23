import assert from 'node:assert/strict';
import { metro, findRoute, calculateFare, slabFare, searchStations, stationList, schematicLayout, farePeriod } from '../src/engine';
const wk = new Date('2026-11-11T09:00:00'); // Wed peak
let n = 0; const ok = (m: string) => { n++; console.log('✓', m); };
// 1. every ordered station pair routes, fare exists, route is internally consistent
let pairs = 0, fareMismatch: string[] = [];
const ids = Object.keys(metro.stations);
for (const a of ids) for (const b of ids) if (a !== b) {
  const r = findRoute(metro, a, b, 'fastest', wk); assert(r, `no route ${a}->${b}`); pairs++;
  assert.equal(r.sequence[0], a); assert.equal(r.sequence.at(-1), b);
  assert.equal(r.stationCount, r.sequence.length - 1);
  assert.equal(r.lineChanges, r.transfers.length);
  const f = calculateFare(metro, r, wk)!; assert(f);
  if (f.base !== slabFare(r.stationCount)) fareMismatch.push(`${a}-${b} table ${f.base} slab(${r.stationCount})=${slabFare(r.stationCount)}`);
  // reverse symmetry
  if (a < b) { const q = findRoute(metro, b, a, 'fastest', wk)!; assert(Math.abs(q.rideSec - r.rideSec) < 1 || q.lineChanges !== r.lineChanges, `asym ride ${a} ${b}`); if (r.lineChanges === 0) assert(Math.abs(q.totalSec - r.totalSec) < 1); assert(Math.abs(q.totalKm - r.totalKm) < 0.1); /* transfer wait depends on the boarded line's headway, so totals may differ legitimately */ }
}
ok(`all ${pairs} ordered pairs route, reverse routes symmetric`);
console.log(fareMismatch.length ? `! ${fareMismatch.length} cross-line pairs where table fare != slab(stations on route): e.g. ${fareMismatch.slice(0, 3)}` : '✓ table fare == slab fare for every pair');
// 2. known journeys
const r1 = findRoute(metro, 'WHTM', 'CLGA', 'fastest', wk)!; assert.equal(r1.lineChanges, 0); assert.equal(r1.stationCount, 36); assert.equal(r1.boardingLine, 'PURPLE'); ok(`Whitefield→Challaghatta: 0 changes, ${r1.stationCount} stations, ${r1.totalKm} km, ${(r1.totalSec / 60).toFixed(1)} min, ₹${calculateFare(metro, r1, wk)!.base}`);
const r2 = findRoute(metro, 'WHTM', 'BMSD', 'fastest', wk)!; assert.equal(r2.lineChanges, 2); assert.deepEqual(r2.transfers.map(t => t.stationId), ['KGWA', 'RVR']); ok(`Whitefield→Bommasandra: changes at ${r2.transfers.map(t => t.stationId)}, ${r2.totalKm} km, ${(r2.totalSec / 60).toFixed(1)} min`);
const r3 = findRoute(metro, 'BYPH', 'MIRD', 'fewest-changes', wk)!; assert.equal(r3.lineChanges, 0); ok('same-line route has 0 changes under every preference');
const sameFare = calculateFare(metro, { origin: 'KGWA', destination: 'KGWA', stationCount: 0 }, wk)!; assert.equal(sameFare.base, 10); ok('same-station fare ₹10');
// 3. preference affects algorithm: fewest-changes never has more changes than fastest, over all pairs
let diff = 0; for (const a of ids) for (const b of ids) if (a !== b) { const f = findRoute(metro, a, b, 'fastest', wk)!, c = findRoute(metro, a, b, 'fewest-changes', wk)!; assert(c.lineChanges <= f.lineChanges); assert(f.totalSec <= c.totalSec + 1e-6); if (c.totalSec !== f.totalSec) diff++; }
ok(`fewest-changes ≤ fastest changes and fastest ≤ time on all pairs (${diff} pairs differ)`);
assert(findRoute(metro, 'WHTM', 'BMSD', 'accessible', wk)); ok('accessible preference routes (all stations step-free in dataset)');
// 4. fare periods / discounts
assert.equal(farePeriod(new Date('2026-11-11T09:00')), 'peak'); assert.equal(farePeriod(new Date('2026-11-11T13:00')), 'offpeak'); assert.equal(farePeriod(new Date('2026-11-15T10:00')), 'sunday-holiday'); assert.equal(farePeriod(new Date('2026-08-15T10:00')), 'sunday-holiday');
const fp = calculateFare(metro, r1, wk)!; assert.equal(fp.options[2].amount, 85.5); assert.equal(calculateFare(metro, r1, new Date('2026-11-11T13:00'))!.options[2].amount, 81); ok('smart-card 5% peak / 10% off-peak: ₹85.50 / ₹81.00 on ₹90');
// 5. search
assert.equal(searchStations(stationList, 'mg road')[0].id, 'MAGR'); assert.equal(searchStations(stationList, 'BYPH')[0].id, 'BYPH'); assert.equal(searchStations(stationList, 'majestic')[0].id, 'KGWA'); assert.equal(searchStations(stationList, 'ಮಹಾತ್ಮ')[0].id, 'MAGR'); assert.equal(searchStations(stationList, 'zzzz').length, 0); ok('search by name, code, alias, Kannada; empty state');
// 6. schematic sanity
const sch = schematicLayout(metro); assert.equal(Object.keys(sch).length, ids.length);
let minD = Infinity; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minD = Math.min(minD, Math.hypot(sch[ids[i]].x - sch[ids[j]].x, sch[ids[i]].y - sch[ids[j]].y)); ok(`schematic: all ${ids.length} stations placed, min pair distance ${minD.toFixed(2)} (spacing 1)`);
console.log(`\n${n} checks passed`);
