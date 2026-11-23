/** Thin client for the SANCHARA Smart Alerts backend. All failures are explicit: callers get `ApiDown` when the server is unreachable (never fake data). */
export const API_URL: string = (import.meta as any).env?.VITE_API_URL ?? '/metro-api';   // same website, same port: Flask forwards /metro-api/... to the metro engine
export class ApiError extends Error { constructor(public status: number, message: string, public data?: any) { super(message); } }
export class ApiDown extends Error { constructor() { super('Smart Alerts server is not reachable'); } }

const TOKEN_KEY = 'sanchara.token';
export const tokenStore = {
  get(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t: string | null) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};
export async function api<T = any>(method: string, path: string, body?: unknown, opts: { query?: Record<string, string | number | undefined>; token?: string | null } = {}): Promise<T> {
  const q = opts.query ? '?' + Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : '';
  const tok = opts.token === undefined ? tokenStore.get() : opts.token;
  let res: Response;
  try { res = await fetch(API_URL + path + q, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiDown(); }
  let data: any = null; try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`, data);
  return data as T;
}
export const get = <T = any>(p: string, query?: Record<string, string | number | undefined>) => api<T>('GET', p, undefined, { query });
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);
export const errText = (e: unknown) => e instanceof ApiDown ? 'The Smart Alerts server is not running. Start the SANCHARA server with: python run_server.py' : e instanceof Error ? e.message : String(e);
export const fmtIST = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST' : '—';
export const toIstInput = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
