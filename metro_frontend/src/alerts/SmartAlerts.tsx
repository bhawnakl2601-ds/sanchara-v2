import { useState } from 'react';
import { Overview, Delays, RouteChanges, Closures } from './pages1';
import { Crowd } from './pages2';
import { FeatureShell } from '../ui/FeatureShell';

const TABS = [['overview', 'Alerts'], ['delays', 'Delays'], ['routes', 'Route changes'], ['closures', 'Closures'], ['crowd', 'Crowd prediction']] as const;
type Tab = typeof TABS[number][0];

export function SmartAlerts() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <FeatureShell kicker="03 · Smart alerts" title="Stay ahead of delays." className="sa">
      <nav className="sa-tabs" role="tablist" aria-label="Smart alerts sections">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="sa-body">
        {tab === 'overview' && <Overview go={t => setTab(t as Tab)} />}{tab === 'delays' && <Delays />}{tab === 'routes' && <RouteChanges />}{tab === 'closures' && <Closures />}{tab === 'crowd' && <Crowd />}
      </div>
    </FeatureShell>
  );
}
