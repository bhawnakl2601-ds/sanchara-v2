/** Accessibility settings + text-to-speech. A tiny external store (no extra dependencies) so the 3D scene and React can both read it. */
export interface A11ySettings {
  contrast: boolean;       // high-contrast theme
  textSize: 100 | 125 | 150;
  plainFont: boolean;      // plain, widely-installed sans font with roomier spacing
  reduceMotion: boolean;   // user override; the OS "reduce motion" setting is always honoured as well
  readHover: boolean;      // speak text a desktop mouse pointer rests on (OFF by default; user must switch it on)
  rate: number;            // fixed speech rate (no UI control)
}
export const DEFAULTS: A11ySettings = { contrast: false, textSize: 100, plainFont: false, reduceMotion: false, readHover: false, rate: 1 };
const KEY = 'sanchara.a11y.v3';   // bumped so earlier saved "read on hover = on" can never switch speech on by itself

let state: A11ySettings = load();
const subs = new Set<() => void>();
let ttsState = { speaking: false, paused: false };
let ttsSnap = ttsState;

function load(): A11ySettings {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* storage may be blocked */ }
  try { if (window.matchMedia('(prefers-contrast: more)').matches) return { ...DEFAULTS, contrast: true }; } catch { /* ignore */ }
  return { ...DEFAULTS };
}
const emit = () => subs.forEach(f => f());
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getSettings = () => state;
export const getTts = () => ttsSnap;
export function setSettings(p: Partial<A11ySettings>) {
  state = { ...state, ...p }; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  apply(); emit();
}
export const resetSettings = () => { stopSpeech(); setSettings({ ...DEFAULTS, contrast: false }); };

/** True when motion should be minimised: the user's switch OR the operating-system preference. Read every frame by the 3D scene. */
export function isReducedMotion(): boolean {
  if (state.reduceMotion) return true;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function apply() {
  const r = document.documentElement;
  r.dataset.contrast = state.contrast ? 'high' : 'normal';
  r.dataset.text = String(state.textSize);
  r.style.setProperty('--ts', String(state.textSize / 100));
  r.dataset.font = state.plainFont ? 'plain' : 'brand';
  r.dataset.motion = isReducedMotion() ? 'reduce' : 'full';
}

// ───────────────────────── text to speech (Web Speech API; works offline with the device's own voices) ─────────────────────────
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const setTts = (p: Partial<typeof ttsState>) => { ttsState = { ...ttsState, ...p }; ttsSnap = ttsState; emit(); };
let queueId = 0;

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis.getVoices(); const base = lang.split('-')[0];
  return vs.find(v => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()) ?? vs.find(v => v.lang.toLowerCase().startsWith(base));
}
/** Split into short chunks: some browsers silently stop long utterances, and short ones let Stop/Pause respond quickly. */
export function chunk(text: string, max = 170): string[] {
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim(); if (!clean) return [];
  const parts = clean.split(/(?<=[.!?।])\s+|\n+/).map(s => s.trim()).filter(Boolean); const out: string[] = [];
  for (const p of parts) { if (p.length <= max) { out.push(p); continue; } let cur = ''; for (const w of p.split(' ')) { if ((cur + ' ' + w).trim().length > max) { out.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) out.push(cur.trim()); }
  return out;
}
export function stopSpeech() { queueId++; if (ttsSupported()) window.speechSynthesis.cancel(); setTts({ speaking: false, paused: false }); }
export function pauseSpeech() { if (ttsSupported() && ttsState.speaking) { window.speechSynthesis.pause(); setTts({ paused: true }); } }
export function resumeSpeech() { if (ttsSupported()) { window.speechSynthesis.resume(); setTts({ paused: false }); } }
export function speak(text: string, opts: { lang?: string } = {}) {
  if (!ttsSupported()) return false; const parts = chunk(text); if (!parts.length) return false;
  window.speechSynthesis.cancel(); const id = ++queueId; setTts({ speaking: true, paused: false });
  const lang = opts.lang ?? (document.documentElement.lang || 'en-IN'); const voice = pickVoice(lang) ?? pickVoice('en');
  parts.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t); u.lang = voice?.lang ?? lang; if (voice) u.voice = voice; u.rate = state.rate;
    u.onend = () => { if (id === queueId && i === parts.length - 1) setTts({ speaking: false, paused: false }); };
    u.onerror = () => { if (id === queueId) setTts({ speaking: false, paused: false }); };
    window.speechSynthesis.speak(u);
  });
  return true;
}

/** Text of whatever the user is looking at: the open feature page, otherwise the hub. */
export function pageText(): string {
  const el = (document.querySelector('.feature') as HTMLElement | null) ?? (document.querySelector('.hub') as HTMLElement | null) ?? document.body;
  const clone = el.cloneNode(true) as HTMLElement; clone.querySelectorAll('[aria-hidden="true"], script, style, svg, .a11y-root, canvas').forEach(n => n.remove());
  // innerText of a detached node ignores layout, so rebuild line breaks from block elements
  clone.querySelectorAll('h1,h2,h3,h4,p,li,tr,dt,dd,label,button,summary,section,header,div').forEach(n => n.append(document.createTextNode(/^(H\d|P|LI|TR)$/.test(n.tagName) ? '.\n' : '\n')));
  return (clone.textContent ?? '').replace(/ /g, ' ').replace(/\s*\.\s*\.\s*/g, '. ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
export function readPage() { return speak(pageText()); }
export function readSelection() { const t = window.getSelection()?.toString().trim(); return t ? speak(t) : false; }

/** Human label for an element, used by "read on focus / hover". */
export function labelOf(el: Element): string {
  const h = el as HTMLElement; const aria = h.getAttribute('aria-label'); if (aria) return aria;
  const by = h.getAttribute('aria-labelledby'); if (by) { const t = by.split(' ').map(i => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t; }
  if (h instanceof HTMLInputElement || h instanceof HTMLSelectElement || h instanceof HTMLTextAreaElement) {
    const lab = h.id ? document.querySelector(`label[for="${CSS.escape(h.id)}"]`)?.textContent : h.closest('label')?.textContent;
    const kind = h instanceof HTMLSelectElement ? 'list' : h.type === 'range' ? 'slider' : h.type === 'checkbox' ? 'checkbox' : 'field';
    const val = h instanceof HTMLSelectElement ? h.selectedOptions[0]?.textContent : h.value; return `${(lab ?? ('placeholder' in h ? h.placeholder : '') ?? '').trim()}, ${kind}${val ? ', ' + val : ''}`;
  }
  const t = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim(); const role = h.tagName === 'BUTTON' || h.getAttribute('role') === 'button' ? ', button' : h.tagName === 'A' ? ', link' : '';
  return t ? t.slice(0, 300) + role : h.getAttribute('title') ?? '';
}
