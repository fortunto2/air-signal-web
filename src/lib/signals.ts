/**
 * Readings → the fourteen scores. One definition, two runtimes.
 *
 * The ETL runs this under Node against the full WASM build; the browser island runs the same code
 * against the slim one. Passing the module in rather than importing it is what lets that happen —
 * and it is why the number a visitor sees after hydration is the same number the crawler was
 * served, rather than a JavaScript approximation of it.
 *
 * The Next version had two implementations of this and they drifted within a week.
 */

import type { SignalKey } from "./site";

/** The subset of `airq-core` this module needs. Both builds satisfy it. */
export interface SignalCore {
  wasm_signal_comfort(json: string): string;
  wasm_normalize_air(pm25: number): number;
  wasm_normalize_temperature(tempC: number): number;
  wasm_normalize_uv(uv: number): number;
  wasm_normalize_wind(speedKmh: number): number;
  wasm_normalize_marine(waveHeightM: number): number;
  wasm_normalize_earthquake(magnitude: number): number;
  wasm_normalize_fire(distanceKm: number): number;
  wasm_normalize_pollen(maxPollen: number): number;
  wasm_normalize_pressure(currentHpa: number, change3h: number): number;
  wasm_normalize_geomagnetic(kp: number): number;
  wasm_normalize_moon(phase: number): number;
  wasm_normalize_daylight(hours: number): number;
  wasm_normalize_humidity(humidityPct: number): number;
  wasm_normalize_noise(db: number): number;
}

/** Raw environmental readings, in the units `airq-core` normalizes from. Absent means unread. */
export interface Readings {
  pm25?: number;
  temperatureC?: number;
  uv?: number;
  windKmh?: number;
  waveHeightM?: number;
  /** Absent when nothing was in reach: an event signal reports events, not their absence. */
  quakeMagnitude?: number;
  fireDistanceKm?: number;
  pollen?: number;
  pressureHpa?: number;
  pressureChange3h?: number;
  kp?: number;
  moonPhase?: number;
  daylightHours?: number;
  humidityPct?: number;
  noiseDb?: number;
}

export type Scores = Partial<Record<SignalKey, number>>;

/**
 * A reading we do not have produces no score at all, rather than a zero. `weighted_score` drops the
 * missing column from its denominator, so a city with no noise sensor is judged on what it actually
 * knows — and a renderer can tell "silent" from "as loud as it gets".
 *
 * The key is `sea`, not `marine`. `marine` is only the name of the normalize function, and
 * `SignalRow::from_pairs` discards keys it does not recognise without saying so.
 */
export function scoresFrom(core: SignalCore, r: Readings): Scores {
  const s: Scores = {};
  const put = (k: SignalKey, v: number | undefined, f: (n: number) => number) => {
    if (v === undefined || !Number.isFinite(v)) return;
    s[k] = f(v);
  };

  put("air", r.pm25, (v) => core.wasm_normalize_air(v));
  put("temperature", r.temperatureC, (v) => core.wasm_normalize_temperature(v));
  put("wind", r.windKmh, (v) => core.wasm_normalize_wind(v));
  put("sea", r.waveHeightM, (v) => core.wasm_normalize_marine(v));
  put("uv", r.uv, (v) => core.wasm_normalize_uv(v));
  put("earthquake", r.quakeMagnitude, (v) => core.wasm_normalize_earthquake(v));
  put("fire", r.fireDistanceKm, (v) => core.wasm_normalize_fire(v));
  put("pollen", r.pollen, (v) => core.wasm_normalize_pollen(v));
  put("geomagnetic", r.kp, (v) => core.wasm_normalize_geomagnetic(v));
  put("humidity", r.humidityPct, (v) => core.wasm_normalize_humidity(v));
  put("daylight", r.daylightHours, (v) => core.wasm_normalize_daylight(v));
  put("noise", r.noiseDb, (v) => core.wasm_normalize_noise(v));
  put("moon", r.moonPhase, (v) => core.wasm_normalize_moon(v));

  if (r.pressureHpa !== undefined && Number.isFinite(r.pressureHpa)) {
    s.pressure = core.wasm_normalize_pressure(r.pressureHpa, r.pressureChange3h ?? 0);
  }
  return s;
}

/** Signal weights, mirrored from airq-core/src/matrix.rs:62 so "worst" means weighted-worst. */
export const WEIGHTS: Record<SignalKey, number> = {
  air: 0.2,
  temperature: 0.16,
  wind: 0.1,
  sea: 0.1,
  uv: 0.08,
  earthquake: 0.08,
  fire: 0.05,
  pollen: 0.04,
  pressure: 0.05,
  geomagnetic: 0.03,
  humidity: 0.04,
  daylight: 0.02,
  noise: 0.03,
  moon: 0.02,
};

export interface Comfort {
  total: number;
  scores: Scores;
  /** The signal costing the most weighted points — the one the verdict sentence names. */
  worst: SignalKey | null;
}

export function comfortFrom(core: SignalCore, scores: Scores): Comfort {
  const parsed = JSON.parse(core.wasm_signal_comfort(JSON.stringify(scores))) as Record<
    string,
    number
  >;
  const { total, ...rest } = parsed;

  // Worst = the signal shedding the most weighted points, not the lowest raw score. Daylight at 30
  // costs 1.4 points; air at 40 costs 12. Naming daylight would be arithmetically true and useless.
  let worst: SignalKey | null = null;
  let worstCost = 0;
  for (const [k, v] of Object.entries(rest)) {
    const w = WEIGHTS[k as SignalKey];
    if (w === undefined) continue;
    const cost = (100 - v) * w;
    if (cost > worstCost) {
      worstCost = cost;
      worst = k as SignalKey;
    }
  }

  return { total: total ?? 0, scores: rest as Scores, worst };
}
