import { useEffect, useRef, type MutableRefObject } from 'react';
import { TrainScene } from './TrainScene';
import { useApp } from '../app/state';

/** Keeps ONE canvas + ONE scene + ONE render loop mounted for the whole session. */
export function Stage({ sceneRef, slotRect }: { sceneRef: MutableRefObject<TrainScene | null>; slotRect: MutableRefObject<DOMRect | null> }) {
  const { tm, settledMode } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null); const flash = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let scene: TrainScene;
    try { scene = new TrainScene(canvas.current!, tm); }
    catch (e) {
      // No WebGL (or the context was refused): keep the app fully usable. The transition manager is still driven so every page opens and closes normally, just without the 3D shot.
      console.warn('[SANCHARA] WebGL unavailable, running without the 3D scene', e);
      document.documentElement.dataset.nowebgl = '1'; let raf = 0, last = performance.now();
      const tick = (t: number) => { tm.update(Math.min(64, t - last)); last = t; raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(raf); delete document.documentElement.dataset.nowebgl; };
    }
    scene.onFrameUi = u => { if (flash.current) flash.current.style.opacity = String(u.flash * 0.45); if (canvas.current) canvas.current.style.opacity = String(u.canvasOpacity); };
    if (slotRect.current) scene.setAnchor(slotRect.current);
    sceneRef.current = scene; scene.setMode('hub');
    if (import.meta.env?.DEV) (window as unknown as { __scene?: TrainScene }).__scene = scene; // dev/test hook
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [tm, sceneRef, slotRect]);
  useEffect(() => { sceneRef.current?.setMode(settledMode); }, [settledMode, sceneRef]);
  return (
    <div className="stage" aria-hidden>
      <canvas ref={canvas} />
      <div ref={flash} className="flash" />
    </div>
  );
}
