import { useState } from 'react';
import { motion } from 'framer-motion';
import { metro, shortName, type Route } from '../engine';

const mins = (s: number) => Math.max(1, Math.round(s / 60));
export function Timeline({ route }: { route: Route }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <ol className="tl" aria-label="Journey sequence">
      {route.legs.map((leg, li) => {
        const line = metro.lines[leg.lineId]; const idxA = line.stations.indexOf(leg.from), idxB = line.stations.indexOf(leg.to);
        const toward = metro.stations[idxA < idxB ? line.stations[line.stations.length - 1] : line.stations[0]];
        const mid = leg.stops.slice(1, -1); const collapsed = mid.length > 3 && !open[li]; const shown = collapsed ? [] : mid;
        const delay = li * 0.9;
        return (
          <li key={li} className="tl-leg">
            <div className="tl-lh" style={{ ['--lc' as string]: line.color }}>
              <span className="chip" style={{ background: line.color, color: line.textColor === '#000000' ? '#01290F' : line.textColor }}>{line.name} Line</span>
              <span>towards {shortName(toward.name)}</span><span className="tl-meta">{leg.stationsTravelled} stops · {mins(leg.rideSec)} min · {leg.km.toFixed(1)} km</span>
            </div>
            <div className="tl-rail" style={{ ['--lc' as string]: line.color }}>
              <motion.i className="tl-line" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay, duration: 0.9 + leg.stops.length * 0.02, ease: 'easeInOut' }} />
              <Stop id={leg.stops[0]} kind={li === 0 ? 'origin' : 'transfer'} delay={delay} line={line.color} />
              {collapsed && <motion.button className="tl-more" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.3 }} onClick={() => setOpen(o => ({ ...o, [li]: true }))}>Show {mid.length} intermediate stations</motion.button>}
              {shown.map((s, i) => <Stop key={s} id={s} kind="mid" delay={delay + 0.1 + i * 0.04} line={line.color} />)}
              {!collapsed && mid.length > 3 && <button className="tl-more" onClick={() => setOpen(o => ({ ...o, [li]: false }))}>Hide intermediate stations</button>}
              <Stop id={leg.stops[leg.stops.length - 1]} kind={li === route.legs.length - 1 ? 'dest' : 'transfer'} delay={delay + 0.6} line={line.color} />
            </div>
            {route.transfers[li] && (() => { const t = route.transfers[li]; return (
              <motion.div className="tl-xfer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.9 }}>
                <b>Change at {shortName(metro.stations[t.stationId].name)}</b>
                <span>{metro.lines[t.fromLine].name} → {metro.lines[t.toLine].name} · walk ≈ {mins(t.walkSec)} min + average wait ≈ {mins(t.waitSec)} min</span>
              </motion.div>); })()}
          </li>);
      })}
    </ol>
  );
}
function Stop({ id, kind, delay, line }: { id: string; kind: 'origin' | 'dest' | 'transfer' | 'mid'; delay: number; line: string }) {
  const s = metro.stations[id];
  return (
    <motion.div className={`tl-stop tl-stop--${kind}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.5 }}>
      <i style={{ borderColor: line }} className={kind === 'mid' ? '' : 'pulse'} /><span>{shortName(s.name)}</span>
      {kind === 'origin' && <em>Board</em>}{kind === 'dest' && <em>Alight</em>}{kind === 'transfer' && <em>Interchange</em>}<small>{s.code}</small>
    </motion.div>
  );
}
