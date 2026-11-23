import { useState } from 'react';
import { useLive } from '../live/LiveProvider';
import { get, post, patch, put } from '../api/client';
import { metro } from '../engine';
import { StationSelect } from '../ui/StationSelect';
import { Err, Field, Loading, StatusBadge, Time, VerifyBadge, stName, useAction, useFetch, LineDot } from './kit';

const AL_CATS = ['DELAY', 'DISRUPTION', 'PARTIAL_DISRUPTION', 'SHORT_LOOP', 'RESTORATION', 'ARRIVAL_CHANGE', 'ROUTE_CHANGE', 'CLOSURE', 'FACILITY', 'INFO'];
const CL_TYPES = ['PLANNED_MAINTENANCE', 'STATION_CLOSURE', 'TRACK_SECTION_CLOSURE', 'LINE_SUSPENSION', 'INTERCHANGE_CLOSURE', 'EMERGENCY_CLOSURE', 'PARTIAL_SERVICE', 'LIFT_OUTAGE', 'ESCALATOR_OUTAGE'];
const SCOPES = ['station', 'section', 'line', 'partial', 'interchange'];
const FLOW: Record<string, string[]> = { POSSIBLE_MATCH: ['UNDER_REVIEW', 'VERIFIED_MATCH', 'CLOSED'], UNDER_REVIEW: ['VERIFIED_MATCH', 'CLOSED'], VERIFIED_MATCH: ['CLAIM_PENDING', 'CLOSED'], CLAIM_PENDING: ['RETURNED', 'VERIFIED_MATCH', 'CLOSED'], RETURNED: ['CLOSED'], CLOSED: [] };
const TABS = ['Dashboard', 'Alerts', 'Closures', 'Sources', 'Events', 'Model', 'Audit'] as const;

