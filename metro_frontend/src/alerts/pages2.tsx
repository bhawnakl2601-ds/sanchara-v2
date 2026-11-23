import { useEffect, useMemo, useState } from 'react';
import { useLive } from '../live/LiveProvider';
import { api, get, post, patch, del, fmtIST, toIstInput } from '../api/client';
import { metro } from '../engine';
import { StationSelect } from '../ui/StationSelect';
import { Empty, Err, Field, Level, LineDot, Loading, StatusBadge, Time, VerifyBadge, fileToB64, stName, tel, useAction, useFetch, LEVEL_CLASS } from './kit';
import { FeedBanner } from './pages1';

const todayIST = () => toIstInput().slice(0, 10);
/** Current hour in India (the model and the service run on IST), kept inside the operating window the model covers. */
const istHour = () => Math.min(23, Math.max(5, Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 2)) || 9));
const LV_COLOR: Record<string, string> = { LOW: '#9DBB9E', MODERATE: '#CFC2A4', HIGH: '#CF8CF3', 'VERY HIGH': '#B34BE8' };

// ── 5. Crowd prediction ─────────────────────────────────────────────────────────────────────────────────────────
function HourChart({ d, d2 }: { d: any; d2?: any }) {
  const W = 760, H = 250, L = 46, B = 28, T = 14, hrs = d.hours as any[]; const max = Math.max(1, ...hrs.map(h => h.entries_range[1]), ...hrs.map(h => h.exits), ...(d2 ? d2.hours.map((h: any) => h.entries) : [0]));
  const x = (i: number) => L + (i + 0.5) * ((W - L - 8) / hrs.length), bw = (W - L - 8) / hrs.length * 0.62, y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map(t => Math.round(max * t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sa-chart" role="img" aria-label={`Predicted hourly entries and exits for ${stName(d.station_id)} on ${d.date}`}>
      {ticks.map(t => <g key={t}><line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#E9DFC6" strokeOpacity=".12" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="ax">{t >= 1000 ? (t / 1000).toFixed(1) + 'k' : t}</text></g>)}
      {hrs.map((h, i) => <g key={h.hour}><title>{`${String(h.hour).padStart(2, '0')}:00  entries ≈ ${h.entries} (${h.entries_range[0]}–${h.entries_range[1]}), exits ≈ ${h.exits}, ${h.level}, uncertainty ${h.uncertainty}`}</title>
        <rect x={x(i) - bw / 2} y={y(h.entries)} width={bw} height={Math.max(1, y(0) - y(h.entries))} fill={LV_COLOR[h.level] ?? '#9DBB9E'} rx="1.5" />
        <line x1={x(i)} x2={x(i)} y1={y(h.entries_range[0])} y2={y(h.entries_range[1])} stroke="#E9DFC6" strokeOpacity=".55" /><text x={x(i)} y={H - 10} textAnchor="middle" className="ax">{h.hour}</text></g>)}
      <polyline fill="none" stroke="#F4EEDB" strokeWidth="1.6" strokeDasharray="4 3" points={hrs.map((h, i) => `${x(i)},${y(h.hist_avg_entries)}`).join(' ')}><title>Historical average entries (same day-type)</title></polyline>
      <polyline fill="none" stroke="#E9DFC6" strokeWidth="1.8" points={hrs.map((h, i) => `${x(i)},${y(h.exits)}`).join(' ')} opacity=".85"><title>Predicted exits</title></polyline>
      {d2 && <polyline fill="none" stroke="#B34BE8" strokeWidth="2.2" points={d2.hours.map((h: any, i: number) => `${x(i)},${y(h.entries)}`).join(' ')}><title>{stName(d2.station_id)} predicted entries</title></polyline>}
    </svg>);
}
function ValidationBox({ s }: { s: any }) {
  const v = useFetch(() => get('/api/crowd/validation'), []); const e = s.validation_summary.entries, x = s.validation_summary.exits; const rf = e.random_forest, base = e.baseline_same_hour_avg; const b = v.data?.breakdown?.entries;
  const pct = (n?: number | null) => (n == null ? 'n/a' : (n * 100).toFixed(1) + '%');
  return (<details><summary>How accurate is it? (held-out final week, {rf?.n?.toLocaleString()} station-hours)</summary>
    <table className="sa-table"><thead><tr><th>Entries</th><th>MAE</th><th>RMSE</th><th>WAPE</th><th>MAPE (≥50 riders)</th></tr></thead><tbody>
      {Object.entries(e).filter(([k]) => /baseline|random_forest$|hist_gradient/.test(k)).map(([k, m]: any) => <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td>{m.mae}</td><td>{m.rmse}</td><td>{pct(m.wape)}</td><td>{pct(m.mape_ge50)}</td></tr>)}</tbody></table>
    <p className="fine">80% prediction interval coverage on the held-out week: entries <b>{pct(rf?.interval80_coverage)}</b>{x?.random_forest ? <>, exits <b>{pct(x.random_forest.interval80_coverage)}</b></> : null} (target 80%). Model vs same-hour average: MAE {rf?.mae} vs {base?.mae} for entries{v.data?.breakdown?.entries?.rf_vs_baseline_mae_improvement_pct != null ? ` (${v.data.breakdown.entries.rf_vs_baseline_mae_improvement_pct}% better)` : ''}; the gain is modest and not uniform.</p>
    {b?.by_peak && <p className="fine">Peak hours (07–10, 17–20): MAE {b.by_peak['peak_07-10_17-20'].mae.toFixed(1)}, WAPE {pct(b.by_peak['peak_07-10_17-20'].wape)} · Non-peak: MAE {b.by_peak.non_peak.mae.toFixed(1)}, WAPE {pct(b.by_peak.non_peak.wape)}.</p>}
    {b?.worst_stations && <p className="fine">Largest errors (MAE): {b.worst_stations.slice(0, 5).map(([k, m]: any) => `${stName(k)} ${Math.round(m)}`).join(' · ')}.</p>}
    {v.data?.data_coverage && <p className="fine">Data coverage: {v.data.data_coverage.date_range.join(' → ')}; {v.data.data_coverage.calendar_days_without_any_data.length} calendar days have no data; {v.data.data_coverage.duplicate_station_hour_rows} duplicates; imputation: {v.data.data_coverage.imputation}. August direction is inferred (entries only).</p>}
  </details>);
}
export function Crowd() {
  const { online } = useLive(); const [sid, setSid] = useState<string | null>('KGWA'); const [cmp, setCmp] = useState<string | null>(null); const [date, setDate] = useState(todayIST()); const [hour, setHour] = useState(istHour);
  const st = useFetch(() => get('/api/crowd/status'), [online]); const p = useFetch(() => (sid ? get(`/api/crowd/stations/${sid}`, { date }) : Promise.resolve(null)), [sid, date, online]);
  const p2 = useFetch(() => (cmp ? get(`/api/crowd/stations/${cmp}`, { date }) : Promise.resolve(null)), [cmp, date, online]); const hm = useFetch(() => get('/api/crowd/heatmap', { date, hour }), [date, hour, online]);
  const d = p.data;
  const avg = (a: number, b: number) => d?.available ? Math.round(d.hours.filter((h: any) => h.hour >= a && h.hour <= b).reduce((s: number, h: any) => s + h.entries, 0) / (b - a + 1)) : 0;
  const prof = d?.profile?.profiles; const sum = (k: string) => Math.round((prof?.[k] ?? []).reduce((s: number, h: any) => s + (h.entries ?? 0), 0)); const peak = (k: string) => (prof?.[k] ?? []).reduce((m: any, h: any) => (h.entries > (m?.entries ?? -1) ? h : m), null)?.hour;
  const lines = Object.values(metro.lines); const order = useMemo(() => lines.flatMap(l => l.stations).filter((s, i, a) => a.indexOf(s) === i), [lines]);
  const hmMap = useMemo(() => new Map((hm.data?.items ?? []).map((i: any) => [i.station_id, i])), [hm.data]);
  const s = st.data;
  return (
    <div className="sa-stack"><FeedBanner />
      <section className="panel sa-model" aria-label="About these predictions"><h3>AI-Predicted Station Demand <span className={`sa-badge ${s?.state === 'MODEL_READY' ? 'ok' : 'warn'}`} title="Model status reported by the backend">{s?.state ?? (st.loading ? 'MODEL_LOADING' : 'MODEL_UNAVAILABLE')}</span></h3>
        {s?.state === 'MODEL_READY' ? <p className="fine"><b>Historical entry/exit patterns, not live occupancy and not coach crowding.</b> Trained on hourly records from <b>{s.data_from}</b> to <b>{s.data_through}</b> (Aug 1–18 and Sep 1–30, 2025; no data for 19–31 Aug). Model <code>{s.model_version}</code>. Levels compare each station against its own history (LOW &lt; P40 &lt; MODERATE &lt; P70 &lt; HIGH &lt; P90 &lt; VERY HIGH). Not validated for festivals, events, emergencies or disruptions.</p>
          : <p className="msg" role="alert">{st.error ? 'Could not reach the backend, so no estimate is shown.' : st.loading ? 'Checking the model…' : (s?.message ?? 'The demand model is unavailable; no estimates are shown (SANCHARA never shows made-up numbers).')}</p>}
        {s?.validation_summary?.entries && <ValidationBox s={s} />}
      </section>
      <section className="panel sa-form"><div className="sa-row sa-wrap">
        <div className="sa-grow"><StationSelect label="Station" value={sid} onChange={setSid} /></div><div className="sa-grow"><StationSelect label="Compare with (optional)" value={cmp} onChange={setCmp} /></div>
        <Field label="Date"><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></Field></div></section>
      <Err msg={p.error} />
      {p.loading && !d ? <Loading what="Predicting" /> : d && !d.available ? <Empty title="Prediction unavailable">{d.reason ?? 'The model could not be loaded.'}</Empty> : d && (
        <>
          <section className="panel"><h3>{d.station_name} · {d.date} <small className="fine">({d.daytype === 'off_day' ? 'weekend/holiday pattern' : 'weekday pattern'})</small></h3>
            <HourChart d={d} d2={p2.data?.available ? p2.data : undefined} />
            <p className="sa-legend"><i style={{ background: LV_COLOR.LOW }} />Low <i style={{ background: LV_COLOR.MODERATE }} />Moderate <i style={{ background: LV_COLOR.HIGH }} />High <i style={{ background: LV_COLOR['VERY HIGH'] }} />Very high · bars = predicted entries/hour, whiskers = 10–90% range, white line = predicted exits, dashed = historical average entries{p2.data?.available ? `, purple line = ${stName(cmp!)}` : ''}</p>
            <p className="fine">Prediction generated <Time iso={d.generated_at} /> · model <code>{d.model_version}</code> · data through {d.data_through}. {d.disclaimer}</p></section>
          <div className="sa-two">
            <section className="panel"><h3>Morning vs evening peak</h3><dl className="sa-stats"><div><dt>07–10 h avg entries</dt><dd>{avg(7, 10)}</dd></div><div><dt>17–20 h avg entries</dt><dd>{avg(17, 20)}</dd></div><div><dt>Busiest hour</dt><dd>{[...d.hours].sort((a: any, b: any) => b.entries - a.entries)[0]?.hour}:00</dd></div></dl>
              <p className="fine">Hourly entries per hour, predicted for {d.date}.</p></section>
            <section className="panel"><h3>Weekday vs weekend</h3>{prof ? <dl className="sa-stats"><div><dt>Weekday daily entries</dt><dd>{sum('weekday')}</dd></div><div><dt>Weekend daily entries</dt><dd>{sum('off_day')}</dd></div><div><dt>Peak hour wkday / wkend</dt><dd>{peak('weekday')}:00 / {peak('off_day')}:00</dd></div></dl> : <p className="fine">Not available.</p>}<p className="fine">Historical averages from the Aug–Sep 2025 records.</p></section>
          </div>
        </>)}
      <section className="panel"><h3>Network heatmap</h3>
        <div className="sa-row sa-wrap"><Field label={`Hour: ${String(hour).padStart(2, '0')}:00`}><input type="range" min={5} max={23} value={hour} onChange={e => setHour(+e.target.value)} /></Field><button type="button" className="btn" onClick={() => { setDate(todayIST()); setHour(istHour()); }}>Now ({String(istHour()).padStart(2, '0')}:00 IST)</button><p className="fine sa-grow">Predicted relative demand at every station for {date}, {String(hour).padStart(2, '0')}:00 IST. This is a model estimate from past patterns, not a live count. Click a station to chart it.</p></div>
        <Err msg={hm.error} />{hm.data?.available ? <div className="sa-heat">{lines.map(l => <div key={l.id} className="sa-heatline"><h4><LineDot id={l.id} /></h4><div>{l.stations.map(id => { const i: any = hmMap.get(id); return <button key={id} className={`sa-tile ${LEVEL_CLASS[i?.level] ?? ''} ${id === sid ? 'sel' : ''}`} onClick={() => setSid(id)} title={`${stName(id)} — ${i?.level ?? 'n/a'} (≈${i?.entries ?? '?'} entries, ${i?.exits ?? '?'} exits)`} aria-label={`${stName(id)}: ${i?.level ?? 'no estimate'}`} />; })}</div></div>)}</div> : !hm.loading && <p className="fine">Heatmap unavailable.</p>}
      </section>
    </div>
  );
}

// ── 6. Emergency ────────────────────────────────────────────────────────────────────────────────────────────────
export function Emergency() {
  const { online } = useLive(); const c = useFetch(() => get('/api/emergency/contacts'), [online]); const near = useAction(); const [res, setRes] = useState<any>(null); const [share, setShare] = useState<string | null>(null); const [geoErr, setGeoErr] = useState<string | null>(null);
  const locate = () => new Promise<GeolocationPosition>((ok, no) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }) : no(new Error('Location is not supported in this browser'))));
  const findNearest = async () => { setGeoErr(null); try { const p = await locate(); const r = await near.run(() => post('/api/emergency/nearest-station', { lat: p.coords.latitude, lon: p.coords.longitude })); setRes(r); } catch (e: any) { setGeoErr(e?.code === 1 ? 'Location permission was denied. You can still search stations on the map.' : e?.message ?? 'Could not get location'); } };
  const shareLoc = async () => { setGeoErr(null); try { const p = await locate(); const msg = `I need help. My location: https://maps.google.com/?q=${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`; if (navigator.share) { try { await navigator.share({ text: msg }); } catch { /* cancelled */ } } else setShare(msg); } catch (e: any) { setGeoErr(e?.code === 1 ? 'Location permission was denied; nothing was shared.' : e?.message ?? 'Could not get location'); } };
  const d = c.data;
  return (
    <div className="sa-stack">
      <div className="sa-banner bad" role="note"><b>In immediate danger, call 112.</b> SANCHARA does not dispatch emergency services; these buttons only place a phone call or open your email app.</div>
      <Err msg={c.error} />{c.loading && !d ? <Loading /> : d && <>
        <div className="sa-grid">{d.contacts.map((x: any) => (
          <article key={x.id} className={`panel sa-contact ${x.kind === 'EMERGENCY' ? 'is-active' : ''}`}><header><span className="sa-tag">{x.kind === 'EMERGENCY' ? 'Emergency' : 'BMRCL'}</span><StatusBadge s={x.verification_status === 'VERIFIED_BY_ADMIN' ? 'verified' : 'verify periodically'} /></header>
            <h3>{x.name}</h3><p className="fine">{x.description}</p>
            {x.tel && <a className="btn btn--p sa-call" href={x.tel}>Call {x.phone}</a>}{x.mailto && <a className="btn btn--g sa-call" href={x.mailto}>Email {x.email}</a>}
            <p className="fine">Source: <a href={x.source_url} target="_blank" rel="noreferrer noopener">{new URL(x.source_url).host}</a>{x.last_verified_at && <> · verified <Time iso={x.last_verified_at} /></>}</p></article>))}</div>
        <p className="sa-banner warn">{d.warning}</p></>}
      <div className="sa-two">
        <section className="panel"><h3>If something goes wrong</h3><ul className="sa-bullets"><li>Danger to life, fire, crime or medical emergency: call <b>112</b>.</li><li>Move away from hazards and follow instructions from station staff and security personnel.</li><li>For a metro-specific issue (delay, lost item, passenger help), use the BMRCL helpline above.</li><li>Keep your phone charged and note your station name and the line you are on.</li></ul><p className="fine">General safety guidance, not an official BMRCL procedure. Verify against BMRCL announcements.</p></section>
        <section className="panel"><h3>Nearest station &amp; share location</h3><p className="fine">Your location is requested only when you tap a button. It is used once and never stored by SANCHARA.</p>
          <div className="sa-row sa-wrap"><button className="btn btn--g" onClick={findNearest} disabled={near.pending}>Find nearest station</button><button className="btn btn--g" onClick={shareLoc}>Share my location with a trusted contact</button></div>
          <Err msg={geoErr || near.error} />
          {res && <ol className="sa-list">{res.stations.map((s: any) => <li key={s.id}><b>{s.name}</b> <small>{s.km} km</small></li>)}</ol>}
          {share && <div className="sa-share"><p className="fine">Copy and send this to your contact:</p><textarea readOnly value={share} rows={2} onFocus={e => e.target.select()} /><a className="btn btn--g" href={`sms:?&body=${encodeURIComponent(share)}`}>Open messages</a></div>}
          <p className="fine">Station exit information is not available from the supplied datasets, so none is shown.</p></section>
      </div>
    </div>
  );
}

