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
import { fetchReadings, storedReadings } from "./live";

let ready = false;

/**
 * Instantiated once per isolate, on first use — not at module scope, so the pages that never score
 * anything (a station page, the sitemap, robots.txt) do not pay for it.
 */
function core(): SignalCore {
  if (!ready) {
    wasm.initSync({ module: wasmModule as unknown as WebAssembly.Module });
    ready = true;
  }
  return wasm as unknown as SignalCore;
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
    const readings = await fetchReadings(lat, lon);

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
    return { ...comfort, readings: storedReadings(readings) };
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
