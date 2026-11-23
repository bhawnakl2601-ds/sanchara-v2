/**
 * Single source of truth for fare rules. No fare number should be hardcoded anywhere else in the app.
 * Per-journey base fares come from src/data/metro.json (`fares`, BMRCL station-to-station chart); this file holds the slab table,
 * discount rules and passes, plus where each value came from and when it was last checked.
 */
export const FARE_CONFIG = {
  chartDate: '14 Feb 2025',
  verification: {
    status: 'chart-in-app-is-last-confirmed-chart; a newer revision is unconfirmed',
    lastCheckedOn: '2026-11-16',
    checkedVia: 'Press reports (secondary sources), not a BMRCL notification',
    note: 'A 5% annual revision (e.g. 10→11, 20→21, 90→95) was announced for 9 Feb 2026 and then reported as put on hold. Whether it took effect could not be confirmed from an official BMRCL page, so the 14 Feb 2025 values are kept. Check bmrc.co.in before relying on fares.',
    officialSource: 'https://english.bmrc.co.in',
  },
  /** stations travelled (excluding the originating station) -> fare (₹). Upper bound inclusive. */
  slabs: [{ upTo: 2, fare: 10 }, { upTo: 4, fare: 20 }, { upTo: 6, fare: 30 }, { upTo: 8, fare: 40 }, { upTo: 10, fare: 50 }, { upTo: 15, fare: 60 }, { upTo: 20, fare: 70 }, { upTo: 25, fare: 80 }, { upTo: Infinity, fare: 90 }],
  sameStationFare: 10,
  /** Smart / NCMC card discount, percent, by period. */
  smartDiscountPct: { peak: 5, offpeak: 10, 'sunday-holiday': 10 },
  peakWindows: [[8, 12], [16, 21]] as [number, number][],
  /** [month0, day] of national holidays that get the Sunday-style discount. */
  nationalHolidays: [[0, 26], [7, 15], [9, 2]] as [number, number][],
  touristPasses: [
    { label: '1-day tourist card', amount: 300 },
    { label: '3-day tourist card', amount: 600 },
    { label: '5-day tourist card', amount: 800 },
  ],
  touristPassNote: 'Not independently verified: one secondary source lists the 5-day card as ₹900 (smart card). Confirm at a BMRCL counter.',
} as const;
export type FarePeriod = 'peak' | 'offpeak' | 'sunday-holiday';
