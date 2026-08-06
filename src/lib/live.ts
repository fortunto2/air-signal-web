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

/** Long enough for a slow model server, short enough that a page never hangs on one. */
const TIMEOUT_MS = 6_000;

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function fetchReadings(lat: number, lon: number): Promise<Readings> {
  const q = `latitude=${lat}&longitude=${lon}`;

  // Settled, not all-or-nothing: a marine model that has nothing to say about an inland city must
  // not cost that city its temperature.
  const [weather, air, marine, sensors] = await Promise.allSettled([
    json(
      `https://api.open-meteo.com/v1/forecast?${q}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl" +
        "&hourly=uv_index&daily=sunrise,sunset&forecast_days=1&timezone=UTC&wind_speed_unit=kmh",
    ),
    json(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${q}` +
        "&current=pm2_5,pm10,alder_pollen,birch_pollen,grass_pollen,olive_pollen,ragweed_pollen",
    ),
    json(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,sea_surface_temperature`),
    json(`https://data.sensor.community/airrohr/v1/filter/area=${lat},${lon},15`),
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

  return {
    pm25: sensorPm25 ?? num(a.pm2_5),
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
export function storedReadings(
  r: Readings,
  extra: { pm10?: number; seaTempC?: number } = {},
): Record<string, number> {
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
  put("pollen", r.pollen, 0);
  return out;
}

function value(r: PromiseSettledResult<any>): any {
  return r.status === "fulfilled" ? r.value : null;
}

function num(v: unknown): number | undefined {
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
