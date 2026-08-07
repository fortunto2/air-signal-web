/**
 * `airq-core`, instantiated once per isolate.
 *
 * Extracted so that both the comfort maths and the upstream gathering can reach it. They cannot
 * both import `comfort-server.ts` — that file imports `live.ts`, so the second import would close a
 * cycle — and duplicating an astronomical formula or a haversine to avoid the cycle is the exact
 * second-opinion-about-the-same-facts that the shared binary exists to prevent.
 */

import * as wasm from "../wasm/web/airq_core.js";
// The compiled module, as a deploy-time import. This is the *only* way WebAssembly gets into a
// Cloudflare Worker: runtime compilation is refused outright —
// `WebAssembly.compile(): Wasm code generation disallowed by embedder` — so fetching the binary
// from the ASSETS binding and compiling it does not work, however tidy it looks.
//
// It is also why nothing else may import this binary with `?url`: Vite resolves both forms from one
// id, the client build wins, and the server bundle ends up holding an asset path instead of a
// module. The browser therefore does not load WASM at all — it asks /api/comfort, which is cheaper
// for the visitor anyway.
import wasmModule from "../wasm/web/airq_core_bg.wasm";
import type { SignalCore } from "./signals";

/**
 * The parts of `airq-core` that are not the comfort maths.
 *
 * Every one of these is a calculation that already existed in Rust and only ever ran in a terminal.
 */
export interface AirqExtras {
  wasm_classify_source(pm25: number, pm10: number): string;
  wasm_detect_event(json: string): string;
  wasm_calculate_cpf(json: string): string;
  wasm_aqi_category(aqi: number): string;
  wasm_pm25_aqi(v: number): number;
  wasm_pm10_aqi(v: number): number;
  wasm_wind_direction(degrees: number): string;
  wasm_haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;
  wasm_bearing(lat1: number, lon1: number, lat2: number, lon2: number): number;
  wasm_moon_phase(year: number, month: number, day: number): number;
  wasm_merge(json: string): string;
}

let ready = false;

/**
 * Instantiated on first use, not at module scope, so the pages that never score anything — a
 * sitemap shard, robots.txt — do not pay for it.
 */
export function core(): SignalCore & AirqExtras {
  if (!ready) {
    wasm.initSync({ module: wasmModule as unknown as WebAssembly.Module });
    ready = true;
  }
  return wasm as unknown as SignalCore & AirqExtras;
}
