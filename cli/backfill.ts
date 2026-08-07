/**
 * Backfill device history from the Sensor.Community archive.
 *
 * `readings_daily` accumulates one row per device per day, written by the nightly pass from
 * `data.24h.json`. That works going forward and says nothing about the past: a station page opened
 * the week the site launched had a chart with one point on it.
 *
 * The archive has the past, and this reads it. What it does not have is a convenient shape:
 *
 *   - The daily directories hold one CSV per device per day — 18 740 files for a single day, so a
 *     month is half a million requests. Not usable.
 *   - The monthly directory holds fourteen zips, one per hardware type, each containing exactly one
 *     CSV of every reading that type produced worldwide that month. `2026-07_sds011.zip` is 3.3 GB
 *     compressed and 28 GB open. That is usable, and it is the only thing that is.
 *
 * Hence a separate command rather than a step in `ingest`: this is a several-gigabyte download and
 * a one-off per month, and putting it in the nightly pass would make every night pay for it.
 *
 * Range requests work on the archive, so `make backfill-fetch` pulls the file in parallel parts —
 * a single connection gets about 0.3 MB/s and ten get close to ten times that. But the zip holds
 * one deflate stream, so nothing can be extracted selectively: the whole thing is downloaded, then
 * streamed through once.
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { entryExtent } from "./zip.ts";
import { execute, query, upsert } from "./d1.ts";

export interface BackfillOpts {
  remote?: boolean;
  /** Directory holding the downloaded `YYYY-MM_type.zip` files. */
  dir: string;
  /** Only these months, e.g. `2026-07`. Defaults to every month found in `dir`. */
  months?: string[];
}

/**
 * The middle value. Robust where a mean is not: one minute of smoke should not become the day.
 *
 * Worth knowing that this is not quite the statistic the nightly pass writes into the same column.
 * That one stores Sensor.Community's own published 24-hour mean, because it is what `data.24h.json`
 * carries and fetching every reading to recompute it would be nine gigabytes a night. So a chart
 * built from both has its last point computed slightly differently from the rest. On a day's worth
 * of readings from one device the two are close, and much closer than the day-to-day variation the
 * chart exists to show — but it is a seam, not a coincidence, and it belongs written down.
 */
function median(xs: number[]): number {
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

interface DayAgg {
  pm25: number[];
  pm10: number[];
}

export async function backfill(opts: BackfillOpts): Promise<void> {
  // Only devices we already know. The archive carries every sensor that ever reported, including
  // thousands with no row here, and `readings_daily` has a foreign key to `stations` — inserting a
  // reading for a device we have never seen would fail the whole batch.
  const known = new Set(
    (await query<{ id: number }>("SELECT id FROM stations", opts)).map((r) => r.id),
  );
  console.log(`backfill: ${known.size} known devices`);

  const files = (await readdir(opts.dir))
    .filter((f) => f.endsWith(".zip"))
    .filter((f) => !opts.months || opts.months.some((m) => f.startsWith(m)))
    .sort();

  if (files.length === 0) {
    console.log(`backfill: no archives in ${opts.dir} — run \`make backfill-fetch\` first`);
    return;
  }

  let written = 0;
  for (const file of files) {
    written += await readArchive(join(opts.dir, file), file, known, opts);
  }
  console.log(`backfill: ${written} device-days written`);
}

async function readArchive(
  path: string,
  label: string,
  known: Set<number>,
  opts: BackfillOpts,
): Promise<number> {
  const start = Date.now();
  const { start: from, end: to } = await entryExtent(path);

  /**
   * One day in memory at a time.
   *
   * The CSV is ordered by timestamp with every device interleaved, so a whole month cannot be held
   * — eight thousand devices reading every two minutes for thirty-one days is a hundred million
   * values. Ordered by *time*, though, a day is a contiguous run: when the date changes, the
   * previous one is complete and can be flushed.
   *
   * Two days are kept rather than one because the ordering is by the device's own clock, and a
   * device a few seconds behind reports 23:59:58 after its neighbour has reported 00:00:01.
   */
  const days = new Map<string, Map<number, DayAgg>>();
  let rows = 0;
  let written = 0;

  const flush = async (day: string) => {
    const byDevice = days.get(day);
    days.delete(day);
    if (!byDevice || byDevice.size === 0) return;

    const batch: (string | number | null)[][] = [];
    for (const [id, agg] of byDevice) {
      batch.push([
        id,
        day,
        agg.pm25.length ? Math.round(median(agg.pm25) * 100) / 100 : null,
        agg.pm10.length ? Math.round(median(agg.pm10) * 100) / 100 : null,
      ]);
    }

    // One call per day, not per two thousand rows: `upsert` already splits on statement size, and
    // `execute` writes the whole list to a single file. Chunking on top of that only bought extra
    // wrangler processes — 155 of them for SDS011 instead of 31.
    await execute(
      upsert("readings_daily", ["station_id", "day", "pm25", "pm10"], batch, {
        conflict: ["station_id", "day"],
      }),
      { ...opts, label: `${label} ${day} (${batch.length})` },
    );
    written += batch.length;
  };

  const stream = createReadStream(path, { start: from, end: to }).pipe(createInflateRaw());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  // Column order is stable across the archive but read from the header anyway — `sea` versus
  // `marine` was learned the hard way, and a silently shifted column is the same class of bug.
  let iId = -1;
  let iTs = -1;
  let iP1 = -1;
  let iP2 = -1;

  for await (const line of lines) {
    if (iId < 0) {
      const head = line.split(";");
      iId = head.indexOf("sensor_id");
      iTs = head.indexOf("timestamp");
      iP1 = head.indexOf("P1");
      iP2 = head.indexOf("P2");
      if (iId < 0 || iTs < 0 || iP2 < 0) throw new Error(`${label}: unexpected columns — ${line}`);
      continue;
    }

    const p = line.split(";");
    if (p.length <= iP2) continue;

    const id = Number(p[iId]);
    if (!known.has(id)) continue;

    const day = p[iTs]!.slice(0, 10);
    let byDevice = days.get(day);
    if (!byDevice) {
      // A third day appearing means the oldest is finished — the interleave is seconds, not hours.
      if (days.size >= 2) {
        for (const old of [...days.keys()].sort().slice(0, days.size - 1)) await flush(old);
      }
      byDevice = new Map();
      days.set(day, byDevice);
    }

    let agg = byDevice.get(id);
    if (!agg) {
      agg = { pm25: [], pm10: [] };
      byDevice.set(id, agg);
    }

    // The same window the live pass uses. Zero is a broken sensor, not clean air, and the archive
    // has plenty of both — as well as values in the thousands from devices reporting raw counts.
    const pm25 = Number(p[iP2]);
    if (pm25 > 0 && pm25 <= 500) agg.pm25.push(pm25);
    const pm10 = iP1 >= 0 ? Number(p[iP1]) : NaN;
    if (pm10 > 0 && pm10 <= 500) agg.pm10.push(pm10);

    if (++rows % 20_000_000 === 0) {
      console.log(`  ${label}: ${(rows / 1e6).toFixed(0)}M rows read`);
    }
  }

  for (const day of [...days.keys()].sort()) await flush(day);

  console.log(
    `${label}: ${(rows / 1e6).toFixed(1)}M rows → ${written} device-days ` +
      `in ${Math.round((Date.now() - start) / 1000)}s`,
  );
  return written;
}
