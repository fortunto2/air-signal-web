/**
 * The Node-side `airq-core`, and the thin bindings around it.
 *
 * Everything the site claims about comfort, divergence and place names is computed by the same
 * Rust the CLI and the desktop app run — not a JavaScript re-derivation of it. The Next version
 * reimplemented the normalizers in JS "to avoid WASM on the server" and they drifted from the Rust
 * weights within a week; that is the failure this module exists to prevent.
 *
 * The scoring itself lives in `src/lib/signals.ts` and takes the WASM module as an argument, so
 * the browser island and this file run the identical code against their respective builds.
 */

import { createRequire } from "node:module";
import {
  comfortFrom as comfortFromCore,
  scoresFrom as scoresFromCore,
  type Comfort,
  type Readings,
  type Scores,
  type SignalCore,
} from "../src/lib/signals.ts";

const require = createRequire(import.meta.url);

interface AirqCore extends SignalCore {
  wasm_merge(json: string): string;
  wasm_classify_source(pm25: number, pm10: number): string;
  wasm_haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;
  wasm_bearing(lat1: number, lon1: number, lat2: number, lon2: number): number;
  wasm_moon_phase(year: number, month: number, day: number): number;

  wasm_list_countries(): string;
  wasm_major_cities(country: string, limit: number): string;
  wasm_search_cities(query: string): string;
}

/** `--target nodejs`, so it is CommonJS and resolves its own .wasm next to the glue. */
export const core: AirqCore = require("../src/wasm/node/airq_core.js");

export const scoresFrom = (r: Readings): Scores => scoresFromCore(core, r);
export const comfortFrom = (s: Scores): Comfort => comfortFromCore(core, s);

export type { Comfort, Readings, Scores };

// ── merge ───────────────────────────────────────────────────────────────────

export interface Merged {
  pm25: number;
  pm10: number;
  model_pm25: number | null;
  sensor_pm25: number | null;
  sensor_count: number;
  model_weight: number;
  divergence: number;
  source: string;
}

/** The Moscow correction: sensors are ground truth, the model is weighted down as it disagrees. */
export function merge(input: {
  model_pm25?: number | null;
  model_pm10?: number | null;
  sensor_pm25?: number | null;
  sensor_pm10?: number | null;
  sensor_count: number;
}): Merged {
  return JSON.parse(core.wasm_merge(JSON.stringify(input))) as Merged;
}

export const haversine = core.wasm_haversine;
/** Degrees clockwise from north. The same one `directional_cluster` measures anomalies with. */
export const bearing = core.wasm_bearing;

/** Moon phase 0–1 for a UTC date. Cheap, and the only signal that needs no network at all. */
export function moonPhase(d: Date): number {
  return core.wasm_moon_phase(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
