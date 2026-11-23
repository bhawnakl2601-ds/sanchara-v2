import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errText, fmtIST } from '../api/client';
import { metro } from '../engine';

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true); const seq = useRef(0);
  const run = useCallback(() => { const my = ++seq.current; setLoading(true); fn().then(d => { if (my === seq.current) { setData(d); setError(null); } }).catch(e => { if (my === seq.current) setError(errText(e)); }).finally(() => { if (my === seq.current) setLoading(false); }); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(run, [run]); return { data, error, loading, reload: run };
}
export const Err = ({ msg }: { msg: string | null }) => msg ? <p className="msg sa-err" role="alert">{msg}</p> : null;
export const Loading = ({ what = 'Loading' }: { what?: string }) => <p className="fine" aria-live="polite">{what}…</p>;
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => <div className="panel sa-empty"><h3>{title}</h3>{children && <p className="fine">{children}</p>}</div>;
export const LineDot = ({ id }: { id?: string | null }) => id && metro.lines[id] ? <span className="sa-line"><i style={{ background: metro.lines[id].color }} />{metro.lines[id].name}</span> : null;
export const stName = (id: string) => metro.stations[id]?.name.replace('Nadaprabhu Kempegowda Station, Majestic', 'Majestic') ?? id;
export const LEVEL_CLASS: Record<string, string> = { LOW: 'lv0', MODERATE: 'lv1', HIGH: 'lv2', 'VERY HIGH': 'lv3' };
export const Level = ({ v }: { v?: string | null }) => v ? <span className={`sa-level ${LEVEL_CLASS[v]}`}>{v}</span> : <span className="sa-level">n/a</span>;
export const VerifyBadge = ({ v }: { v: string }) => <span className={`sa-badge ${v === 'UNVERIFIED' ? 'warn' : 'ok'}`}>{v === 'OFFICIAL_FEED' ? 'Official feed' : v === 'VERIFIED' ? 'Verified' : v === 'MODEL_ESTIMATE' ? 'AI estimate' : v === 'ADMIN' ? 'Admin' : 'Unverified'}</span>;
export const StatusBadge = ({ s }: { s: string }) => <span className={`sa-badge st-${s.toLowerCase()}`}>{s.replace(/_/g, ' ')}</span>;
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <label className="sa-field"><span>{label}{hint && <small> {hint}</small>}</span>{children}</label>;
export const Time = ({ iso }: { iso?: string | null }) => <time dateTime={iso ?? undefined}>{fmtIST(iso)}</time>;
export const tel = (n: string) => 'tel:' + n.replace(/[^\d+]/g, '');
export function Busy({ on, children }: { on: boolean; children: ReactNode }) { return <span className="sa-busy" aria-busy={on}>{children}</span>; }

/** Run an async action with pending/error/ok state for forms and buttons. */
export function useAction() {
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => { setPending(true); setError(null); setOk(null); try { const r = await fn(); if (okMsg) setOk(okMsg); return r; } catch (e) { setError(errText(e)); } finally { setPending(false); } }, []);
  return { pending, error, ok, run, clear: () => { setError(null); setOk(null); } };
}
export const fileToB64 = (f: File): Promise<string> => new Promise((res, rej) => { if (f.size > 2 * 1024 * 1024) return rej(new Error('Image is larger than 2 MB')); if (!/^image\/(jpeg|png)$/.test(f.type)) return rej(new Error('Only JPEG or PNG images are accepted')); const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(f); });
