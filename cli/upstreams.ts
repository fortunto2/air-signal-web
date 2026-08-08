/**
 * Every network call the site makes, in one file, with the shape of each response narrowed here
 * and nowhere deeper.
 *
 * Two ideas keep this cheap enough to run over ten thousand cities:
 *
 * 1. **Open-Meteo takes coordinates in bulk.** 200 points and 31 days of history come back in one
 *    ~600 ms request. Ten thousand cities is fifty-odd requests per API, not ten thousand.
 * 2. **Global feeds beat per-city queries.** Earthquakes, geomagnetic Kp and fire detections are
 *    one worldwide download each; the nearest event per city is then arithmetic, not traffic.
 */

import { haversine } from "./wasm.ts";
import { quakeFelt, usablePm25 } from "../src/lib/live.ts";

const UA = { "user-agent": "air-signal-web/0.1 (+https://airsignal.app)" };

/**
 * Batch sizes, and why they are not the same number.
 *
 * Open-Meteo does not price a request — it prices work. A call is weighted by locations × variables
 * × days, so "200 cities with 31 days of history" is not one request, it is thousands, and firing
 * fifty-three of those back to back earns a 429 in under a minute. The first version of this file
 * learned that the hard way.
 *
 * So the two shapes of query get two budgets: a current-conditions call is cheap and goes wide, a
 * history backfill is expensive and goes narrow.
 */
export const BATCH = 200;
export const BATCH_HISTORY = 50;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * No request may hang forever.
 *
 * `fetch` has no default timeout, and an upstream that accepts a connection and then says nothing
 * will stall the whole pass indefinitely — which is exactly what happened on the first full run:
 * eleven minutes, 0.4 seconds of CPU, one open socket, no progress. In CI that is a job that never
 * ends rather than a job that fails, which is strictly worse.
 */
const TIMEOUT_MS = 45_000;

export function get(url: string, ms = TIMEOUT_MS): Promise<Response> {
  return fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
}

async function getJson<T>(url: string, tries = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await get(url);
      // A 429 is not a blip to retry past in a second — it is a request to slow down, and treating
      // it like a transient error is how a client gets blocked outright.
      if (res.status === 429) throw new RateLimited();
      if (res.status >= 500) throw new Error(`upstream ${res.status}`);
      if (!res.ok) throw new Error(`upstream ${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const backoff = err instanceof RateLimited ? 20_000 * (i + 1) : 1_200 * (i + 1);
      if (i < tries - 1) await sleep(backoff);
    }
  }
  throw new Error(`${url.slice(0, 90)}… failed after ${tries} tries: ${lastError}`);
}

class RateLimited extends Error {
  constructor() {
    super("upstream 429 — rate limited");
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Point {
  lat: number;
  lon: number;
}

/** Open-Meteo returns a bare object for one coordinate and an array for many. Normalize it. */
function asArray<T>(body: T | T[]): T[] {
  return Array.isArray(body) ? body : [body];
}

// ── Sensor.Community ────────────────────────────────────────────────────────

export const SC_NOW = "https://data.sensor.community/static/v2/data.json";
export const SC_24H = "https://data.sensor.community/static/v2/data.24h.json";

export interface SensorReading {
  id: number;
  lat: number;
  lon: number;
  country: string;
  pm25: number | null;
  pm10: number | null;
  seenAt: string;
}

/**
 * One network-wide snapshot: every device that reported in the last five minutes.
 *
 * A value at or below zero, or above 500 µg/m³, is a broken sensor rather than perfect or
 * apocalyptic air. Dropping it here is the difference between a map that shows pollution and a map
 * that shows dying fans.
 */
export async function fetchSensorSnapshot(url = SC_NOW): Promise<SensorReading[]> {
  const raw = await getJson<Array<Record<string, any>>>(url);
  const byId = new Map<number, SensorReading>();

  for (const row of raw) {
    const id = row?.sensor?.id;
    const loc = row?.location;
    if (!id || !loc) continue;
    if (Number(loc.indoor) === 1) continue; // an indoor device does not describe being outside

    const lat = Number.parseFloat(loc.latitude);
    const lon = Number.parseFloat(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let pm25: number | null = null;
    let pm10: number | null = null;
    for (const v of row.sensordatavalues ?? []) {
      const n = Number.parseFloat(v.value);
      if (!Number.isFinite(n) || n <= 0 || n > 500) continue;
      if (v.value_type === "P2") pm25 = n;
      if (v.value_type === "P1") pm10 = n;
    }
    // See `usablePm25`: the same rule the Worker applies, so the two runtimes cannot disagree
    // about which devices are broken.
    pm25 = usablePm25(pm25, pm10);

    if (pm25 === null && pm10 === null) continue;

    byId.set(id, {
      id,
      lat,
      lon,
      country: String(loc.country ?? "").toUpperCase(),
      pm25,
      pm10,
      seenAt: row.timestamp ?? new Date().toISOString(),
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Which devices had data on a given day, and what hardware each one is.
 *
 * The archive publishes one CSV per sensor per day, and its directory index names them
 * `2026-07-07_sds011_sensor_12345.csv`. That single 4.6 MB listing answers both "does this device
 * have thirty days of history" and "what is it" — for the whole network, in one request. The
 * alternative was nine thousand HEAD requests, which is why the gate went unimplemented until now.
 */
export async function fetchArchiveDay(date: Date, tries = 4): Promise<Map<number, string>> {
  const day = date.toISOString().slice(0, 10);
  let lastError: unknown;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await get(`https://archive.sensor.community/${day}/`, 90_000);
      if (!res.ok) throw new Error(`archive ${day}: ${res.status}`);
      const html = await res.text();

      const out = new Map<number, string>();
      for (const m of html.matchAll(/_([a-z0-9]+)_sensor_(\d+)\.csv/g)) {
        const id = Number(m[2]);
        // A device may publish several sensors; the particulate one is what a PM page is about.
        if (!out.has(id) || /sds|sps|pms/.test(m[1]!)) out.set(id, m[1]!);
      }

      // The listing is ~4.5 MB and the server sometimes closes the connection partway through,
      // which `res.text()` reports as success with a truncated body. A short answer here is not a
      // quiet day in 2026 — it is a broken download, and accepting it would set `history_days = 0`
      // for the whole network and empty the sitemap on the next gate pass.
      if (out.size < 5_000) throw new Error(`archive ${day}: truncated — only ${out.size} entries`);

      return out;
    } catch (err) {
      lastError = err;
      if (i < tries - 1) await sleep(3_000 * (i + 1));
    }
  }
  throw new Error(`archive ${day} failed after ${tries} tries: ${lastError}`);
}

