/**
 * The ETL. Everything the site knows enters here.
 *
 * Ordering is deliberate: places first (a device needs somewhere to be), then devices, then what
 * they measured, then the model that explains it, then the gate that decides what gets indexed.
 * Each step is independently runnable, because the day one of them breaks is the day you want to
 * rerun just that one.
 */

import { citiesFromDb, loadCities, loadPlaces, CityIndex, type City } from "./places.ts";
import { loadGeoNames } from "./geonames.ts";
import { bearing, comfortFrom, haversine, merge, moonPhase, scoresFrom, type Readings } from "./wasm.ts";
import * as up from "./upstreams.ts";
import { execute, query, update, upsert } from "./d1.ts";
import { storedReadings } from "../src/lib/live.ts";
import { slug, type SignalKey } from "../src/lib/site.ts";

export interface Opts {
  remote?: boolean;
  /** Backfill this many days of history for cities that have devices. */
  historyDays?: number;
  /** Stop after this many cities. For a fast pass while developing. */
  limitCities?: number;
  /** Score every city, not just the ones with devices. See `ingestComfort` for why that is not the default. */
  all?: boolean;
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

// ── 1. cities ───────────────────────────────────────────────────────────────

export async function seedCities(opts: Opts = {}): Promise<City[]> {
  const { countries, cities } = loadPlaces();
  console.log(`places: ${countries.length} countries, ${cities.length} cities`);

  await execute(
    upsert("countries", ["id", "slug", "name"], countries.map((c) => [c.id, c.slug, c.name]), {
      conflict: ["id"],
    }),
    { ...opts, label: "countries" },
  );

  await execute(
    upsert(
      "cities",
      ["id", "country_id", "slug", "name", "lat", "lon", "rank"],
      cities.map((c) => [c.id, c.countryId, c.slug, c.name, c.lat, c.lon, c.rank]),
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
        "id", "lat", "lon", "city_id", "distance_km",
        "sensor_type", "first_seen", "last_seen", "pm25", "pm10", "pm25_24h", "history_days",
      ],
      facts.map((f) => [
        f.id, f.lat, f.lon, f.cityId, f.distanceKm,
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

  await rollUpCountries(opts);

  return facts;
}

/**
 * Country totals, rolled up from the cities.
 *
 * Stored rather than computed per request. A country page wants "how many cities, how many
 * devices, what is the median, which city is best and which is worst", and answering that with a
 * GROUP BY over ten thousand rows on every hit is the same mistake as querying in a loop — it just
 * hides better. Five statements once per ingest replaces it.
 *
 * Run after the city counts and again after the comfort pass, because the first fills the device
 * numbers and the second fills the scores.
 */
/**
 * Where each measured city sits against the others.
 *
 * Recomputed whenever the scores move, because a percentile is only meaningful against the set it
 * was taken from. Only cities with devices are in the set — a modelled city has no measurement to
 * rank, and mixing the two would rank ten thousand model outputs against nine hundred measurements
 * and call the result a comparison.
 *
 * 100 is the best. Ties share a position, so a hundred cities on 91 do not fan out across a hundred
 * percentiles and imply an order that is not there.
 */
export async function rankPercentiles(opts: Opts = {}): Promise<void> {
  await execute(
    [
      `WITH ranked AS (
         SELECT id,
                PERCENT_RANK() OVER (ORDER BY comfort) AS p
           FROM cities
          WHERE comfort IS NOT NULL AND station_count > 0
       )
       UPDATE cities
          SET percentile = (SELECT CAST(ROUND(p * 100) AS INTEGER) FROM ranked WHERE ranked.id = cities.id)
        WHERE comfort IS NOT NULL AND station_count > 0;`,
      // A city that lost its devices or its score keeps a percentile that no longer means anything.
      `UPDATE cities SET percentile = NULL WHERE comfort IS NULL OR station_count = 0;`,
    ],
    { ...opts, label: "percentiles" },
  );
}

export async function rollUpCountries(opts: Opts = {}): Promise<void> {
  await execute(
    [
      `UPDATE countries SET
         city_count = (SELECT COUNT(*) FROM cities WHERE cities.country_id = countries.id),
         station_count = COALESCE(
           (SELECT SUM(station_count) FROM cities WHERE cities.country_id = countries.id), 0
         ),
         updated_at = ${JSON.stringify(new Date().toISOString())};`,

      // Median of the medians: the country's typical city, not its typical device. Weighting by
      // device count would make Germany a report on Stuttgart, which has more sensors than most
      // countries have cities.
      `WITH ranked AS (
         SELECT c.country_id, c.pm25_median AS v,
                ROW_NUMBER() OVER (PARTITION BY c.country_id ORDER BY c.pm25_median) AS rn,
                COUNT(*)     OVER (PARTITION BY c.country_id)                         AS n
           FROM cities c
          WHERE c.pm25_median IS NOT NULL
       ),
       med AS (
         SELECT country_id, AVG(v) AS m FROM ranked
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2) GROUP BY country_id
       )
       UPDATE countries SET pm25_median = (SELECT m FROM med WHERE med.country_id = countries.id);`,

      `WITH ranked AS (
         SELECT c.country_id, c.comfort AS v,
                ROW_NUMBER() OVER (PARTITION BY c.country_id ORDER BY c.comfort) AS rn,
                COUNT(*)     OVER (PARTITION BY c.country_id)                     AS n
           FROM cities c
          WHERE c.comfort IS NOT NULL AND c.station_count > 0
       ),
       med AS (
         SELECT country_id, CAST(AVG(v) AS INTEGER) AS m FROM ranked
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2) GROUP BY country_id
       )
       UPDATE countries SET comfort = (SELECT m FROM med WHERE med.country_id = countries.id);`,

      `UPDATE countries SET best_city_id = (
         SELECT id FROM cities
          WHERE country_id = countries.id AND comfort IS NOT NULL AND station_count > 0
          ORDER BY comfort DESC LIMIT 1
       );`,
      `UPDATE countries SET worst_city_id = (
         SELECT id FROM cities
          WHERE country_id = countries.id AND comfort IS NOT NULL AND station_count > 0
          ORDER BY comfort ASC LIMIT 1
       );`,
    ],
    { ...opts, label: "country roll-up" },
  );

  const [n] = await query<{ withSensors: number; total: number }>(
    `SELECT COUNT(*) AS total, SUM(station_count > 0) AS withSensors FROM countries`,
    opts,
  );
  if (n) console.log(`countries: ${n.total}, of which ${n.withSensors} have devices`);
}

// ── 3. the fourteen signals, per city ───────────────────────────────────────

export async function ingestComfort(
  cities: City[],
  stations: StationFacts[],
  opts: Opts = {},
): Promise<void> {
  const historyDays = opts.historyDays ?? 31;
  let targets = opts.limitCities ? cities.slice(0, opts.limitCities) : cities;

  /**
   * By default this warms only the cities that have devices — about 1 300 of 10 596.
   *
   * The other nine thousand are scored on demand by the Worker when someone first opens them
   * (`src/lib/comfort-server.ts`), which is the right trade for a long tail that mostly sees no
   * traffic for months. Scoring all of them nightly is what exhausted Open-Meteo's daily quota and
   * left every page blank.
   *
   * The sensor cities cannot be lazy: the home page, `/ranking` and every country page are
   * aggregates over them, and an aggregate cannot wait for its members to be visited.
   *
   * `--all` scores everything, for the rare case of wanting the whole set warm at once.
   */
  if (!opts.all && !opts.limitCities) {
    const withDevices = new Set(
      (await query<{ id: number }>("SELECT id FROM cities WHERE station_count > 0", opts)).map(
        (r) => r.id,
      ),
    );
    const before = targets.length;
    targets = targets.filter((c) => withDevices.has(c.id));
    console.log(
      `comfort: warming ${targets.length} cities with devices; the other ${before - targets.length} ` +
        "are scored on demand (pass --all to include them)",
    );
  }

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

      // Through `storedReadings`, not by hand. This table used to live here as well as in
      // live.ts, and the two had already drifted: the ETL wrote kp/quake/fire/moon without
      // wind_dir, the live path wrote wind_dir without the other four, and both fed the same
      // renderer — so a city silently lost measure lines depending on which had touched it last.
      const stored = storedReadings(readings, {
        pm10: a.pm10,
        seaTempC: m.seaTempC,
      });

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

  /**
   * A city already holding a series needs the last couple of days, not the last thirty.
   *
   * Open-Meteo prices work as locations × variables × days, and this pass was asking for the full
   * window every single night — thirty times the quota, to rewrite twenty-nine days that cannot
   * change. It runs after pass one, so when the ceiling was reached it was the part that never ran,
   * every time. `city_daily` was empty in production for exactly that reason.
   *
   * Two days rather than one because a day is only complete once it is over, and the run happens
   * inside it — yesterday is still being written when today's pass looks at it.
   */
  const RECENT_DAYS = 2;
  const stored = await query<{ city_id: number; days: number; newest: string }>(
    "SELECT city_id, COUNT(*) days, MAX(day) newest FROM city_daily GROUP BY city_id",
    opts,
  );
  const coverage = new Map(stored.map((r) => [r.city_id, r]));
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const cold: typeof withHistory = [];
  const warm: typeof withHistory = [];
  for (const c of withHistory) {
    const cov = coverage.get(c.id);
    // "Warm" means the series is both long enough and current. A city that fell behind — the site
    // was down, the pass was cut short — falls back to the full window and heals itself.
    (cov && cov.days >= historyDays - 2 && cov.newest >= yesterday ? warm : cold).push(c);
  }

  /** One sub-pass. `days` is what makes the two cost wildly different, so batch size follows it. */
  const runHistory = async (cities: typeof withHistory, days: number, batchSize: number) => {
    if (cities.length === 0) return;
    const hBatches = up.chunk(cities, batchSize);
    console.log(
      `history: ${cities.length} cities × ${days} days, ${hBatches.length} batches of ${batchSize}`,
    );

    for (const [i, batch] of hBatches.entries()) {
      if (i > 0) await up.sleep(2_000);

      const [weather, air] = await Promise.all([
        up.fetchDailyHistory(batch, days),
        up.fetchAir(batch, days),
      ]);

      batch.forEach((city, j) => {
        const series = weather[j] ?? [];
        const pmByDay = new Map((air[j]?.daily ?? []).map((d) => [d.day, d.pm25]));

        for (const d of series) {
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
        console.log(`  ${Math.min((i + 1) * batchSize, cities.length)}/${cities.length} cities`);
        await flushDaily();
      }
    }
    await flushDaily();
  };

  // Warm first, and deliberately: it is the cheap one, it keeps every existing chart current, and
  // if the quota runs out during the backfill the site still moved forward today.
  await runHistory(warm, RECENT_DAYS, up.BATCH);
  await runHistory(cold, historyDays, up.BATCH_HISTORY);

  // Again: the first roll-up ran before any city had a score.
  await rankPercentiles(opts);
  await rollUpCountries(opts);

  console.log(
    `comfort: ${done} cities scored · history ${warm.length} topped up, ${cold.length} backfilled`,
  );
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
  await seedCities(opts);

  // The seed writes the crate's ~10 600; the merged set in D1 is six times that. Everything after
  // this point decides which city a device belongs to, so it has to read the table rather than the
  // list that was just written into part of it — otherwise a device two kilometres from a town
  // added by `expand-cities` is attributed to a city twenty kilometres away, for ever.
  const cities = await citiesFromDb(query, opts);
  const stations = await ingestStations(cities, opts);
  await ingestComfort(cities, stations, opts);
  await ingestDivergence(opts);
  await applyGate(opts);
  console.log(`\ningest finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

export type { City, SignalKey };
export { slug };

/**
 * Where the pollution plausibly comes from.
 *
 * Only cities that have devices, and only the ones whose sensors disagree with each other enough
 * to be worth explaining — Overpass is volunteer-run infrastructure and a query for every one of
 * ten thousand cities would be an abuse of it. Sources change on the timescale of construction
 * projects, so a city already carrying them is skipped unless `--force`.
 *
 * This is the input `wasm_calculate_cpf` has been waiting for. It also needs hourly wind and PM2.5
 * to say "when the wind is off the works you breathe 31 µg/m³, otherwise 12", and that series is
 * a separate fetch this pass does not do yet.
 */
export async function ingestSources(opts: Opts & { limit?: number }): Promise<void> {
  const targets = await query<{ id: number; name: string; lat: number; lon: number }>(
    `SELECT c.id, c.name, c.lat, c.lon
       FROM cities c
      WHERE c.station_count > 0
        ${opts.force ? "" : "AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.city_id = c.id)"}
      ORDER BY c.station_count DESC
      LIMIT ${opts.limit ?? 200}`,
    opts,
  );

  if (targets.length === 0) {
    console.log("sources: every city with devices already has them (pass --force to redo)");
    return;
  }
  console.log(`sources: ${targets.length} cities`);

  const rows: (string | number | null)[][] = [];
  let found = 0;
  let empty = 0;

  for (const [i, city] of targets.entries()) {
    // Overpass asks for one query at a time and means it. Two seconds between calls is the
    // difference between being a good citizen and being blocked.
    if (i > 0) await up.sleep(2_000);

    const sources = await up.fetchSources(city.lat, city.lon, 25);
    if (sources.length === 0) empty++;
    found += sources.length;

    for (const s of sources) {
      rows.push([
        city.id,
        s.osmId,
        s.name.slice(0, 120),
        s.kind,
        Math.round(s.lat * 1e5) / 1e5,
        Math.round(s.lon * 1e5) / 1e5,
        Math.round(haversine(city.lat, city.lon, s.lat, s.lon) * 10) / 10,
        Math.round(bearing(city.lat, city.lon, s.lat, s.lon) * 10) / 10,
        new Date().toISOString(),
      ]);
    }

    if (rows.length >= 800 || i === targets.length - 1) {
      await execute(
        upsert(
          "sources",
          ["city_id", "osm_id", "name", "kind", "lat", "lon", "distance_km", "bearing_deg", "updated_at"],
          rows,
          { conflict: ["city_id", "osm_id"] },
        ),
        { ...opts, label: `sources (${rows.length})` },
      );
      rows.length = 0;
    }

    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${targets.length} cities, ${found} sources`);
  }

  console.log(
    `sources: ${found} across ${targets.length - empty} cities; ${empty} had nothing mapped nearby`,
  );
}

/**
 * Add every city GeoNames knows that we do not.
 *
 * The embedded crate caps at ~100 per country and that ceiling is the site's biggest limit: a
 * country page listed a hundred places and stopped, which reads as a bug and is a data boundary.
 *
 * Additive on purpose. A city we already have keeps its id, its slug and therefore its URL — it
 * only gains a population figure from whichever GeoNames row it matched. Replacing the source
 * outright would have renamed a few thousand indexed pages (GeoNames writes Munchen where the crate
 * writes Muenchen) to gain some new ones, which is a bad trade in both directions.
 *
 * Matching is by name, with distance as the sanity check, and that order matters. Six kilometres of
 * pure proximity looked reasonable and was wrong: Berlin has dozens of settlements inside that
 * radius, every one of them matched the city, the last one won the population update, and Berlin
 * ended up with 5 629 residents. Each of those villages was then treated as already-present and
 * never added at all.
 *
 * So: the same slug within fifty kilometres is the same place, which covers the ordinary case.
 * Failing that, anything within two kilometres is the same place too, which catches a city under a
 * different spelling — GeoNames writes Munchen where the crate writes Muenchen. Everything else is
 * new. Where several rows still land on one city, the most populous wins, because that one is the
 * city and the others are districts of it.
 */
export async function expandCities(opts: Opts & { dir?: string; file?: string }): Promise<void> {
  const geo = await loadGeoNames(opts.dir ?? ".cache", opts.file ?? "cities5000");
  console.log(`geonames: ${geo.cities.length} cities in the source file`);

  const ourCountries = await query<{ id: number; name: string }>(
    "SELECT id, name FROM countries",
    opts,
  );
  const ourCities = await query<{
    id: number;
    country_id: number;
    slug: string;
    lat: number;
    lon: number;
  }>("SELECT id, country_id, slug, lat, lon FROM cities", opts);

  // ISO → our country id. A country GeoNames has and we do not is skipped rather than created:
  // countries are the hub every city page links up to, and inventing one from a city file would
  // give it no name we chose and no aggregates.
  const countryByIso = new Map<string, number>();
  const missing: string[] = [];
  for (const c of ourCountries) {
    const iso = geo.isoFor(c.name);
    if (iso) countryByIso.set(iso, c.id);
    else missing.push(c.name);
  }
  if (missing.length) {
    console.warn(`geonames: no ISO match for ${missing.length} countries — ${missing.join(", ")}`);
  }

  // Existing cities, bucketed by whole degree, so the distance search is over a handful of rows
  // rather than ten thousand. Same trick as CityIndex; not reusing it because that one is typed
  // for the seed's City and carries fields this does not have.
  const cells = new Map<string, typeof ourCities>();
  const key = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`;
  for (const c of ourCities) {
    const k = key(c.lat, c.lon);
    const bucket = cells.get(k);
    if (bucket) bucket.push(c);
    else cells.set(k, [c]);
  }
  const slugsByCountry = new Map<number, Set<string>>();
  for (const c of ourCities) {
    let set = slugsByCountry.get(c.country_id);
    if (!set) slugsByCountry.set(c.country_id, (set = new Set()));
    set.add(c.slug);
  }

  let nextId = Math.max(0, ...ourCities.map((c) => c.id)) + 1;
  const additions: (string | number | null)[][] = [];
  /** Our city id → the best GeoNames row seen for it, so a suburb cannot overwrite its city. */
  const best = new Map<number, { population: number; geonameId: number }>();
  let skippedCountry = 0;

  for (const g of geo.cities) {
    const countryId = countryByIso.get(g.cc);
    if (countryId === undefined) {
      skippedCountry++;
      continue;
    }

    const s = slug(g.ascii) || slug(g.name);

    // Candidates in the same country: the nearest by distance, and the nearest sharing the slug.
    let nearest: (typeof ourCities)[number] | null = null;
    let nearestKm = Infinity;
    let sameSlug: (typeof ourCities)[number] | null = null;
    let sameSlugKm = Infinity;

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        for (const c of cells.get(key(g.lat + dLat, g.lon + dLon)) ?? []) {
          if (c.country_id !== countryId) continue;
          const km = haversine(g.lat, g.lon, c.lat, c.lon);
          if (km < nearestKm) {
            nearestKm = km;
            nearest = c;
          }
          if (c.slug === s && km < sameSlugKm) {
            sameSlugKm = km;
            sameSlug = c;
          }
        }
      }
    }

    const match =
      sameSlug && sameSlugKm <= 50 ? sameSlug : nearest && nearestKm <= 2 ? nearest : null;

    if (match) {
      const held = best.get(match.id);
      if (!held || g.population > held.population) {
        best.set(match.id, { population: g.population, geonameId: g.geonameId });
      }
      continue;
    }

    if (!s) continue;
    const taken = slugsByCountry.get(countryId) ?? new Set<string>();
    let unique = s;
    for (let n = 2; taken.has(unique); n++) unique = `${s}-${n}`;
    taken.add(unique);
    slugsByCountry.set(countryId, taken);

    const id = nextId++;
    additions.push([
      id,
      countryId,
      unique,
      g.name.slice(0, 90),
      Math.round(g.lat * 1e5) / 1e5,
      Math.round(g.lon * 1e5) / 1e5,
      // Provisional; the rank pass below replaces it with the real ordering.
      9_999,
      g.population || null,
      g.geonameId,
    ]);
    // A new city joins the index, so the next GeoNames row two kilometres away matches it rather
    // than being added a second time under a suffixed slug.
    const row = { id, country_id: countryId, slug: unique, lat: g.lat, lon: g.lon };
    ourCities.push(row);
    const k = key(g.lat, g.lon);
    const bucket = cells.get(k);
    if (bucket) bucket.push(row);
    else cells.set(k, [row]);
  }

  console.log(
    `geonames: ${additions.length} new, ${best.size} matched to cities we already had` +
      (skippedCountry ? `, ${skippedCountry} in countries we do not carry` : ""),
  );

  const matches: (string | number | null)[][] = [...best.entries()].map(([id, m]) => [
    id,
    m.population || null,
    m.geonameId,
  ]);
  for (let i = 0; i < matches.length; i += 4_000) {
    await execute(
      update("cities", "id", ["population", "geoname_id"], matches.slice(i, i + 4_000)),
      { ...opts, label: `population (${Math.min(4_000, matches.length - i)})` },
    );
  }

  for (let i = 0; i < additions.length; i += 4_000) {
    await execute(
      upsert(
        "cities",
        ["id", "country_id", "slug", "name", "lat", "lon", "rank", "population", "geoname_id"],
        additions.slice(i, i + 4_000),
        { conflict: ["id"] },
      ),
      { ...opts, label: `new cities (${Math.min(4_000, additions.length - i)})` },
    );
  }

  // `rank` is what the sitemap and the search order use, and it now means what it always claimed
  // to: position by population within the country. Cities with no population figure sort last
  // rather than first, which is where SQLite would otherwise put a NULL.
  await execute(
    [
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY country_id
                  ORDER BY (population IS NULL), population DESC, rank
                ) - 1 AS r
           FROM cities
       )
       UPDATE cities SET rank = (SELECT r FROM ranked WHERE ranked.id = cities.id);`,
      `UPDATE countries SET city_count = COALESCE((
         SELECT COUNT(*) FROM cities WHERE cities.country_id = countries.id
       ), 0);`,
    ],
    { ...opts, label: "rank and city counts" },
  );

  const [after] = await query<{ n: number }>("SELECT COUNT(*) n FROM cities", opts);
  console.log(`geonames: ${after?.n ?? "?"} cities now`);
}
