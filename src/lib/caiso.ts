/**
 * CAISO Today's Outlook, read as carbon intensity.
 *
 * Two 5-minute CSV files a day: `co2.csv` (metric tons of CO2 per hour by source: natural gas, imports,
 * biogas, biomass, geothermal, coal; imports count in, exports out as a negative) and `demand.csv`
 * (MW; "Current demand" is filled up to now, the forecast columns for the whole day). Intensity is
 * Σ CO2 ÷ demand × 1000 = g CO2 per kWh, the same arithmetic GridLight documents. Pure functions,
 * no network: the cron in `grid-co2.ts` fetches, this file computes, the tests use a fixture.
 */

import { median } from "./stats";

export interface IntensityRow {
  /** "HH:MM", Pacific. */
  time: string;
  g_per_kwh: number;
}

export interface HourMean {
  hour: number;
  g_per_kwh: number;
  samples: number;
}

/** A CSV with a header row and no quoting, as CAISO writes it. Empty cells come back as "". */
function table(csv: string): Record<string, string>[] {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const cols = (head ?? "").split(",").map((c) => c.trim());
  return rows
    .filter((r) => r.trim() !== "")
    .map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i] ?? `col${i}`, v.trim()])));
}

/**
 * Join the two files on their time stamp. A row without a demand figure (the hours still to come, a
 * stray non-number) or without a CO2 row is dropped, not zeroed; the first row for a time stamp wins,
 * since the demand file closes with a "00:00" that belongs to tomorrow.
 */
export function parseOutlook(co2Csv: string, demandCsv: string): IntensityRow[] {
  const demand = new Map<string, number>();
  for (const r of table(demandCsv)) {
    const t = r.Time ?? "";
    if (!/^\d{2}:\d{2}$/.test(t) || demand.has(t)) continue;
    const mw = Number(r["Current demand"]);
    if (r["Current demand"] !== "" && Number.isFinite(mw) && mw > 0) demand.set(t, mw);
  }
  const out: IntensityRow[] = [];
  const seen = new Set<string>();
  for (const r of table(co2Csv)) {
    const t = r.Time ?? "";
    const mw = demand.get(t);
    if (mw === undefined || seen.has(t)) continue;
    seen.add(t);
    let tons = 0;
    let any = false;
    for (const [k, v] of Object.entries(r)) {
      if (k === "Time" || v === "") continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      tons += n;
      any = true;
    }
    if (!any) continue;
    out.push({ time: t, g_per_kwh: (tons / mw) * 1000 });
  }
  return out;
}

/** The mean intensity of each hour that has at least one row, with how many rows it rests on. */
export function hourlyMeans(rows: IntensityRow[]): HourMean[] {
  const acc = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    const hour = Number(r.time.slice(0, 2));
    const a = acc.get(hour) ?? { sum: 0, n: 0 };
    a.sum += r.g_per_kwh;
    a.n += 1;
    acc.set(hour, a);
  }
  return [...acc]
    .map(([hour, a]) => ({ hour, g_per_kwh: Math.round((a.sum / a.n) * 10) / 10, samples: a.n }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * The typical value of each hour across days: the median, so one unusual day (a heat wave, an
 * outage) does not become next week's expectation. Whole grams; hours no day has are absent.
 */
export function medianByHour(rows: { hour: number; g_per_kwh: number }[]): Record<string, number> {
  const byHour = new Map<number, number[]>();
  for (const r of rows) {
    let vals = byHour.get(r.hour);
    if (!vals) byHour.set(r.hour, (vals = []));
    vals.push(r.g_per_kwh);
  }
  const out: Record<string, number> = {};
  for (const [hour, vals] of [...byHour].sort((a, b) => a[0] - b[0])) out[String(hour).padStart(2, "0")] = Math.round(median(vals));
  return out;
}