// ── 7. Lost & found (+ passenger reports) ───────────────────────────────────────────────────────────────────────
const CATS = ['bag', 'wallet', 'phone', 'laptop', 'keys', 'id_card', 'documents', 'clothing', 'umbrella', 'water_bottle', 'headphones', 'spectacles', 'jewellery', 'other'];
const REPORT_CATS = [['POSSIBLE_DELAY', 'Possible delay'], ['UNEXPECTED_CROWDING', 'Unexpected crowding'], ['FACILITY_ISSUE', 'Station facility issue'], ['LIFT_ESCALATOR', 'Lift / escalator problem'], ['ASSISTANCE', 'I need assistance']];
export function LostFound() {
  const { online } = useLive(); const [tab, setTab] = useState<'lost' | 'found' | 'report'>('lost'); const as = useFetch(() => get<any>('/api/assistance/status'), [online]); const on = as.data?.submissions_enabled === true;
  return (
    <div className="sa-stack"><FeedBanner />
      <div className="sa-banner warn" role="status"><b>Work in progress.</b> {on ? 'Test submissions are enabled. They are stored for staff review but are not monitored in real time, and nothing is passed to BMRCL.' : 'Submissions, matching and claims are switched off in this release. The forms below show how the feature will work but cannot be sent.'}</div>
      <div className="sa-filters" role="tablist" aria-label="Lost and found">{([['lost', 'I lost something'], ['found', 'I found something'], ['report', 'Report an issue']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <p className="fine">BMRCL publishes no public lost-item database. SANCHARA keeps its own reports and suggests <b>possible</b> matches; staff verify before anything is revealed. No account is needed to file a report. For official lost property, contact BMRCL (see Emergency tab: helpline 1800-425-12345, travelhelp@bmrc.co.in).</p>
      <fieldset className="sa-fs" disabled={!on} aria-disabled={!on}>{tab === 'lost' && <ItemForm kind="lost" />}{tab === 'found' && <ItemForm kind="found" />}{tab === 'report' && <ReportForm />}</fieldset>
    </div>
  );
}
function ItemForm({ kind }: { kind: 'lost' | 'found' }) {
  const [f, setF] = useState<any>({ category: 'bag', name: '', description: '', colour: '', brand: '', station_id: null, lost_on: todayIST(), lost_time: '', found_at: toIstInput(), contact: '' }); const [img, setImg] = useState<string | null>(null); const a = useAction(); const [done, setDone] = useState<any>(null);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setDone(null); const body = kind === 'lost' ? { category: f.category, name: f.name, description: f.description, colour: f.colour, brand: f.brand, station_id: f.station_id, lost_on: f.lost_on, lost_time: f.lost_time || undefined, contact: f.contact || undefined, image_b64: img ?? undefined } : { category: f.category, description: f.description, colour: f.colour, brand: f.brand, station_id: f.station_id, found_at: f.found_at, image_b64: img ?? undefined };
    const r = await a.run(() => post(`/api/lost-found/${kind}`, body)); if (r) setDone(r); };
  return (
    <form className="panel sa-form" onSubmit={submit}><h3>{kind === 'lost' ? 'Report a lost item' : 'Report a found item'}</h3>
      <div className="sa-cols">
        <Field label="Category"><select value={f.category} onChange={e => set('category', e.target.value)}>{CATS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></Field>
        {kind === 'lost' && <Field label="Item name"><input required maxLength={100} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Black laptop bag" /></Field>}
        <Field label="Colour"><input maxLength={30} value={f.colour} onChange={e => set('colour', e.target.value)} placeholder="black" /></Field>
        <Field label="Brand" hint="(if known)"><input maxLength={60} value={f.brand} onChange={e => set('brand', e.target.value)} /></Field>
        <div><StationSelect label={kind === 'lost' ? 'Station' : 'Station where found'} value={f.station_id} onChange={v => set('station_id', v)} /></div>
        {kind === 'lost' ? <><Field label="Approximate date"><input type="date" required value={f.lost_on} max={todayIST()} onChange={e => set('lost_on', e.target.value)} /></Field><Field label="Approximate time"><input type="time" value={f.lost_time} onChange={e => set('lost_time', e.target.value)} /></Field></> : <Field label="Date & time found (IST)"><input type="datetime-local" required value={f.found_at} onChange={e => set('found_at', e.target.value)} /></Field>}
      </div>
      <Field label="Description"><textarea rows={3} required={kind === 'found'} maxLength={1000} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Distinguishing marks, contents, stickers…" /></Field>
      <Field label="Photo" hint="(optional, JPEG/PNG up to 2 MB)"><input type="file" accept="image/jpeg,image/png" onChange={async e => { const file = e.target.files?.[0]; if (!file) return setImg(null); try { setImg(await fileToB64(file)); } catch (er: any) { a.run(async () => { throw er; }); e.target.value = ''; } }} /></Field>
      {kind === 'lost' && <Field label="Contact" hint="(optional · private, never shown publicly)"><input maxLength={120} value={f.contact} onChange={e => set('contact', e.target.value)} placeholder="phone or email" /></Field>}
      {kind === 'found' && <p className="fine">Do not publish the item's exact handover location or any personal details found inside it.</p>}
      <Err msg={a.error} />{done && <p className="msg ok">Saved. Your reference is <b>{done.ref}</b>. {kind === 'lost' ? 'Keep this reference: staff review possible matches and BMRCL is not notified automatically.' : 'Thank you. Staff will review any possible matches.'}</p>}
      <button className="btn btn--p" disabled={a.pending}>{a.pending ? 'Sending…' : 'Submit report'}</button>
    </form>);
}
function ReportForm() {
  const [f, setF] = useState<any>({ category: 'FACILITY_ISSUE', station_id: null, description: '', website: '' }); const [img, setImg] = useState<string | null>(null); const a = useAction(); const [done, setDone] = useState<any>(null);
  return (<div className="sa-stack"><form className="panel sa-form" onSubmit={async e => { e.preventDefault(); setDone(null); const r = await a.run(() => post('/api/reports', { ...f, image_b64: img ?? undefined })); if (r) { setDone(r); setF({ ...f, description: '' }); } }}>
    <h3>Report an issue</h3><p className="fine">Reports are reviewed by staff. Many reports do <b>not</b> make a disruption official; only verified alerts appear in the alert feed.</p>
    <div className="sa-cols"><Field label="What happened?"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{REPORT_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><StationSelect label="Station" value={f.station_id} onChange={v => setF({ ...f, station_id: v })} /></div>
    <Field label="Description"><textarea required minLength={10} maxLength={1000} rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
    <input className="sa-hp" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={e => setF({ ...f, website: e.target.value })} name="website" />
    <Field label="Photo" hint="(optional)"><input type="file" accept="image/jpeg,image/png" onChange={async e => { const file = e.target.files?.[0]; if (!file) return setImg(null); try { setImg(await fileToB64(file)); } catch (er: any) { a.run(async () => { throw er; }); e.target.value = ''; } }} /></Field>
    <Err msg={a.error} />{done && <p className="msg ok">Report <b>{done.ref}</b> submitted. {done.notice}</p>}<button className="btn btn--p" disabled={a.pending}>Submit report</button></form></div>);
}

