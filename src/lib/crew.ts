/**
 * The crew shift plan: a place, a day and a shift in; Cal/OSHA smoke and heat actions out.
 *
 * Network here, maths in `airq-core` (`crew.rs`): NowCast, the rulebook engine and the BMS signal
 * are one Rust function, so the CLI, this page and the hackathon demo cannot disagree about when
 * N95s are due. The upstream is Open-Meteo's hourly *raw* PM2.5, not its `us_aqi`, which is a
 * 24-hour mean and lags a smoke front by most of a shift.
 *
 * Two checks go in beside the forecast, both keyless public files: VIIRS fire detections from NASA
 * FIRMS (a fire within 50 km is where a 40 km smoke model reads lowest) and the latest hour from
 * AirNow's regulatory monitors, which `crew.rs` uses to scale the forecast near that hour.
 */

import { core } from "./core";
import { slug } from "./site";
import { getNearbyCities, type ReportKind } from "./db";

export const CREW_TZ = "America/Los_Angeles";

export interface CrewHour {
  time: string;
  metrics: Partial<Record<"us_aqi_pm25" | "pm25_nowcast_ugm3" | "pm25_ugm3" | "temp_f" | "temp_c", number>>;
}

export interface CrewAction {
  time: string;
  rule: string;
  cite: string;
  text: string;
}

export interface CrewPlan {
  jurisdiction: string;
  hours: CrewHour[];
  actions: CrewAction[];
  peak_aqi: number | null;
  peak_temp_f: number | null;
  confidence: {
    level: "sensor-confirmed" | "model-adjusted" | "model-only";
    fire: { nearest_km: number; direction: string; bearing_deg?: number; within_50km: number } | null;
    ground: {
      time: string;
      pm25: number;
      stations: number;
      nearest: string;
      nearest_km: number;
      nearest_lat?: number;
      nearest_lon?: number;
      model_pm25: number;
      divergence: number;
      factor: number;
    } | null;
    notes: string[];
  };
  bms: {
    threshold_aqi: number;
    recirculate_at: string | null;
    resume_at: string | null;
    peak_aqi: number | null;
    reason: string;
  };
}

/**
 * A place as data, not as a display string. `town` and `state` are what keys, agencies and wording are
 * built from; `name` is only for showing. `approximate` marks a place derived from coordinates.
 */
export interface CrewPlace {
  name: string;
  town: string;
  state: string | null;
  lat: number;
  lon: number;
  approximate: boolean;
}

export interface CrewAnswer {
  place: CrewPlace;
  date: string;
  shift: { start: number; end: number };
  /** Set when Open-Meteo was down and the plan was built from the fallbacks instead. */
  fallback?: { air: "monitor"; monitor: string; temp: "open-meteo" | "nws" | "none"; reason: string };
  plan: CrewPlan;
  /** Active National Weather Service alerts for the point (Red Flag Warning, Heat Advisory, …). */
  alerts: { event: string; onset: string | null; ends: string | null }[];
  /** The same day for a home or a building's agent: the price peak and the hours to act before it. */
  home: HomeSignal;
  /** A task for a sensor node (fixed, or a drone outside the fire's TFR) when a satellite sees fire nearby. */
  dispatch: Dispatch;
  /** Wind by local hour (10 m, °from, km/h) for the plan's hours, for the plume drawing. */
  wind: { time: string; dir_deg: number; kmh: number }[];
  /** VIIRS detections within about 150 km, [lat, lon], for the map; the engine sees the same list. */
  fires_near: [number, number][];
}

/**
 * The satellite trigger as a task: a VIIRS detection within 50 km means the model's smoke is a guess
 * and a ground reading is worth going for. The node answers through POST /api/crew/report with its
 * PM2.5, and the next plan is corrected by that reading like by any AirNow monitor.
 */
export interface Dispatch {
  sensor: "launch" | "standby";
  bearing_deg: number | null;
  distance_km: number | null;
  detections_50km: number;
  reason: string;
}

// The engine's own warning radius: one threshold on the page, in the JSON and in the task.
const DISPATCH_KM = 50;

