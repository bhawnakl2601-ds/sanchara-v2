import { SceneryStrip } from './CityBackdrop';

export type Theme = 'planner' | 'map' | 'alerts' | 'assist' | 'guide';
export const themeOf = (cls: string): Theme => cls.includes('assist') ? 'assist' : cls.includes('guide') ? 'guide' : cls.includes('planner') ? 'planner' : cls.includes('mapview') ? 'map' : 'alerts';

/** Decorative, non-interactive scenery for feature pages (clouds + foreground foliage); the full Bengaluru illustration lives behind everything in App. */
export function Backdrop({ theme }: { theme: Theme }) {
  return <div className={`bdrop bdrop--${theme}`} aria-hidden="true"><SceneryStrip /></div>;
}