// ── Open-Meteo ──────────────────────────────────────────────────────────────

export interface WeatherPoint {
  temperatureC?: number;
  humidityPct?: number;
  windKmh?: number;
  pressureHpa?: number;
  pressureChange3h?: number;
  uv?: number;
  daylightHours?: number;
  /** Daily series, oldest first, for the thirty-day chart. */
  daily?: { day: string; temp: number | null; uv: number | null }[];
}

/**
 * Current conditions. Always one day — never used for history.
 *
 * Open-Meteo prices a call as roughly locations × variables × days, and the hourly series here is
 * two variables at 24 points a day. Asking for it across 31 days of history multiplies the whole
 * request by thirty and earns a 429 within a minute; that is what `fetchDailyHistory` exists to
 * avoid. Current conditions and history are different questions and now they are different calls.
 */
export async function fetchWeather(points: Point[]): Promise<WeatherPoint[]> {
  const pastDays = 0;
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${points.map((p) => p.lat).join(",")}` +
    `&longitude=${points.map((p) => p.lon).join(",")}` +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl,surface_pressure" +
    "&hourly=uv_index,pressure_msl" +
    "&daily=uv_index_max,sunrise,sunset,temperature_2m_max" +
    `&past_days=${pastDays}&forecast_days=1&timezone=UTC&wind_speed_unit=kmh`;

  return asArray(await getJson<any>(url)).map((b): WeatherPoint => {
    const cur = b?.current ?? {};
    const daily = b?.daily ?? {};
    const hourly = b?.hourly ?? {};

    // Now-ish UV: the hourly series is UTC-aligned, so index by the current UTC hour.
    const hour = new Date().getUTCHours();
    const uv = Number(hourly?.uv_index?.[hour]);

    // Three-hour pressure change is what the body notices; the absolute value barely matters.
    const p = hourly?.pressure_msl as (number | null)[] | undefined;
    const change3h =
      p && Number.isFinite(p[hour]!) && Number.isFinite(p[hour - 3]!)
        ? p[hour]! - p[hour - 3]!
        : undefined;

    const days: WeatherPoint["daily"] = [];
    const times: string[] = daily?.time ?? [];
    for (let i = 0; i < times.length; i++) {
      days.push({
        day: times[i]!,
        temp: num(daily?.temperature_2m_max?.[i]),
        uv: num(daily?.uv_index_max?.[i]),
      });
    }

    const sunrise = daily?.sunrise?.at(-1);
    const sunset = daily?.sunset?.at(-1);
    const daylightHours =
      sunrise && sunset ? (Date.parse(sunset) - Date.parse(sunrise)) / 3_600_000 : undefined;

    return {
      temperatureC: num(cur.temperature_2m) ?? undefined,
      humidityPct: num(cur.relative_humidity_2m) ?? undefined,
      windKmh: num(cur.wind_speed_10m) ?? undefined,
      pressureHpa: num(cur.pressure_msl) ?? num(cur.surface_pressure) ?? undefined,
      pressureChange3h: change3h,
      uv: Number.isFinite(uv) ? uv : (num(daily?.uv_index_max?.at(-1)) ?? undefined),
      daylightHours: Number.isFinite(daylightHours!) ? daylightHours : undefined,
      daily: days,
    };
  });
}

/**
 * Thirty days of dailies, and nothing else.
 *
 * Two variables, no hourly series, no current block — the cheapest shape that still fills a chart.
 * Requesting this separately is the difference between a run that completes and a run that spends
 * its afternoon backing off from a rate limit.
 */
export interface HistoryPoint {
  day: string;
  temp: number | null;
  uv: number | null;
}

export async function fetchDailyHistory(points: Point[], days: number): Promise<HistoryPoint[][]> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${points.map((p) => p.lat).join(",")}` +
    `&longitude=${points.map((p) => p.lon).join(",")}` +
    "&daily=temperature_2m_max,uv_index_max" +
    `&past_days=${days}&forecast_days=1&timezone=UTC`;

  return asArray(await getJson<any>(url)).map((b) => {
    const d = b?.daily ?? {};
    const times: string[] = d?.time ?? [];
    return times.map((day, i) => ({
      day,
      temp: num(d?.temperature_2m_max?.[i]),
      uv: num(d?.uv_index_max?.[i]),
    }));
  });
}

