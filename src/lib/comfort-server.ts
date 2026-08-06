/**
 * Comfort computed inside the Worker, on demand.
 *
 * The batch ingest used to compute all 10 596 cities every night whether or not anyone looked at
 * them. That is ten thousand upstream calls a day for a long tail where most pages get no traffic
 * for months, and it is what exhausted Open-Meteo's daily quota and left every city page blank.
 *
 * So the expensive half moved here: a city page with stale or missing readings fetches its own
 * four upstreams, scores them with the same WASM the ingest uses, renders the fresh numbers, and
 * writes them back to D1 so the next visitor — human or crawler — pays nothing. The nightly pass
 * now only warms the cities that have sensors, because the home page, the ranking and the country
 * pages are aggregates and cannot be lazy.
 *
 * Crawlers are the load here, and that is fine: a single-coordinate call is the cheapest shape
 * Open-Meteo bills, one full crawl of the site warms every page, and the write-back means the
 * second crawl costs nothing at all.
 */

import * as wasm from "../wasm/web/airq_core.js";
// The compiled module, as a deploy-time import. This is the *only* way WebAssembly gets into a
// Cloudflare Worker: runtime compilation is refused outright —
// `WebAssembly.compile(): Wasm code generation disallowed by embedder` — so fetching the binary
// from the ASSETS binding and compiling it does not work, however tidy it looks.
//
// It is also why nothing else may import this file with `?url`: Vite resolves both forms from one
// id, the client build wins, and the server bundle ends up holding an asset path instead of a
// module. The browser therefore does not load WASM at all — it asks /api/comfort, which is
// cheaper for the visitor anyway.
import wasmModule from "../wasm/web/airq_core_bg.wasm";
import { comfortFrom, scoresFrom, type Comfort, type SignalCore } from "./signals";
import { fetchReadings, storedReadings, type Extras } from "./live";

/**
 * The parts of `airq-core` that are not the comfort maths.
 *
 * Every one of these is a calculation that already existed in Rust and only ever ran in a
 * terminal. Reimplementing any of it in TypeScript would be a second opinion about the same facts,
 * which is the failure the whole two-runtimes-one-binary arrangement exists to prevent.
 */
interface AirqExtras {
  wasm_classify_source(pm25: number, pm10: number): string;
  wasm_detect_event(json: string): string;
  wasm_calculate_cpf(json: string): string;
  wasm_aqi_category(aqi: number): string;
  wasm_pm25_aqi(v: number): number;
  wasm_pm10_aqi(v: number): number;
  wasm_wind_direction(degrees: number): string;
  wasm_haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;
  wasm_merge(json: string): string;
}

let ready = false;

/**
 * Instantiated once per isolate, on first use — not at module scope, so the pages that never score
 * anything (a station page, the sitemap, robots.txt) do not pay for it.
 */
function core(): SignalCore & AirqExtras {
  if (!ready) {
    wasm.initSync({ module: wasmModule as unknown as WebAssembly.Module });
    ready = true;
  }
  return wasm as unknown as SignalCore & AirqExtras;
}

// ── the things Rust knows that the score does not say ───────────────────────

export interface SourceHint {
  category: string;
  label: string;
  confidence: number;
  reason: string;
  typical_sources: string[];
  advice: string;
}

/**
 * What this air is made of, from the PM10/PM2.5 ratio.
 *
 * Coarse particles dominating means dust; a ratio near one means combustion. Two numbers the site
 * already has turn into a named category, the reasoning with the figures in it, and advice — which
 * is a different and more useful sentence than any score.
 */
export function classifySource(pm25: number | null, pm10: number | null): SourceHint | null {
  if (pm25 === null || pm10 === null || pm25 <= 0 || pm10 <= 0) return null;
  try {
    return JSON.parse(core().wasm_classify_source(pm25, pm10)) as SourceHint;
  } catch {
    return null;
  }
}

export interface AqiReading {
  aqi: number;
  label: string;
  emoji: string;
  color: string;
}

/** US EPA AQI with its category. The number people actually search for, alongside our own score. */
export function aqi(pm25: number | null, pm10: number | null): AqiReading | null {
  const c = core();
  const values = [
    pm25 !== null && pm25 > 0 ? c.wasm_pm25_aqi(pm25) : 0,
    pm10 !== null && pm10 > 0 ? c.wasm_pm10_aqi(pm10) : 0,
  ].filter((n) => n > 0);
  if (values.length === 0) return null;

  const worst = Math.max(...values);
  try {
    const cat = JSON.parse(c.wasm_aqi_category(worst)) as {
      label: string;
      emoji: string;
      color: string;
    };
    return { aqi: worst, ...cat };
  } catch {
    return null;
  }
}

