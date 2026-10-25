/**
 * The grid's carbon, kept and served.
 *
 * Every 30 minutes the Worker's cron (src/worker.ts) reads CAISO Today's Outlook for today, turns the
 * 5-minute rows into hourly g CO2/kWh (`caiso.ts`) and writes them to `grid_co2`; days the table lacks
 * among the last seven are filled from CAISO's history files, a few per run, so a fresh table is whole
 * within a couple of hours. Fourteen days are kept.
 *
 * The plan reads it as "typical g/kWh at this hour": the median of the last seven days for each hour,
 * said as such on the page and in the JSON. It is a pattern, not a forecast; CAISO publishes no hourly
 * carbon forecast, and a day-ahead one would be a model, which this is not.
 */

import { hourlyMeans, medianByHour, parseOutlook } from "./caiso";
import { getGridCo2Recent, listGridCo2Days, pruneGridCo2, upsertGridCo2 } from "./db";

const OUTLOOK = "https://www.caiso.com/outlook";
/** CAISO answers a bare fetch today; the browser string is there in case that changes, as GridLight found it needed. */
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "text/csv,*/*" };
const KEEP_DAYS = 14;
const TYPICAL_DAYS = 7;
/** History days fetched per run: two files each, and a Worker has a subrequest budget. */
const BACKFILL_PER_RUN = 3;

const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
const pacificDay = (d: Date) => PACIFIC_DAY.format(d);
const shift = (day: string, days: number) => pacificDay(new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000));

async function csv(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) }).catch((e: Error) => {
    throw new Error(`${url}: ${e.message}`);
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith("Time,")) throw new Error(`${url}: not a CAISO CSV`);
  return text;
}

/** Names the step a failure happened in, so the cron's one log line says where to look. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(`${name}: ${(e as Error).message}`);
  }
}

/** One day's hourly means from the pair of files at `base` (…/current or …/history/YYYYMMDD). */
async function dayMeans(base: string) {
  const [co2, demand] = await Promise.all([csv(`${base}/co2.csv`), csv(`${base}/demand.csv`)]);
  return hourlyMeans(parseOutlook(co2, demand));
}

/** The cron's work: today, then up to three missing recent days, then retention. Returns what it wrote. */
export async function refreshGridCo2(now = new Date()): Promise<{ today: string; hours: number; backfilled: string[] }> {
  const today = pacificDay(now);
  const means = await step("fetch today", () => dayMeans(`${OUTLOOK}/current`));
  await step("write today", () => upsertGridCo2(today, means));
  const have = new Set(await step("list days", listGridCo2Days));
  const missing = Array.from({ length: TYPICAL_DAYS }, (_, i) => shift(today, -(i + 1))).filter((d) => !have.has(d));
  const backfilled: string[] = [];
  for (const day of missing.slice(0, BACKFILL_PER_RUN)) {
    const rows = await dayMeans(`${OUTLOOK}/history/${day.replace(/-/g, "")}`).catch((e: Error) => {
      console.warn(`grid_co2: ${day} not backfilled: ${e.message}`);
      return [];
    });
    if (rows.length === 0) continue;
    await step(`write ${day}`, () => upsertGridCo2(day, rows));
    backfilled.push(day);
  }
  await step("prune", () => pruneGridCo2(today, KEEP_DAYS));
  return { today, hours: means.length, backfilled };
}

/** What `/api/crew` carries for a California place. */
export interface GridCo2 {
  /** "00".."23" → g CO2 per kWh. Hours no stored day has are absent. */
  g_per_kwh: Record<string, number>;
  /** How many days the median rests on; fewer than seven while the table is young. */
  days: number;
  basis: string;
  source: string;
}

/** The typical hour from what the cron has stored; `null` until the first run has written something. */
export async function typicalGridCo2(today: string): Promise<GridCo2 | null> {
  const rows = await getGridCo2Recent(today, TYPICAL_DAYS);
  if (rows.length === 0) return null;
  const days = new Set(rows.map((r) => r.day)).size;
  return {
    g_per_kwh: medianByHour(rows),
    days,
    basis: `median of the last ${days} day${days === 1 ? "" : "s"} for that hour, not a forecast`,
    source: "CAISO Today's Outlook (co2.csv, demand.csv): Σ CO2 t/h ÷ demand MW × 1000",
  };
}