export interface AirPoint {
  pm25?: number;
  pm10?: number;
  pollen?: number;
  daily?: { day: string; pm25: number | null }[];
}

export async function fetchAir(points: Point[], pastDays = 0): Promise<AirPoint[]> {
  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${points.map((p) => p.lat).join(",")}` +
    `&longitude=${points.map((p) => p.lon).join(",")}` +
    "&current=pm2_5,pm10,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen" +
    (pastDays > 0 ? "&hourly=pm2_5" : "") +
    `&past_days=${pastDays}&forecast_days=1&timezone=UTC`;

  return asArray(await getJson<any>(url)).map((b): AirPoint => {
    const cur = b?.current ?? {};
    const pollens = [
      cur.alder_pollen,
      cur.birch_pollen,
      cur.grass_pollen,
      cur.mugwort_pollen,
      cur.olive_pollen,
      cur.ragweed_pollen,
    ]
      .map(num)
      .filter((n): n is number => n !== null);

    // Pollen coverage is Europe-only. Outside it every species is null, and that is "unknown",
    // not "no pollen" — so the signal is left absent rather than scored a perfect 100.
    const pollen = pollens.length ? Math.max(...pollens) : undefined;

    return {
      pm25: num(cur.pm2_5) ?? undefined,
      pm10: num(cur.pm10) ?? undefined,
      pollen,
      daily: dailyMeanFromHourly(b?.hourly?.time, b?.hourly?.pm2_5),
    };
  });
}

export async function fetchMarine(points: Point[]): Promise<{ waveHeightM?: number; seaTempC?: number }[]> {
  const url =
    "https://marine-api.open-meteo.com/v1/marine" +
    `?latitude=${points.map((p) => p.lat).join(",")}` +
    `&longitude=${points.map((p) => p.lon).join(",")}` +
    "&current=wave_height,sea_surface_temperature&timezone=UTC";

  // Inland coordinates legitimately have no marine model. A failure here must not take the whole
  // batch down — the other thirteen signals are unaffected by there being no sea.
  try {
    return asArray(await getJson<any>(url)).map((b) => ({
      waveHeightM: num(b?.current?.wave_height) ?? undefined,
      seaTempC: num(b?.current?.sea_surface_temperature) ?? undefined,
    }));
  } catch {
    return points.map(() => ({}));
  }
}

// ── global feeds ────────────────────────────────────────────────────────────

export interface Quake {
  lat: number;
  lon: number;
  magnitude: number;
}

/** Every M2.5+ event worldwide in the last day — one request, then nearest-neighbour locally. */
export async function fetchQuakes(): Promise<Quake[]> {
  const body = await getJson<any>(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  );
  return (body?.features ?? [])
    .map((f: any) => ({
      lon: Number(f?.geometry?.coordinates?.[0]),
      lat: Number(f?.geometry?.coordinates?.[1]),
      magnitude: Number(f?.properties?.mag),
    }))
    .filter((q: Quake) => Number.isFinite(q.lat) && Number.isFinite(q.lon) && Number.isFinite(q.magnitude));
}

/**
 * Strongest quake felt at a point, as a magnitude.
 *
 * Returns a **negative** magnitude when the feed loaded and nothing was near, because
 * `normalize_earthquake` reads a negative input as "no earthquake" and scores it 100. The
 * distinction matters: a quiet week is a measurement and belongs in the score, while a failed
 * fetch is an absence and must stay out of it. Collapsing the two — which the first version did —
 * silently dropped an 8 %-weighted signal from every calm city on Earth.
 *
 * Distance is folded in here rather than in Rust: an M6 five hundred kilometres away is not an M6
 * where you are standing, and the normalizer only ever sees a magnitude.
 */
/** The strongest quake felt at a point. One implementation, shared with the Worker. */
export function quakeNear(
  quakes: Quake[] | null,
  lat: number,
  lon: number,
  radiusKm = 500,
): number | undefined {
  // The feed itself failing is not the same as a calm day, and must not be reported as one.
  if (quakes === null) return undefined;
  return quakeFelt(quakes, lat, lon, haversine, radiusKm);
}

/**
 * Planetary K-index — one number for the whole planet, so one request for the whole run.
 *
 * NOAA publishes this endpoint as an array of **objects** (`{time_tag, Kp, …}`), while a sibling
 * endpoint uses an array of string arrays with a header row. Both are handled, because reading the
 * wrong shape yields `NaN` and `NaN` here means every city quietly loses its geomagnetic reading —
 * which is precisely what the first run did.
 */
export async function fetchKp(): Promise<number | undefined> {
  try {
    const rows = await getJson<unknown[]>(
      "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
    );
    const last = rows?.at(-1) as Record<string, unknown> | unknown[] | undefined;
    const kp = Array.isArray(last)
      ? Number(last[1])
      : Number(last?.["Kp"] ?? last?.["kp_index"] ?? last?.["k_index"]);

    if (!Number.isFinite(kp)) {
      console.warn(`  Kp: feed parsed but held no number — last row was ${JSON.stringify(last)}`);
      return undefined;
    }
    return kp;
  } catch (err) {
    // Says so out loud rather than returning `undefined` into the dark. A swallowed failure here
    // silently drops geomagnetic from every city on Earth, and the only visible symptom is one
    // fewer bar in the spectrum — which nobody notices, because nobody knows what it should be.
    console.warn(`  Kp: ${err instanceof Error ? err.message : err} — geomagnetic stays absent`);
    return undefined;
  }
}

export interface Fire {
  lat: number;
  lon: number;
}

/**
 * Active fire detections, worldwide, last 24 h. The only upstream that needs a key and the only
 * one without CORS — which is why it is fetched here at ingest and served from our own database,
 * rather than proxied per page view.
 */
export async function fetchFires(apiKey: string | undefined): Promise<Fire[]> {
  if (!apiKey) return [];
  try {
    const res = await get(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/VIIRS_SNPP_NRT/world/1`,
      60_000,
    );
    if (!res.ok) return [];
    const text = await res.text();
    const [header, ...lines] = text.trim().split("\n");
    const cols = (header ?? "").split(",");
    const latAt = cols.indexOf("latitude");
    const lonAt = cols.indexOf("longitude");
    if (latAt < 0 || lonAt < 0) return [];

    const out: Fire[] = [];
    for (const line of lines) {
      const parts = line.split(",");
      const lat = Number(parts[latAt]);
      const lon = Number(parts[lonAt]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
    }
    return out;
  } catch {
    return [];
  }
}