/** Great-circle kilometres, from Rust rather than a fourth JavaScript copy of the formula. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return core().wasm_haversine(lat1, lon1, lat2, lon2);
}

/** 16-point compass label and an arrow, from Rust so the vocabulary matches the CLI's. */
export function windDirection(degrees: number | undefined): { label: string; arrow: string } | null {
  if (degrees === undefined || !Number.isFinite(degrees)) return null;
  try {
    return JSON.parse(core().wasm_wind_direction(degrees)) as { label: string; arrow: string };
  } catch {
    return null;
  }
}

export interface EventAnalysis {
  concordance: { event_type: string; anomaly_count: number; total_sensors: number; score: number };
  directional: { bearing_deg: number; bearing_label: string; spread_deg: number; is_directional: boolean } | null;
  median_pm25: number;
  median_pm10: number;
  pm10_pm25_ratio: number;
  source_hint: SourceHint;
  confidence: number;
  summary: string;
}

/**
 * Is something happening, or is one device having a bad day?
 *
 * The question every air map gets wrong. One sensor reading high is noise; seven reading high on
 * the same side of town is something arriving, and saying which is the entire value of having a
 * network rather than a sensor.
 *
 * Costs nothing extra: the baseline is the median of the city's own devices, so the comparison is
 * this sensor against its neighbours right now. No history, no database, no second request.
 */
export function detectEvent(
  lat: number,
  lon: number,
  devices: { id: number; lat: number; lon: number; pm25: number | null; pm10: number | null }[],
): EventAnalysis | null {
  const usable = devices.filter((d) => d.pm25 !== null && d.pm25 > 0);
  // Under four devices there is no "most of them" to speak of, and concordance would be reading
  // tea leaves — which is exactly the false positive this function exists to avoid.
  if (usable.length < 4) return null;

  const pm25 = usable.map((d) => d.pm25!);
  const pm10 = usable.map((d) => d.pm10 ?? d.pm25! * 1.5);
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const variance = (xs: number[], mean: number) =>
    Math.max(1, xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length);

  const m25 = med(pm25);
  const m10 = med(pm10);

  try {
    const out = JSON.parse(
      core().wasm_detect_event(
        JSON.stringify({
          lat,
          lon,
          k: 2,
          readings: usable.map((d, i) => ({
            sensor_id: d.id,
            lat: d.lat,
            lon: d.lon,
            pm25: pm25[i],
            pm10: pm10[i],
          })),
          baseline: { pm25: m25, pm25_var: variance(pm25, m25), pm10: m10, pm10_var: variance(pm10, m10) },
        }),
      ),
    ) as EventAnalysis & { error?: string };
    return out.error ? null : out;
  } catch {
    return null;
  }
}

export interface FreshComfort extends Comfort {
  /** The raw values, in their own units — what the page prints and what D1 stores. */
  readings: Record<string, number>;
}

/**
 * Live readings for a coordinate, scored.
 *
 * Returns `null` when the upstreams cannot be reached — rate-limited, slow, down. That is a
 * deliberate signal to the caller to render whatever the database already has: a page showing
 * yesterday's real numbers is right, and a page showing an error because today's fetch failed is
 * not.
 */
export async function computeComfort(lat: number, lon: number): Promise<FreshComfort | null> {
  try {
    const extras: { out: Extras } = { out: {} };
    const readings = await fetchReadings(lat, lon, extras);

    // Temperature is the marker for the main weather upstream. Without it the forecast API failed
    // — no temperature, wind, pressure, humidity, UV or daylight — and what is left is three
    // signals out of fourteen. Scoring that produces a number (the maths correctly ignores what it
    // cannot see) but storing it would cache a confident-looking answer built on almost nothing,
    // and `isStale` would keep it for an hour and a half. Better to serve what the database has.
    if (readings.temperatureC === undefined) {
      console.error(`[comfort] ${lat},${lon}: no temperature — the forecast upstream is unavailable`);
      return null;
    }

    const c = core();
    const comfort = comfortFrom(c, scoresFrom(c, readings));
    return { ...comfort, readings: storedReadings(readings, extras.out) };
  } catch (err) {
    // Logged, not swallowed. A bare `catch {}` here turns "the upstream is rate-limited" and "the
    // WASM failed to instantiate" into the same blank page, and only one of those is survivable.
    console.error(
      `[comfort] ${lat},${lon}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  }
}

/** How long a stored reading stays good enough to serve without going back to the upstreams. */
export const FRESH_FOR_MINUTES = 90;

export function isStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > FRESH_FOR_MINUTES * 60_000;
}
