/**
 * Live readings for one coordinate, fetched straight from the upstreams.
 *
 * Shared by the worker (on a cold city page) and by the browser island (on hydration), because the
 * number a visitor sees after hydration must be the number the crawler was served — not a second
 * implementation's opinion of it. The maths that turns these into scores lives in `signals.ts`,
 * also shared; this file only gathers.
 *
 * Every upstream here sends `access-control-allow-origin: *`, which is why the browser can call
 * them directly and why this site has no proxy routes. NASA FIRMS does not, so `fire` is absent
 * from a live refresh and keeps whatever the ingest last stored — refreshing a page must never
 * remove a reading from it.
 */

import type { Readings, SignalCore } from "./signals";

/** Long enough for a slow model server, short enough that a page never hangs on one. */
const TIMEOUT_MS = 6_000;

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Everything the page shows that is not one of the fourteen scores. */
export interface Extras {
  pm10?: number;
  seaTempC?: number;
  /** Degrees the wind is coming *from*. Rust turns it into a compass label and an arrow. */
  windDirection?: number;
}

/**
 * One device's PM2.5, or nothing, applied by both runtimes.
 *
 * Lived in `cli/upstreams.ts` alone, which meant the nightly pass rejected Pfullingen's broken
 * device and the Worker accepted it — and since `saveCityReadings` writes the Worker's answer back
 * into the same row, opening the page undid the night's work. The city went 2.7 → 197 on a refresh.
 *
 * Two rules, both about physics rather than thresholds:
 *
 * PM2.5 is a subset of PM10 — every particle under 2.5 micrometres is also under ten — so a device
 * reporting more fine than coarse is reporting a fault.
 *
 * And an extreme PM2.5 with no PM10 at all is the same fault with one channel dead: an SDS011
 * publishes both in 8 359 of 8 376 readings, and among the seventeen that publish only PM2.5 the
 * average is 372 µg/m³. Below 50 an uncorroborated reading changes nothing, so the rule only fires
 * where it would matter.
 */
export interface Quake {
  lat: number;
  lon: number;
  magnitude: number;
}

/**
 * The strongest quake felt at a point, or nothing.
 *
 * One implementation, because there were two and they disagreed. The ETL used a 500 km radius with
 * the magnitude attenuated by distance; the Worker used 300 km and the raw magnitude. An M5.0 at
 * 250 km therefore scored 3.2 from one and 5.0 from the other — and both write the answer into the
 * same row, so a city's earthquake reading changed depending on which touched it last, with nothing
 * in the data saying which.
 *
 * Magnitude is logarithmic and attenuating it linearly with distance is crude, but the signal only
 * needs an ordering, not a seismology paper.
 *
 * `undefined` when nothing is in reach: an event signal reports events, not their absence. Scoring
 * "no earthquake" as a hundred pinned eight per cent of every score to the maximum for essentially
 * every place on Earth, which separated nothing.
 */
export function quakeFelt(
  quakes: Quake[],
  lat: number,
  lon: number,
  haversine: (a: number, b: number, c: number, d: number) => number,
  radiusKm = 500,
): number | undefined {
  let felt = -1;
  for (const q of quakes) {
    // A cheap box before the trigonometry: at these radii a degree is never less than ~78 km.
    if (Math.abs(q.lat - lat) > 6 || Math.abs(q.lon - lon) > 8) continue;
    const d = haversine(lat, lon, q.lat, q.lon);
    if (d > radiusKm) continue;
    const effective = q.magnitude * (1 - d / (radiusKm * 1.4));
    if (effective > felt) felt = effective;
  }
  return felt < 0 ? undefined : felt;
}

export function usablePm25(pm25: number | null, pm10: number | null): number | null {
  if (pm25 === null || !Number.isFinite(pm25) || pm25 <= 0 || pm25 > 500) return null;
  if (pm10 !== null && Number.isFinite(pm10) && pm25 > pm10) return null;
  if (pm10 === null && pm25 > 50) return null;
  return pm25;
}

/**
 * The two core functions this file needs, handed in rather than imported.
 *
 * Importing the core here would be a static import of the *web* WASM build, and this module is
 * also read by the Node CLI — which loads the node build. Naming the import was enough to crash
 * the ETL with "cannot find airq_core_bg.js", because ESM imports are hoisted whether the code
 * path runs or not. So the caller, which already holds the right build for its runtime, passes it.
 */
export interface LiveCore {
  wasm_moon_phase(year: number, month: number, day: number): number;
  wasm_haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;
}

