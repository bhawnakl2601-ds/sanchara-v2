import { lazy, Suspense, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AppProvider, useApp } from './app/state';
import { Stage } from './three/Stage';
import type { TrainScene } from './three/TrainScene';
import { Hub } from './ui/Hub';
const Planner = lazy(() => import('./ui/Planner').then(m => ({ default: m.Planner })));
const MapView = lazy(() => import('./ui/MapView').then(m => ({ default: m.MapView })));
const PassengerAssistance = lazy(() => import('./assist/PassengerAssistance').then(m => ({ default: m.PassengerAssistance })));
const MetroGuide = lazy(() => import('./guide/MetroGuide').then(m => ({ default: m.MetroGuide })));
const SmartAlerts = lazy(() => import('./alerts/SmartAlerts').then(m => ({ default: m.SmartAlerts })));
import { LiveProvider } from './live/LiveProvider';
import { CityBackdrop } from './ui/CityBackdrop';
import { A11yControl } from './a11y/A11y';

function Shell() {
  const { content } = useApp();
  const sceneRef = useRef<TrainScene | null>(null);
  const slotRect = useRef<DOMRect | null>(null);
  const onSlot = useCallback((r: DOMRect) => { slotRect.current = r; sceneRef.current?.setAnchor(r); }, []);
  return (
    <>
      <CityBackdrop />
      <Stage sceneRef={sceneRef} slotRect={slotRect} />
      <Hub onSlot={onSlot} />
      <Suspense fallback={null}><AnimatePresence>
        {content === 'planner' && <Planner key="planner" />}
        {content === 'map' && <MapView key="map" />}
        {content === 'alerts' && <SmartAlerts key="alerts" />}
        {content === 'guide' && <MetroGuide key="guide" />}
        {content === 'assist' && <PassengerAssistance key="assist" />}
      </AnimatePresence></Suspense>
      <A11yControl />
    </>
  );
}
export function App() { return <LiveProvider><AppProvider><Shell /></AppProvider></LiveProvider>; }
