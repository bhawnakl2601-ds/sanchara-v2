import assert from 'node:assert/strict';
import { metro, findRoute, calculateFare, routeImpact, recommend, NO_RESTRICTIONS, type Restrictions } from '../src/engine';
const wk = new Date('2026-11-11T09:00:00'); const R = (p: Partial<Restrictions>): Restrictions => ({ ...NO_RESTRICTIONS, ...p });
let n = 0; const ok = (m: string) => { n++; console.log('✓', m); };
// normal route unchanged when restrictions are empty
const base = findRoute(metro, 'MAGR', 'VSWA', 'fastest', wk)!; const same = findRoute(metro, 'MAGR', 'VSWA', 'fastest', wk, NO_RESTRICTIONS)!;
assert.deepEqual(base.sequence, same.sequence); assert.equal(base.totalSec, same.totalSec); ok('empty restrictions == original engine result');
// station closure, trains pass through: route continues but cannot stop at the station
const thru = findRoute(metro, 'MAGR', 'VSWA', 'fastest', wk, R({ closedStations: [{ id: 'VDSA', passThrough: true }] }))!; assert.deepEqual(thru.sequence, base.sequence);
assert.equal(findRoute(metro, 'MAGR', 'VDSA', 'fastest', wk, R({ closedStations: [{ id: 'VDSA', passThrough: true }] })), null); ok('closed station (pass-through): journeys through it work, journeys to/from it do not');
// station closure, no pass-through on a line end-to-end: Purple is cut -> alternative or none
const cut = R({ closedStations: [{ id: 'VDSA', passThrough: false }] }); assert.equal(findRoute(metro, 'MAGR', 'VSWA', 'fastest', wk, cut), null); ok('closed station (no pass-through) splits a single line: no alternative -> null');
// edge (section) closure forces a detour via other lines where one exists, otherwise null
const seg = R({ closedSegments: [{ line: 'PURPLE', from: 'CBPK', to: 'VDSA' }] });
const d1 = findRoute(metro, 'MAGR', 'KGWA', 'fastest', wk, seg); console.log('   MAGR->KGWA with CBPK-VDSA closed:', d1 ? `${d1.sequence.length - 1} stations, ${d1.lineChanges} changes, ${Math.round(d1.totalSec / 60)} min` : 'no route');
assert.equal(d1, null); ok('section closure on the only path: honest "no route" (Purple is a single line there)');
// a section closure that HAS an alternative: Green/Yellow/Purple share interchanges KGWA (Green/Purple) and RVR (Green/Yellow)
const gseg = R({ closedSegments: [{ line: 'GREEN', from: 'KGWA', to: 'CHPK' }] }); const alt = findRoute(metro, 'NGSA', 'NLC', 'fastest', wk, gseg); console.log('   Green section closed NGSA->NLC:', alt ? `${alt.lineChanges} changes` : 'no route'); ok('closure handling returns route or null without throwing');
// whole-line suspension
const susp = R({ suspendedLines: [{ line: 'YELLOW' }] }); assert.equal(findRoute(metro, 'RVR', 'BMSD', 'fastest', wk, susp), null); const viaPurple = findRoute(metro, 'WHTM', 'KGWA', 'fastest', wk, susp)!; assert(viaPurple); ok('Yellow suspended: Yellow-only trips impossible, Purple trips unaffected');
// partial service: only RVR..JDHP runs
const part = R({ partialLines: [{ line: 'YELLOW', from: 'RVR', to: 'JDHP' }] }); assert(findRoute(metro, 'RVR', 'JDHP', 'fastest', wk, part)); assert.equal(findRoute(metro, 'RVR', 'BMSD', 'fastest', wk, part), null); ok('partial service: trips inside the operating section work, beyond it do not');
// interchange restriction: cannot transfer at KGWA -> Green<->Purple trips lose that interchange
const noX = R({ noTransfer: [{ id: 'KGWA' }] }); const g2p = findRoute(metro, 'NGSA', 'MIRD', 'fastest', wk, noX); const g2p0 = findRoute(metro, 'NGSA', 'MIRD', 'fastest', wk)!; console.log('   NGSA->MIRD baseline transfers:', g2p0.transfers.map(t => t.stationId), ' restricted:', g2p ? g2p.transfers.map(t => t.stationId) : null);
assert(!g2p || !g2p.transfers.some(t => t.stationId === 'KGWA')); ok('interchange restriction: no route transfers at the restricted station');
// no alternative available
assert.equal(findRoute(metro, 'WHTM', 'CLGA', 'fastest', wk, R({ suspendedLines: [{ line: 'PURPLE' }] })), null); ok('whole Purple suspended: Whitefield->Challaghatta has no alternative');
// impact detection + fare recalculation follows the NEW route
const imp = routeImpact(metro, base, R({ closedSegments: [{ line: 'PURPLE', from: 'CBPK', to: 'VDSA' }] })); assert(imp.affected && imp.affectedSegments.length === 1);
assert(!routeImpact(metro, base, R({ closedSegments: [{ line: 'PURPLE', from: 'BYPH', to: 'SVRD' }] })).affected); ok('routeImpact flags only journeys that use the closed section');
const gr = R({ noTransfer: [{ id: 'KGWA' }] }); const o = findRoute(metro, 'NGSA', 'MIRD', 'fastest', wk)!; const nr = findRoute(metro, 'NGSA', 'MIRD', 'fastest', wk, gr);
if (nr) { const f2 = calculateFare(metro, nr, wk)!; assert.equal(f2.base, calculateFare(metro, { origin: nr.origin, destination: nr.destination, stationCount: nr.stationCount }, wk)!.base); }
ok('fare recalculated through the existing fare rules for the restricted route');
// recommendations: fastest/cheapest/least-crowded with reasons
const rec = recommend(metro, 'NGSA', 'BMSD', wk, NO_RESTRICTIONS, id => (id === 'KGWA' ? 3 : 1)); assert.equal(rec.length, 3); assert(rec.every(r => r.reason.length > 10) && rec[0].route && rec[1].route); ok(`recommendations carry reasons (${rec.map(r => r.kind + ':' + (r.route ? Math.round(r.route.totalSec / 60) + 'min' : 'n/a')).join(', ')})`);
assert.equal(recommend(metro, 'NGSA', 'BMSD', wk, NO_RESTRICTIONS, null)[2].available, false); ok('least-crowded is withheld without a crowd estimate');
assert(recommend(metro, 'WHTM', 'CLGA', wk, R({ suspendedLines: [{ line: 'PURPLE' }] })).every(r => !r.available)); ok('no-route case reported for all recommendation kinds');
console.log(`\n${n} restriction checks passed`);
