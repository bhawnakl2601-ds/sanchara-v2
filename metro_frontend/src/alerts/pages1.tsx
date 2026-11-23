import { useMemo, useState } from 'react';
import { useApp } from '../app/state';
import { useLive, type Alert } from '../live/LiveProvider';
import { get, post, del, fmtIST } from '../api/client';
import { calculateFare, findRoute, metro, recommend, routeImpact, hasRestrictions, type Recommendation, type Route } from '../engine';
import { StationSelect } from '../ui/StationSelect';
import { Empty, Err, Level, LineDot, Loading, StatusBadge, Time, VerifyBadge, stName, useAction, useFetch } from './kit';

const rupee = (n: number) => '₹' + n;
const mins = (s: number) => `${Math.round(s / 60)} min`;
export const FeedBanner = () => {
  const { feed, online, lastSync } = useLive();
  if (!online) return <div className="sa-banner bad" role="status"><b>Smart Alerts server not reachable.</b> The planner and map still work; no alert, closure or demand data can be shown right now.</div>;
  return <div className={`sa-banner ${feed?.live_connected ? 'ok' : 'warn'}`} role="status">{feed?.live_connected ? 'Live BMRCL feed connected.' : feed?.message}{lastSync && <small> · refreshed {lastSync.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST</small>}</div>;
};

/** Shortcut used by cards: open the map focused on the first affected station. */
function useMapJump() { const { setMapSelected, lateral } = useApp(); return (a: { stations: string[] }) => { setMapSelected(a.stations[0] ?? null); lateral('map'); }; }
const CAT_LABEL: Record<string, string> = { DELAY: 'Delay', DISRUPTION: 'Disruption', PARTIAL_DISRUPTION: 'Partial disruption', SHORT_LOOP: 'Short-loop', RESTORATION: 'Service restored', ARRIVAL_CHANGE: 'Arrival change', ROUTE_CHANGE: 'Route change', CLOSURE: 'Closure', FACILITY: 'Facility', INFO: 'Information' };

function alternativeFor(a: Alert, restr: ReturnType<typeof useLive>['restrictions']): { text: string; route?: Route } {
  if (a.stations.length < 2 || !a.line_id) return { text: 'See Route Changes to plan around this.' };
  const o = a.stations[0], d = a.stations[a.stations.length - 1]; const r = findRoute(metro, o, d, 'fastest', new Date(), restr);
  if (!r) return { text: hasRestrictions(restr) ? 'No alternative route exists across the affected section with the current closures.' : 'No restriction applies to routing for this alert; services may be slower.' };
  return { text: `${stName(o)} → ${stName(d)}: ${r.stationCount} stations, ${r.lineChanges} change${r.lineChanges === 1 ? '' : 's'}, ${mins(r.totalSec)}.`, route: r };
}

export function AlertCard({ a }: { a: Alert }) {
  const { restrictions } = useLive(); const jump = useMapJump(); const alt = useMemo(() => alternativeFor(a, restrictions), [a, restrictions]);
  return (
    <article className={`panel sa-card ${a.status === 'ACTIVE' ? 'is-active' : ''}`}>
      <header><LineDot id={a.line_id} /><span className="sa-tag">{CAT_LABEL[a.category] ?? a.category}</span><StatusBadge s={a.status} /><VerifyBadge v={a.verification_status} /></header>
      <h3>{a.title}</h3>
      {a.delay_minutes != null && <p className="sa-delay"><b>{a.delay_minutes} min</b> <span className={`sa-level lv${['NORMAL', 'MINOR', 'MODERATE', 'MAJOR'].indexOf(a.delay_level ?? '')}`}>{a.delay_level}</span> <small>SANCHARA display level, not an official BMRCL category</small></p>}
      {a.station_names.length > 0 && <p className="sa-section"><b>Affected:</b> {a.station_names.slice(0, 6).join(' · ')}{a.station_names.length > 6 ? ` +${a.station_names.length - 6} more` : ''}</p>}
      {a.reason && <p><b>Reason:</b> {a.reason}</p>}
      {a.description && a.description !== a.reason && <p className="fine">{a.description}</p>}
      <dl className="sa-meta"><div><dt>Source</dt><dd>{a.source_url ? <a href={a.source_url} target="_blank" rel="noreferrer noopener">{a.source_label}</a> : a.source_label}</dd></div><div><dt>Started</dt><dd><Time iso={a.start_at} /></dd></div><div><dt>Last updated</dt><dd><Time iso={a.last_updated_at} /></dd></div>{a.expected_end_at && <div><dt>Expected end</dt><dd><Time iso={a.expected_end_at} /></dd></div>}</dl>
      {a.stale_warning && <p className="msg">{a.stale_warning}</p>}
      <p className="sa-alt"><b>Alternative:</b> {alt.text}</p>
      <footer><button className="btn btn--g" onClick={() => jump(a)} disabled={!a.stations.length}>View on map</button></footer>
    </article>
  );
}

// ── 1. Overview ────────────────────────────────────────────────────────────────────────────────────────────────
export function Overview({ go }: { go: (t: string) => void }) {
  const { alerts, online } = useLive();
  const closures = useFetch(() => get('/api/closures'), [online]);
  const hour = Math.min(23, Math.max(5, Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 2)) || 9)); const busy = useFetch(() => get('/api/crowd/busiest', { hour, date: undefined }), [online]);
  const planned = (closures.data?.closures ?? []).filter((c: any) => c.status === 'SCHEDULED');
  return (
    <div className="sa-stack">
      <FeedBanner />
      <div className="sa-kpis">
        <button onClick={() => go('delays')}><b>{alerts.length}</b><span>Active verified alerts</span></button>
        <button onClick={() => go('closures')}><b>{planned.length}</b><span>Planned closures</span></button>
        <button onClick={() => go('crowd')}><b>{busy.data?.items?.length ?? '—'}</b><span>Predicted busy stations <small>(AI, around {hour}:00)</small></span></button>
      </div>
      <div className="sa-two">
        <section className="panel"><h3>Latest updates</h3>{alerts.length === 0 ? <p className="fine">No active verified alerts. {online ? 'Services are running normally as far as verified information goes.' : ''}</p> :
          <ul className="sa-list">{[...alerts].sort((a, b) => b.last_updated_at.localeCompare(a.last_updated_at)).slice(0, 6).map(a => <li key={a.id}><LineDot id={a.line_id} /> <b>{a.title}</b><small><Time iso={a.last_updated_at} /></small></li>)}</ul>}</section>
        <section className="panel"><h3>Predicted busy stations</h3><p className="fine">Expected passengers (entries + exits) for {String(hour).padStart(2, '0')}:00 IST, highest first. The tag compares this with how busy <em>that station</em> usually is, so a large interchange can be “moderate” at a high count. A model estimate from past patterns, not a live count.</p>
          {busy.error ? <Err msg={busy.error} /> : busy.loading ? <Loading /> : busy.data?.items?.length ? <ol className="sa-list">{busy.data.items.slice(0, 6).map((i: any) => <li key={i.station_id}>{i.station_name.replace('Nadaprabhu Kempegowda Station, Majestic', 'Majestic')} <small className="mono">{Number(i.demand).toLocaleString('en-IN')} / hr</small> <Level v={i.level} /> <small>for this station</small></li>)}</ol> : <p className="fine">Prediction model not available.</p>}</section>
      </div>
      <section className="panel"><h3>Planned closures</h3>{planned.length === 0 ? <p className="fine">No closures are scheduled.</p> : <ul className="sa-list">{planned.slice(0, 5).map((c: any) => <li key={c.id}><b>{c.type.replace(/_/g, ' ')}</b> · {c.station_names.slice(0, 3).join(', ')} <small>from <Time iso={c.start_at} /></small></li>)}</ul>}</section>
    </div>
  );
}