/**
 * The two feeds that are the same for everybody.
 *
 * Geomagnetic activity is one number for the whole planet, and the earthquake summary is one
 * document listing every event above magnitude 2.5 in the last day. Fetching them per city would
 * be the same two responses ten thousand times, so they are fetched once and held for the life of
 * the isolate — which on a Worker is minutes, and both change on the order of hours.
 *
 * This is why a city warmed on demand used to show six of fourteen signals absent while the same
 * city warmed by the nightly pass showed nine: the ETL fetched these and the Worker never did.
 */
interface GlobalFeeds {
  at: number;
  kp?: number;
  quakes: Quake[];
}

let globals: GlobalFeeds | null = null;
let inFlight: Promise<GlobalFeeds> | null = null;

async function globalFeeds() {
  if (globals && Date.now() - globals.at < 15 * 60_000) return globals;
  // The promise is memoised, not just its result. A crawler burst starts twenty cold renders in one
  // isolate before the first fetch returns; caching only the value let all twenty fire their own
  // pair of requests at two public feeds and throw nineteen of the answers away.
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function load(): Promise<GlobalFeeds> {

  const [kpRes, quakeRes] = await Promise.allSettled([
    json("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
    json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"),
  ]);

  // The feed publishes either an array of rows or an array of objects depending on the day, and
  // reading only one shape is how geomagnetic once vanished from every city on Earth at once.
  let kp: number | undefined;
  if (kpRes.status === "fulfilled") {
    const rows = kpRes.value as unknown[] | undefined;
    const last = rows?.at(-1) as Record<string, unknown> | unknown[] | undefined;
    const v = Array.isArray(last)
      ? Number(last[1])
      : Number(last?.["Kp"] ?? last?.["kp_index"] ?? last?.["k_index"]);
    if (Number.isFinite(v)) kp = v;
  }

  const quakes: Quake[] = [];
  if (quakeRes.status === "fulfilled") {
    const features = (quakeRes.value as { features?: unknown[] } | undefined)?.features ?? [];
    for (const f of features as Record<string, any>[]) {
      const lon = Number(f?.geometry?.coordinates?.[0]);
      const lat = Number(f?.geometry?.coordinates?.[1]);
      const magnitude = Number(f?.properties?.mag);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(magnitude)) {
        quakes.push({ lat, lon, magnitude });
      }
    }
  }

  globals = { at: Date.now(), kp, quakes };
  return globals;
}

export async function fetchReadings(
  lat: number,
  lon: number,
  extras: { out: Extras } | undefined,
  // Required, not optional. When it was optional an omitted argument silently dropped the moon and
  // every earthquake from a city's score, with no log — the exact failure CLAUDE.md warns against.
  core: LiveCore,
): Promise<Readings> {
  const q = `latitude=${lat}&longitude=${lon}`;

  // Settled, not all-or-nothing: a marine model that has nothing to say about an inland city must
  // not cost that city its temperature.
  const [weather, air, marine, sensors, shared] = await Promise.allSettled([
    json(
      `https://api.open-meteo.com/v1/forecast?${q}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl" +
        "&hourly=uv_index&daily=sunrise,sunset&forecast_days=1&timezone=UTC&wind_speed_unit=kmh",
    ),
    json(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${q}` +
        "&current=pm2_5,pm10,alder_pollen,birch_pollen,grass_pollen,olive_pollen,ragweed_pollen",
    ),
    json(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,sea_surface_temperature`),
    json(`https://data.sensor.community/airrohr/v1/filter/area=${lat},${lon},15`),
    globalFeeds(),
  ]);

  const w = value(weather)?.current ?? {};
  const a = value(air)?.current ?? {};
  const m = value(marine)?.current ?? {};
  const daily = value(weather)?.daily ?? {};

  // Community sensors are ground truth where they exist; the model is the fallback. Same ordering
  // as the ingest, so hydration cannot flip a page from sensor-backed to modelled and back.
  const sensorPm25 = medianPm25(value(sensors));

  const sunrise = daily?.sunrise?.[0];
  const sunset = daily?.sunset?.[0];

  const pollens = [a.alder_pollen, a.birch_pollen, a.grass_pollen, a.olive_pollen, a.ragweed_pollen]
    .map(Number)
    .filter((n) => Number.isFinite(n));

  if (extras) {
    extras.out = {
      pm10: num(a.pm10),
      seaTempC: num(m.sea_surface_temperature),
      windDirection: num(w.wind_direction_10m),
    };
  }

  // The moon costs nothing: it is arithmetic on today's date, and it was absent from every
  // on-demand city purely because the code that computed it lived in the nightly pass.
  const now = new Date();
  const moon = core.wasm_moon_phase(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());

  const g = shared.status === "fulfilled" ? shared.value : null;

  // The largest quake within reach, or nothing. See `quakeNear` in cli/upstreams.ts for why "no
  // event" is absent rather than a hundred: a signal that is maximal for every place on Earth
  // cannot separate any two of them, it only lifts them all.
  const quake = g ? quakeFelt(g.quakes, lat, lon, core.wasm_haversine) : undefined;

  return {
    pm25: sensorPm25 ?? num(a.pm2_5),
    moonPhase: moon,
    kp: g?.kp,
    quakeMagnitude: quake,
    temperatureC: num(w.temperature_2m),
    humidityPct: num(w.relative_humidity_2m),
    windKmh: num(w.wind_speed_10m),
    pressureHpa: num(w.pressure_msl),
    uv: num(value(weather)?.hourly?.uv_index?.[new Date().getUTCHours()]),
    daylightHours:
      sunrise && sunset ? (Date.parse(sunset) - Date.parse(sunrise)) / 3_600_000 : undefined,
    waveHeightM: num(m.wave_height),
    // Pollen coverage is Europe-only. Outside it every species is null, and that is "unknown",
    // not "no pollen" — so the signal stays absent rather than scoring a perfect 100.
    pollen: pollens.length ? Math.max(...pollens) : undefined,
  };
}

/** The raw values a page prints, in their own units — the shape stored as `readings_json`. */
export function storedReadings(r: Readings, extra: Extras = {}): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (k: string, v: number | undefined, places: number) => {
    if (v === undefined || !Number.isFinite(v)) return;
    out[k] = Math.round(v * 10 ** places) / 10 ** places;
  };
  put("pm25", r.pm25, 1);
  put("pm10", extra.pm10, 1);
  put("temperature", r.temperatureC, 1);
  put("humidity", r.humidityPct, 0);
  put("wind", r.windKmh, 1);
  put("pressure", r.pressureHpa, 0);
  put("uv", r.uv, 1);
  put("daylight", r.daylightHours, 1);
  put("wave", r.waveHeightM, 2);
  put("sea_temp", extra.seaTempC, 1);
  put("wind_dir", extra.windDirection, 0);
  put("pollen", r.pollen, 0);
  // The four the ingest can supply and a live refresh cannot: they come from global feeds it
  // downloads once for the whole world, which is not worth a request for one page view. Listed
  // here anyway so there is exactly one description of what `readings_json` holds — the ETL used
  // to keep its own copy of this table and the two had already drifted in opposite directions.
  put("kp", r.kp, 2);
  put("quake", r.quakeMagnitude, 1);
  put("fire_km", r.fireDistanceKm, 0);
  put("moon", r.moonPhase, 2);
  return out;
}

function value(r: PromiseSettledResult<any>): any {
  return r.status === "fulfilled" ? r.value : null;
}

/**
 * Coerce to a number, or report absence.
 *
 * `null` is spelled out because `Number(null)` is **0**, not NaN — so a bare `Number.isFinite`
 * guard passes every null an upstream sends and turns it into a measurement of zero. Open-Meteo
 * returns `null` for a marine reading inland, which is how Berlin came to have a sea at 0 °C with
 * flat water, scoring 95 out of 100 on a signal it has no business having at all. Absent is not
 * zero, and this is the function where that rule is either kept or lost.
 */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Median, not mean — one broken device beside a road must not move the city's number. */
function medianPm25(rows: any): number | undefined {
  if (!Array.isArray(rows)) return undefined;
  const values: number[] = [];
  for (const row of rows) {
    if (Number(row?.location?.indoor) === 1) continue;

    // Both channels, because the validity rule needs the coarse one to judge the fine one. Reading
    // only P2 is how this path used to accept the reading the ETL had just thrown away.
    let pm25: number | null = null;
    let pm10: number | null = null;
    for (const v of row?.sensordatavalues ?? []) {
      const n = Number.parseFloat(v?.value);
      if (!Number.isFinite(n)) continue;
      if (v?.value_type === "P2") pm25 = n;
      if (v?.value_type === "P1") pm10 = n;
    }

    const usable = usablePm25(pm25, pm10);
    if (usable !== null) values.push(usable);
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}
