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

import type { Readings } from "./signals";
import { core } from "./core";

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
  kp?: number;
  quakeMagnitude?: number;
  moonPhase?: number;
}

/**
 * Phase 0..1, full moon at 0.5. Delegated to the core rather than reimplemented, because the site
 * already scores it there and two implementations of an astronomical formula is one too many.
 */
function moonPhaseFor(d: Date): number {
  return core().wasm_moon_phase(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Kilometres between two points, from the same haversine the ETL and the map use. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return core().wasm_haversine(lat1, lon1, lat2, lon2);
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
let globals: { at: number; kp?: number; quakes: { lat: number; lon: number; magnitude: number }[] } | null =
  null;

async function globalFeeds() {
  if (globals && Date.now() - globals.at < 15 * 60_000) return globals;

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

  const quakes: { lat: number; lon: number; magnitude: number }[] = [];
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
  extras?: { out: Extras },
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
  const moon = moonPhaseFor(now);

  const g = shared.status === "fulfilled" ? shared.value : null;
  if (extras) {
    extras.out.moonPhase = moon;
    if (g?.kp !== undefined) extras.out.kp = g.kp;
  }

  // The largest quake within reach. -1 rather than undefined when the feed loaded and found
  // nothing: a quiet day is a reading worth a hundred points, and an outage is not.
  let quake: number | undefined;
  if (g) {
    let worst = -1;
    for (const q of g.quakes) {
      if (haversineKm(lat, lon, q.lat, q.lon) <= 300 && q.magnitude > worst) worst = q.magnitude;
    }
    quake = worst;
    if (extras) extras.out.quakeMagnitude = worst;
  }

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
    for (const v of row?.sensordatavalues ?? []) {
      const n = Number.parseFloat(v?.value);
      // Outside this window is a broken sensor, not clean or catastrophic air.
      if (v?.value_type === "P2" && Number.isFinite(n) && n > 0 && n <= 500) values.push(n);
    }
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}
