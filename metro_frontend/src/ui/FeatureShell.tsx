import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { useApp } from '../app/state';
import { Arrow } from './icons';
import { Backdrop, themeOf } from './Backdrop';

export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } };
export const rise: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } } };

export function BackButton({ to }: { to?: { label: string; go: () => void } }) {
  const { goHome, view } = useApp();
  return <motion.button variants={rise} className="back" onClick={to ? to.go : goHome} disabled={view === 'returning-home'}><Arrow dir="left" /><span>{to?.label ?? 'Back to SANCHARA'}</span></motion.button>;
}
export function FeatureShell({ kicker, title, children, solid = true, className = '', back }: { kicker: string; title: string; children: ReactNode; solid?: boolean; className?: string; back?: { label: string; go: () => void } }) {
  return (
    <motion.section className={`feature ${solid ? 'feature--solid' : 'feature--clear'} ${className}`} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.4 } }} variants={stagger}>
      <Backdrop theme={themeOf(className)} />
      <header className="feature-head">
        <BackButton to={back} />
        <motion.div variants={rise} className="feature-title"><span className="kicker">{kicker}</span><h2>{title}</h2></motion.div>
      </header>
      {children}
    </motion.section>
  );
}