// ── 2. Delays ──────────────────────────────────────────────────────────────────────────────────────────────────
export function Delays() {
  const { online } = useLive(); const [f, setF] = useState('ALL'); const all = useFetch(() => get<{ alerts: Alert[] }>('/api/alerts'), [online]);
  const rows = (all.data?.alerts ?? []).filter(a => f === 'ALL' || (f === 'ACTIVE' ? a.status === 'ACTIVE' : f === 'RESOLVED' ? a.status !== 'ACTIVE' : f === 'OTHER' ? !['PURPLE', 'GREEN'].includes(a.line_id ?? '') : a.line_id === f));
  const F = [['ALL', 'All alerts'], ['PURPLE', 'Purple Line'], ['GREEN', 'Green Line'], ['OTHER', 'Other lines'], ['ACTIVE', 'Active'], ['RESOLVED', 'Resolved']];
  return (
    <div className="sa-stack"><FeedBanner />
      <div className="sa-filters" role="group" aria-label="Filter alerts">{F.map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
      <p className="fine">Delay figures appear only when an authorised feed or an administrator-verified announcement supplies them. SANCHARA never infers a delay from the timetable.</p>
      <Err msg={all.error} />{all.loading && !all.data ? <Loading /> : rows.length === 0 ? <Empty title="No alerts match">There are no {f === 'ALL' ? '' : 'matching '}verified alerts right now.</Empty> : <div className="sa-grid">{rows.map(a => <AlertCard key={a.id} a={a} />)}</div>}
    </div>
  );
}

// ── 3. Route changes ───────────────────────────────────────────────────────────────────────────────────────────
export function RouteChanges() {
  const { restrictions, online } = useLive(); const { planner, setOrigin, setDestination, lateral, setMapSelected } = useApp(); const { origin, destination } = planner;
  const [hrs, setHrs] = useState(() => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 2)) || 9); const when = useMemo(() => { const d = new Date(); d.setHours(hrs, 0, 0, 0); return d; }, [hrs]);
  const crowd = useFetch(() => (origin && destination ? get('/api/crowd/heatmap', { hour: hrs }) : Promise.resolve(null)), [origin, destination, hrs, online]);
  const rank = useMemo(() => { const m = new Map<string, number>(); const R: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, 'VERY HIGH': 3 }; for (const i of crowd.data?.items ?? []) if (i.level) m.set(i.station_id, R[i.level]); return m.size ? (id: string) => m.get(id) ?? null : null; }, [crowd.data]);
  const out = useMemo(() => { if (!origin || !destination || origin === destination) return null; const base = findRoute(metro, origin, destination, 'fastest', when); const cur = findRoute(metro, origin, destination, 'fastest', when, restrictions);
    return { base, cur, impact: base ? routeImpact(metro, base, restrictions) : null, recs: recommend(metro, origin, destination, when, restrictions, rank) }; }, [origin, destination, when, restrictions, rank]);
  const delta = out?.base && out.cur ? Math.round((out.cur.totalSec - out.base.totalSec) / 60) : null;
  return (
    <div className="sa-stack"><FeedBanner />
      <div className="sa-two sa-top">
        <section className="panel sa-form"><h3>Check a journey</h3>
          <StationSelect label="From" badge="A" value={origin} onChange={setOrigin} /><StationSelect label="To" badge="B" value={destination} onChange={setDestination} />
          <label className="sa-field"><span>Travel hour <small>(for fares and crowd estimates)</small></span><select value={hrs} onChange={e => setHrs(+e.target.value)}>{Array.from({ length: 19 }, (_, i) => i + 5).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          <p className="fine">Routes come from the SANCHARA route engine (Dijkstra) with the verified closures below applied to its graph.</p>
        </section>
        <section className="panel"><h3>Active restrictions</h3>{!hasRestrictions(restrictions) ? <p className="fine">No active closures: every route is calculated on the full network.</p> : <ul className="sa-list">
          {restrictions.closedStations.map(c => <li key={'s' + c.id}>Station closed: <b>{stName(c.id)}</b> <small>{c.passThrough ? 'trains pass through' : 'no trains through'}</small></li>)}
          {restrictions.closedSegments.map((c, i) => <li key={'g' + i}>Section closed: <b>{stName(c.from)} – {stName(c.to)}</b> <LineDot id={c.line} /></li>)}
          {restrictions.suspendedLines.map(c => <li key={c.line}>Line suspended: <LineDot id={c.line} /></li>)}
          {restrictions.partialLines.map(c => <li key={c.line}>Partial service: <LineDot id={c.line} /> only {stName(c.from)} – {stName(c.to)}</li>)}
          {restrictions.noTransfer.map(c => <li key={'t' + c.id}>No interchange at <b>{stName(c.id)}</b></li>)}</ul>}</section>
      </div>
      {!out ? <Empty title="Choose two stations">The comparison shows your usual route, the route with current closures, and three recommendations.</Empty> :
        !out.cur ? <div className="panel sa-nr"><h3>No route available</h3><p>{hasRestrictions(restrictions) ? 'With the current verified closures there is no way to travel between these stations on the metro.' : 'These stations are not connected.'}</p>{out.base && <p className="fine">Normally: {out.base.stationCount} stations, {mins(out.base.totalSec)}.</p>}</div> : (
          <>
            {out.impact?.affected && <div className="sa-banner warn" role="alert"><b>Your usual route is affected.</b> {delta !== null && delta !== 0 ? `The alternative takes ${Math.abs(delta)} min ${delta > 0 ? 'longer' : 'less'}.` : 'The alternative has the same travel time.'}</div>}
            <div className="sa-two">
              <RouteCard title={out.impact?.affected ? 'Usual route (affected)' : 'Route'} r={out.base} when={when} dim={!!out.impact?.affected} />
              {out.impact?.affected && <RouteCard title="Alternative route" r={out.cur} when={when} hl diff={delta} />}
            </div>
            <section className="panel"><h3>Recommendations</h3><div className="sa-recs">{out.recs.map(r => <Rec key={r.kind} r={r} when={when} />)}</div></section>
            <div className="sa-row"><button className="btn btn--g" onClick={() => { setMapSelected(null); lateral('map'); }}>Show on map</button></div>
          </>)}
    </div>
  );
}
function RouteCard({ title, r, when, dim, hl, diff }: { title: string; r: Route | null; when: Date; dim?: boolean; hl?: boolean; diff?: number | null }) {
  if (!r) return null; const f = calculateFare(metro, r, when);
  return (
    <section className={`panel sa-route ${hl ? 'hl' : ''} ${dim ? 'dim' : ''}`}><h3>{title}</h3>
      <p className="sa-seq">{r.legs.map((l, i) => <span key={i}><LineDot id={l.lineId} /> {stName(l.from)} → {stName(l.to)}</span>)}</p>
      <dl className="sa-stats"><div><dt>Time</dt><dd>{mins(r.totalSec)}{diff ? <small className={diff > 0 ? 'neg' : 'pos'}> {diff > 0 ? '+' : ''}{diff} min</small> : null}</dd></div><div><dt>Fare (token)</dt><dd>{f ? rupee(f.base) : '—'}</dd></div><div><dt>Changes</dt><dd>{r.lineChanges}</dd></div><div><dt>Stations</dt><dd>{r.stationCount}</dd></div></dl>
      {r.transfers.length > 0 && <p className="fine">Change at {r.transfers.map(t => stName(t.stationId)).join(', ')}</p>}
    </section>);
}
function Rec({ r, when }: { r: Recommendation; when: Date }) {
  const T = { fastest: 'Fastest', cheapest: 'Cheapest', 'least-crowded': 'Least crowded' }[r.kind];
  return <div className={`sa-rec ${r.available ? '' : 'off'}`}><h4>{T}</h4>{r.route ? <p className="sa-big">{mins(r.route.totalSec)} · {r.fare !== null ? rupee(r.fare) : '—'} · {r.route.lineChanges} change{r.route.lineChanges === 1 ? '' : 's'}</p> : <p className="sa-big">Not available</p>}<p className="fine">{r.reason}</p>{r.route && <p className="fine">{r.route.legs.map(l => metro.lines[l.lineId].name).join(' → ')}</p>}</div>;
}

