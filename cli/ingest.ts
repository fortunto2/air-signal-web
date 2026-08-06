/**
 * The ETL. Everything the site knows enters here.
 *
 * Ordering is deliberate: places first (a device needs somewhere to be), then devices, then what
 * they measured, then the model that explains it, then the gate that decides what gets indexed.
 * Each step is independently runnable, because the day one of them breaks is the day you want to
 * rerun just that one.
 */

import { loadCities, CityIndex, type City } from "./places.ts";
import { comfortFrom, merge, moonPhase, scoresFrom, type Readings } from "./wasm.ts";
import * as up from "./upstreams.ts";
import { execute, query, update, upsert } from "./d1.ts";
import { slug, type SignalKey } from "../src/lib/site.ts";

export interface Opts {
  remote?: boolean;
  /** Backfill this many days of history for cities that have devices. */
  historyDays?: number;
  /** Stop after this many cities. For a fast pass while developing. */
  limitCities?: number;
  /**
   * Redo cities that already have today's numbers.
   *
   * Off by default, which makes the comfort pass resumable: Open-Meteo enforces an hourly request
   * ceiling, and a run that trips it should be restartable in the next hour without paying again
   * for everything it already fetched. It also makes the workflow safe to trigger twice.
   */
  force?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Undefined stays undefined — JSON.stringify drops the key, and absent must not become zero. */
const round = (v: number | null | undefined, places: number): number | undefined =>
  v === null || v === undefined || !Number.isFinite(v)
    ? undefined
    : Math.round(v * 10 ** places) / 10 ** places;

// ── 1. cities ───────────────────────────────────────────────────────────────

export async function seedCities(opts: Opts = {}): Promise<City[]> {
  const cities = loadCities();
  console.log(`cities: ${cities.length} from the embedded database`);

  const rows = cities.map((c) => [
    c.id, c.country, c.countrySlug, c.slug, c.name, c.lat, c.lon, c.rank,
  ]);

  await execute(
    upsert(
      "cities",
      ["id", "country", "country_slug", "slug", "name", "lat", "lon", "rank"],
      rows,
      { conflict: ["id"] },
    ),
    { ...opts, label: "cities" },
  );
  return cities;
}

// ── 2. devices ──────────────────────────────────────────────────────────────

export interface StationFacts {
  id: number;
  lat: number;
  lon: number;
  country: string;
  cityId: number | null;
  distanceKm: number | null;
  pm25: number | null;
  pm10: number | null;
  pm25_24h: number | null;
  sensorType: string | null;
  historyDays: number;
  seenAt: string;
}

export async function ingestStations(cities: City[], opts: Opts = {}): Promise<StationFacts[]> {
  console.log("stations: fetching the network snapshot …");
  const [now, avg24h] = await Promise.all([
    up.fetchSensorSnapshot(up.SC_NOW),
    up.fetchSensorSnapshot(up.SC_24H).catch(() => [] as up.SensorReading[]),
  ]);
  const byId24h = new Map(avg24h.map((s) => [s.id, s]));
  console.log(`stations: ${now.length} reporting now, ${avg24h.length} with a 24 h average`);

  // History, and hardware, from two directory listings. See fetchArchiveDay for why this is two
  // requests rather than nine thousand.
  //
  // The 30-day listing is load-bearing and is allowed to fail the run: it is the sole evidence
  // behind `history_days`, and a silent empty result would fail every station through the gate and
  // empty the sitemap. The 180-day one only sharpens `first_seen`, so it may go missing quietly.
  const day = 86_400_000;
  const [d30, d180] = await Promise.all([
    up.fetchArchiveDay(new Date(Date.now() - 30 * day)),
    up.fetchArchiveDay(new Date(Date.now() - 180 * day)).catch((err) => {
      console.warn(`  archive at 180 days unavailable (${err.message}) — first_seen will be coarse`);
      return new Map<number, string>();
    }),
  ]);
  console.log(`archive: ${d30.size} devices 30 days ago, ${d180.size} at 180 days`);

  const index = new CityIndex(cities);
  let unplaced = 0;

  const facts: StationFacts[] = now.map((s) => {
    const near = index.nearest(s.lat, s.lon);
    if (!near) unplaced++;
    return {
      id: s.id,
      lat: s.lat,
      lon: s.lon,
      country: s.country,
      cityId: near?.city.id ?? null,
      distanceKm: near ? Math.round(near.km * 10) / 10 : null,
      pm25: s.pm25,
      pm10: s.pm10,
      pm25_24h: byId24h.get(s.id)?.pm25 ?? null,
      sensorType: d30.get(s.id) ?? d180.get(s.id) ?? null,
      historyDays: d180.has(s.id) ? 180 : d30.has(s.id) ? 30 : 0,
      seenAt: s.seenAt,
    };
  });

  console.log(
    `stations: placed ${facts.length - unplaced}/${facts.length}` +
      (unplaced ? ` — ${unplaced} have no city within reach (ocean buoys, remote sites)` : ""),
  );

  await execute(
    upsert(
      "stations",
      [
        "id", "lat", "lon", "country", "city_id", "distance_km",
        "sensor_type", "first_seen", "last_seen", "pm25", "pm10", "pm25_24h", "history_days",
      ],
      facts.map((f) => [
        f.id, f.lat, f.lon, f.country, f.cityId, f.distanceKm,
        f.sensorType, f.seenAt, f.seenAt, f.pm25, f.pm10, f.pm25_24h, f.historyDays,
      ]),
      // first_seen is the one column a re-ingest must not touch: it is the oldest thing we know,
      // and overwriting it with today would erase the device's history every single run.
      { conflict: ["id"], keep: ["first_seen"], coalesce: ["sensor_type", "pm25_24h"] },
    ),
    { ...opts, label: "stations" },
  );

  // Today's reading, kept as a daily row. Rerunning within a day overwrites rather than appends.
  await execute(
    upsert(
      "readings_daily",
      ["station_id", "day", "pm25", "pm10"],
      facts
        .filter((f) => f.pm25 !== null || f.pm10 !== null)
        .map((f) => [f.id, today(), f.pm25_24h ?? f.pm25, f.pm10]),
      { conflict: ["station_id", "day"] },
    ),
    { ...opts, label: "readings_daily" },
  );

  // How many devices each city has, and their median reading — derived here rather than in the
  // comfort pass, because the map's city layer needs it and the comfort pass is the expensive,
  // rate-limited one. Deriving it here means the map works the moment the devices are loaded,
  // even if the weather upstream is having a bad hour.
  await execute(
    [
      `UPDATE cities SET station_count = COALESCE((
         SELECT COUNT(*) FROM stations WHERE stations.city_id = cities.id
       ), 0);`,
      // Median per city in one pass. SQLite has no MEDIAN, and the obvious LIMIT/OFFSET trick
      // needs to reference `cities.id` from inside a doubly-nested subquery — which SQLite cannot
      // correlate, and says so at runtime. A window function ranks every device once and picks the
      // middle one (or averages the middle two on an even count), which is both correct and one
      // table scan instead of two per city.
      `WITH ranked AS (
         SELECT city_id, pm25,
                ROW_NUMBER() OVER (PARTITION BY city_id ORDER BY pm25) AS rn,
                COUNT(*)     OVER (PARTITION BY city_id)               AS n
           FROM stations
          WHERE city_id IS NOT NULL AND pm25 IS NOT NULL
       ),
       med AS (
         SELECT city_id, AVG(pm25) AS m
           FROM ranked
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
          GROUP BY city_id
       )
       UPDATE cities
          SET pm25_median = (SELECT m FROM med WHERE med.city_id = cities.id)
        WHERE station_count > 0;`,
    ],
    { ...opts, label: "city station counts" },
  );

  return facts;
}

// ── 3. the fourteen signals, per city ───────────────────────────────────────

export async function ingestComfort(
  cities: City[],
  stations: StationFacts[],
  opts: Opts = {},
): Promise<void> {
  const historyDays = opts.historyDays ?? 31;
  let targets = opts.limitCities ? cities.slice(0, opts.limitCities) : cities;

  // Resume, unless told otherwise. See Opts.force — the upstream has an hourly ceiling and a run
  // that trips it must be restartable without re-fetching what it already has.
  if (!opts.force) {
    const doneToday = await query<{ id: number }>(
      `SELECT id FROM cities WHERE readings_json IS NOT NULL AND substr(updated_at, 1, 10) = '${today()}'`,
      opts,
    );
    if (doneToday.length > 0) {
      const skip = new Set(doneToday.map((r) => r.id));
      const before = targets.length;
      targets = targets.filter((c) => !skip.has(c.id));
      console.log(`comfort: ${before - targets.length} cities already have today's numbers — skipping`);
    }
  }
  if (targets.length === 0) {
    console.log("comfort: nothing left to do today (pass --force to redo it)");
    return;
  }

  // Devices grouped by city, so the sensor median is one pass rather than a lookup per city.
  const byCity = new Map<number, StationFacts[]>();
  for (const s of stations) {
    if (s.cityId === null) continue;
    const list = byCity.get(s.cityId);
    if (list) list.push(s);
    else byCity.set(s.cityId, [s]);
  }

  console.log("global feeds: quakes, Kp, fires …");
  // `null`, not `[]`, when the feed fails: an empty list means "we looked and it is calm", which
  // is a reading worth 100 points. Conflating the two would score an outage as good news.
  const [quakes, kp, fires] = await Promise.all([
    up.fetchQuakes().catch(() => null),
    up.fetchKp(),
    up.fetchFires(process.env.FIRMS_API_KEY),
  ]);
  console.log(
    `  ${quakes?.length ?? "no"} quakes · Kp ${kp ?? "—"} · ${fires.length} fire detections` +
      (fires.length === 0 && !process.env.FIRMS_API_KEY ? " (no FIRMS_API_KEY — fire stays absent)" : ""),
  );

  const phase = moonPhase(new Date());

  // Pass one: current conditions for every city, one day of data, wide batches. Cheap.
  // Pass two (below): thirty days of dailies, only for cities that have devices — everywhere else
  // the model is a fetch away in the browser, and keeping a copy for ten thousand cities would be
  // a third of a million rows a day for a chart nobody opened.
  const batches = up.chunk(targets, up.BATCH);
  console.log(`comfort: ${targets.length} cities in ${batches.length} batches of ${up.BATCH}`);

  const cityRows: (string | number | null)[][] = [];
  const dailyRows: (string | number | null)[][] = [];
  let done = 0;

  const CITY_COLUMNS = [
    "station_count", "pm25_median", "comfort", "worst_signal",
    "signals_json", "readings_json", "divergence", "updated_at",
  ];

  /**
   * Write what we have and forget it.
   *
   * The first version accumulated every row and wrote once at the end, which meant a twenty-minute
   * pass that lost everything to one upstream timeout in minute nineteen. Flushing as we go also
   * keeps peak memory flat, and the writes are idempotent upserts, so a rerun is free.
   */
  const flushCities = async () => {
    if (cityRows.length === 0) return;
    await execute(update("cities", "id", CITY_COLUMNS, cityRows), {
      ...opts,
      label: `city comfort (${cityRows.length})`,
    });
    cityRows.length = 0;
  };

  const flushDaily = async () => {
    if (dailyRows.length === 0) return;
    await execute(
      upsert("city_daily", ["city_id", "day", "comfort", "pm25", "temp", "uv"], dailyRows, {
        conflict: ["city_id", "day"],
      }),
      { ...opts, label: `city_daily (${dailyRows.length})` },
    );
    dailyRows.length = 0;
  };

  for (const [i, batch] of batches.entries()) {
    // Paced on purpose. Open-Meteo prices a call as locations × variables × days, so a polite gap
    // costs a couple of minutes across the whole run — far less than backing off from a 429.
    if (i > 0) await up.sleep(900);

    const [weather, air, marine] = await Promise.all([
      up.fetchWeather(batch),
      up.fetchAir(batch),
      up.fetchMarine(batch),
    ]);

    batch.forEach((city, j) => {
      const w = weather[j] ?? {};
      const a = air[j] ?? {};
      const m = marine[j] ?? {};
      const devices = byCity.get(city.id) ?? [];

      const sensorPm25 = up.median(
        devices.map((d) => d.pm25).filter((n): n is number => n !== null),
      );
      const sensorPm10 = up.median(
        devices.map((d) => d.pm10).filter((n): n is number => n !== null),
      );

      // Sensors are ground truth; the model is weighted down as it disagrees with them.
      const merged = merge({
        model_pm25: a.pm25 ?? null,
        model_pm10: a.pm10 ?? null,
        sensor_pm25: sensorPm25,
        sensor_pm10: sensorPm10,
        sensor_count: devices.length,
      });

      const readings: Readings = {
        pm25: merged.source === "no-data" ? undefined : merged.pm25,
        temperatureC: w.temperatureC,
        humidityPct: w.humidityPct,
        windKmh: w.windKmh,
        pressureHpa: w.pressureHpa,
        pressureChange3h: w.pressureChange3h,
        uv: w.uv,
        daylightHours: w.daylightHours,
        waveHeightM: m.waveHeightM,
        pollen: a.pollen,
        quakeMagnitude: up.quakeNear(quakes, city.lat, city.lon),
        fireDistanceKm: fires.length ? up.fireDistance(fires, city.lat, city.lon) : undefined,
        kp,
        moonPhase: phase,
        // Noise has no upstream at all — no model covers it and the community network's `laerm`
        // devices are a few hundred worldwide. Absent, not invented.
      };

      const comfort = comfortFrom(scoresFrom(readings));

      // Only the readings that exist. `undefined` disappears through JSON.stringify, which is the
      // behaviour we want: the page can then ask "is this key present" and get the truth.
      const stored = {
        pm25: round(readings.pm25, 1),
        pm10: round(a.pm10, 1),
        temperature: round(w.temperatureC, 1),
        humidity: round(w.humidityPct, 0),
        wind: round(w.windKmh, 1),
        pressure: round(w.pressureHpa, 0),
        uv: round(w.uv, 1),
        daylight: round(w.daylightHours, 1),
        wave: round(m.waveHeightM, 2),
        sea_temp: round(m.seaTempC, 1),
        pollen: round(a.pollen, 0),
        kp: round(kp, 2),
        quake: round(readings.quakeMagnitude, 1),
        fire_km: round(readings.fireDistanceKm, 0),
        moon: round(phase, 2),
      };

      cityRows.push([
        city.id,
        devices.length,
        sensorPm25 ?? merged.pm25 ?? null,
        comfort.total,
        comfort.worst,
        JSON.stringify(comfort.scores),
        JSON.stringify(stored),
        devices.length > 0 ? Math.round(merged.divergence * 100) / 100 : null,
        new Date().toISOString(),
      ]);

    });

    done += batch.length;
    if ((i + 1) % 5 === 0 || i === batches.length - 1) {
      console.log(`  ${done}/${targets.length} cities`);
      // UPDATE, not upsert: these columns enrich a city that `seed-cities` already created. See
      // `update()` in d1.ts for why an upsert cannot express this against NOT NULL columns.
      await flushCities();
    }
  }
  await flushCities();

  // ── pass two: history, only where there are devices ──────────────────────
  const withHistory = targets.filter((c) => (byCity.get(c.id)?.length ?? 0) > 0);
  const hBatches = up.chunk(withHistory, up.BATCH_HISTORY);
  console.log(
    `history: ${withHistory.length} cities with devices, ${historyDays} days, ` +
      `${hBatches.length} batches of ${up.BATCH_HISTORY}`,
  );

  for (const [i, batch] of hBatches.entries()) {
    if (i > 0) await up.sleep(2_000);

    const [weather, air] = await Promise.all([
      up.fetchDailyHistory(batch, historyDays),
      up.fetchAir(batch, historyDays),
    ]);

    batch.forEach((city, j) => {
      const days = weather[j] ?? [];
      const pmByDay = new Map((air[j]?.daily ?? []).map((d) => [d.day, d.pm25]));

      for (const d of days) {
        const pm = pmByDay.get(d.day) ?? null;
        // A past day's comfort from the three signals that have real history. Reconstructing all
        // fourteen retroactively would mean inventing eleven of them.
        const pastScores = scoresFrom({
          pm25: pm ?? undefined,
          temperatureC: d.temp ?? undefined,
          uv: d.uv ?? undefined,
        });
        dailyRows.push([
          city.id,
          d.day,
          Object.keys(pastScores).length ? comfortFrom(pastScores).total : null,
          pm,
          d.temp,
          d.uv,
        ]);
      }
    });

    if ((i + 1) % 5 === 0 || i === hBatches.length - 1) {
      console.log(
        `  ${Math.min((i + 1) * up.BATCH_HISTORY, withHistory.length)}/${withHistory.length} cities`,
      );
      await flushDaily();
    }
  }
  await flushDaily();

  console.log(`comfort: ${done} cities scored, ${withHistory.length} with a stored history series`);
}

// ── 4. per-device divergence ────────────────────────────────────────────────

export async function ingestDivergence(opts: Opts = {}): Promise<void> {
  // Each device against its own city's model reading. The city pass already stored the merged
  // median; here the question is narrower and more useful: is *this* box reading like its
  // neighbours, or is it the one indoors?
  const rows = await query<{
    id: number;
    pm25: number | null;
    city_pm: number | null;
    city_n: number | null;
  }>(
    `SELECT s.id, s.pm25, c.pm25_median AS city_pm, c.station_count AS city_n
       FROM stations s JOIN cities c ON c.id = s.city_id
      WHERE s.pm25 IS NOT NULL AND c.pm25_median IS NOT NULL`,
    opts,
  );

  const out = rows.map((r) => {
    const m = merge({
      model_pm25: r.city_pm,
      sensor_pm25: r.pm25,
      sensor_count: Math.max(1, r.city_n ?? 1),
    });
    return [
      r.id,
      Math.round(m.divergence * 100) / 100,
      Math.round(m.model_weight * 10000) / 10000,
      Math.round(m.pm25 * 10) / 10,
    ];
  });

  await execute(
    update("stations", "id", ["divergence", "model_weight", "merged_pm25"], out),
    { ...opts, label: "divergence" },
  );
  console.log(`divergence: ${out.length} devices scored against their city`);
}

// ── 5. the gate ─────────────────────────────────────────────────────────────

/**
 * Which station pages are worth indexing.
 *
 * The PRD's gate — reported today and thirty days of history — was assumed to leave "a few
 * hundred" pages. Measured against the archive it passes 8 420 of 9 155, which is 92 %: it is not
 * a gate, it is a formality. What was missing is that a page needs a *place* to be about, and that
 * the twentieth device in one city says nothing the first eight did not.
 *
 * So the bar is four things, and the numbers are logged rather than assumed:
 *   · reported today
 *   · present in the archive thirty days ago
 *   · within 25 km of a named city — or the closest device that city has, so the one sensor
 *     covering a stretch of coast keeps its page even when the coast has no town on the list
 *   · among the eight most complete devices in that city
 */
export async function applyGate(opts: Opts = {}): Promise<void> {
  const cutoff = new Date(Date.now() - 36 * 3_600_000).toISOString();

  await execute(
    [
      `UPDATE stations SET indexable = 0;`,
      `UPDATE stations SET indexable = 1
         WHERE last_seen >= ${JSON.stringify(cutoff)}
           AND history_days >= 30
           AND city_id IS NOT NULL
           AND (
                 distance_km <= 25
                 OR id IN (SELECT id FROM (
                      SELECT id, ROW_NUMBER() OVER (PARTITION BY city_id ORDER BY distance_km) AS r
                        FROM stations WHERE city_id IS NOT NULL
                    ) WHERE r = 1)
               )
           AND id IN (SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (
                          PARTITION BY city_id
                          ORDER BY (pm25 IS NULL), (pm10 IS NULL), history_days DESC, distance_km
                        ) AS r
                   FROM stations WHERE city_id IS NOT NULL
               ) WHERE r <= 8);`,
      // A city with no devices still has a page — Open-Meteo covers every coordinate on Earth, so
      // the fourteen signals are real either way. Gating cities on sensors would delete the entire
      // non-European map to fix a problem the non-European map does not have.
      `UPDATE cities SET indexable = 1;`,
      `UPDATE meta SET value = ${JSON.stringify(new Date().toISOString())} WHERE key = 'last_ingest_at';`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('last_ingest_at', ${JSON.stringify(new Date().toISOString())});`,
    ],
    { ...opts, label: "gate" },
  );

  const [counts] = await query<{
    total: number;
    fresh: number;
    history: number;
    placed: number;
    indexed: number;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(last_seen >= ${JSON.stringify(cutoff)}) AS fresh,
            SUM(history_days >= 30) AS history,
            SUM(city_id IS NOT NULL AND distance_km <= 25) AS placed,
            SUM(indexable) AS indexed
       FROM stations`,
    opts,
  );

  if (counts) {
    console.log(
      `gate: ${counts.total} devices → ${counts.fresh} reported recently → ${counts.history} have ` +
        `30 days → ${counts.placed} sit within 25 km of a city → ${counts.indexed} indexed`,
    );
    console.log(`gate: ${counts.total - counts.indexed} kept as pages but out of the sitemap`);
  }
}

// ── the whole thing ─────────────────────────────────────────────────────────

export async function ingestAll(opts: Opts = {}): Promise<void> {
  const started = Date.now();
  const cities = await seedCities(opts);
  const stations = await ingestStations(cities, opts);
  await ingestComfort(cities, stations, opts);
  await ingestDivergence(opts);
  await applyGate(opts);
  console.log(`\ningest finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

export type { City, SignalKey };
export { slug };
