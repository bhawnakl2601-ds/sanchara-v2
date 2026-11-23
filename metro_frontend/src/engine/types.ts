export type LineId = string;
export interface Segment { from: string; to: string; km: number; sec: number }
export interface MetroLine {
  id: LineId; name: string; longName: string; color: string; textColor: string;
  stations: string[]; segments: Segment[]; dwellSec: number;
  headwaySec: { peak: number | null; offpeak: number | null };
  geometry: [number, number][];
}
export interface Station {
  id: string; code: string; name: string; kn: string; lat: number; lon: number;
  lines: LineId[]; interchange: boolean; wheelchair: boolean; aliases: string[];
}
export interface MetroData {
  generatedFrom: string;
  lines: Record<LineId, MetroLine>;
  stations: Record<string, Station>;
  transferSeconds: Record<string, number>;
  fares: Record<string, Record<string, number>>;
  holidays: string[];
}
export type RoutePreference = 'fastest' | 'fewest-changes' | 'accessible';
export interface RouteStop { stationId: string; lineId: LineId }
export interface RouteLeg {
  lineId: LineId; from: string; to: string; stops: string[]; // inclusive of from & to
  km: number; rideSec: number; stationsTravelled: number;
}
export interface Transfer { stationId: string; fromLine: LineId; toLine: LineId; walkSec: number; waitSec: number }
export interface Route {
  origin: string; destination: string; preference: RoutePreference;
  legs: RouteLeg[]; transfers: Transfer[];
  totalKm: number; rideSec: number; transferSec: number; totalSec: number;
  stationCount: number; // stations travelled, excluding origin
  lineChanges: number; sequence: string[]; // every station in order
  boardingLine: LineId; finalLine: LineId; boardingWaitSec: number;
}
export interface FareOption { media: 'token' | 'qr' | 'smartcard'; label: string; amount: number; note: string }
export interface FareResult {
  slabStations: number; base: number; period: 'peak' | 'offpeak' | 'sunday-holiday';
  smartDiscountPct: number; options: FareOption[]; touristPasses: { label: string; amount: number }[];
  chartDate: string; notes: string[]; sameStation: boolean;
}

/** Operational restrictions published by the Smart Alerts backend (verified, currently active closures only). */
export interface Restrictions {
  closedStations: { id: string; passThrough: boolean; closureId?: number }[];   // cannot board / alight / transfer; trains may still run through if passThrough
  closedSegments: { line: LineId; from: string; to: string; closureId?: number }[];
  suspendedLines: { line: LineId; closureId?: number }[];
  partialLines: { line: LineId; from: string; to: string; closureId?: number }[];  // only from..to operates
  noTransfer: { id: string; closureId?: number }[];
  liftOutages?: { id: string; closureId?: number }[];   // stations whose step-free access is temporarily unavailable (affects accessible routing only)
  closureIds?: number[];
}
export const NO_RESTRICTIONS: Restrictions = { closedStations: [], closedSegments: [], suspendedLines: [], partialLines: [], noTransfer: [] };
export const hasRestrictions = (r?: Restrictions | null) => !!r && ((r.liftOutages?.length ?? 0) + r.closedStations.length + r.closedSegments.length + r.suspendedLines.length + r.partialLines.length + r.noTransfer.length) > 0;