// ── 4. Closures ────────────────────────────────────────────────────────────────────────────────────────────────
export function Closures() {
  const { online } = useLive(); const jump = useMapJump(); const [f, setF] = useState('LIVE'); const d = useFetch(() => get('/api/closures'), [online]);
  const rows = (d.data?.closures ?? []).filter((c: any) => f === 'ALL' || (f === 'LIVE' ? ['ACTIVE', 'EXTENDED'].includes(c.status) : f === 'SCHEDULED' ? c.status === 'SCHEDULED' : ['RESOLVED', 'CANCELLED'].includes(c.status)));
  return (
    <div className="sa-stack"><FeedBanner />
      <div className="sa-filters" role="group" aria-label="Filter closures">{[['LIVE', 'Active'], ['SCHEDULED', 'Scheduled'], ['PAST', 'Resolved / cancelled'], ['ALL', 'All']].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
      <p className="fine">Closures are published only by administrators with an official source attached. A closed station does not always mean trains stop running through it; each notice says which applies.</p>
      <Err msg={d.error} />{d.loading && !d.data ? <Loading /> : rows.length === 0 ? <Empty title="Nothing here">No closures in this category.</Empty> :
        <div className="sa-grid">{rows.map((c: any) => (
          <article key={c.id} className={`panel sa-card ${['ACTIVE', 'EXTENDED'].includes(c.status) ? 'is-active' : ''}`}><header><span className="sa-tag">{c.type.replace(/_/g, ' ')}</span><StatusBadge s={c.status} /></header>
            <h3>{c.scope === 'station' || c.scope === 'interchange' ? stName(c.station_id) : c.from_station ? `${stName(c.from_station)} – ${stName(c.to_station)}` : `${metro.lines[c.line_id]?.name} Line`} {c.line_id && <LineDot id={c.line_id} />}</h3>
            <p>{c.reason}</p>
            {c.scope === 'station' && <p className="fine">{c.trains_pass_through ? 'Trains run through without stopping.' : 'Trains do not run through this station.'}</p>}
            {c.scope === 'partial' && <p className="fine">Only {stName(c.from_station)} – {stName(c.to_station)} is operating.</p>}
            {c.scope === 'interchange' && <p className="fine">Changing lines here is not possible.</p>}
            <dl className="sa-meta"><div><dt>From</dt><dd><Time iso={c.start_at} /></dd></div><div><dt>Until</dt><dd>{c.end_at ? <Time iso={c.end_at} /> : 'Until further notice'}</dd></div>{c.extended_count > 0 && <div><dt>Extended</dt><dd>{c.extended_count}×</dd></div>}<div><dt>Source</dt><dd>{c.source_url ? <a href={c.source_url} target="_blank" rel="noreferrer noopener">Official notice</a> : c.source_note}</dd></div></dl>
            <footer><button className="btn btn--g" onClick={() => jump({ stations: c.affected_stations })}>View on map</button></footer></article>))}</div>}
    </div>
  );
}

