import assert from 'node:assert/strict';
import { metro, findRoute, calculateFare, slabFare, farePeriod, FARE_CONFIG, assessRoute, accessOf, NO_RESTRICTIONS, type Restrictions } from '../src/engine';
let n = 0; const ok = (m: string) => { n++; console.log('✓', m); };
const R = (p: Partial<Restrictions>): Restrictions => ({ ...NO_RESTRICTIONS, ...p });
// ---- fare: slab boundaries (stations travelled, excluding origin) ----
const exp: [number, number][] = [[1, 10], [2, 10], [3, 20], [4, 20], [5, 30], [6, 30], [7, 40], [8, 40], [9, 50], [10, 50], [11, 60], [15, 60], [16, 70], [20, 70], [21, 80], [25, 80], [26, 90], [40, 90]];
for (const [k, f] of exp) assert.equal(slabFare(k), f, `slab ${k}`); ok('slab boundaries match the 14 Feb 2025 chart');
// ---- fare: every station pair has a fare, symmetric, within the slab range ----
const ids = Object.keys(metro.stations); let pairs = 0;
for (const a of ids) for (const b of ids) { if (a === b) continue; const f = metro.fares[a]?.[b]; assert.ok(f !== undefined && [10, 20, 30, 40, 50, 60, 70, 80, 90].includes(f), `${a}->${b}=${f}`); assert.equal(f, metro.fares[b][a], `asymmetric ${a}/${b}`); pairs++; }
ok(`all ${pairs} station pairs have a valid, symmetric fare`);
// ---- fare: discounts by period ----
const peak = new Date('2026-11-11T09:00:00'), off = new Date('2026-11-11T13:00:00'), sun = new Date('2026-11-15T09:00:00'), hol = new Date('2026-08-15T09:00:00');
assert.deepEqual([farePeriod(peak), farePeriod(off), farePeriod(sun), farePeriod(hol)], ['peak', 'offpeak', 'sunday-holiday', 'sunday-holiday']);
const r = findRoute(metro, 'MAGR', 'VSWA', 'fastest', peak)!; const base = metro.fares.MAGR.VSWA;
const fp = calculateFare(metro, r, peak)!, fo = calculateFare(metro, r, off)!, fs = calculateFare(metro, r, sun)!;
assert.equal(fp.base, base); assert.equal(fp.options[0].amount, base); assert.equal(fp.options[1].amount, base);
assert.equal(fp.options[2].amount, Math.round(base * 95) / 100); assert.equal(fo.options[2].amount, Math.round(base * 90) / 100); assert.equal(fs.options[2].amount, Math.round(base * 90) / 100); ok('token = QR; smart card 5% peak / 10% off-peak / 10% Sunday & national holiday');
assert.equal(calculateFare(metro, r, peak)!.base, calculateFare(metro, findRoute(metro, 'VSWA', 'MAGR', 'fastest', peak)!, peak)!.base); ok('same fare in both directions');
assert.ok(fp.notes.some(x => x.includes('on hold')) && FARE_CONFIG.verification.lastCheckedOn); ok('fare output carries its verification caveat');
// ---- accessibility ----
const a1 = accessOf('MAGR'); assert.equal(a1.confidence, 'unverified'); assert.equal(a1.lifts, null); ok('a bare wheelchair flag is never "verified"');
assert.equal(accessOf('MAGR', ['MAGR']).confidence, 'unavailable'); ok('lift outage -> unavailable');
const acc = findRoute(metro, 'MAGR', 'VSWA', 'accessible', peak)!; assert.ok(acc);
const as = assessRoute(metro, acc); assert.equal(as.overall, 'unverified'); assert.ok(as.reasons.join(' ').includes('NOT guaranteed')); ok('accessible route states uncertainty and reasons');
const mid = acc.sequence[Math.floor(acc.sequence.length / 2)];
const re = findRoute(metro, 'MAGR', 'VSWA', 'accessible', peak, R({ liftOutages: [{ id: mid }] }));
assert.ok(re === null || !re.sequence.includes(mid)); ok('lift outage mid-route: accessible route avoids the station or reports none');
assert.equal(findRoute(metro, 'MAGR', 'VSWA', 'accessible', peak, R({ liftOutages: [{ id: 'MAGR' }] })), null); ok('lift outage at origin: no accessible route');
assert.deepEqual(findRoute(metro, 'MAGR', 'VSWA', 'fastest', peak, R({ liftOutages: [{ id: mid }] }))!.sequence, findRoute(metro, 'MAGR', 'VSWA', 'fastest', peak)!.sequence); ok('lift outages do not affect non-accessible routing');
// ---- edge cases ----
assert.equal(findRoute(metro, 'MAGR', 'MAGR'), null); assert.equal(findRoute(metro, 'MAGR', 'NOPE'), null); assert.equal(findRoute(metro, 'NOPE', 'MAGR'), null); ok('same / invalid stations return null');
assert.equal(findRoute(metro, 'MAGR', 'VSWA', 'fastest', peak, R({ suspendedLines: [{ line: 'PURPLE' }, { line: 'GREEN' }, { line: 'YELLOW' }] })), null); ok('all lines suspended: unreachable');
console.log(`\n${n} fare/accessibility checks passed`);
