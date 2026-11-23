import type { FareResult, MetroData, Route } from './types';
import { FARE_CONFIG, type FarePeriod } from './fareConfig';
export const FARE_CHART_DATE = FARE_CONFIG.chartDate;
/** Slab fare for a number of stations travelled (excluding the originating station). */
export function slabFare(n: number): number {
  return (FARE_CONFIG.slabs.find(s => n <= s.upTo) ?? FARE_CONFIG.slabs[FARE_CONFIG.slabs.length - 1]).fare;
}
export function farePeriod(d: Date): FarePeriod {
  if (d.getDay() === 0 || FARE_CONFIG.nationalHolidays.some(([m, day]) => d.getMonth() === m && d.getDate() === day)) return 'sunday-holiday';
  const h = d.getHours() + d.getMinutes() / 60;
  return FARE_CONFIG.peakWindows.some(([a, b]) => h >= a && h < b) ? 'peak' : 'offpeak';
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export function baseFare(data: MetroData, a: string, b: string): number | null {
  if (a === b) return FARE_CONFIG.sameStationFare; // entry and exit at the same station
  const v = data.fares[a]?.[b]; return v === undefined ? null : v;
}
export function calculateFare(data: MetroData, route: Pick<Route, 'origin' | 'destination' | 'stationCount'>, when: Date = new Date()): FareResult | null {
  const base = baseFare(data, route.origin, route.destination);
  if (base === null) return null;
  const period = farePeriod(when);
  const pct = FARE_CONFIG.smartDiscountPct[period];
  const notes = [
    `Fare chart effective ${FARE_CHART_DATE}. Fares are by stations travelled, excluding the originating station.`,
    period === 'sunday-holiday' ? 'Sunday / national holiday: 10% smart-card discount all day.'
      : period === 'peak' ? 'Peak hours (8–12, 16–21, Mon–Sat): 5% smart-card discount.'
      : 'Non-peak hours (to 8, 12–16, after 21): 10% smart-card discount.',
  ];
  return {
    slabStations: route.stationCount, base, period, smartDiscountPct: pct, sameStation: route.origin === route.destination, chartDate: FARE_CHART_DATE, notes: [...notes, FARE_CONFIG.verification.note],
    options: [
      { media: 'token', label: 'Token', amount: base, note: 'Single-journey token' },
      { media: 'qr', label: 'QR ticket', amount: base, note: 'Same as token fare' },
      { media: 'smartcard', label: 'Smart / NCMC card', amount: r2(base * (1 - pct / 100)), note: `${pct}% discount applied` },
    ],
    touristPasses: FARE_CONFIG.touristPasses.map(t => ({ ...t })),
  };
}