export function Admin() {
  const { user } = useLive(); const [tab, setTab] = useState<typeof TABS[number]>('Dashboard');
  if (!user) return <p className="sa-banner warn" role="status">Administrator tools are not available in the passenger app.</p>;
  if (user.role !== 'admin') return <div className="panel sa-empty"><h3>Administrators only</h3><p className="fine">Your account does not have admin access. The server enforces this on every admin request.</p></div>;
  return (
    <div className="sa-stack">
      <div className="sa-filters" role="tablist" aria-label="Admin sections">{TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Dashboard' && <Dash />}{tab === 'Alerts' && <AlertsAdmin />}{tab === 'Closures' && <ClosuresAdmin />}{tab === 'Sources' && <SourcesAdmin />}{tab === 'Events' && <EventsAdmin />}{tab === 'Model' && <ModelAdmin />}{tab === 'Audit' && <AuditAdmin />}
    </div>);
}

function Dash() {
  const d = useFetch(() => get('/api/admin/dashboard')); const a = useAction(); const [jobs, setJobs] = useState<any>(null); const x = d.data;
  const kp: [string, any][] = x ? [['Active alerts', x.active_alerts], ['Verified disruptions', x.verified_disruptions], ['Unverified alerts', x.unverified_alerts], ['Active closures', x.active_closures], ['Scheduled closures', x.scheduled_closures], ['Reports to review', x.unverified_reports], ['Open lost', x.lost_open], ['Open found', x.found_open], ['Possible matches', x.possible_matches], ['Pending claims', x.pending_claims]] : [];
  return (<div className="sa-stack"><Err msg={d.error || a.error} />{d.loading && !x ? <Loading /> : x && <>
    <div className="sa-kpis">{kp.map(([l, v]) => <div key={l} className="panel sa-kpi"><b>{v}</b><span>{l}</span></div>)}</div>
    <section className="panel"><div className="sa-row sa-between"><h3>Data-source health</h3><button className="btn btn--g" disabled={a.pending} onClick={async () => { const r = await a.run(() => post('/api/admin/jobs/run', {})); if (r) { setJobs(r); d.reload(); } }}>Run background jobs now</button></div>
      <p className="fine">{x.feed?.message}</p><ul className="sa-list">{x.sources.map((s: any) => <li key={s.id}><b>{s.name}</b> <StatusBadge s={s.status} /> <small>last success: {s.last_success ? <Time iso={s.last_success} /> : 'never'}</small></li>)}</ul>{jobs && <pre className="sa-pre">{JSON.stringify(jobs, null, 1)}</pre>}</section>
    <section className="panel"><h3>Highest predicted demand today (AI estimate)</h3>{x.predicted_high_demand?.length ? <ul className="sa-list">{x.predicted_high_demand.map((i: any, k: number) => <li key={k}>{stName(i.station_id)} · {i.hour}:00 · {i.level}</li>)}</ul> : <p className="fine">Model unavailable or no estimate.</p>}</section></>}</div>);
}

function AlertsAdmin() {
  const l = useFetch(() => get('/api/admin/alerts')); const a = useAction(); const [f, setF] = useState<any>({ category: 'DELAY', title: '', description: '', line_id: '', delay_minutes: '', reason: '', source_url: '', station: null }); const [prev, setPrev] = useState<any>(null);
  const body = () => ({ category: f.category, title: f.title, description: f.description || undefined, line_id: f.line_id || undefined, delay_minutes: f.delay_minutes === '' ? undefined : +f.delay_minutes, reason: f.reason || undefined, source_url: f.source_url || undefined, stations: f.station ? [f.station] : [] });
  return (<div className="sa-stack"><section className="panel sa-form"><h3>Create alert</h3><p className="fine">New alerts start UNVERIFIED and notify nobody. Verifying needs an official source link or note.</p>
    <div className="sa-cols"><Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{AL_CATS.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Line"><select value={f.line_id} onChange={e => setF({ ...f, line_id: e.target.value })}><option value="">—</option>{Object.values(metro.lines).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <StationSelect label="Station (optional)" value={f.station} onChange={v => setF({ ...f, station: v })} compact /><Field label="Delay (min)"><input type="number" min={0} value={f.delay_minutes} onChange={e => setF({ ...f, delay_minutes: e.target.value })} /></Field></div>
    <Field label="Title"><input required maxLength={160} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field><Field label="Description"><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
    <div className="sa-cols"><Field label="Reason"><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field><Field label="Source link"><input type="url" value={f.source_url} onChange={e => setF({ ...f, source_url: e.target.value })} placeholder="https://…" /></Field></div>
    <Err msg={a.error} />{a.ok && <p className="msg ok">{a.ok}</p>}{prev && <p className="msg">Audience preview: {prev.audience} user(s). {prev.note}</p>}
    <div className="sa-row"><button type="button" className="btn btn--g" disabled={!f.title || a.pending} onClick={async () => { const r = await a.run(() => post('/api/admin/alerts/preview-notification', body())); if (r) setPrev(r); }}>Preview audience</button>
      <button type="button" className="btn btn--p" disabled={!f.title || a.pending} onClick={async () => { if (await a.run(() => post('/api/admin/alerts', body()), 'Alert created (unverified).')) { setF({ ...f, title: '', description: '' }); l.reload(); } }}>Create</button></div></section>
    <section className="panel"><h3>All alerts</h3><Err msg={l.error} />{l.data?.alerts?.length ? <ul className="sa-notes">{l.data.alerts.map((x: any) => <li key={x.id}><div><LineDot id={x.line_id} /> <span className="sa-tag">{x.category}</span> <VerifyBadge v={x.verification_status} /> <StatusBadge s={x.status} /></div><b>{x.title}</b><small>{x.source_url ? 'source attached' : 'no source'} · <Time iso={x.created_at} /></small>
      {x.status === 'ACTIVE' && <div className="sa-row">{x.verification_status === 'UNVERIFIED' && <button className="btn btn--p" onClick={async () => { const note = x.source_url ? undefined : window.prompt('Source note (required to verify):'); if (!x.source_url && !note) return; await a.run(() => patch(`/api/admin/alerts/${x.id}`, { verify: true, source_note: note })); l.reload(); }}>Verify</button>}<button className="btn btn--g" onClick={async () => { await a.run(() => post(`/api/admin/alerts/${x.id}/resolve`, {})); l.reload(); }}>Resolve</button></div>}</li>)}</ul> : <p className="fine">No alerts.</p>}</section></div>);
}

function ClosuresAdmin() {
  const l = useFetch(() => get('/api/admin/closures')); const a = useAction(); const [prev, setPrev] = useState<any>(null);
  const [f, setF] = useState<any>({ type: 'STATION_CLOSURE', scope: 'station', reason: '', start_at: '', end_at: '', station_id: null, line_id: 'PURPLE', from_station: null, to_station: null, trains_pass_through: true, source_url: '', source_note: '' });
  const fixed: Record<string, string | null> = { STATION_CLOSURE: 'station', TRACK_SECTION_CLOSURE: 'section', LINE_SUSPENSION: 'line', INTERCHANGE_CLOSURE: 'interchange', PARTIAL_SERVICE: 'partial', LIFT_OUTAGE: 'station', ESCALATOR_OUTAGE: 'station' }; const scope = fixed[f.type] ?? f.scope; const lineSts = metro.lines[f.line_id]?.stations ?? [];
  const body = () => ({ type: f.type, scope, reason: f.reason, start_at: f.start_at ? f.start_at + ':00+05:30' : '', end_at: f.end_at ? f.end_at + ':00+05:30' : undefined, station_id: f.station_id ?? undefined, line_id: ['station', 'interchange'].includes(scope) ? undefined : f.line_id, from_station: f.from_station ?? undefined, to_station: f.to_station ?? undefined, trains_pass_through: f.trains_pass_through, source_url: f.source_url || undefined, source_note: f.source_note || undefined });
  return (<div className="sa-stack"><section className="panel sa-form"><h3>Create closure</h3><p className="fine">Times are IST. An official source link or note is required. Closures are SCHEDULED until their start time, then ACTIVE automatically.</p>
    <div className="sa-cols"><Field label="Type"><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{CL_TYPES.map(c => <option key={c}>{c}</option>)}</select></Field>
      {!fixed[f.type] && <Field label="Scope"><select value={f.scope} onChange={e => setF({ ...f, scope: e.target.value })}>{SCOPES.map(c => <option key={c}>{c}</option>)}</select></Field>}
      {['station', 'interchange'].includes(scope) ? <StationSelect label="Station" value={f.station_id} onChange={v => setF({ ...f, station_id: v })} compact /> : <Field label="Line"><select value={f.line_id} onChange={e => setF({ ...f, line_id: e.target.value, from_station: null, to_station: null })}>{Object.values(metro.lines).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      {['section', 'partial'].includes(scope) && <><Field label={scope === 'partial' ? 'Operating from' : 'Closed from'}><select value={f.from_station ?? ''} onChange={e => setF({ ...f, from_station: e.target.value })}><option value="">—</option>{lineSts.map(s => <option key={s} value={s}>{stName(s)}</option>)}</select></Field><Field label={scope === 'partial' ? 'Operating to' : 'Closed to'}><select value={f.to_station ?? ''} onChange={e => setF({ ...f, to_station: e.target.value })}><option value="">—</option>{lineSts.map(s => <option key={s} value={s}>{stName(s)}</option>)}</select></Field></>}
      <Field label="Start (IST)"><input type="datetime-local" required value={f.start_at} onChange={e => setF({ ...f, start_at: e.target.value })} /></Field><Field label="End (IST)" hint="(blank = open-ended)"><input type="datetime-local" value={f.end_at} onChange={e => setF({ ...f, end_at: e.target.value })} /></Field></div>
    {scope === 'station' && <label className="sa-check"><input type="checkbox" checked={f.trains_pass_through} onChange={e => setF({ ...f, trains_pass_through: e.target.checked })} /> Trains still pass through without stopping</label>}
    <Field label="Reason"><input required value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field><div className="sa-cols"><Field label="Official source link"><input type="url" value={f.source_url} onChange={e => setF({ ...f, source_url: e.target.value })} /></Field><Field label="or source note"><input value={f.source_note} onChange={e => setF({ ...f, source_note: e.target.value })} /></Field></div>
    <Err msg={a.error} />{a.ok && <p className="msg ok">{a.ok}</p>}{prev && <p className="msg">Preview: {prev.affected_stations.length} station(s) affected; {prev.saved_journeys_affected} saved journey(s) would be flagged.{prev.note ? ' ' + prev.note : ''}</p>}
    <div className="sa-row"><button type="button" className="btn btn--g" disabled={a.pending} onClick={async () => { const r = await a.run(() => post('/api/admin/closures/preview', body())); if (r) setPrev(r); }}>Preview impact</button><button type="button" className="btn btn--p" disabled={a.pending} onClick={async () => { if (await a.run(() => post('/api/admin/closures', body()), 'Closure created.')) { setPrev(null); l.reload(); } }}>Publish closure</button></div></section>
    <section className="panel"><h3>Closures</h3><Err msg={l.error} />{l.data?.closures?.length ? <ul className="sa-notes">{l.data.closures.map((c: any) => <li key={c.id}><div><span className="sa-tag">{c.type.replace(/_/g, ' ')}</span> <StatusBadge s={c.status} /></div><b>{c.reason}</b><small><Time iso={c.start_at} /> → {c.end_at ? <Time iso={c.end_at} /> : 'open-ended'} · {c.affected_stations.length} stations</small>
      {['SCHEDULED', 'ACTIVE', 'EXTENDED'].includes(c.status) && <div className="sa-row">{c.status !== 'SCHEDULED' && <button className="btn btn--g" onClick={async () => { const e = window.prompt('New end (YYYY-MM-DDTHH:MM, IST):'); if (!e) return; await a.run(() => patch(`/api/admin/closures/${c.id}`, { end_at: e + ':00+05:30' })); l.reload(); }}>Extend</button>}<button className="btn btn--g" onClick={async () => { await a.run(() => post(`/api/admin/closures/${c.id}/resolve`, {})); l.reload(); }}>Resolve (reopen)</button><button className="btn btn--g" onClick={async () => { await a.run(() => post(`/api/admin/closures/${c.id}/cancel`, {})); l.reload(); }}>Cancel</button></div>}</li>)}</ul> : <p className="fine">No closures.</p>}</section></div>);
}

export function ReportsAdmin() {
  const l = useFetch(() => get('/api/admin/reports')); const a = useAction(); const [sel, setSel] = useState<number[]>([]); const set = async (id: number, status: string) => { const note = status === 'REJECTED' ? window.prompt('Reason (optional):') ?? undefined : undefined; await a.run(() => patch(`/api/admin/reports/${id}`, { status, note })); l.reload(); };
  return (<section className="panel"><div className="sa-row sa-between"><h3>Passenger reports</h3><button className="btn btn--g" disabled={sel.length < 2} onClick={async () => { await a.run(() => post('/api/admin/reports/merge', { ids: sel })); setSel([]); l.reload(); }}>Merge selected ({sel.length})</button></div>
    <p className="fine">Reports are never official automatically. Verifying a report does not publish an alert; create one under Alerts.</p><Err msg={l.error || a.error} />
    {l.data?.reports?.length ? <ul className="sa-notes">{l.data.reports.map((r: any) => <li key={r.id}><div><label><input type="checkbox" checked={sel.includes(r.id)} onChange={e => setSel(s => e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id))} /> {r.ref}</label> <span className="sa-tag">{r.category.replace(/_/g, ' ')}</span> <StatusBadge s={r.status} />{r.group_size > 1 && <span className="sa-badge warn">{r.group_size} similar</span>}</div><p>{r.description}</p><small>{r.station_name ?? 'no station'} · <Time iso={r.created_at} /></small>
      <div className="sa-row">{['UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESOLVED'].filter(s => s !== r.status).map(s => <button key={s} className="btn btn--g" onClick={() => set(r.id, s)}>{s.replace('_', ' ').toLowerCase()}</button>)}</div></li>)}</ul> : <p className="fine">No reports.</p>}</section>);
}

export function LFAdmin() {
  const l = useFetch(() => get('/api/admin/lost-found')); const w = useFetch(() => get('/api/admin/lost-found/weights')); const a = useAction(); const [wt, setWt] = useState<any>(null); const x = l.data;
  const mv = async (m: any, to: string) => { const handover_note = to === 'VERIFIED_MATCH' || to === 'RETURNED' ? window.prompt('Handover / collection note (shown to the owner):') ?? undefined : undefined; await a.run(() => patch(`/api/admin/lost-found/matches/${m.id}`, { status: to, handover_note })); l.reload(); };
  return (<div className="sa-stack"><Err msg={l.error || a.error} />{l.loading && !x ? <Loading /> : x && <>
    <section className="panel"><h3>Possible matches</h3><p className="fine">Scores are text/attribute similarity only (no image matching). Verify details with the owner before moving a match to Verified.</p>{x.matches?.length ? <ul className="sa-notes">{x.matches.map((m: any) => <li key={m.id}><div><b>{m.lost_name}</b> ↔ found #{m.found_id} <StatusBadge s={m.status} /> <small>{Math.round(m.score * 100)}%</small></div><div className="sa-row">{(FLOW[m.status] ?? []).map(to => <button key={to} className="btn btn--g" onClick={() => mv(m, to)}>→ {to.replace('_', ' ').toLowerCase()}</button>)}</div></li>)}</ul> : <p className="fine">None.</p>}</section>
    <div className="sa-two"><section className="panel"><h3>Lost ({x.lost?.length ?? 0})</h3><ul className="sa-list">{(x.lost ?? []).slice(0, 30).map((i: any) => <li key={i.id}>{i.ref} · {i.name} <StatusBadge s={i.status} /></li>)}</ul></section>
      <section className="panel"><h3>Found ({x.found?.length ?? 0})</h3><ul className="sa-list">{(x.found ?? []).slice(0, 30).map((i: any) => <li key={i.id}>{i.ref} · {i.category} <StatusBadge s={i.status} /></li>)}</ul></section></div>
    <section className="panel"><h3>Matching weights</h3>{w.data && <>{(wt ?? w.data) && <div className="sa-cols">{Object.entries(wt ?? w.data).filter(([k]) => k !== 'threshold').map(([k, v]: any) => <Field key={k} label={k}><input type="number" step="0.05" min={0} max={1} value={v} onChange={e => setWt({ ...(wt ?? w.data), [k]: +e.target.value })} /></Field>)}</div>}<button className="btn btn--g" disabled={!wt || a.pending} onClick={async () => { await a.run(() => put('/api/admin/lost-found/weights', wt), 'Weights saved.'); setWt(null); w.reload(); }}>Save weights</button>{a.ok && <span className="msg ok">{a.ok}</span>}</>}</section></>}</div>);
}

function SourcesAdmin() {
  const d = useFetch(() => get('/api/admin/data-sources')); const a = useAction();
  return (<div className="sa-stack"><Err msg={d.error || a.error} /><section className="panel"><div className="sa-row sa-between"><h3>Data sources</h3><button className="btn btn--g" disabled={a.pending} onClick={async () => { await a.run(() => post('/api/admin/data-sources/refresh', {})); d.reload(); }}>Refresh adapters</button></div>
    {d.data && <><p className="fine">{d.data.feed?.message}</p><ul className="sa-notes">{d.data.sources.map((s: any) => <li key={s.id}><div><b>{s.name}</b> <StatusBadge s={s.status} /></div><small>{s.kind} · {s.notes ?? ''} · last check {s.last_check ? <Time iso={s.last_check} /> : 'never'}{s.last_error ? ` · ${s.last_error}` : ''}</small>
      {s.status === 'MANUAL_SOURCE' && <button className="btn btn--g" onClick={async () => { const note = window.prompt('Verification note:') ?? ''; await a.run(() => post(`/api/admin/data-sources/${s.id}/verify`, { note })); d.reload(); }}>Mark verified</button>}</li>)}</ul></>}</section>
</div>);
}

function EventsAdmin() {
  const [f, setF] = useState<any>({ name: '', venue: '', event_date: '', start_time: '18:00', expected_attendance: '', station: null, source_url: '' }); const a = useAction(); const [sc, setSc] = useState<any>(null); const [share, setShare] = useState('0.2');
  const create = async () => { const e = await a.run(() => post('/api/admin/events', { name: f.name, venue: f.venue, event_date: f.event_date, start_time: f.start_time, expected_attendance: f.expected_attendance, nearby_stations: f.station ? [f.station] : [], source_url: f.source_url || undefined })); if (e) setSc(await a.run(() => get(`/api/crowd/events/${e.id}/scenario`, { metro_share: share }))); };
  return (<section className="panel sa-form"><h3>Event scenario</h3><p className="fine"><b>Hypothetical what-if.</b> The demand model is not validated for events. Extra riders = attendance × the metro share you assume, spread across nearby stations.</p>
    <div className="sa-cols"><Field label="Event"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Venue"><input value={f.venue} onChange={e => setF({ ...f, venue: e.target.value })} /></Field><Field label="Date"><input type="date" value={f.event_date} onChange={e => setF({ ...f, event_date: e.target.value })} /></Field><Field label="Starts"><input type="time" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></Field>
      <Field label="Expected attendance"><input type="number" min={0} value={f.expected_attendance} onChange={e => setF({ ...f, expected_attendance: e.target.value })} /></Field><Field label="Assumed metro share (0–1)"><input type="number" step="0.05" min={0.01} max={1} value={share} onChange={e => setShare(e.target.value)} /></Field><StationSelect label="Nearby station" value={f.station} onChange={v => setF({ ...f, station: v })} compact /><Field label="Source link" hint="(optional)"><input type="url" value={f.source_url} onChange={e => setF({ ...f, source_url: e.target.value })} /></Field></div>
    <Err msg={a.error} /><button className="btn btn--p" disabled={a.pending || !f.name || !f.event_date} onClick={create}>Create &amp; run scenario</button>{sc && <pre className="sa-pre">{JSON.stringify(sc, null, 1)}</pre>}</section>);
}

function ModelAdmin() {
  const d = useFetch(() => get('/api/admin/model')); const r = d.data?.report;
  return (<section className="panel"><h3>Model report</h3><Err msg={d.error} />{d.loading && !d.data ? <Loading /> : <><pre className="sa-pre">{JSON.stringify(d.data?.status, null, 1)}</pre>{r ? <details open><summary>Validation report</summary><pre className="sa-pre">{JSON.stringify(r, null, 1).slice(0, 12000)}</pre></details> : <p className="fine">No model report found. Run <code>python -m backend.ml.train</code>.</p>}</>}</section>);
}

function AuditAdmin() {
  const d = useFetch(() => get('/api/admin/audit'));
  return (<section className="panel"><h3>Audit log (latest 200)</h3><Err msg={d.error} />{d.data && <div className="sa-scroll"><table className="sa-table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr></thead><tbody>{d.data.map((r: any) => <tr key={r.id}><td><Time iso={r.created_at} /></td><td>{r.user_id}</td><td>{r.action}</td><td>{r.entity} {r.entity_id}</td></tr>)}</tbody></table></div>}</section>);
}

export function EmergencyAdmin() {
  const em = useFetch(() => get('/api/emergency/contacts')); const a = useAction();
  return (<section className="panel"><h3>Emergency contact verification</h3><p className="fine">Mark a contact verified only after checking it against the official source. The date is recorded and shown to passengers.</p><Err msg={em.error || a.error} />
    <ul className="sa-list">{(em.data?.contacts ?? []).map((c: any) => <li key={c.id}>{c.name} · {c.phone ?? c.email} <StatusBadge s={c.verification_status} />{c.verification_status !== 'VERIFIED_BY_ADMIN' && <button className="btn btn--g" onClick={async () => { await a.run(() => post(`/api/admin/emergency/${c.id}/verify`, {})); em.reload(); }}>Mark verified</button>}</li>)}</ul></section>);
}
export function AssistAdmin() {
  const { user } = useLive(); const [t, setT] = useState<'reports' | 'lf' | 'em'>('reports');
  if (user?.role !== 'admin') return <div className="panel sa-empty"><h3>Administrators only</h3><p className="fine">Sign in as an administrator (Smart Alerts → Control room) to manage reports, lost &amp; found cases and emergency-contact verification.</p></div>;
  return (<div className="sa-stack"><div className="sa-filters" role="tablist" aria-label="Staff queue">{([['reports', 'Passenger reports'], ['lf', 'Lost & found cases'], ['em', 'Emergency contacts']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)}>{l}</button>)}</div>
    {t === 'reports' && <ReportsAdmin />}{t === 'lf' && <LFAdmin />}{t === 'em' && <EmergencyAdmin />}</div>);
}
