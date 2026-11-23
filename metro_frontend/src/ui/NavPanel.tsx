import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { Arrow } from './icons';

export type PanelState = 'in' | 'selected' | 'dim' | 'out';
interface Props { dest?: string; idx: number; n: string; tag: string; label: string; heading: string; desc: string; icon: ReactNode; side: 'left' | 'right'; state: PanelState; wip?: boolean; disabled?: boolean; onClick: () => void }

export function NavPanel({ dest, idx, n, tag, label, heading, desc, icon, side, state, wip, disabled, onClick }: Props) {
  const reduce = useReducedMotion(); const dx = side === 'left' ? -36 : 36;
  const variants: Variants = {
    out: { opacity: 0, x: reduce ? 0 : dx, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } },
    in: (i: number) => ({ opacity: 1, x: 0, scale: 1, transition: { duration: 0.7, delay: 0.25 + i * 0.09, ease: [0.16, 1, 0.3, 1] } }),
    dim: { opacity: 0.0, x: reduce ? 0 : dx * 0.5, transition: { duration: 0.5 } },
    selected: { opacity: 1, x: 0, scale: reduce ? 1 : 1.05, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };
  return (
    <motion.button
      type="button" className={`nav nav--${side} nav--${dest ?? 'x'}${wip ? ' nav--wip' : ''}${state === 'selected' ? ' is-selected' : ''}`} variants={variants} custom={idx} initial="out" animate={state}
      whileHover={state === 'in' && !reduce ? { y: -4 } : undefined} whileTap={state === 'in' ? { scale: 0.99 } : undefined}
      onClick={onClick} disabled={disabled} aria-label={`${n} ${tag}. ${heading} ${desc}`}
    >
      <span className="nav-top"><span className="nav-num">{n}</span><span className="nav-label">{label}</span><span className="nav-icon">{icon}</span></span>
      <NavArt dest={dest} /><span className="nav-title">{heading}</span>
      <span className="nav-desc">{desc}</span>
      <span className="nav-foot"><span className="nav-tag">{tag}</span><span className="nav-arrow"><Arrow /></span><span className="nav-pulse" /></span>
    </motion.button>
  );
}

/** Small, fixed line illustration per option (decorative; each option has its own composition). */
/** Small hand-drawn vignettes for the four cards: same line weight and tone as the city illustration. */
function NavArt({ dest }: { dest?: string }) {
  const P = { className: 'nav-art v2', viewBox: '0 0 170 34', 'aria-hidden': true } as const;
  if (dest === 'planner') return <svg {...P}><path d="M3 29H167" /><path d="M13 29V10" /><rect x="6" y="3.5" width="15" height="7.5" rx="1.8" /><path d="M9.5 7.3h8" /><path className="ix" d="M30 22C46 6 72 6 90 22" /><circle cx="30" cy="22" r="2.6" /><circle cx="90" cy="22" r="2.6" /><g transform="translate(112 13)"><rect width="46" height="15" rx="5.5" /><path d="M8 5.5h6M19 5.5h6M30 5.5h6M2 11h42" /></g></svg>;
  if (dest === 'map') return <svg {...P}><path d="M3 27C30 7 56 31 84 15S140 3 167 13" /><path className="ix" d="M9 6C40 15 70 13 96 23S146 31 167 23" /><circle cx="40" cy="20" r="2.6" /><circle cx="120" cy="8" r="2.6" /><circle cx="150" cy="25" r="2.6" /><circle className="ix" cx="90" cy="18" r="5.5" /><circle cx="90" cy="18" r="1.8" /></svg>;
  if (dest === 'alerts') return <svg {...P}><path d="M17 32V6M10 32h14" /><circle cx="17" cy="9" r="3.6" /><circle cx="17" cy="20" r="3.6" /><circle className="ix" cx="66" cy="18" r="11.5" /><path d="M66 11v7l5 3" /><path d="M110 27h22M114 27c0-11 2-16 7-16s7 5 7 16" /><path d="M119 30a3 3 0 0 0 4 0" /><path className="ix" d="M138 12q5 6 0 12M143 9q8 9 0 18" /></svg>;
  return <svg {...P}><path d="M6 17a19 14 0 0 1 38 0z" /><path d="M25 17v11a3.2 3.2 0 0 1-6.4 0" /><path d="M72 29c-2-4-7-8-7-12 0-2.4 3-2.4 5 .8l2 3V8c0-2.6 4-2.6 4 0v9V6c0-2.6 4-2.6 4 0v11V8c0-2.6 4-2.6 4 0v15c0 5-4 8-8 8z" /><path className="ix" d="M100 9c-3-4-9 1-4 6l4 4 4-4c5-5-1-10-4-6z" /><circle className="ix" cx="130" cy="19" r="6" /><path d="M136 19h28M153 19v6M160 19v4" /></svg>;
}
