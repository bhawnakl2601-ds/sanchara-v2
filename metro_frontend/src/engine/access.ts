import type { MetroData, Route } from './types';
import records from '../data/accessibility.json';

export type AccessConfidence = 'verified' | 'partially_verified' | 'unverified' | 'unavailable';
export interface AccessRecord {
  confidence: AccessConfidence;
  lifts: boolean | null; escalators: boolean | null; stepFreeEntrance: boolean | null;
  accessibleToilet: boolean | null; tactilePaving: boolean | null; audioAssistance: boolean | null;
  source: string; verifiedOn: string | null;
}
const UNKNOWN: AccessRecord = { confidence: 'unverified', lifts: null, escalators: null, stepFreeEntrance: null, accessibleToilet: null, tactilePaving: null, audioAssistance: null, source: 'Dataset station-level wheelchair flag only (not facility-verified)', verifiedOn: null };
const FILE = (records as { stations: Record<string, Partial<AccessRecord>> }).stations;

/** Facility-level record for a station. A bare `wheelchair: true` flag is never promoted to "verified". */
export function accessOf(id: string, outages: string[] = []): AccessRecord {
  const r = { ...UNKNOWN, ...(FILE[id] ?? {}) } as AccessRecord;
  if (outages.includes(id)) return { ...r, confidence: 'unavailable', lifts: false, source: 'Active lift/step-free outage reported' };
  return r;
}
export const confidenceLabel: Record<AccessConfidence, string> = { verified: 'Verified', partially_verified: 'Partially verified', unverified: 'Unverified', unavailable: 'Temporarily unavailable' };

export interface RouteAccessibility {
  overall: AccessConfidence; verifiedStations: string[]; partialStations: string[]; unverifiedStations: string[]; reasons: string[];
}
/** Why a route is (or is not) considered step-free, with the uncertainty spelled out. */
export function assessRoute(_data: MetroData, route: Route, outages: string[] = []): RouteAccessibility {
  const v: string[] = [], p: string[] = [], u: string[] = [];
  for (const s of new Set(route.sequence)) { const c = accessOf(s, outages).confidence; (c === 'verified' ? v : c === 'partially_verified' ? p : u).push(s); }
  const overall: AccessConfidence = u.length ? 'unverified' : p.length ? 'partially_verified' : 'verified';
  const reasons = ['Every station on this route is flagged wheelchair-accessible in the dataset.'];
  if (u.length) reasons.push(`Facility-level data (lifts, step-free entrances, interchange paths) is not verified for ${u.length} of ${v.length + p.length + u.length} stations, so step-free travel is NOT guaranteed. Confirm with station staff.`);
  if (route.transfers.length) reasons.push('Interchange walking paths have no verified step-free data.');
  return { overall, verifiedStations: v, partialStations: p, unverifiedStations: u, reasons };
}
