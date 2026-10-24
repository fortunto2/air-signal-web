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
import { getNearbyCities } from "./db";

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
    fire: { nearest_km: number; direction: string; within_50km: number } | null;
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

export interface CrewAnswer {
  place: { name: string; lat: number; lon: number };
  date: string;
  shift: { start: number; end: number };
  plan: CrewPlan;
}

async function json(url: string): Promise<any> {
  // Cached at the edge: /crew is no-store (its reports are live), so the forecast must not be
  // fetched again on every view. Ten minutes is far inside how often the models update.
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

/** A shared upstream file: cached by the Cloudflare edge for `ttl` seconds, and per isolate too. */
const memo = new Map<string, { at: number; value: unknown }>();
async function shared<T>(url: string, ttl: number, parse: (text: string) => T): Promise<T | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl * 1000) return hit.value as T;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: ttl, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const value = parse(await res.text());
    memo.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
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
export async function fetchFires(): Promise<[number, number][]> {
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
  const sets = await Promise.all(FIRMS.map((u) => shared(u, 1800, parse)));
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

/** A UTC instant as the forecast's local hour, `2026-10-24T05:00`. */
function localHour(utc: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: CREW_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(utc)).map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

/**
 * The latest AirNow hour within 25 km: median of the nearest three monitors.
 *
 * AirNow posts an hour's file roughly an hour later and fills it in over the next one, so files are
 * searched newest first, up to four hours back, for one where a nearby monitor has a value. Keyless; the hourly file is ~1 MB and cached at the edge.
 */
export async function fetchGround(lat: number, lon: number) {
  for (let back = 1; back <= 4; back++) {
    const t = new Date(Date.now() - back * 3_600_000).toISOString();
    const stamp = `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}${t.slice(11, 13)}`;
    const url = `https://files.airnowtech.org/airnow/${t.slice(0, 4)}/${stamp.slice(0, 8)}/HourlyAQObs_${stamp}.dat`;
    const monitors = await shared(url, 3600, parseAirNow);
    if (!monitors) continue;
    const near = monitors
      .filter((m) => Math.abs(m.lat - lat) < 0.4 && Math.abs(m.lon - lon) < 0.5)
      .map((m) => ({ ...m, km: km(lat, lon, m.lat, m.lon) }))
      .filter((m) => m.km <= 25)
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

/** A California place first: the rulebook is Cal/OSHA, and "Fresno" means the one in the valley. */
/** `"36.748,-119.772"` → the coordinate, named after the nearest city we know, else the numbers. */
async function fromCoordinates(place: string): Promise<CrewAnswer["place"] | null | undefined> {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(place);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const [near] = await getNearbyCities(lat, lon, 0.5, 1).catch(() => []);
  const name = near ? `near ${near.name}` : `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  return { name, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}

/** Up to 8 US places matching what was typed, California first: the app's and page's place search. */
export async function placeSuggestions(q: string): Promise<{ name: string; detail: string; lat: number; lon: number }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const r = await json(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=20&countryCode=US`,
  );
  const hits: any[] = r.results ?? [];
  hits.sort((a, b) => Number(b.admin1 === "California") - Number(a.admin1 === "California"));
  return hits.slice(0, 8).map((g) => ({
    name: g.name,
    detail: [g.admin2, g.admin1].filter(Boolean).join(", "),
    lat: g.latitude,
    lon: g.longitude,
  }));
}

export async function geocode(place: string): Promise<CrewAnswer["place"] | null> {
  const coords = await fromCoordinates(place);
  if (coords !== undefined) return coords;
  const name = place.split(",")[0]!.trim();
  if (!name) return null;
  const r = await json(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&countryCode=US`,
  );
  const hits: any[] = r.results ?? [];
  const g = hits.find((x) => x.admin1 === "California") ?? hits[0];
  if (!g) return null;
  return { name: [g.name, g.admin1].filter(Boolean).join(", "), lat: g.latitude, lon: g.longitude };
}

/** Today in California, as `YYYY-MM-DD`, plus `offset` days. */
export function crewDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: CREW_TZ }).format(d);
}

/** Before noon in California the plan is for today; after it, for tomorrow's shift. */
export function crewDefaultDate(): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: CREW_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return crewDate(hour < 12 ? 0 : 1);
}

/** `07-17` → `{start: 7, end: 17}`; anything malformed falls back to a day shift. */
export function parseShift(raw: string | null): { start: number; end: number } {
  // Forgiving: "07-17", "7–17", "07 17", "7:00 to 17:00" all mean the same shift.
  const m = /^\s*(\d{1,2})(?::00)?\s*(?:-|–|—|to|\s)\s*(\d{1,2})(?::00)?\s*$/i.exec(raw ?? "");
  const start = m ? Number(m[1]) : 7;
  const end = m ? Number(m[2]) : 17;
  return start < end && end <= 24 ? { start, end } : { start: 7, end: 17 };
}

export async function crewPlan(place: string, date: string, shift: { start: number; end: number }): Promise<CrewAnswer | null> {
  const at = await geocode(place);
  if (!at) return null;
  // A day of history so the first shift hour has the 12 hours a NowCast needs.
  const q = `latitude=${at.lat}&longitude=${at.lon}&past_days=1&forecast_days=3&timezone=${encodeURIComponent(CREW_TZ)}`;
  const [aq, wx, fires, ground] = await Promise.all([
    json(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5`),
    json(`https://api.open-meteo.com/v1/forecast?${q}&hourly=temperature_2m`),
    fetchFires(),
    fetchGround(at.lat, at.lon),
  ]);
  const temp = new Map<string, number | null>(
    (wx.hourly.time as string[]).map((t, i) => [t, wx.hourly.temperature_2m[i]]),
  );
  const hours = (aq.hourly.time as string[]).map((time, i) => ({
    time,
    pm25: aq.hourly.pm2_5[i] ?? null,
    temp_c: temp.get(time) ?? null,
  }));
  const out = JSON.parse(
    core().wasm_crew_plan(JSON.stringify({ hours, date, ...shift, lat: at.lat, lon: at.lon, fires, ground })),
  );
  if (out.error) throw new Error(out.error);
  return { place: at, date, shift, plan: out as CrewPlan };
}

