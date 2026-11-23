import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FeatureShell } from '../ui/FeatureShell';
import { useApp } from '../app/state';
import { metro, shortName } from '../engine';

const OFFICIAL = 'https://english.bmrc.co.in/';
const byName = (n: string) => Object.values(metro.stations).find(s => s.name === n)?.id;

/** Per-line copy. Terminals and interchanges are read from the network dataset; only the "worth knowing" stations are editorial. */
const LINES = [
  { id: 'PURPLE', from: 'Challaghatta', to: 'Whitefield (Kadugodi)', reverse: true, note: 'East–west. Runs underground through the centre (Cubbon Park, Vidhana Soudha) and elevated at both ends.', key: ['Nadaprabhu Kempegowda Station, Majestic', 'Mahatma Gandhi Road', 'Indiranagar', 'Krishnarajapura'], labels: { 'Nadaprabhu Kempegowda Station, Majestic': 'Majestic', 'Mahatma Gandhi Road': 'MG Road', Krishnarajapura: 'K. R. Pura' } as Record<string, string> },
  { id: 'GREEN', from: 'Madavara', to: 'Silk Institute', reverse: true, note: 'North–south. Connects Yeshwantpur and Rajajinagar with Jayanagar and Banashankari.', key: ['Yeshwantpur', 'Nadaprabhu Kempegowda Station, Majestic', 'Jayanagar', 'Banashankari'], labels: { 'Nadaprabhu Kempegowda Station, Majestic': 'Majestic' } as Record<string, string> },
  { id: 'YELLOW', from: 'Rashtreeya Vidyalaya Road', to: 'Delta Electronics Bommasandra', reverse: false, note: 'South-east, towards the Electronic City tech corridor. Starts at RV Road, where it meets the Green Line.', key: ['BTM Layout', 'Central Silk Board', 'Electronic City'], labels: {} as Record<string, string> },
] as const;

function LineDiagram({ line, keys, labels, reverse }: { line: string; keys: readonly string[]; labels: Record<string, string>; reverse: boolean }) {
  const L = metro.lines[line]; const ids = reverse ? [...L.stations].reverse() : L.stations; const n = ids.length; const W = Math.max(560, n * 22), x = (i: number) => 24 + (i / (n - 1)) * (W - 48);
  const keyIds = new Set(keys.map(byName)); let flip = 0;
  return (
    <div className="gd-diagram" role="img" aria-label={`${L.name} Line, ${n} stations from ${shortName(metro.stations[ids[0]].name)} to ${shortName(metro.stations[ids[n - 1]].name)}`}>
      <svg viewBox={`0 0 ${W} 92`} width={W} height="92" focusable="false">
        <line x1="24" x2={W - 24} y1="46" y2="46" stroke={L.color} strokeWidth="7" strokeLinecap="round" /><line x1="24" x2={W - 24} y1="46" y2="46" stroke="#F4EEDB" strokeWidth="1.5" strokeDasharray="1 7" opacity=".55" />
        {ids.map((id, i) => { const s = metro.stations[id]; const key = keyIds.has(id) || i === 0 || i === n - 1; const label = labels[s.name] ?? shortName(s.name); const up = key ? (flip++ % 2 === 0) : true;
          return (<g key={id}>
            {s.interchange ? <><circle cx={x(i)} cy="46" r="10" fill="#F4EEDB" stroke="#01290F" strokeWidth="3" /><circle cx={x(i)} cy="46" r="5" fill="#B34BE8" /></> : <circle cx={x(i)} cy="46" r={key ? 6.5 : 3.6} fill="#F4EEDB" stroke="#01290F" strokeWidth={key ? 2.6 : 1.6} />}
            {key && <text x={x(i)} y={up ? 22 : 78} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="gd-st">{label.length > 22 ? label.slice(0, 21) + '…' : label}</text>}
          </g>); })}
      </svg>
    </div>
  );
}