function dispatchFor(plan: CrewPlan): Dispatch {
  const f = plan.confidence.fire;
  const go = !!f && f.nearest_km <= DISPATCH_KM;
  return {
    sensor: go ? "launch" : "standby",
    bearing_deg: f ? (f.bearing_deg ?? null) : null,
    distance_km: f ? Math.round(f.nearest_km * 10) / 10 : null,
    detections_50km: f?.within_50km ?? 0,
    reason: go
      ? `VIIRS fire ${f!.nearest_km.toFixed(1)} km ${f!.direction}: sample PM2.5 toward it, outside the fire's TFR, and report`
      : f
        ? `nearest VIIRS fire ${f.nearest_km.toFixed(1)} km ${f.direction}, beyond ${DISPATCH_KM} km`
        : "no VIIRS fire within about 200 km in the last 24 h",
  };
}

/**
 * What a home energy agent needs from this forecast. PG&E's E-TOU-C peak is 16:00–21:00 every day
 * (SVCE and the other CCAs bill generation on the same schedule), so the cheap hours to cool a house
 * are the ones before it. Rules, not an optimisation: no load model, no price in dollars.
 */
export interface HomeSignal {
  /** PG&E E-TOU-C: peak price 16:00–21:00 every day, including weekends. */
  peak_price: { start: number; end: number; tariff: string };
  /** Pre-cool when the day reaches the heat rule's 80 °F; the window ends when the peak price starts. */
  precool: { start: number; end: number } | null;
  /** The smoke hour from the building signal: windows shut, HVAC on recirculate. */
  close_windows_at: string | null;
  open_windows_at: string | null;
  reason: string;
}

const TOU_PEAK = { start: 16, end: 21, tariff: "PG&E E-TOU-C" };

function homeSignal(plan: CrewPlan): HomeSignal {
  const hot = (plan.peak_temp_f ?? 0) >= 80;
  const smoke = plan.bms.recirculate_at;
  return {
    peak_price: TOU_PEAK,
    precool: hot ? { start: 13, end: TOU_PEAK.start } : null,
    close_windows_at: smoke,
    open_windows_at: plan.bms.resume_at,
    reason: [
      hot ? `peak ${Math.floor(plan.peak_temp_f!)} °F: cool the house 13:00–16:00, before the ${TOU_PEAK.start}:00–${TOU_PEAK.end}:00 peak price` : "under 80 °F: no pre-cooling needed",
      smoke ? `smoke: windows shut and HVAC on recirculate from ${smoke.slice(11, 16)}` : "no smoke hour",
    ].join("; "),
  };
}

/** Active NWS alerts at a point: Red Flag Warnings, heat advisories, air quality alerts. Free, no key. */
async function nwsAlerts(lat: number, lon: number): Promise<CrewAnswer["alerts"]> {
  const fc = await cached(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    600,
    (t) => JSON.parse(t),
    { "User-Agent": "airsignal.app (info@superduperai.co)", Accept: "application/geo+json" },
  );
  return (fc?.features ?? []).map((f: any) => ({
    event: String(f.properties?.event ?? "Alert"),
    onset: f.properties?.onset ?? null,
    ends: f.properties?.ends ?? f.properties?.expires ?? null,
  }));
}

/**
 * Every upstream read: cached by the Cloudflare edge for `ttl` seconds and per isolate too. The
 * isolate cache holds the *promise*, so concurrent cold requests share one download of a 1 MB AirNow
 * file; a failure is remembered for a minute so a missing newest file is not refetched per request;
 * the map is capped, since AirNow URLs change every hour.
 */
const memo = new Map<string, { until: number; value: Promise<unknown> }>();
const MEMO_MAX = 16;
/** Why the last fetch of a URL failed, so an error names the status instead of just "unavailable". */
const failures = new Map<string, string>();

