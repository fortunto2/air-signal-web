#!/usr/bin/env tsx
/**
 * Air Signal CLI — the site's business logic without the site.
 *
 * CLI-first testing: every deterministic thing the pages do can be run here, so `make integration`
 * exercises the real pipeline without a browser, a build, or a network round-trip through UI code.
 *
 *   pnpm stations            rebuild data/stations.json from Sensor.Community
 *   pnpm stations:check      verify the committed index is present and well-formed (build gate)
 *   pnpm comfort -- <lat> <lon>   compute the fourteen signals for a point
 *   pnpm integration         end-to-end check against live upstreams
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(ROOT, "data", "stations.json");

/** Global feed: every station that reported in the last five minutes. */
const SENSOR_COMMUNITY_NOW = "https://data.sensor.community/static/v2/data.json";

interface Station {
  id: number;
  lat: number;
  lon: number;
  country: string;
  /** Nearest city from the cities database — assigned when the index is built, never at render. */
  city: string | null;
  pm25: number | null;
  pm10: number | null;
  seenAt: string;
}

interface StationIndex {
  builtAt: string;
  source: string;
  stations: Station[];
}

// ── commands ────────────────────────────────────────────────────────────────

/**
 * Rebuild the station index.
 *
 * The result is committed to the repo on purpose. A build that fetches its own page list is a build
 * that silently ships half a site when the upstream has a bad minute; a committed index makes the
 * page list a reviewable diff.
 */
async function buildStations(): Promise<void> {
  console.log(`fetching ${SENSOR_COMMUNITY_NOW} …`);
  const res = await fetch(SENSOR_COMMUNITY_NOW);
  if (!res.ok) throw new Error(`upstream ${res.status} ${res.statusText}`);

  const raw = (await res.json()) as Array<Record<string, any>>;
  const byId = new Map<number, Station>();

  for (const row of raw) {
    const id = row?.sensor?.id;
    const loc = row?.location;
    if (!id || !loc) continue;

    const lat = Number.parseFloat(loc.latitude);
    const lon = Number.parseFloat(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let pm25: number | null = null;
    let pm10: number | null = null;
    for (const v of row.sensordatavalues ?? []) {
      const n = Number.parseFloat(v.value);
      // Values outside this window are a broken sensor, not clean or catastrophic air. Keeping
      // them would colour a pin bright red on the strength of a dying fan.
      if (!Number.isFinite(n) || n <= 0 || n > 500) continue;
      if (v.value_type === "P2") pm25 = n;
      if (v.value_type === "P1") pm10 = n;
    }
    if (pm25 === null && pm10 === null) continue;

    byId.set(id, {
      id,
      lat,
      lon,
      country: (loc.country ?? "").toUpperCase(),
      city: null, // TODO: nearest-city assignment via airq-core `wasm_search_cities`
      pm25,
      pm10,
      seenAt: row.timestamp ?? new Date().toISOString(),
    });
  }

  const index: StationIndex = {
    builtAt: new Date().toISOString(),
    source: SENSOR_COMMUNITY_NOW,
    stations: [...byId.values()].sort((a, b) => a.id - b.id),
  };

  await mkdir(dirname(INDEX_PATH), { recursive: true });
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");

  const countries = new Set(index.stations.map((s) => s.country)).size;
  console.log(`wrote ${index.stations.length} stations across ${countries} countries → data/stations.json`);
}

/**
 * Build gate. Runs before every build so a missing or truncated index fails loudly here rather than
 * quietly shipping a site with no city pages.
 */
async function verifyStations(): Promise<void> {
  if (!existsSync(INDEX_PATH)) {
    throw new Error("data/stations.json is missing — run `pnpm stations` and commit the result");
  }
  const index = JSON.parse(await readFile(INDEX_PATH, "utf8")) as StationIndex;
  if (!Array.isArray(index.stations) || index.stations.length < 100) {
    throw new Error(`station index looks truncated: ${index.stations?.length ?? 0} entries`);
  }
  const ageDays = (Date.now() - Date.parse(index.builtAt)) / 86_400_000;
  if (ageDays > 14) {
    console.warn(`warning: station index is ${ageDays.toFixed(0)} days old — refresh it`);
  }
  console.log(`ok — ${index.stations.length} stations, built ${ageDays.toFixed(1)} days ago`);
}

/** Fourteen signals for one point. Wired to airq-core WASM in the first build task. */
async function comfort(lat: number, lon: number): Promise<void> {
  console.log(`comfort at ${lat}, ${lon}`);
  console.log("not wired yet — see docs/plan/*/plan.md, task «airq-core WASM in Node»");
  process.exitCode = 1;
}

/** End-to-end: the index is sane and both upstreams answer with the shape we expect. */
async function integration(): Promise<void> {
  await verifyStations();

  const area = await fetch("https://data.sensor.community/airrohr/v1/filter/area=36.54,32.00,10");
  if (!area.ok) throw new Error(`sensor.community area query: ${area.status}`);
  const areaRows = (await area.json()) as unknown[];
  console.log(`ok — sensor.community area query returned ${areaRows.length} rows`);

  const meteo = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=36.54&longitude=32.00&current=temperature_2m,wind_speed_10m",
  );
  if (!meteo.ok) throw new Error(`open-meteo: ${meteo.status}`);
  const now = (await meteo.json()) as any;
  if (typeof now?.current?.temperature_2m !== "number") {
    throw new Error("open-meteo returned no temperature — the response shape changed");
  }
  console.log(`ok — open-meteo current temperature ${now.current.temperature_2m} °C`);

  console.log("\nintegration passed");
}

// ── entry ───────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "stations":
      await (args.includes("--verify") ? verifyStations() : buildStations());
      break;
    case "comfort":
      await comfort(Number.parseFloat(args[0] ?? "36.54"), Number.parseFloat(args[1] ?? "32.00"));
      break;
    case "integration":
      await integration();
      break;
    default:
      console.log("usage: tsx cli/main.ts <stations [--verify] | comfort <lat> <lon> | integration>");
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
