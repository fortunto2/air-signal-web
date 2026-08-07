/**
 * Which direction the dirty hours come from.
 *
 * The conditional probability function is the one thing on this site that turns a map of readings
 * into an argument about cause. It asks: of the hours when the wind blew from that works, how many
 * were in this city's dirtiest quartile? A high answer is not proof — a motorway and a factory on
 * the same side of town are indistinguishable to it, and so is a hill — but it is evidence, and it
 * is the question everyone living downwind of something is already asking.
 *
 * `wasm_calculate_cpf` has been exported from airq-core since the start and unusable, because it
 * needs three parallel hourly series and the site stored dailies. Both inputs exist, and neither
 * costs anything new:
 *
 *   - **PM2.5 hourly** comes out of the Sensor.Community monthly archive already on disk for the
 *     history backfill. That file holds a reading every 2.5 minutes; aggregating it to the day was
 *     a choice, not a limit.
 *   - **Wind hourly** comes from Open-Meteo's ERA5 archive endpoint, which is a different service
 *     from the forecast API and is not the one whose quota this project has exhausted twice. A
 *     month for two locations is 41 KB and three seconds.
 *
 * Run monthly, alongside the backfill. A prevailing wind is not a thing that changes overnight, and
 * a fresh answer every night would be the same answer with more noise in it.
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { entryExtent } from "./zip.ts";
import { core } from "./wasm.ts";
import { execute, query, upsert } from "./d1.ts";

export interface CpfOpts {
  remote?: boolean;
  dir: string;
  /** `YYYY-MM`. Defaults to whichever month the archives in `dir` cover. */
  month?: string;
  /** Only cities with at least this many devices — a median of two is not a city's air. */
  minDevices?: number;
}

interface CpfResult {
  source: { name: string; lat: number; lon: number; source_type: string; distance_km: number };
  cpf_score: number;
  bearing_deg: number;
  hours_in_sector: number;
  high_hours_in_sector: number;
  avg_pm25_in_sector: number;
  avg_pm25_other: number;
}