function cached<T>(url: string, ttl: number, parse: (text: string) => T, headers?: Record<string, string>): Promise<T | null> {
  const now = Date.now();
  const hit = memo.get(url);
  if (hit && hit.until > now) return hit.value as Promise<T | null>;
  const value = fetch(url, { headers, signal: AbortSignal.timeout(8000), cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit)
    .then(async (res) => {
      if (res.ok) return parse(await res.text());
      failures.set(url, `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      return null;
    })
    .catch((e) => {
      failures.set(url, String(e));
      return null;
    });
  memo.set(url, { until: now + ttl * 1000, value });
  value.then((v) => {
    if (v === null) memo.set(url, { until: Date.now() + 60_000, value });
  });
  if (memo.size > MEMO_MAX) {
    for (const [k, e] of memo) if (e.until <= now || memo.size > MEMO_MAX) memo.delete(k);
  }
  return value;
}

/** JSON from an upstream; throws when it is unavailable, so a plan never silently lacks a forecast. */
async function json(url: string, ttl = 600): Promise<any> {
  const out = await cached(url, ttl, (t) => JSON.parse(t));
  if (out === null) throw new Error(`${new URL(url).hostname} unavailable (${failures.get(url) ?? "no answer"})`);
  return out;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return core().wasm_haversine(lat1, lon1, lat2, lon2);
}

/** `"a","b",""` → `["a","b",""]`. AirNow's files quote every field and never embed a quote. */
const fields = (line: string) => line.slice(1, -1).split('","');

const FIRMS = [
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
];

/** VIIRS detections over the US, last 24 h, both satellites. Low-confidence pixels are dropped. */
async function fetchFires(): Promise<[number, number][]> {
  const parse = (text: string) => {
    const [head, ...rows] = text.trim().split("\n");
    const cols = (head ?? "").split(",");
    const [la, lo, cf] = ["latitude", "longitude", "confidence"].map((c) => cols.indexOf(c));
    const out: [number, number][] = [];
    for (const row of rows) {
      const p = row.split(",");
      if (p[cf!] === "low" || p[cf!] === "l") continue;
      const lat = Number(p[la!]);
      const lon = Number(p[lo!]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
    }
    return out;
  };
  const sets = await Promise.all(FIRMS.map((u) => cached(u, 1800, parse)));
  return sets.flatMap((s) => s ?? []);
}

interface Monitor {
  name: string;
  lat: number;
  lon: number;
  pm25: number;
  utc: string;
}

/** One hour of every AirNow monitor that measured PM2.5. */
function parseAirNow(text: string): Monitor[] {
  const [head, ...rows] = text.trim().split("\n");
  const cols = fields((head ?? "").trim());
  const at = (c: string) => cols.indexOf(c);
  const [name, la, lo, pm, measured, date, time] = [
    "SiteName", "Latitude", "Longitude", "PM25", "PM25_Measured", "ValidDate", "ValidTime",
  ].map(at);
  const out: Monitor[] = [];
  for (const row of rows) {
    const p = fields(row.trim());
    if (p[measured!] !== "1" || p[pm!] === "") continue;
    const v = Number(p[pm!]);
    if (!Number.isFinite(v) || v < 0) continue;
    const [mm, dd, yyyy] = (p[date!] ?? "").split("/");
    out.push({ name: p[name!]!, lat: Number(p[la!]), lon: Number(p[lo!]), pm25: v, utc: `${yyyy}-${mm}-${dd}T${p[time!]}:00Z` });
  }
  return out;
}

const HOUR_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: CREW_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: CREW_TZ });
const HOUR_NUM = new Intl.DateTimeFormat("en-US", { timeZone: CREW_TZ, hour: "numeric", hourCycle: "h23" });
const PT = new Intl.DateTimeFormat("en-US", { timeZone: CREW_TZ, dateStyle: "medium", timeStyle: "short" });
const PT_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: CREW_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** An ISO instant in California: "Oct 24, 2026, 1:58 AM". */
export const ptTime = (iso: string) => PT.format(new Date(iso));
/** An ISO instant as a California clock: "13:05". */
export const ptClock = (iso: string) => PT_CLOCK.format(new Date(iso));
/** Whole minutes since an ISO instant. */
export const minutesSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 60_000);

/** A UTC instant as the forecast's local hour, `2026-10-24T05:00`. */
function localHour(utc: string): string {
  const parts = Object.fromEntries(HOUR_PARTS.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

/**
 * The latest AirNow hour within 25 km: median of the nearest three monitors.
 *
 * AirNow posts an hour's file roughly an hour later and fills it in over the next one, so files are
 * searched newest first, up to four hours back, for one where a nearby monitor has a value. Keyless; the hourly file is ~1 MB and cached at the edge.
 */
async function fetchGround(lat: number, lon: number, maxKm = 25) {
  // All four candidate hours are requested at once (each is shared per isolate and edge-cached), then
  // read newest first: worst case one round trip instead of four sequential 8-second waits.
  const files = [1, 2, 3, 4].map((back) => {
    const t = new Date(Date.now() - back * 3_600_000).toISOString();
    const stamp = `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}${t.slice(11, 13)}`;
    return cached(`https://files.airnowtech.org/airnow/${t.slice(0, 4)}/${stamp.slice(0, 8)}/HourlyAQObs_${stamp}.dat`, 3600, parseAirNow);
  });
  for (const file of files) {
    const monitors = await file;
    if (!monitors) continue;
    const near = monitors
      .filter((m) => Math.abs(m.lat - lat) < maxKm / 60 && Math.abs(m.lon - lon) < maxKm / 50)
      .map((m) => ({ ...m, km: km(lat, lon, m.lat, m.lon) }))
      .filter((m) => m.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
    // The newest file fills in over the next hour: a monitor can be listed with no value yet.
    if (near.length === 0) continue;
    const vals = near.map((m) => m.pm25).sort((a, b) => a - b);
    return {
      time: localHour(near[0]!.utc),
      pm25: vals[Math.floor(vals.length / 2)]!,
      stations: near.length,
      nearest: near[0]!.name,
      nearest_km: Math.round(near[0]!.km * 10) / 10,
      nearest_lat: near[0]!.lat,
      nearest_lon: near[0]!.lon,
    };
  }
  return null;
}

interface Hit {
  name: string;
  admin1?: string;
  admin2?: string;
  latitude: number;
  longitude: number;
}

/** US places matching a name, California first: the rulebook is Cal/OSHA, and "Fresno" means the valley. */
async function searchUS(name: string): Promise<Hit[]> {
  const r = await json(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=20&countryCode=US`,
    86_400,
  );
  const hits: Hit[] = r.results ?? [];
  return hits.sort((a, b) => Number(b.admin1 === "California") - Number(a.admin1 === "California"));
}

const toPlace = (g: Hit, approximate = false, lat = g.latitude, lon = g.longitude): CrewPlace => ({
  name: approximate ? `near ${g.name}` : [g.name, g.admin1].filter(Boolean).join(", "),
  town: g.name,
  state: g.admin1 ?? null,
  lat,
  lon,
  approximate,
});

/**
 * `"36.748,-119.772"` → that coordinate, named after the nearest city we know; its state comes from
 * the geocoder hit for that name that lies closest to the point.
 */
async function fromCoordinates(place: string): Promise<CrewPlace | null | undefined> {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(place);
  if (!m) return undefined;
  const lat = Math.round(Number(m[1]) * 1000) / 1000;
  const lon = Math.round(Number(m[2]) * 1000) / 1000;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const [near] = await getNearbyCities(lat, lon, 0.5, 1).catch(() => []);
  if (!near) {
    const name = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    return { name, town: name, state: null, lat, lon, approximate: true };
  }
  const hits = await searchUS(near.name).catch(() => [] as Hit[]);
  const closest = hits.sort((a, b) => km(lat, lon, a.latitude, a.longitude) - km(lat, lon, b.latitude, b.longitude))[0];
  return toPlace(closest ?? { name: near.name, latitude: lat, longitude: lon }, true, lat, lon);
}

/** Up to 8 US places matching what was typed: the app's and page's place search. */
export async function placeSuggestions(q: string): Promise<{ name: string; detail: string; lat: number; lon: number }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return (await searchUS(term)).slice(0, 8).map((g) => ({
    name: g.name,
    detail: [g.admin2, g.admin1].filter(Boolean).join(", "),
    lat: g.latitude,
    lon: g.longitude,
  }));
}

/** A typed name ("Fresno", "Springfield, Illinois") or `lat,lon` → a place. A state after the comma wins. */
export async function geocode(place: string): Promise<CrewPlace | null> {
  const coords = await fromCoordinates(place);
  if (coords !== undefined) return coords;
  const [name, hint] = place.split(",").map((x) => x.trim());
  if (!name) return null;
  const hits = await searchUS(name);
  const g = (hint && hits.find((x) => x.admin1?.toLowerCase() === hint.toLowerCase())) || hits[0];
  return g ? toPlace(g) : null;
}

/** Today in California, as `YYYY-MM-DD`, plus `offset` days. */
export function crewDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return DAY.format(d);
}

/** Before noon in California the plan is for today; after it, for tomorrow's shift. */
export function crewDefaultDate(): string {
  const hour = Number(HOUR_NUM.format(new Date()));
  return crewDate(hour < 12 ? 0 : 1);
}

/** A `YYYY-MM-DD` from a request, or the default plan day. */
export function parseDate(raw: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw ?? "") ? raw! : crewDefaultDate();
}

export type Shift = { start: number; end: number };
export const ALL_DAY: Shift = { start: 0, end: 24 };
/** `{start: 7, end: 17}` → `"07-17"`, the form links and the app use. */
export const formatShift = (s: Shift) => `${String(s.start).padStart(2, "0")}-${String(s.end).padStart(2, "0")}`;

/** `07-17` → `{start: 7, end: 17}`; anything malformed falls back to a day shift. */
export function parseShift(raw: string | null): { start: number; end: number } {
  // Forgiving: "07-17", "7–17", "07 17", "7:00 to 17:00" all mean the same shift.
  const m = /^\s*(\d{1,2})(?::00)?\s*(?:-|–|—|to|\s)\s*(\d{1,2})(?::00)?\s*$/i.exec(raw ?? "");
  const start = m ? Number(m[1]) : 7;
  const end = m ? Number(m[2]) : 17;
  return start < end && end <= 24 ? { start, end } : { start: 7, end: 17 };
}

const COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

/** Hourly temperature (°C) and wind by local hour from the National Weather Service: US only, free, no key. */
async function nwsHourly(lat: number, lon: number): Promise<Map<string, { c: number | null; dir: number | null; kmh: number | null }>> {
  const out = new Map<string, { c: number | null; dir: number | null; kmh: number | null }>();
  const get = (url: string) =>
    cached(url, 3600, (t) => JSON.parse(t), { "User-Agent": "airsignal.app (info@superduperai.co)", Accept: "application/geo+json" });
  const point = await get(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const url = point?.properties?.forecastHourly;
  const fc = url ? await get(url) : null;
  for (const p of fc?.properties?.periods ?? []) {
    const f = Number(p.temperature);
    const c = p.temperatureUnit === "F" ? ((f - 32) * 5) / 9 : f;
    const mph = Number(String(p.windSpeed ?? "").split(" ")[0]);
    const di = COMPASS16.indexOf(String(p.windDirection ?? ""));
    out.set(localHour(new Date(p.startTime).toISOString()), {
      c: Math.round(c * 10) / 10,
      dir: di >= 0 ? di * 22.5 : null,
      kmh: Number.isFinite(mph) ? Math.round(mph * 1.609) : null,
    });
  }
  return out;
}

export async function crewPlan(place: string, date: string, shift: Shift): Promise<CrewAnswer | null> {
  const at = await geocode(place);
  return at ? crewPlanAt(at, date, shift) : null;
}

/** The plan for a place already resolved, so callers that also need the site key geocode once. */
export async function crewPlanAt(at: CrewPlace, date: string, shift: Shift): Promise<CrewAnswer> {
  // A day of history so the first shift hour has the 12 hours a NowCast needs.
  const q = `latitude=${at.lat}&longitude=${at.lon}&past_days=1&forecast_days=3&timezone=${encodeURIComponent(CREW_TZ)}`;
  const [aqR, wxR, fires, ground, alerts] = await Promise.all([
    json(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5`).catch((e: Error) => e),
    json(`https://api.open-meteo.com/v1/forecast?${q}&hourly=temperature_2m,winddirection_10m,windspeed_10m`).catch((e: Error) => e),
    fetchFires(),
    fetchGround(at.lat, at.lon),
    nwsAlerts(at.lat, at.lon),
  ]);
  let hours: { time: string; pm25: number | null; temp_c: number | null }[];
  let fallback: CrewAnswer["fallback"];
  const wind = new Map<string, { dir_deg: number; kmh: number }>();
  if (!(wxR instanceof Error)) {
    (wxR.hourly.time as string[]).forEach((t, i) => {
      const d = wxR.hourly.winddirection_10m?.[i];
      const k = wxR.hourly.windspeed_10m?.[i];
      if (typeof d === "number" && typeof k === "number") wind.set(t, { dir_deg: d, kmh: Math.round(k) });
    });
  } else {
    for (const [t, w] of await nwsHourly(at.lat, at.lon)) if (w.dir !== null && w.kmh !== null) wind.set(t, { dir_deg: w.dir, kmh: w.kmh });
  }
  if (!(aqR instanceof Error) && !(wxR instanceof Error)) {
    const temp = new Map<string, number | null>(
      (wxR.hourly.time as string[]).map((t, i) => [t, wxR.hourly.temperature_2m[i]]),
    );
    hours = (aqR.hourly.time as string[]).map((time, i) => ({
      time,
      pm25: aqR.hourly.pm2_5[i] ?? null,
      temp_c: temp.get(time) ?? null,
    }));
  } else {
    // Open-Meteo shares a daily limit across Cloudflare's egress IPs and can refuse a whole day.
    // A safety tool must still answer: the air holds at the nearest monitor's reading (persistence,
    // said on the page), the temperature comes from the National Weather Service.
    const reason = String(aqR instanceof Error ? aqR.message : (wxR as Error).message);
    const held = ground ?? (await fetchGround(at.lat, at.lon, 100));
    if (!held) throw new Error(`${reason}; no ground monitor within 100 km to fall back on`);
    const temp: Map<string, number | null> =
      wxR instanceof Error
        ? new Map([...(await nwsHourly(at.lat, at.lon))].map(([t, w]) => [t, w.c]))
        : new Map((wxR.hourly.time as string[]).map((t, i) => [t, wxR.hourly.temperature_2m[i]]));
    const t0 = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 36 * 3_600_000;
    hours = Array.from({ length: 36 + 80 }, (_, k) => {
      const time = localHour(new Date(t0 + k * 3_600_000).toISOString());
      return { time, pm25: held.pm25, temp_c: temp.get(time) ?? null };
    });
    fallback = { air: "monitor", monitor: `${held.nearest}, ${held.nearest_km} km`, temp: !(wxR instanceof Error) ? "open-meteo" : temp.size ? "nws" : "none", reason };
  }
  // Only detections that could matter: the US list runs to tens of thousands in fire season, and the
  // engine looks no further than ~2° anyway.
  const near = fires.filter(([la, lo]) => Math.abs(la - at.lat) < 2 && Math.abs(lo - at.lon) < 2.5);
  const out = JSON.parse(
    core().wasm_crew_plan(JSON.stringify({ hours, date, ...shift, lat: at.lat, lon: at.lon, fires: near, ground })),
  );
  if (out.error) throw new Error(out.error);
  // With no forecast the "model" is the monitor itself; comparing them would claim a check that never ran.
  if (fallback) {
    out.confidence.notes = (out.confidence.notes as string[]).map((n) =>
      n.replace(/; the model had [\d.]+\..*$/, "; the plan holds this reading for every hour."),
    );
  }
  const plan = out as CrewPlan;
  const windOut = plan.hours.flatMap((h) => {
    const w = wind.get(h.time);
    return w ? [{ time: h.time, ...w }] : [];
  });
  // About 150 km: a plume drawn further than that is a guess, and the engine itself looks no further.
  const fires_near = near
    .filter(([la, lo]) => Math.abs(la - at.lat) < 1.35 && Math.abs(lo - at.lon) * Math.cos((at.lat * Math.PI) / 180) < 1.35)
    .slice(0, 400);
  return {
    place: at, date, shift, plan, alerts, home: homeSignal(plan), dispatch: dispatchFor(plan), wind: windOut, fires_near,
    ...(fallback ? { fallback } : {}),
  };
}

