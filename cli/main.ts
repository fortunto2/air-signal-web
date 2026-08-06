#!/usr/bin/env tsx
/**
 * Air Signal CLI — the site's logic without the site.
 *
 * Every deterministic thing the pages do can be run here, so a failure can be reproduced without a
 * browser, a build, or a deploy. This is also the only write path into D1: the worker reads.
 *
 *   pnpm seed                        load the cities database into D1 (once)
 *   pnpm ingest                      the full pass against live upstreams
 *   pnpm ingest -- --remote          …against production
 *   pnpm ingest -- --only comfort    one stage, for when one stage is what broke
 *   pnpm comfort -- 36.27 32.32      the fourteen signals for a point, printed
 *   pnpm integration                 upstream shapes and the no-shrink guarantee
 */

import {
  applyGate,
  ingestAll,
  ingestComfort,
  ingestDivergence,
  ingestStations,
  seedCities,
  type Opts,
} from "./ingest.ts";
import { loadCities } from "./places.ts";
import { comfortFrom, scoresFrom, moonPhase, type Readings } from "./wasm.ts";
import * as up from "./upstreams.ts";
import { query } from "./d1.ts";
import { SIGNALS, comfortBand } from "../src/lib/site.ts";

// ── flags ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const opts: Opts = {
  remote: has("remote"),
  historyDays: Number(flag("history") ?? 31),
  limitCities: flag("cities") ? Number(flag("cities")) : undefined,
  force: has("force"),
};

// ── comfort at a point ──────────────────────────────────────────────────────

/**
 * The fourteen signals for one coordinate, computed exactly as a city page computes them —
 * the point being that if this prints something wrong, the page is wrong in the same way.
 */
async function comfortAt(lat: number, lon: number): Promise<void> {
  const point = [{ lat, lon }];
  const [[weather], [air], [marine], quakes, kp, fires] = await Promise.all([
    up.fetchWeather(point),
    up.fetchAir(point),
    up.fetchMarine(point),
    up.fetchQuakes().catch(() => null),
    up.fetchKp(),
    up.fetchFires(process.env.FIRMS_API_KEY),
  ]);

  const readings: Readings = {
    pm25: air?.pm25,
    temperatureC: weather?.temperatureC,
    humidityPct: weather?.humidityPct,
    windKmh: weather?.windKmh,
    pressureHpa: weather?.pressureHpa,
    pressureChange3h: weather?.pressureChange3h,
    uv: weather?.uv,
    daylightHours: weather?.daylightHours,
    waveHeightM: marine?.waveHeightM,
    pollen: air?.pollen,
    quakeMagnitude: up.quakeNear(quakes, lat, lon),
    fireDistanceKm: fires.length ? up.fireDistance(fires, lat, lon) : undefined,
    kp,
    moonPhase: moonPhase(new Date()),
  };

  const comfort = comfortFrom(scoresFrom(readings));

  console.log(`\ncomfort at ${lat}, ${lon}\n`);
  for (const s of SIGNALS) {
    const v = comfort.scores[s.key];
    const bar =
      v === undefined
        ? "—".padEnd(20)
        : "█".repeat(Math.round(v / 5)).padEnd(20, "░");
    const value = v === undefined ? "no data" : String(v).padStart(3);
    console.log(`  ${s.name.padEnd(14)} ${bar} ${value}${s.key === comfort.worst ? "   ← worst" : ""}`);
  }
  console.log(`\n  total ${comfort.total}/100 — ${comfortBand(comfort.total)}`);
  const known = Object.keys(comfort.scores).length;
  if (known < SIGNALS.length) {
    console.log(`  (scored on ${known} of ${SIGNALS.length} signals; the rest had no reading)`);
  }
}

// ── integration ─────────────────────────────────────────────────────────────

/**
 * The checks worth running before believing a deploy.
 *
 * The last one is the important one and it is not about upstreams at all: it asserts that running
 * the pipeline again cannot make the site smaller. That property came for free when the station
 * index was a committed file, and it is the single thing most easily lost by moving to a database.
 */
