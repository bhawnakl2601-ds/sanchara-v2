import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, get, tokenStore, ApiDown, API_URL } from '../api/client';
import { NO_RESTRICTIONS, hasRestrictions, type Restrictions } from '../engine';

export interface Alert { id: number; category: string; title: string; description?: string; line_id?: string; delay_minutes?: number | null; delay_level?: string | null; reason?: string; start_at: string; expected_end_at?: string | null; last_updated_at: string;
  verification_status: string; status: string; stations: string[]; station_names: string[]; segments: { line_id: string; from_station: string; to_station: string }[]; source_label?: string; source_url?: string; stale_warning?: string; closure_id?: number | null }
export interface Feed { live_connected: boolean; message: string | null }
export interface User { id: number; email: string; role: 'passenger' | 'admin'; display_name?: string }
interface Live {
  online: boolean; restrictions: Restrictions; alerts: Alert[]; feed: Feed | null; user: User | null; unread: number; lastSync: Date | null;
  refresh: () => Promise<void>; login: (email: string, password: string) => Promise<void>; register: (email: string, password: string) => Promise<void>; logout: () => void;
  alertStations: Map<string, Alert[]>; restrictionKey: string;
}
const Ctx = createContext<Live | null>(null);
export const useLive = () => { const c = useContext(Ctx); if (!c) throw new Error('useLive outside provider'); return c; };

/** Polls the backend for verified alerts + the active-closure restriction set that the route engine consumes. If the server is down the app keeps working with no restrictions and says so. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(false); const [restrictions, setR] = useState<Restrictions>(NO_RESTRICTIONS); const [alerts, setAlerts] = useState<Alert[]>([]);
  const [feed, setFeed] = useState<Feed | null>(null); const [user, setUser] = useState<User | null>(null); const [unread, setUnread] = useState(0); const [lastSync, setSync] = useState<Date | null>(null);
  const keyRef = useRef('');
  const refresh = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([get<Restrictions>('/api/routes/restrictions'), get<{ alerts: Alert[]; feed: Feed }>('/api/alerts/active')]);
      const k = JSON.stringify(r); if (k !== keyRef.current) { keyRef.current = k; setR(hasRestrictions(r) ? r : NO_RESTRICTIONS); }
      setAlerts(a.alerts); setFeed(a.feed); setOnline(true); setSync(new Date());
      if (tokenStore.get()) { try { const n = await get<{ unread: number }>('/api/notifications'); setUnread(n.unread); } catch { /* auth expired handled below */ } }
    } catch (e) { setOnline(false); if (!(e instanceof ApiDown)) console.warn(e); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); const vis = () => document.visibilityState === 'visible' && refresh(); document.addEventListener('visibilitychange', vis); return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); }; }, [refresh]);
  useEffect(() => { if (tokenStore.get()) get<User>('/api/auth/me').then(setUser).catch(() => { tokenStore.set(null); }); }, []);
  // realtime: Server-Sent Events from the stdlib server / WebSocket from FastAPI; polling above remains the fallback
  useEffect(() => {
    const tok = tokenStore.get(); if (!user || !tok) return; let es: EventSource | null = null;
    try { es = new EventSource(API_URL + '/api/stream?token=' + encodeURIComponent(tok)); es.onmessage = () => refresh(); } catch { /* polling only */ }   // the merged Flask server streams over SSE (no WebSocket)
    return () => { es?.close(); };
  }, [user, refresh]);
  const auth = useCallback(async (path: string, email: string, password: string) => { const d = await api<{ token: string; user: User }>('POST', path, { email, password }, { token: null }); tokenStore.set(d.token); setUser(d.user); refresh(); }, [refresh]);
  const value = useMemo<Live>(() => {
    const m = new Map<string, Alert[]>(); for (const a of alerts) for (const s of a.stations) m.set(s, [...(m.get(s) ?? []), a]);
    return { online, restrictions, alerts, feed, user, unread, lastSync, refresh, login: (e, p) => auth('/api/auth/login', e, p), register: (e, p) => auth('/api/auth/register', e, p), logout: () => { tokenStore.set(null); setUser(null); setUnread(0); }, alertStations: m, restrictionKey: JSON.stringify(restrictions) };
  }, [online, restrictions, alerts, feed, user, unread, lastSync, refresh, auth]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