/**
 * The site a report belongs to: the town. A worker on GPS ("near Fresno") and a crew lead who typed
 * "Fresno" must share one list, so the key is the town, never the display name. Kept without the state
 * so existing report rows stay on their site.
 */
export function siteKey(place: Pick<CrewPlace, "town">): string {
  return slug(place.town);
}

/** The local hour now, in the forecast's format. */
export function nowHour(): string {
  return localHour(new Date().toISOString());
}

/**
 * What the plan said for the hour a report was made: the evidence a worker's report carries, so
 * "it was smoky" arrives with the NowCast, the nearest satellite fire and the ground monitor.
 */
export function evidenceFor(answer: CrewAnswer, at = nowHour()) {
  const hour = answer.plan.hours.find((h) => h.time === at) ?? null;
  return {
    place: answer.place,
    hour: at,
    metrics: hour?.metrics ?? null,
    confidence: answer.plan.confidence.level,
    fire: answer.plan.confidence.fire,
    ground: answer.plan.confidence.ground,
  };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

/**
 * Where the report was made and which way the camera faced, from the phone (or the page's
 * geolocation). Rounded to 3 decimals, about 100 m: enough to put it on a block of the field, not
 * enough to follow a person. A heading within 45° of the nearest satellite fire is called out,
 * because "the haze is in the direction of the fire" is the sentence a crew lead acts on.
 */
export function reportedFrom(
  raw: { lat?: unknown; lon?: unknown; accuracy_m?: unknown; heading_deg?: unknown; sky?: unknown },
  fire: CrewPlan["confidence"]["fire"],
) {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const lat = num(raw.lat);
  const lon = num(raw.lon);
  const heading = num(raw.heading_deg);
  const accuracy = num(raw.accuracy_m);
  const where =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, accuracy_m: Number.isFinite(accuracy) ? Math.round(accuracy) : null }
      : null;
  let facing: { heading_deg: number; compass: string; toward_fire: boolean | null } | null = null;
  if (Number.isFinite(heading)) {
    const h = ((heading % 360) + 360) % 360;
    // The engine's exact bearing when it sends one; the 8-point label is only a fallback.
    const fireDeg = fire ? (fire.bearing_deg ?? COMPASS.indexOf(fire.direction) * 45) : -1;
    const diff = fireDeg >= 0 ? Math.abs(((h - fireDeg + 540) % 360) - 180) : null;
    facing = { heading_deg: Math.round(h), compass: compass(h), toward_fire: diff === null ? null : diff <= 45 };
  }
  // A sky-check result the phone attaches: kept as given, small fields only.
  const s = raw.sky && typeof raw.sky === "object" ? (raw.sky as Record<string, unknown>) : null;
  const sky = s
    ? { smoke: Number(s.smoke) || 0, smoke_call: String(s.smoke_call ?? ""), verdict: String(s.verdict ?? "").slice(0, 200) }
    : null;
  return where || facing || sky ? { where, facing, sky } : null;
}

