import { motion } from 'framer-motion';
import { useApp } from '../app/state';
import { FeatureShell, rise, stagger } from './FeatureShell';
import { StationSelect, LinePips } from './StationSelect';
import { Timeline } from './Timeline';
import { assessRoute, confidenceLabel, calculateFare, hasRestrictions, metro, shortName, type RoutePreference } from '../engine';
import { useLive } from '../live/LiveProvider';

const PREFS: { id: RoutePreference; label: string; hint: string }[] = [
  { id: 'fastest', label: 'Fastest', hint: 'Lowest total time incl. transfers' },
  { id: 'fewest-changes', label: 'Fewest changes', hint: 'Minimise line changes first' },
  { id: 'accessible', label: 'Accessible', hint: 'Stations flagged wheelchair-accessible (facility data unverified)' },
];
const fmtMin = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const rupee = (n: number) => '₹' + (Number.isInteger(n) ? n : n.toFixed(2));

export function Planner() {
  const live = useLive();
  const { planner, setOrigin, setDestination, swap, setPref, setWhen, search, lateral, setMapSelected } = useApp();
  const { origin, destination, pref, route, searched, when } = planner;
  const fare = route ? calculateFare(metro, route, when ?? new Date()) : null;
  const same = !!origin && origin === destination;
  const canSearch = !!origin && !!destination && !same;
  return (
    <FeatureShell kicker="01 · Route intelligence" title="Plan your journey." className="planner">
      <div className="planner-grid">
        <motion.form variants={rise} className="panel form" onSubmit={e => { e.preventDefault(); if (canSearch) search(); }}>
          <StationSelect label="From" badge="A" value={origin} onChange={setOrigin} />
          <button type="button" className="swap" onClick={swap} aria-label="Swap origin and destination" disabled={!origin && !destination}><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><path d="M5 2v13M2 12l3 3 3-3M13 16V3M10 6l3-3 3 3" /></svg></button>
          <StationSelect label="To" badge="B" value={destination} onChange={setDestination} />
          <fieldset className="prefs"><legend>Route preference</legend>
            {PREFS.map(p => <label key={p.id} className={pref === p.id ? 'is-on' : ''} title={p.hint}><input type="radio" name="pref" checked={pref === p.id} onChange={() => setPref(p.id)} />{p.label}</label>)}
          </fieldset>
          <label className="when"><span>Travel time <small>(affects fare discount and waits)</small></span>
            <span className="when-row"><input type="datetime-local" value={when ? toLocal(when) : toLocal(new Date())} onChange={e => setWhen(e.target.value ? new Date(e.target.value) : null)} />{when && <button type="button" onClick={() => setWhen(null)}>Now</button>}</span></label>
          {same && <p className="msg" role="alert">Origin and destination are the same station — entry and exit at one station is charged ₹10.</p>}
          <button className="btn btn--p" type="submit" disabled={!canSearch}>Find route</button>
        </motion.form>

        <div className="results" aria-live="polite">
          {!route && planner.searched && hasRestrictions(live.restrictions) && <motion.div variants={rise} className="sa-banner bad" role="status"><b>No route with current verified closures.</b> The route engine honours active closures; see Smart Alerts → Closures for what is affected.</motion.div>}
          {!route && (
            <motion.div variants={rise} className="panel empty">
              {searched && canSearch ? <><h3>No route found</h3><p>{pref === 'accessible' ? 'No step-free path connects these stations in the dataset.' : 'These stations are not connected.'}</p></>
                : <><h3>Where to?</h3><p>Choose a starting station and a destination. Routes, fares and timings are calculated from BMRCL station, schedule and fare data.</p>
                  <div className="legend">{Object.values(metro.lines).map(l => <span key={l.id}><i style={{ background: l.color }} />{l.name} · {l.stations.length} stations</span>)}</div></>}
            </motion.div>)}
          {route && fare && (
            <motion.div key={`${route.origin}-${route.destination}-${route.preference}`} initial="hidden" animate="show" variants={stagger} className="res-stack">
              {planner.baseRoute && (planner.baseRoute.sequence.join() !== route.sequence.join() || planner.baseRoute.totalSec !== route.totalSec) && (
                <motion.div variants={rise} className="sa-banner" role="status"><b>Verified closure on this journey — rerouted.</b> Normal route: {fmtMin(planner.baseRoute.totalSec)}, {planner.baseRoute.stationCount} stations. Current route: {fmtMin(route.totalSec)}, {route.stationCount} stations ({route.totalSec >= planner.baseRoute.totalSec ? '+' : '−'}{fmtMin(Math.abs(route.totalSec - planner.baseRoute.totalSec))}). Alternatives are in Smart Alerts → Route changes.</motion.div>)}
              <motion.div variants={rise} className="panel summary">
                <div className="sum-route"><div><small>Source</small><strong>{shortName(metro.stations[route.origin].name)}</strong><LinePips ids={[route.boardingLine]} /> <span className="sm">{metro.lines[route.boardingLine].name} Line</span></div>
                  <span className="sum-arrow">→</span>
                  <div><small>Destination</small><strong>{shortName(metro.stations[route.destination].name)}</strong><LinePips ids={[route.finalLine]} /> <span className="sm">{metro.lines[route.finalLine].name} Line</span></div></div>
                <dl className="stats">
                  <div><dt>Time</dt><dd>{fmtMin(route.totalSec)}</dd></div>
                  <div><dt>Distance</dt><dd>{route.totalKm.toFixed(1)} km</dd></div>
                  <div><dt>Fare (token)</dt><dd>{rupee(fare.base)}</dd></div>
                  <div><dt>Stations</dt><dd>{route.stationCount}</dd></div>
                  <div><dt>Line changes</dt><dd>{route.lineChanges}</dd></div>
                  <div><dt>Interchange</dt><dd className="sm">{route.transfers.length ? route.transfers.map(t => shortName(metro.stations[t.stationId].name)).join(', ') : 'None'}</dd></div>
                </dl>
                <p className="fine">In-train {fmtMin(route.rideSec)}{route.transferSec ? ` + transfers ${fmtMin(route.transferSec)}` : ''} · average wait for first train ≈ {fmtMin(route.boardingWaitSec)} (not included) · {PREFS.find(p => p.id === route.preference)!.label} route</p>
                {route.preference === 'accessible' && (() => { const a = assessRoute(metro, route, live.restrictions?.liftOutages?.map(l => l.id)); return (
                  <div className="sa-banner" role="note"><b>Accessibility confidence: {confidenceLabel[a.overall]}.</b> {a.reasons.join(' ')}</div>); })()}
                <button className="btn btn--g" onClick={() => { setMapSelected(null); lateral('map'); }}>View on Network Map →</button>
              </motion.div>
              <motion.div variants={rise} className="panel fare">
                <h3>Fare breakdown</h3>
                <table><tbody>{fare.options.map(o => <tr key={o.media}><th scope="row">{o.label}<small>{o.note}</small></th><td>{rupee(o.amount)}</td></tr>)}</tbody></table>
                <ul className="fine">{fare.notes.map(n => <li key={n}>{n}</li>)}<li>Tourist cards (all-line, unlimited): {fare.touristPasses.map(t => `${t.label} ${rupee(t.amount)}`).join(' · ')}.</li></ul>
              </motion.div>
              <motion.div variants={rise} className="panel"><h3>Your journey</h3><Timeline route={route} /></motion.div>
            </motion.div>)}
        </div>
      </div>
    </FeatureShell>
  );
}