/** Distance to the nearest active fire, capped — beyond the cap the signal reads as clear. */
export function fireDistance(fires: Fire[], lat: number, lon: number, capKm = 200): number | undefined {
  if (fires.length === 0) return undefined;
  let best = Infinity;
  for (const f of fires) {
    if (Math.abs(f.lat - lat) > 2.5 || Math.abs(f.lon - lon) > 3.5) continue;
    const d = haversine(lat, lon, f.lat, f.lon);
    if (d < best) best = d;
  }
  // Beyond the horizon is not a reading. Returning the cap scored it 100 and made "no fire within
  // 200 km" — which is nearly everywhere, nearly always — worth five per cent of a perfect score.
  return Number.isFinite(best) ? Math.min(best, capKm) : undefined;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Coerce to a number, or report absence.
 *
 * `null` is spelled out because `Number(null)` is **0**, not NaN — so a bare `Number.isFinite`
 * guard passes every null an upstream sends and turns it into a measurement of zero. Open-Meteo
 * returns `null` for a marine reading inland, which is how Berlin came to have a sea at 0 °C with
 * flat water, scoring 95 out of 100 on a signal it has no business having at all. Absent is not
 * zero, and this is the function where that rule is either kept or lost.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Hourly → daily mean, so a thirty-day chart is thirty points rather than seven hundred. */
function dailyMeanFromHourly(
  times: string[] | undefined,
  values: (number | null)[] | undefined,
): { day: string; pm25: number | null }[] {
  if (!times || !values) return [];
  const sums = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < times.length; i++) {
    const v = num(values[i]);
    if (v === null) continue;
    const day = times[i]!.slice(0, 10);
    const acc = sums.get(day) ?? { sum: 0, n: 0 };
    acc.sum += v;
    acc.n += 1;
    sums.set(day, acc);
  }
  return [...sums.entries()]
    .map(([day, { sum, n }]) => ({ day, pm25: Math.round((sum / n) * 10) / 10 }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// OpenStreetMap — where the pollution plausibly comes from
// ---------------------------------------------------------------------------

export interface OsmSource {
  osmId: string;
  name: string;
  kind: "power_plant" | "works" | "industrial" | "motorway" | "trunk";
  lat: number;
  lon: number;
}

/**
 * Factories, power plants, industrial zones and major roads near a point.
 *
 * A port of `fetch_pollution_sources` in the `airq` binary crate, which has done this since early
 * on and could never reach the site: it is built on reqwest and a filesystem cache, so it never
 * became part of the WASM the worker and the browser share. Only the shape of its answer,
 * `PollutionSource`, made it into airq-core.
 *
 * The query is deliberately the same one. `nwr` catches a factory whether it is mapped as a node,
 * a way or a relation, which in OSM depends entirely on who mapped it; `out center` collapses each
 * to a single coordinate so a plant the size of a district and a chimney are comparable.
 *
 * Overpass is a volunteer-run service with no commercial tier. It is called once per city on the
 * nightly pass and never from a page, the results are stored, and the two public instances are
 * tried in turn because one of them is usually busy.
 */
export async function fetchSources(
  lat: number,
  lon: number,
  radiusKm = 25,
): Promise<OsmSource[]> {
  const r = Math.round(radiusKm * 1000);
  const around = `(around:${r},${lat},${lon})`;
  const query =
    `[out:json][timeout:25];\n(\n` +
    `  nwr["power"="plant"]${around};\n` +
    `  nwr["man_made"="works"]${around};\n` +
    `  nwr["landuse"="industrial"]${around};\n` +
    `  way["highway"="motorway"]${around};\n` +
    `  way["highway"="trunk"]${around};\n` +
    `);\nout center tags 50;`;

  const servers = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  for (const server of servers) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...UA },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) continue;

      const body = (await res.json()) as {
        elements?: {
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }[];
      };

      const out: OsmSource[] = [];
      for (const el of body.elements ?? []) {
        const at = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
        if (!at) continue;
        const tags = el.tags ?? {};

        const kind: OsmSource["kind"] | null =
          tags.power === "plant"
            ? "power_plant"
            : tags.man_made === "works"
              ? "works"
              : tags.landuse === "industrial"
                ? "industrial"
                : tags.highway === "motorway"
                  ? "motorway"
                  : tags.highway === "trunk"
                    ? "trunk"
                    : null;
        if (!kind) continue;

        // An unnamed industrial zone is still a source; falling back to the category keeps it
        // rather than dropping it for the sake of a tidy label.
        const name =
          tags.name ??
          tags["name:en"] ??
          tags.operator ??
          {
            power_plant: "Power plant",
            works: "Factory",
            industrial: "Industrial zone",
            motorway: "Motorway",
            trunk: "Major road",
          }[kind];

        out.push({ osmId: `${el.type}/${el.id}`, name, kind, lat: at.lat, lon: at.lon });
      }
      return out;
    } catch {
      // Try the next server. Both being busy is a normal Overpass afternoon, not an error worth
      // failing the whole pass over — the city keeps whatever sources it already had.
    }
  }
  return [];
}