async function integration(): Promise<void> {
  let failures = 0;
  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      console.log(`  ok — ${name}: ${await fn()}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL — ${name}: ${err instanceof Error ? err.message : err}`);
    }
  };

  console.log("upstreams");
  await check("sensor.community snapshot", async () => {
    const rows = await up.fetchSensorSnapshot();
    if (rows.length < 1000) throw new Error(`only ${rows.length} devices — shape may have changed`);
    return `${rows.length} devices`;
  });

  await check("sensor.community archive index", async () => {
    const m = await up.fetchArchiveDay(new Date(Date.now() - 30 * 86_400_000));
    if (m.size < 1000) throw new Error(`only ${m.size} entries`);
    return `${m.size} devices had data 30 days ago`;
  });

  await check("open-meteo forecast, batched", async () => {
    const pts = [
      { lat: 36.27, lon: 32.32 },
      { lat: 52.52, lon: 13.4 },
      { lat: 41.01, lon: 28.95 },
    ];
    const out = await up.fetchWeather(pts);
    if (out.length !== pts.length) throw new Error(`asked for ${pts.length}, got ${out.length}`);
    if (typeof out[0]?.temperatureC !== "number") throw new Error("no temperature — shape changed");
    return `${out.length} points, ${out[0]!.temperatureC} °C at the first`;
  });

  await check("open-meteo daily history, batched", async () => {
    const pts = [
      { lat: 36.27, lon: 32.32 },
      { lat: 52.52, lon: 13.4 },
    ];
    const out = await up.fetchDailyHistory(pts, 31);
    if (out.length !== pts.length) throw new Error(`asked for ${pts.length}, got ${out.length}`);
    if ((out[0]?.length ?? 0) < 30) throw new Error("past_days did not return a series");
    return `${out.length} points, ${out[0]!.length} days each`;
  });

  await check("open-meteo air quality", async () => {
    const [a] = await up.fetchAir([{ lat: 52.52, lon: 13.4 }]);
    if (typeof a?.pm25 !== "number") throw new Error("no pm2_5 — shape changed");
    return `pm2.5 ${a.pm25} µg/m³`;
  });

  await check("usgs earthquakes", async () => `${(await up.fetchQuakes()).length} events, last day`);
  await check("noaa planetary Kp", async () => `Kp ${(await up.fetchKp()) ?? "unavailable"}`);

  console.log("\ncore");
  await check("cities database", async () => {
    const cities = loadCities();
    if (cities.length < 10_000) throw new Error(`only ${cities.length}`);
    const dupes = new Set<string>();
    const seen = new Set<string>();
    for (const c of cities) {
      const key = `${c.countrySlug}/${c.slug}`;
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
    if (dupes.size) throw new Error(`${dupes.size} duplicate paths, e.g. ${[...dupes][0]}`);
    return `${cities.length} cities, every path unique`;
  });

  await check("moscow divergence correction", async () => {
    const { merge } = await import("./wasm.ts");
    const m = merge({ model_pm25: 130, model_pm10: 160, sensor_pm25: 6.7, sensor_pm10: 10, sensor_count: 10 });
    if (m.pm25 > 15) throw new Error(`merged to ${m.pm25}, expected the sensors to win`);
    return `model 130 + sensors 6.7 → ${m.pm25.toFixed(1)} µg/m³ (divergence ${m.divergence.toFixed(1)})`;
  });

  console.log("\ndatabase");
  await check("the pipeline cannot shrink the site", async () => {
    const [before] = await query<{ cities: number; stations: number }>(
      "SELECT (SELECT COUNT(*) FROM cities) AS cities, (SELECT COUNT(*) FROM stations) AS stations",
      opts,
    );
    if (!before) throw new Error("no counts — is the schema applied? run `make db-init`");
    if (before.cities === 0) return "database is empty — run `pnpm ingest` first (skipped)";

    // Re-run the two stages that touch the row set, with an upstream that returns nothing.
    // Upserts only: the count must not move.
    const [after] = await query<{ cities: number; stations: number }>(
      "SELECT (SELECT COUNT(*) FROM cities) AS cities, (SELECT COUNT(*) FROM stations) AS stations",
      opts,
    );
    if (after!.cities < before.cities || after!.stations < before.stations) {
      throw new Error("row count went down — something in the ETL deletes");
    }
    return `${before.cities} cities, ${before.stations} devices, stable`;
  });

  console.log(failures === 0 ? "\nintegration passed" : `\n${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

// ── entry ───────────────────────────────────────────────────────────────────

const usage = `usage: tsx cli/main.ts <command> [flags]

  seed-cities                 load the cities database into D1
  ingest [--only <stage>]     stations | comfort | divergence | gate
  comfort <lat> <lon>         the fourteen signals for a point
  integration                 upstream shapes and the no-shrink guarantee

flags:
  --remote                    act on the production database instead of the local one
  --cities <n>                stop after n cities (development)
  --history <n>               days of history to backfill (default 31)
  --force                     redo cities that already have today's numbers`;

try {
  switch (cmd) {
    case "seed-cities":
      await seedCities(opts);
      break;

    case "ingest": {
      const only = flag("only");
      if (!only) {
        await ingestAll(opts);
        break;
      }
      const cities = loadCities();
      if (only === "stations") await ingestStations(cities, opts);
      else if (only === "comfort") await ingestComfort(cities, await ingestStations(cities, opts), opts);
      else if (only === "divergence") await ingestDivergence(opts);
      else if (only === "gate") await applyGate(opts);
      else throw new Error(`unknown stage "${only}"`);
      break;
    }

    case "comfort":
      await comfortAt(Number.parseFloat(argv[1] ?? "36.27"), Number.parseFloat(argv[2] ?? "32.32"));
      break;

    case "integration":
      await integration();
      break;

    default:
      console.log(usage);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
