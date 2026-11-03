/**
 * Turkey's national air quality index (Ulusal Hava Kalitesi İndeksi, havaizleme.gov.tr) for the
 * particle fraction it covers: PM10, on its 24-hour mean. PM2.5 is not part of the Turkish index and
 * has no national limit value, so it is shown as a concentration, never as a Turkish band. The band
 * names are the ministry's own; the colours are ours (tokens), never the ministry's palette.
 *
 * Breakpoints 50/100/260/400/520 µg/m³: from a secondary source (Environmental Systems Research 2023,
 * table 6), matching the regulation's PM10 alert levels 260/400/520; see `rulebooks/tr.json`.
 * Pure, so the bands are tested (tests/tr-index.test.ts).
 */

import type { Band } from "./site";

export interface TrBand {
  label: string;
  lo: number;
  hi: number;
  band: Band;
}

/** Index ranges and their names, in order. */
export const TR_BANDS: TrBand[] = [
  { label: "İyi", lo: 0, hi: 50, band: "excellent" },
  { label: "Orta", lo: 51, hi: 100, band: "good" },
  { label: "Hassas", lo: 101, hi: 150, band: "fair" },
  { label: "Sağlıksız", lo: 151, hi: 200, band: "poor" },
  { label: "Kötü", lo: 201, hi: 300, band: "bad" },
  { label: "Tehlikeli", lo: 301, hi: 500, band: "bad" },
];

/** Concentration breakpoints, µg/m³ (24-hour mean), one row per band above. */
export const PM10_BP: [number, number][] = [
  [0, 50],
  [51, 100],
  [101, 260],
  [261, 400],
  [401, 520],
  [521, 620],
];

function sub(c: number, bp: [number, number][]): number {
  const v = Math.max(0, c);
  for (let i = 0; i < bp.length; i++) {
    const [clo, chi] = bp[i]!;
    const { lo, hi } = TR_BANDS[i]!;
    if (v <= chi || i === bp.length - 1) {
      const x = Math.min(v, chi);
      return Math.round(((hi - lo) / (chi - clo)) * (Math.max(x, clo) - clo) + lo);
    }
  }
  return 500;
}

/** The index and its band from the PM10 24-hour mean; null without one. */
export function trIndex(pm10_24h: number | undefined): { index: number; label: string; band: Band } | null {
  if (pm10_24h === undefined) return null;
  const index = sub(pm10_24h, PM10_BP);
  const band = TR_BANDS.find((x) => index <= x.hi) ?? TR_BANDS.at(-1)!;
  return { index, label: band.label, band: band.band };
}