const Num = ({ n }: { n: number }) => <span className="gd-n" aria-hidden="true">{n}</span>;
function Sec({ id, step, title, lead, children }: { id: string; step?: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <motion.section id={id} className="gd-sec" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -8% 0px' }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} aria-labelledby={`${id}-h`}>
      <header className="gd-sh">{step && <span className="gd-step">{step}</span>}<h3 id={`${id}-h`}>{title}</h3>{lead && <p className="gd-lead">{lead}</p>}</header>{children}
    </motion.section>
  );
}
function Steps({ items }: { items: { icon: ReactNode; t: string; d: string }[] }) {
  return <ol className="gd-steps">{items.map((s, i) => <li key={i}><div className="gd-ico">{s.icon}</div><Num n={i + 1} /><div><b>{s.t}</b><p>{s.d}</p></div></li>)}</ol>;
}
function More({ q, children }: { q: string; children: ReactNode }) { return <details className="gd-more"><summary>{q}</summary><div>{children}</div></details>; }

/* small illustrated icons (stroke style matches the rest of the UI) */
const I = (c: ReactNode) => <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c}</svg>;
const ICON = {
  enter: I(<><path d="M6 34V14l14-8 14 8v20" /><path d="M15 34V22h10v12" /></>),
  bag: I(<><rect x="5" y="14" width="30" height="16" rx="3" /><path d="M9 14V10h22v4M10 22h20" /></>),
  detector: I(<><path d="M9 34V10a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v24" /><path d="M16 34V14h8v20" /><circle cx="20" cy="9.5" r="1.2" fill="currentColor" /></>),
  gate: I(<><path d="M5 30h30M12 30V16l8-6 8 6v14" /><path d="M16 22h8" /></>),
  qr: I(<><rect x="7" y="7" width="10" height="10" rx="1.5" /><rect x="23" y="7" width="10" height="10" rx="1.5" /><rect x="7" y="23" width="10" height="10" rx="1.5" /><path d="M23 23h4v4h-4zM29 29h4v4h-4zM29 23h4M23 29v4" /></>),
  sign: I(<><path d="M20 6v30M8 12h20l4 4-4 4H8zM32 26H12l-4 4 4 4h20" /></>),
  train: I(<><rect x="8" y="5" width="24" height="25" rx="6" /><path d="M8 20h24M13 30l-3 5M27 30l3 5" /><circle cx="14" cy="25" r="1.4" fill="currentColor" /><circle cx="26" cy="25" r="1.4" fill="currentColor" /><path d="M13 10h14v6H13z" /></>),
  line: I(<><path d="M4 28h32" /><path d="M10 28v-6M30 28v-6M4 22h32" strokeDasharray="3 3" /><path d="M20 8v8M16 12h8" /></>),
  swap: I(<><path d="M8 14h24l-5-5M32 26H8l5 5" /></>),
  ear: I(<><path d="M14 16a8 8 0 1 1 16 0c0 6-6 6-6 12a4 4 0 0 1-8 0" /><path d="M20 16a2 2 0 1 1 3 2" /></>),
  exit: I(<><path d="M10 34V8h14v26M24 21h10M30 16l5 5-5 5" /></>),
  watch: I(<><path d="M5 34h30M5 28h30" strokeDasharray="6 3" /><path d="M13 22a3 3 0 1 0 0-.01M22 22a3 3 0 1 0 0-.01M20 14h-14" /></>),
};
const Ticket = ({ kind }: { kind: 'qr' | 'token' | 'card' | 'pass' }) => (
  <svg viewBox="0 0 220 96" className="gd-tk" aria-hidden="true" focusable="false">
    {kind === 'qr' && <><path d="M8 8h204v30a8 8 0 0 0 0 16v34H8V54a8 8 0 0 0 0-16z" fill="#F4EEDB" /><path d="M156 8v80" stroke="#023A19" strokeDasharray="4 5" opacity=".5" /><g fill="#01290F">{[0,1,2,3,4].flatMap(r => [0,1,2,3,4].filter(c => (r * 7 + c * 3 + (r * c)) % 3 !== 1 || (r % 4 === 0 && c % 4 === 0)).map(c => <rect key={`${r}${c}`} x={170 + c * 8} y={28 + r * 8} width="6" height="6" rx="1" />))}</g><rect x="24" y="26" width="92" height="8" rx="3" fill="#023A19" /><rect x="24" y="44" width="70" height="6" rx="3" fill="#B34BE8" /><rect x="24" y="60" width="50" height="6" rx="3" fill="#CDBF9E" /></>}
    {kind === 'token' && <><circle cx="110" cy="48" r="38" fill="#F4EEDB" stroke="#023A19" strokeWidth="3" /><circle cx="110" cy="48" r="28" fill="none" stroke="#B34BE8" strokeWidth="2.5" strokeDasharray="3 5" /><path d="M96 48h28M114 40l10 8-10 8" stroke="#01290F" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
    {kind === 'card' && <><rect x="26" y="10" width="168" height="76" rx="10" fill="#027032" /><rect x="26" y="26" width="168" height="14" fill="#01290F" opacity=".5" /><rect x="40" y="56" width="42" height="10" rx="3" fill="#E9DFC6" /><path d="M150 52a14 14 0 0 1 0 22M160 46a24 24 0 0 1 0 34" fill="none" stroke="#B34BE8" strokeWidth="3.5" strokeLinecap="round" /></>}
    {kind === 'pass' && <><rect x="10" y="12" width="200" height="72" rx="8" fill="#E9DFC6" /><rect x="10" y="12" width="46" height="72" rx="8" fill="#B34BE8" /><text x="33" y="56" textAnchor="middle" className="gd-pass">1·3·5</text><rect x="70" y="28" width="110" height="8" rx="3" fill="#023A19" /><rect x="70" y="46" width="84" height="6" rx="3" fill="#CDBF9E" /><rect x="70" y="60" width="60" height="6" rx="3" fill="#CDBF9E" /></>}
  </svg>
);

export function MetroGuide() {
  const { lateral, setAssistSub } = useApp(); const [open, setOpen] = useState<string | null>('PURPLE');
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const interchanges = useMemo(() => Object.values(metro.stations).filter(s => s.interchange).map(s => ({ id: s.id, name: shortName(s.name), lines: s.lines.map(l => metro.lines[l].name) })), []);
  const NAV: [string, string][] = [['gd-lines', 'The lines'], ['gd-plan', '1 · Plan'], ['gd-tickets', '2 · Tickets'], ['gd-security', '3 · Security'], ['gd-board', '4 · Boarding'], ['gd-transfer', '5 · Transfers'], ['gd-times', 'Timings'], ['gd-help', 'Help']];
  return (
    <FeatureShell kicker="04 · Metro Guide" title="Ride with confidence." className="guide">
      <p className="gd-intro">Never taken Namma Metro before? Follow these five steps, from choosing a route to changing trains. Everything that can change (fares, passes, timings) points to the official BMRCL source.</p>
      <nav className="gd-nav" aria-label="Metro Guide sections">{NAV.map(([id, l]) => <button key={id} type="button" onClick={() => jump(id)}>{l}</button>)}</nav>

      <Sec id="gd-lines" title="Understand the lines" lead="Bengaluru has three operating lines. Each has a colour, and every sign, map and train uses it.">
        <div className="gd-lines">{LINES.map(l => { const L = metro.lines[l.id]; const isOpen = open === l.id; const ix = interchanges.filter(i => i.lines.includes(L.name));
          return (
            <article key={l.id} className={`gd-line${isOpen ? ' open' : ''}`} style={{ ['--lc' as string]: L.color }}>
              <button type="button" className="gd-line-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)}>
                <i aria-hidden="true" /><span><b>{L.name} Line</b><small>{l.from} → {l.to}</small></span><em>{L.stations.length} stations</em><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              </button>
              {isOpen && <div className="gd-line-b">
                <p>{l.note}</p>
                <dl className="gd-kv"><div><dt>Starts</dt><dd>{l.from}</dd></div><div><dt>Ends</dt><dd>{l.to}</dd></div><div><dt>Worth knowing</dt><dd>{l.key.map(k => (l.labels as Record<string, string>)[k] ?? shortName(k)).join(' · ')}</dd></div></dl>
                <LineDiagram line={l.id} keys={l.key} labels={l.labels as Record<string, string>} reverse={l.reverse} />
                <p className="gd-ix"><b>Change here:</b> {ix.length ? ix.map(i => `${i.name} (${i.lines.join(' ⇄ ')})`).join(' · ') : 'no interchange on this line'}</p>
              </div>}
            </article>); })}</div>
        <p className="gd-callout"><b>Majestic is the big one.</b> Nadaprabhu Kempegowda Station, Majestic is where the Purple and Green Lines cross. {interchanges.filter(i => i.id !== 'KGWA').map(i => `${i.name} is the data-listed ${i.lines.join(' ⇄ ')} interchange.`).join(' ')} No other interchanges are shown, because none are in the network data.</p>
      </Sec>

      <Sec id="gd-plan" step="Step 1" title="Plan your route" lead="Do this before you reach the station.">
        <Steps items={[
          { icon: ICON.enter, t: 'Pick where you start', d: 'In the Travel Planner, type your nearest station in “From”. You can search by name or station code.' },
          { icon: ICON.exit, t: 'Pick where you are going', d: 'Do the same for “To”. Use the swap button for the return trip.' },
          { icon: ICON.line, t: 'Find your line', d: 'The result shows each line by colour and the direction by its end station, for example “towards Whitefield”.' },
          { icon: ICON.swap, t: 'Spot the changes', d: 'A highlighted stop marked “Change” is where you switch lines. A direct trip has none.' },
          { icon: ICON.watch, t: 'Check the time', d: 'Total journey time includes waiting at interchanges. Add a few minutes for walking inside big stations.' },
        ]} />
        <button type="button" className="btn btn--p" onClick={() => lateral('planner')}>Open the Travel Planner →</button>
      </Sec>

      <Sec id="gd-tickets" step="Step 2" title="Choose and buy your ticket" lead="Four ways to pay. Pick one that suits how often you ride.">
        <div className="gd-cards">
          <article className="gd-card"><Ticket kind="qr" /><h4>QR ticket</h4>
            <ul><li>Buy on the official Namma Metro app, or another channel listed on the BMRCL website.</li><li>Open the ticket on your phone before the gate. Turn screen brightness up.</li><li>Hold the QR code to the reader on the entry gate, then again at the exit gate.</li></ul>
            <p className="fine">Only buy through channels BMRCL lists officially.</p></article>
          <article className="gd-card"><Ticket kind="token" /><h4>Token</h4>
            <ul><li>A single-trip token, bought at the station ticket counter or vending machine.</li><li>Tap it on the reader at the entry gate.</li><li>At the exit gate, drop it in the slot to leave.</li></ul>
            <p className="fine">Keep it safe: you need it to exit.</p></article>
          <article className="gd-card"><Ticket kind="card" /><h4>Smart card / NCMC</h4>
            <ul><li>A reloadable contactless card. Tap at the entry gate and again at the exit gate.</li><li>BMRCL has offered fare discounts for card users. Confirm the current discount on the official site.</li><li>Buy or recharge at station facilities or through the card issuer’s supported channels.</li></ul>
            <p className="fine">Carry a QR ticket as a back-up: card systems can occasionally go down.</p></article>
          <article className="gd-card"><Ticket kind="pass" /><h4>Day passes</h4>
            <ul><li>For many trips in a short period: BMRCL has offered 1-day, 3-day and 5-day unlimited passes.</li><li>Passes have been available as mobile QR passes and as smart-card passes, usually at different prices.</li></ul>
            <p className="fine">Prices and pass options change (fares were revised in February 2026). Check the current list before you buy.</p></article>
        </div>
        <a className="btn btn--g gd-link" href={OFFICIAL} target="_blank" rel="noreferrer noopener">Current fares, passes and ticket channels · BMRCL ↗</a>
      </Sec>

      <Sec id="gd-security" step="Step 3" title="Security and entering the station" lead="Every passenger is screened. It takes a minute or two.">
        <Steps items={[
          { icon: ICON.enter, t: 'Enter the station', d: 'Follow the station entrance signs. Large stations have several entrances, so check the one nearest your line.' },
          { icon: ICON.detector, t: 'Complete security screening', d: 'Queue at the screening point. Keep your ticket or card ready and in hand.' },
          { icon: ICON.bag, t: 'Put bags through the X-ray', d: 'Place bags on the belt. Take large metal items such as keys and phones from your pockets if asked.' },
          { icon: ICON.detector, t: 'Walk through the metal detector', d: 'Walk through one at a time. Staff may use a hand scanner for a quick check.' },
          { icon: ICON.gate, t: 'Reach the fare gates (AFC)', d: 'These are the automatic fare collection gates, with a reader at hand height.' },
          { icon: ICON.qr, t: 'Scan or tap', d: 'Hold the QR code to the scanner, or tap your card or token. The gate opens when it is accepted.' },
          { icon: ICON.sign, t: 'Follow the signs to your platform', d: 'Signs show the line colour and the end station. Check that it matches “towards …” from your route.' },
        ]} />
      </Sec>

      <Sec id="gd-board" step="Step 4" title="Boarding the train" lead="A calm, orderly boarding keeps everyone moving.">
        <Steps items={[
          { icon: ICON.sign, t: 'Check the destination board', d: 'The train front and the platform display show the end station. It must match your direction.' },
          { icon: ICON.line, t: 'Confirm the platform', d: 'Platform numbers and line colours are on the signs overhead.' },
          { icon: ICON.watch, t: 'Wait behind the safety line', d: 'Stand behind the marked line until the doors open fully.' },
          { icon: ICON.exit, t: 'Let people off first', d: 'Stand to the side of the door so passengers can leave before you step in.' },
          { icon: ICON.train, t: 'Board and move inside', d: 'Step in and move along the coach. Hold a rail or strap.' },
          { icon: ICON.ear, t: 'Listen and watch', d: 'Announcements and the in-train display name the next station, in more than one language.' },
          { icon: ICON.exit, t: 'Get ready to exit', d: 'Move to the door one stop early. Use your ticket or card again at the exit gate.' },
        ]} />
      </Sec>

      <Sec id="gd-transfer" step="Step 5" title="Understanding transfers" lead="Changing lines happens inside a single station. You do not leave the paid area.">
        <div className="gd-two">
          <div className="gd-card gd-card--plain"><h4>Majestic: Purple ⇄ Green</h4><p>Nadaprabhu Kempegowda Station, Majestic is the main interchange. The two lines cross here.</p></div>
          <div className="gd-card gd-card--plain"><h4>How to change</h4><ul><li>Get off at the interchange and follow the “Interchange” signs.</li><li>Find the platform for your next line, shown by its colour.</li><li>Check the direction: read the end station on the board and compare it with your route.</li><li>Wait behind the line and board as in Step 4.</li></ul></div>
        </div>
        {interchanges.some(i => i.id === 'RVR') && <p className="fine">Also in the network data: Rashtreeya Vidyalaya Road (RV Road) joins the Green and Yellow Lines.</p>}
      </Sec>

      <Sec id="gd-times" title="Metro timings" lead="Indicative only. Services change on holidays, during events and after notices, so check the official source before a late or early trip.">
        <div className="gd-times">
          <div><h4>Purple and Green Lines</h4><dl className="gd-kv"><div><dt>Mon–Sat</dt><dd>First trains from about 5:00 AM</dd></div><div><dt>Sunday</dt><dd>First trains from about 7:00 AM</dd></div><div><dt>Last train</dt><dd>From terminal stations, around 11:00 PM</dd></div></dl></div>
          <div><h4>Yellow Line</h4><dl className="gd-kv"><div><dt>Mon–Sat</dt><dd>First train about 6:30 AM</dd></div><div><dt>Sunday</dt><dd>About 7:00 AM</dd></div><div><dt>Last train</dt><dd>Differs by end station. Check the current timetable.</dd></div></dl></div>
        </div>
        <p className="gd-callout gd-callout--soft">Timings above are indicative, based on published BMRCL announcements, and can be changed at any time. For current schedules use the official BMRCL site, not this guide. <a href={OFFICIAL} target="_blank" rel="noreferrer noopener">bmrc.co.in ↗</a></p>
      </Sec>

      <Sec id="gd-help" title="Passenger assistance" lead="Lost something, or need to reach someone? These are one tap away.">
        <div className="gd-two">
          <button type="button" className="gd-card gd-help" onClick={() => { setAssistSub('lf'); lateral('assist'); }}><h4>Lost &amp; Found</h4><p>Report a lost or found item, or see how it works.</p><span>Open →</span></button>
          <button type="button" className="gd-card gd-help" onClick={() => { setAssistSub('emergency'); lateral('assist'); }}><h4>Emergency contacts</h4><p>Call 112 for police, fire or ambulance, plus the BMRCL helpline.</p><span>Open →</span></button>
        </div>
        <More q="Quick tips for your first ride"><ul className="gd-tips"><li>Keep your ticket or card handy: you need it again to exit.</li><li>Allow extra time at Majestic, a very large station.</li><li>Follow the floor markings and signs: they show where to queue and where to stand.</li><li>Ask station staff (uniformed, near the gates) if you are unsure about anything.</li></ul></More>
      </Sec>
    </FeatureShell>
  );
}