/** The site a report belongs to: the geocoded place, as a slug. Crew and crew lead share the URL. */
export function siteKey(placeName: string): string {
  // "Fresno, California" (typed) and "near Fresno" (GPS) must be one site, or a worker on GPS and a
  // crew lead who typed the name see different report lists. The town is the key; the geocoder already
  // prefers California, so two Fresnos in different states do not meet here in practice.
  return slug(placeName.replace(/^near\s+/i, "").split(",")[0]!);
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
    const fireDeg = fire ? COMPASS.indexOf(fire.direction) * 45 : -1;
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

export const REPORT_LABELS: Record<string, string> = {
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
  const pt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: CREW_TZ, dateStyle: "medium", timeStyle: "short" });
  const m = evidence?.metrics ?? {};
  const from = evidence?.from;
  const smoke = ["smoke", "ash", "symptoms", "no_n95"].includes(report.kind);
  const rule = smoke ? "wildfire smoke protections required by Title 8 §5141.1" : "heat illness protections required by Title 8 §3395";
  const age = Math.floor((Date.now() - Date.parse(report.created_at)) / 60_000);
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
  return [
    `Hazard: outdoor work without the ${rule}.`,
    `Employer: [employer name]. Worksite: [worksite address], ${evidence?.place?.name ?? report.site}${from?.where ? ` (${from.where.lat}, ${from.where.lon})` : ""}.`,
    `When: ${pt(report.created_at)} PT.`,
    `What happened: ${REPORT_LABELS[report.kind] ?? report.kind}${report.note ? ` - ${report.note}` : ""}. Reported to the crew lead at ${pt(report.created_at)}${handled}.`,
    air.length ? `Air data: ${air.join("; ")}.` : null,
    `Workers exposed: [number]. Protections missing: [N95s / shade / water / breaks / information].`,
    `I [want / do not want] my name kept confidential.`,
    `Record: Crew Air report #${report.id}, airsignal.app/crew.`,
  ]
    .filter(Boolean)
    .join("\n");
}