/** A report's place in words: "36.748, -119.772 · facing 210° SW, toward the fire". */
export function describeFrom(from: ReturnType<typeof reportedFrom> | null | undefined): string | null {
  if (!from) return null;
  const parts: string[] = [];
  if (from.where) parts.push(`${from.where.lat.toFixed(3)}, ${from.where.lon.toFixed(3)}`);
  if (from.facing)
    parts.push(`facing ${from.facing.heading_deg}° ${from.facing.compass}${from.facing.toward_fire ? ", toward the nearest fire" : ""}`);
  if (from.sky?.smoke_call) parts.push(`sky check: smoke ${Math.round(from.sky.smoke * 100)}%`);
  return parts.length ? parts.join(" · ") : null;
}

/** A salted, daily-rotating hash of the sender: enough to rate-limit, useless to identify. */
export async function senderHash(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${crewDate(0)}|crew-air`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const REPORT_LABELS: Record<ReportKind, string> = {
  smoke: "Smoke or haze",
  ash: "Ash falling",
  symptoms: "Someone feels sick",
  no_n95: "No N95s here",
  no_shade: "No shade",
  no_water: "No water",
  other: "Something else",
};

/**
 * A Cal/OSHA complaint drafted from a report: every fact the report holds, square brackets for what
 * only the worker knows (employer, address, how many people, confidentiality). Used by the escalation
 * page and /api/crew/complaint. Nothing is filed by us: the worker, or an agent acting on the worker's
 * explicit request, submits it after the worker has read it.
 */
export function complaintText(
  report: { id: number; site: string; created_at: string; kind: string; note: string | null; status: string; handled_at: string | null; handled_note: string | null },
  evidence: any,
): string {
  const pt = ptTime;
  const m = evidence?.metrics ?? {};
  const from = evidence?.from;
  const smoke = ["smoke", "ash", "symptoms", "no_n95"].includes(report.kind);
  const rule = smoke ? "wildfire smoke protections required by Title 8 §5141.1" : "heat illness protections required by Title 8 §3395";
  const age = minutesSince(report.created_at);
  const air = [
    m.us_aqi_pm25 !== undefined ? `forecast PM2.5 AQI ${m.us_aqi_pm25} for that hour (EPA NowCast)` : null,
    m.temp_f !== undefined ? `${Math.floor(m.temp_f)}°F` : null,
    evidence?.fire ? `nearest NASA VIIRS fire detection ${Math.round(evidence.fire.nearest_km)} km ${evidence.fire.direction}` : null,
    evidence?.ground ? `AirNow monitor ${evidence.ground.nearest} (${Math.round(evidence.ground.nearest_km)} km): ${evidence.ground.pm25} µg/m³` : null,
    from?.sky?.smoke_call ? `photo of the sky checked by a vision model: smoke ${Math.round(from.sky.smoke * 100)}%` : null,
    from?.facing ? `camera facing ${from.facing.heading_deg}° ${from.facing.compass}${from.facing.toward_fire ? ", toward the fire" : ""}` : null,
  ].filter(Boolean);
  const handled =
    report.status === "open"
      ? `; not handled after ${age} minutes`
      : `; marked handled ${report.handled_at ? pt(report.handled_at) : ""}${report.handled_note ? ` (${report.handled_note})` : ""}`;
  const file = agenciesFor(evidence?.place)[0]!;
  return [
    `To: ${file.name} (${file.url}).`,
    `Hazard: outdoor work without the ${rule}.`,
    `Employer: [employer name]. Worksite: [worksite address], ${evidence?.place?.name ?? report.site}${from?.where ? ` (${from.where.lat}, ${from.where.lon})` : ""}.`,
    `When: ${pt(report.created_at)} PT.`,
    `What happened: ${REPORT_LABELS[report.kind as ReportKind] ?? report.kind}${report.note ? ` - ${report.note.replace(/[.\s]+$/, "")}` : ""}. Reported to the crew lead at ${pt(report.created_at)}${handled}.`,
    air.length ? `Air data: ${air.join("; ")}.` : null,
    `Workers exposed: [number]. Protections missing: [N95s / shade / water / breaks / information].`,
    `I [want / do not want] my name kept confidential.`,
    `Record: Crew Air report #${report.id}, airsignal.app/crew.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Agency {
  name: string;
  url: string;
  how: string;
}