function median(xs: number[]): number {
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

export async function computeCpf(opts: CpfOpts): Promise<void> {
  const minDevices = opts.minDevices ?? 4;

  // Only cities that have both halves of the question: something to blame, and enough devices for
  // the median to mean anything.
  const cities = await query<{ id: number; name: string; lat: number; lon: number; n: number }>(
    `SELECT c.id, c.name, c.lat, c.lon, c.station_count AS n
       FROM cities c
      WHERE c.station_count >= ${minDevices}
        AND EXISTS (SELECT 1 FROM sources s WHERE s.city_id = c.id)
      ORDER BY c.station_count DESC`,
    opts,
  );
  if (cities.length === 0) {
    console.log("cpf: no city has both sources and devices — run `ingest --only sources` first");
    return;
  }
  console.log(`cpf: ${cities.length} cities with sources and ${minDevices}+ devices`);

  const sources = await query<{
    id: number;
    city_id: number;
    name: string;
    kind: string;
    lat: number;
    lon: number;
    distance_km: number;
  }>(
    `SELECT id, city_id, name, kind, lat, lon, distance_km FROM sources
      WHERE city_id IN (${cities.map((c) => c.id).join(",")})`,
    opts,
  );
  const byCity = new Map<number, typeof sources>();
  for (const s of sources) {
    const list = byCity.get(s.city_id);
    if (list) list.push(s);
    else byCity.set(s.city_id, [s]);
  }

  // Which city each device belongs to, so the archive's sensor ids can be folded to city medians.
  const deviceCity = new Map<number, number>();
  for (const r of await query<{ id: number; city_id: number }>(
    `SELECT id, city_id FROM stations WHERE city_id IN (${cities.map((c) => c.id).join(",")})`,
    opts,
  )) {
    deviceCity.set(r.id, r.city_id);
  }
  console.log(`cpf: ${deviceCity.size} devices across them`);

  // ── the hourly PM series, from the archive ────────────────────────────────
  const files = (await readdir(opts.dir))
    .filter((f) => f.endsWith(".zip"))
    .filter((f) => !opts.month || f.startsWith(opts.month))
    .sort();
  if (files.length === 0) {
    console.log(`cpf: no archives in ${opts.dir} — run \`make backfill-fetch\` first`);
    return;
  }

  /** cityId → hour ('YYYY-MM-DDTHH') → the readings seen in it. */
  const hourly = new Map<number, Map<string, number[]>>();
  let month = opts.month ?? "";

  for (const file of files) {
    const start = Date.now();
    const { start: from, end: to } = await entryExtent(join(opts.dir, file));
    const stream = createReadStream(join(opts.dir, file), { start: from, end: to }).pipe(
      createInflateRaw(),
    );

    let iId = -1;
    let iTs = -1;
    let iP2 = -1;
    let rows = 0;

    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (iId < 0) {
        const head = line.split(";");
        iId = head.indexOf("sensor_id");
        iTs = head.indexOf("timestamp");
        iP2 = head.indexOf("P2");
        if (iId < 0 || iTs < 0 || iP2 < 0) throw new Error(`${file}: unexpected columns`);
        continue;
      }
      const p = line.split(";");
      if (p.length <= iP2) continue;

      const cityId = deviceCity.get(Number(p[iId]));
      if (cityId === undefined) continue;

      const pm = Number(p[iP2]);
      if (!(pm > 0 && pm <= 500)) continue;

      // 'YYYY-MM-DDTHH' — the hour the ERA5 series is keyed by.
      const hour = p[iTs]!.slice(0, 13);
      if (!month) month = hour.slice(0, 7);

      let forCity = hourly.get(cityId);
      if (!forCity) hourly.set(cityId, (forCity = new Map()));
      const bucket = forCity.get(hour);
      if (bucket) bucket.push(pm);
      else forCity.set(hour, [pm]);

      rows++;
    }
    console.log(
      `cpf: ${file} — ${(rows / 1e6).toFixed(1)}M relevant rows in ${Math.round((Date.now() - start) / 1000)}s`,
    );
  }

  // Collapse each hour to a median once, rather than inside the alignment loop below.
  const pmByCity = new Map<number, Map<string, number>>();
  for (const [cityId, hours] of hourly) {
    const out = new Map<string, number>();
    for (const [hour, values] of hours) out.set(hour, median(values));
    pmByCity.set(cityId, out);
  }
  hourly.clear();

  const withData = cities.filter((c) => (pmByCity.get(c.id)?.size ?? 0) >= 200);
  console.log(
    `cpf: ${withData.length} cities have 200+ hours in ${month}; ` +
      `${cities.length - withData.length} too sparse`,
  );
  if (withData.length === 0) return;

  // ── the hourly wind, from ERA5 ────────────────────────────────────────────
  const [y, m] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const endDate = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);

  const rows: (string | number | null)[][] = [];
  let scored = 0;

  // Batches of 50: ERA5 accepts many coordinates per call, and the response is one JSON object per
  // location. A month of hourly wind is ~20 KB each, so 50 is a megabyte and well inside a sane
  // request.
  for (let i = 0; i < withData.length; i += 50) {
    const batch = withData.slice(i, i + 50);
    const url =
      "https://archive-api.open-meteo.com/v1/archive" +
      `?latitude=${batch.map((c) => c.lat).join(",")}` +
      `&longitude=${batch.map((c) => c.lon).join(",")}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      "&hourly=wind_direction_10m,wind_speed_10m&timezone=UTC";

    const res = await fetch(url, {
      headers: { "user-agent": "air-signal-web/0.1 (+https://airsignal.app)" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.warn(`cpf: ERA5 said ${res.status} for batch ${i / 50 + 1} — skipping it`);
      continue;
    }
    const body = (await res.json()) as
      | { hourly: { time: string[]; wind_direction_10m: number[]; wind_speed_10m: number[] } }
      | { hourly: { time: string[]; wind_direction_10m: number[]; wind_speed_10m: number[] } }[];
    const locations = Array.isArray(body) ? body : [body];

    batch.forEach((city, j) => {
      const h = locations[j]?.hourly;
      const cityPm = pmByCity.get(city.id);
      const citySources = byCity.get(city.id);
      if (!h || !cityPm || !citySources?.length) return;

      // The three arrays have to be parallel and the same length, so they are built together from
      // the hours where both a reading and a wind exist. An hour the devices missed is dropped
      // rather than interpolated: inventing a reading is exactly what would make this lie.
      const pm25: number[] = [];
      const dirs: number[] = [];
      const speeds: number[] = [];
      for (let k = 0; k < h.time.length; k++) {
        const hour = h.time[k]!.slice(0, 13);
        const value = cityPm.get(hour);
        const dir = h.wind_direction_10m[k];
        const speed = h.wind_speed_10m[k];
        if (value === undefined || dir === null || dir === undefined || speed === null || speed === undefined) {
          continue;
        }
        pm25.push(value);
        dirs.push(dir);
        speeds.push(speed);
      }
      if (pm25.length < 200) return;

      let results: CpfResult[];
      try {
        results = JSON.parse(
          core.wasm_calculate_cpf(
            JSON.stringify({
              lat: city.lat,
              lon: city.lon,
              percentile: 0.75,
              sources: citySources.map((s) => ({
                name: s.name,
                lat: s.lat,
                lon: s.lon,
                source_type: s.kind,
                distance_km: s.distance_km,
              })),
              pm25,
              wind_dirs: dirs,
              wind_speeds: speeds,
            }),
          ),
        ) as CpfResult[];
      } catch {
        return;
      }

      // The core sorts its answer by score, so the results do not come back in the order they went
      // in and cannot be matched by index. Coordinates are the identity.
      const byPoint = new Map(
        citySources.map((s) => [`${s.lat.toFixed(4)},${s.lon.toFixed(4)}`, s.id]),
      );

      for (const r of results) {
        const id = byPoint.get(`${r.source.lat.toFixed(4)},${r.source.lon.toFixed(4)}`);
        if (id === undefined) continue;
        // A source the wind never came from has no evidence, not zero evidence, and storing it as
        // a score of zero would put it on the page as an exoneration it has not earned.
        if (r.hours_in_sector < 24) continue;

        rows.push([
          city.id,
          id,
          Math.round(r.cpf_score * 1000) / 1000,
          Math.round(r.bearing_deg * 10) / 10,
          r.hours_in_sector,
          r.high_hours_in_sector,
          Math.round(r.avg_pm25_in_sector * 10) / 10,
          Math.round(r.avg_pm25_other * 10) / 10,
          month,
        ]);
      }
      scored++;
    });

    console.log(`  ${Math.min(i + 50, withData.length)}/${withData.length} cities`);
  }

  if (rows.length === 0) {
    console.log("cpf: nothing scored");
    return;
  }

  for (let i = 0; i < rows.length; i += 3_000) {
    await execute(
      upsert(
        "cpf",
        [
          "city_id", "source_id", "score", "bearing_deg",
          "hours", "high_hours", "pm25_from", "pm25_other", "period",
        ],
        rows.slice(i, i + 3_000),
        { conflict: ["city_id", "source_id"] },
      ),
      { ...opts, label: `cpf (${Math.min(3_000, rows.length - i)})` },
    );
  }

  console.log(`cpf: ${rows.length} source scores across ${scored} cities for ${month}`);
}
