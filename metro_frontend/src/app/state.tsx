import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TransitionManager, isBusy, viewFor, HOLD_Z, type AppView, type Dest } from './transition';
import { findRoute, hasRestrictions, type Route, type RoutePreference } from '../engine';
import { useLive } from '../live/LiveProvider';

export interface PlannerState { origin: string | null; destination: string | null; pref: RoutePreference; when: Date | null; route: Route | null; baseRoute: Route | null; searched: boolean }
interface Ctx {
  view: AppView; content: Dest | null; hubVisible: boolean; selected: Dest | null; tm: TransitionManager;
  planner: PlannerState; mapSelected: string | null; mapRouteVisible: boolean; assistSub: 'home' | 'lf' | 'emergency'; setAssistSub: (s: 'home' | 'lf' | 'emergency') => void;
  go: (d: Dest) => void; goHome: () => void; lateral: (d: Dest) => void; settledMode: 'hub' | 'hold' | 'off' | 'transition';
  setOrigin: (id: string | null) => void; setDestination: (id: string | null) => void; swap: () => void; setPref: (p: RoutePreference) => void; setWhen: (d: Date | null) => void;
  search: () => void; setMapSelected: (id: string | null) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('useApp outside provider'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const tm = useRef(new TransitionManager()).current;
  const [view, setView] = useState<AppView>('home');
  const [content, setContent] = useState<Dest | null>(null);
  const [hubVisible, setHubVisible] = useState(true);
  const [selected, setSelected] = useState<Dest | null>(null);
  const [planner, setPlanner] = useState<PlannerState>({ origin: null, destination: null, pref: 'fastest', when: null, route: null, baseRoute: null, searched: false });
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  const [assistSub, setAssistSub] = useState<'home' | 'lf' | 'emergency'>('home');
  const viewRef = useRef(view); viewRef.current = view;

  const go = useCallback((d: Dest) => {
    if (viewRef.current !== 'home' || tm.active) return; // no double triggers
    const ok = tm.start('forward', d === 'map' ? 'map' : d === 'alerts' ? 'alerts' : 'planner', {
      onSwap: () => { setContent(d); setHubVisible(false); },
      onDone: () => { setView(viewFor(d, true)); setSelected(null); },
    });
    if (ok) { setSelected(d); setView(viewFor(d, false)); }
  }, [tm]);

  const goHome = useCallback(() => {
    const v = viewRef.current; if (isBusy(v) || v === 'home' || tm.active) return;
    const startZ = v === 'coming-soon-4' ? HOLD_Z : -150;  // 'coming-soon-4' is retained in the view type only for the transition tests
    const ok = tm.start('return', 'planner', { onSwap: () => setHubVisible(true), onDone: () => setView('home') }, startZ);
    if (ok) { setContent(null); setView('returning-home'); }
  }, [tm]);

  /** Feature -> feature (e.g. planner "View on Network Map"): a short warp through the tunnel. */
  const lateral = useCallback((d: Dest) => {
    const v = viewRef.current; if (isBusy(v) || v === 'home' || tm.active) return;
    const ok = tm.start('warp', d === 'map' ? 'map' : d === 'alerts' ? 'alerts' : 'planner', { onSwap: () => setContent(d), onDone: () => { setView(viewFor(d, true)); setSelected(null); } });
    if (ok) { setSelected(d); setView(viewFor(d, false)); setContent(null); }
  }, [tm]);

  const patch = (p: Partial<PlannerState>) => setPlanner(s => ({ ...s, ...p, route: null, baseRoute: null, searched: false }));
  const live = useLive(); const restrRef = useRef(live.restrictions); restrRef.current = live.restrictions;
  const search = useCallback(() => setPlanner(s => {
    if (!s.origin || !s.destination || s.origin === s.destination) return { ...s, route: null, baseRoute: null, searched: true };
    const when = s.when ?? new Date(); const r = restrRef.current;   // verified closures feed the SAME Dijkstra; baseRoute = what the route would be without them
    return { ...s, route: findRoute(metroData(), s.origin, s.destination, s.pref, when, r), baseRoute: hasRestrictions(r) ? findRoute(metroData(), s.origin, s.destination, s.pref, when) : null, searched: true };
  }), []);
  const plannerSearched = planner.searched;
  useEffect(() => { if (plannerSearched) search(); }, [live.restrictionKey]); // eslint-disable-line react-hooks/exhaustive-deps  (re-route automatically when closures change)
  const settledMode: Ctx['settledMode'] = view === 'home' ? 'hub' : view === 'coming-soon-4' ? 'hold' : view === 'planner' || view === 'map' || view === 'alerts' || view === 'guide' || view === 'assist' ? 'off' : 'transition';

  const value = useMemo<Ctx>(() => ({
    view, content, hubVisible, selected, tm, planner, mapSelected, mapRouteVisible: !!planner.route, assistSub, setAssistSub, go, goHome, lateral, settledMode,
    setOrigin: id => patch({ origin: id }),
    setDestination: id => patch({ destination: id }),
    swap: () => patch({ origin: planner.destination, destination: planner.origin }),
    setPref: pref => patch({ pref }),
    setWhen: when => patch({ when }),
    search, setMapSelected,
  }), [view, content, hubVisible, selected, tm, planner, mapSelected, assistSub, go, goHome, lateral, settledMode, search]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
import { metro } from '../engine';
const metroData = () => metro;