const FEDERAL_OSHA: Agency = {
  name: "Federal OSHA",
  url: "https://www.osha.gov/workers/file-complaint",
  how: "Online, by phone 1-800-321-6742, or at an area office. You can ask for your name to be kept confidential.",
};

/**
 * Where a worker files a safety complaint, by state. California, Oregon and Washington run their own
 * OSHA plans; elsewhere federal OSHA takes complaints. Data, like the rulebooks: a new state plan is a
 * new entry, not new code. Federal OSHA is always listed too, since it covers federal worksites and
 * every state without a plan.
 */
const STATE_AGENCIES: Record<string, Agency> = {
  California: {
    name: "Cal/OSHA",
    url: "https://www.dir.ca.gov/dosh/Complaint.htm",
    how: "Online or at a district office; anonymous if you want.",
  },
  Oregon: {
    name: "Oregon OSHA",
    url: "https://osha.oregon.gov/workers",
    how: "Online form (English and Spanish) or the field office nearest the worksite.",
  },
  Washington: {
    name: "Washington L&I (DOSH)",
    url: "https://lni.wa.gov/workers-rights/workplace-complaints/safety-complaints",
    how: "Call 1-800-423-7233 or send the DOSH complaint form; photos can be attached. Anonymous or confidential.",
  },
};

/** The agencies for a place: its state's plan first when it has one, federal OSHA always. */
export function agenciesFor(place: { state?: string | null } | null | undefined): Agency[] {
  const own = place?.state ? STATE_AGENCIES[place.state] : undefined;
  return own ? [own, FEDERAL_OSHA] : [STATE_AGENCIES.California!, FEDERAL_OSHA];
}
