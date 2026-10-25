/**
 * The grid's carbon, kept and served.
 *
 * Every 30 minutes the Worker's cron (src/worker.ts) reads CAISO Today's Outlook for today, turns the
 * 5-minute rows into hourly g CO2/kWh (`caiso.ts`) and writes the hours that can still change (the
 * current one and the one before) to `grid_co2`. Recent days the table lacks or holds incomplete are
 * filled from CAISO's history files, a few per run and in parallel; a day whose history file fails is
 * marked and retried a day later, not every half hour. Fourteen days are kept, pruned on the day's
 * first run.
 *
 * The plan reads it as "typical g/kWh at this hour": the median of the last seven days for each hour,
 * said as such on the page and in the JSON. It is a pattern, not a forecast; CAISO publishes no hourly
 * carbon forecast, and a day-ahead one would be a model, which this is not.
 */

import { hourlyMeans, medianByHour, parseOutlook } from "./caiso";
import { getGridCo2Recent, listGridCo2Days, markGridCo2DayFailed, pruneGridCo2, upsertGridCo2 } from "./db";
import { PACIFIC, localDay, localHourNumber, shiftDay } from "./tz";

const OUTLOOK = "https://www.caiso.com/outlook";
/** CAISO answers a bare fetch today; the browser string is there in case that changes, as GridLight found it needed. */
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "text/csv,*/*" };
const KEEP_DAYS = 14;
const TYPICAL_DAYS = 7;
/** History days fetched per run: two files each, and a Worker has a subrequest budget. */
const BACKFILL_PER_RUN = 3;
/** A complete day: every hour, each with its twelve 5-minute rows. */
const COMPLETE_SAMPLES = 24 * 12;

async function csv(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) }).catch((e: Error) => {
    throw new Error(`${url}: ${e.message}`);
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith("Time,")) throw new Error(`${url}: not a CAISO CSV`);
  return text;
}

/** One day's hourly means from the pair of files at `base` (…/current or …/history/YYYYMMDD). */
async function dayMeans(base: string) {
  const [co2, demand] = await Promise.all([csv(`${base}/co2.csv`), csv(`${base}/demand.csv`)]);
  return hourlyMeans(parseOutlook(co2, demand));
}

export interface RefreshResult {
  today: string;
  /** Hours of today written this run (the current hour and the one before, or every hour on a cold table). */
  hours: number;
  backfilled: string[];
  failed: string[];
  pruned: boolean;
}

/** The cron's work. Returns what it did, for the one log line. */
export async function refreshGridCo2(now = new Date()): Promise<RefreshResult> {
  const today = localDay(now, PACIFIC);
  const hour = localHourNumber(now, PACIFIC);
  const stored = await listGridCo2Days(today, TYPICAL_DAYS + 1);
  const byDay = new Map(stored.map((d) => [d.day, d]));

  // Today: the whole file is read, but only the hours that can still change are written, unless the
  // table has nothing for today yet (first run after midnight, or a cold table).
  const means = await dayMeans(`${OUTLOOK}/current`);
  const fresh = byDay.has(today) ? means.filter((m) => m.hour >= hour - 1) : means;
  await upsertGridCo2(today, fresh).catch((e: Error) => {
    throw new Error(`write today: ${e.message}`);
  });

  // Yesterday back to a week ago: fetch the days that are missing or incomplete and were not tried
  // in the last day, a few at a time, together.
  const wanted = Array.from({ length: TYPICAL_DAYS }, (_, i) => shiftDay(today, -(i + 1))).filter((day) => {
    const d = byDay.get(day);
    if (d && d.samples >= COMPLETE_SAMPLES) return false;
    return !d?.failed_at || Date.parse(d.failed_at) < now.getTime() - 86_400_000;
  });
  const backfilled: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    wanted.slice(0, BACKFILL_PER_RUN).map(async (day) => {
      try {
        const rows = await dayMeans(`${OUTLOOK}/history/${day.replace(/-/g, "")}`);
        if (rows.length === 0) throw new Error("empty");
        await upsertGridCo2(day, rows);
        backfilled.push(day);
      } catch (e) {
        console.warn(`grid_co2: ${day} not backfilled: ${(e as Error).message}`);
        await markGridCo2DayFailed(day).catch(() => undefined);
        failed.push(day);
      }
    }),
  );

  // Retention once a day, on the first run after midnight.
  const pruned = hour === 0;
  if (pruned) await pruneGridCo2(today, KEEP_DAYS).catch((e: Error) => console.warn(`grid_co2: prune: ${e.message}`));
  return { today, hours: fresh.length, backfilled: backfilled.sort(), failed: failed.sort(), pruned };
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

const typical = new Map<string, { at: number; value: Promise<GridCo2 | null> }>();
const TYPICAL_TTL = 30 * 60_000;

/**
 * The typical hour from what the cron has stored; `null` until the first run has written something.
 * Remembered per day for half an hour per isolate: the cron writes twice an hour, and a plan page
 * should not read 168 rows for a number that moves that slowly.
 */
export function typicalGridCo2(today: string): Promise<GridCo2 | null> {
  const hit = typical.get(today);
  if (hit && Date.now() - hit.at < TYPICAL_TTL) return hit.value;
  const value = computeTypical(today).catch((e: unknown) => {
    typical.delete(today);
    throw e;
  });
  typical.set(today, { at: Date.now(), value });
  for (const k of typical.keys()) if (k !== today) typical.delete(k);
  return value;
}

async function computeTypical(today: string): Promise<GridCo2 | null> {
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
