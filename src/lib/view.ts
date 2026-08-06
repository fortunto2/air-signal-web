/**
 * The view-model every surface renders from.
 *
 * A city has four representations — the HTML page, its Markdown twin, its JSON-LD, and its entry
 * in llms.txt — and they must agree to the digit. Deriving all four from one function is the only
 * arrangement where they cannot quietly drift; the alternative is discovering months later that
 * the structured data says 78 and the sentence says 74.
 *
 * Nothing here touches the database or the DOM. It takes rows and returns strings and numbers.
 */

import {
  SIGNALS,
  comfortBand,
  paths,
  type Band,
  type SignalKey,
} from "./site";
import type { CityRow, StationRow, DayPoint } from "./db";

// ── readings ────────────────────────────────────────────────────────────────

/** Raw readings as the ETL stored them, in their own units. Keys are absent when unread. */
export interface Readings {
  pm25?: number;
  pm10?: number;
  temperature?: number;
  humidity?: number;
  wind?: number;
  pressure?: number;
  uv?: number;
  daylight?: number;
  wave?: number;
  sea_temp?: number;
  /** Degrees the wind comes *from*. Rust turns it into a compass label and an arrow. */
  wind_dir?: number;
  pollen?: number;
  kp?: number;
  quake?: number;
  fire_km?: number;
  moon?: number;
}

export function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const moonName = (p: number): string => {
  const names = [
    "new", "waxing crescent", "first quarter", "waxing gibbous",
    "full", "waning gibbous", "last quarter", "waning crescent",
  ];
  return names[Math.round(p * 8) % 8]!;
};

const uvWord = (uv: number) =>
  uv >= 11 ? "extreme" : uv >= 8 ? "very high" : uv >= 6 ? "high" : uv >= 3 ? "moderate" : "low";

/**
 * One line per signal: what it says, in the unit a person uses.
 *
 * A signal with no reading returns `null` for `measure` rather than a dash or a zero, so every
 * consumer decides for itself how to draw absence — and none of them can accidentally print "0".
 */
export interface SignalLine {
  key: SignalKey;
  label: string;
  name: string;
  /** 0–100, or undefined when unread. */
  score?: number;
  band?: Band;
  /** Human-readable measurement, e.g. "5.8 µg/m³". Null when there is no reading. */
  measure: string | null;
}

export function signalLines(
  scores: Partial<Record<SignalKey, number>>,
  r: Readings,
): SignalLine[] {
  const measures: Record<SignalKey, string | null> = {
    air: r.pm25 !== undefined ? `${r.pm25} µg/m³` : null,
    temperature: r.temperature !== undefined ? `${r.temperature} °C` : null,
    wind:
      r.wind !== undefined
        ? `${r.wind} km/h${r.wind_dir !== undefined ? ` from ${Math.round(r.wind_dir)}°` : ""}`
        : null,
    sea:
      r.sea_temp !== undefined
        ? `${r.sea_temp} °C${r.wave !== undefined ? ` · ${r.wave} m` : ""}`
        : r.wave !== undefined
          ? `${r.wave} m waves`
          : null,
    uv: r.uv !== undefined ? `${r.uv} · ${uvWord(r.uv)}` : null,
    earthquake:
      r.quake === undefined ? null : r.quake < 0 ? "none nearby" : `M${r.quake.toFixed(1)} felt`,
    fire:
      r.fire_km === undefined
        ? null
        : r.fire_km >= 200
          ? "none within 200 km"
          : `nearest ${r.fire_km} km`,
    pollen: r.pollen !== undefined ? `${r.pollen} grains/m³` : null,
    pressure: r.pressure !== undefined ? `${r.pressure} hPa` : null,
    geomagnetic: r.kp !== undefined ? `Kp ${r.kp}` : null,
    humidity: r.humidity !== undefined ? `${r.humidity} %` : null,
    daylight:
      r.daylight !== undefined
        ? `${Math.floor(r.daylight)} h ${Math.round((r.daylight % 1) * 60)} m`
        : null,
    noise: null,
    moon: r.moon !== undefined ? moonName(r.moon) : null,
  };

  return SIGNALS.map((s) => {
    const score = scores[s.key];
    return {
      key: s.key,
      label: s.label,
      name: s.name,
      score,
      band: score === undefined ? undefined : comfortBand(score),
      measure: measures[s.key],
    };
  });
}

// ── city ────────────────────────────────────────────────────────────────────

export interface CityView {
  id: number;
  name: string;
  country: string;
  path: string;
  lat: number;
  lon: number;
  comfort: number | null;
  band: Band | null;
  /** "Good", "Fair" — the one word above the score. */
  word: string;
  signals: SignalLine[];
  readings: Readings;
  worst: SignalLine | null;
  stationCount: number;
  divergence: number | null;
  /** The sentence with real numbers in it. The thing a search result is made of. */
  verdict: string;
  title: string;
  description: string;
  updatedAt: Date | null;
  history: DayPoint[];
}

const WORD: Record<Band, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  bad: "Bad",
};

export function cityView(row: CityRow, history: DayPoint[] = []): CityView {
  const scores = parseJson<Partial<Record<SignalKey, number>>>(row.signals_json, {});
  const readings = parseJson<Readings>(row.readings_json, {});
  const signals = signalLines(scores, readings);
  const band = row.comfort === null ? null : comfortBand(row.comfort);
  const worst = signals.find((s) => s.key === row.worst_signal) ?? null;

  return {
    id: row.id,
    name: row.name,
    country: row.country,
    path: paths.city(row.country_slug, row.slug),
    lat: row.lat,
    lon: row.lon,
    comfort: row.comfort,
    band,
    word: band ? WORD[band] : "No reading",
    signals,
    readings,
    worst,
    stationCount: row.station_count,
    divergence: row.divergence,
    verdict: cityVerdict(row, readings, worst),
    title: `Air Quality & Comfort in ${row.name} — live PM2.5, sea, UV`,
    description: cityDescription(row, readings),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    history,
  };
}

/**
 * The verdict sentence.
 *
 * It has one job: contain real numbers, and name the thing that is actually wrong. "Air quality is
 * moderate" is what every other site says and it is worth nothing; "particulates are low across
 * four community sensors, but midday UV reaches 9" is a sentence a person can act on, and it is
 * also the only kind Google will show under a title.
 */
function cityVerdict(row: CityRow, r: Readings, worst: SignalLine | null): string {
  const parts: string[] = [];

  if (row.comfort !== null) {
    const band = comfortBand(row.comfort);
    parts.push(
      band === "excellent" || band === "good"
        ? `Comfortable in ${row.name} today.`
        : band === "fair"
          ? `Mixed conditions in ${row.name} today.`
          : `Unpleasant in ${row.name} today.`,
    );
  }

  if (r.pm25 !== undefined) {
    parts.push(
      row.station_count > 0
        ? `Particulates are ${r.pm25 < 12 ? "low" : r.pm25 < 35 ? "moderate" : "high"} — ` +
            `${r.pm25} µg/m³ across ${row.station_count} community ` +
            `sensor${row.station_count === 1 ? "" : "s"}.`
        : `Modelled PM2.5 is ${r.pm25} µg/m³.`,
    );
  }

  if (r.sea_temp !== undefined) parts.push(`The sea is at ${r.sea_temp} °C.`);
  else if (r.temperature !== undefined) parts.push(`It is ${r.temperature} °C.`);

  // Name what costs the most points, with its reading rather than its score.
  if (worst?.measure && worst.score !== undefined && worst.score < 70) {
    parts.push(
      worst.key === "uv"
        ? `Midday UV reaches ${r.uv}, which is where the score loses most of its points.`
        : `${worst.name} at ${worst.measure} is what holds the score back.`,
    );
  }

  return parts.join(" ");
}

function cityDescription(row: CityRow, r: Readings): string {
  const bits: string[] = [];
  if (row.comfort !== null) bits.push(`Comfort ${row.comfort}/100 right now.`);
  if (r.pm25 !== undefined) {
    bits.push(
      `PM2.5 ${r.pm25} µg/m³` +
        (row.station_count > 0 ? ` from ${row.station_count} community sensors` : " (modelled)") +
        ".",
    );
  }
  if (r.sea_temp !== undefined) bits.push(`Sea ${r.sea_temp} °C.`);
  if (r.uv !== undefined) bits.push(`UV peaks at ${r.uv}.`);
  bits.push("Updated hourly.");
  return bits.join(" ").slice(0, 300);
}

// ── station ─────────────────────────────────────────────────────────────────

export interface StationView {
  id: number;
  path: string;
  cityName: string;
  cityPath: string;
  lat: number;
  lon: number;
  sensorType: string | null;
  pm25: number | null;
  pm10: number | null;
  pm25_24h: number | null;
  band: Band | "quiet";
  lastSeen: Date | null;
  /** Minutes since the last reading, or null when it has never reported. */
  ageMinutes: number | null;
  quiet: boolean;
  historyDays: number;
  distanceKm: number | null;
  divergence: number | null;
  /** "×3.9 higher than modelled", or null when there is nothing to compare against. */
  divergenceText: string | null;
  indexable: boolean;
  title: string;
  description: string;
  verdict: string;
}

/** A device that has not spoken in two hours is drawn hollow. Same threshold as the map legend. */
export const QUIET_AFTER_MINUTES = 120;

export function stationView(s: StationRow, city: CityRow, cityMedian: number | null): StationView {
  const lastSeen = s.last_seen ? new Date(s.last_seen.replace(" ", "T") + "Z") : null;
  const ageMinutes = lastSeen ? Math.max(0, Math.round((Date.now() - lastSeen.getTime()) / 60000)) : null;
  const quiet = ageMinutes === null || ageMinutes > QUIET_AFTER_MINUTES;

  const cityPath = paths.city(city.country_slug, city.slug);
  const hardware = s.sensor_type ? s.sensor_type.toUpperCase() : "particulate sensor";

  const divergenceText =
    s.divergence !== null && s.divergence > 1.15 && cityMedian !== null
      ? `×${s.divergence.toFixed(1)} ${(s.pm25 ?? 0) > cityMedian ? "higher" : "lower"} than the city median`
      : null;

  const parts = [
    // "An SDS011", not "A SDS011": the article follows the sound, and an initialism read letter by
    // letter starts with a vowel sound whenever its first letter does.
    `${article(hardware)} ${hardware} ${
      s.distance_km !== null ? `${s.distance_km} km from ${city.name}` : `near ${city.name}`
    }`,
    s.history_days >= 180
      ? "reporting for at least six months"
      : s.history_days >= 30
        ? "reporting for at least a month"
        : "newly online",
  ];
  if (s.pm25 !== null) parts.push(`currently reading ${s.pm25} µg/m³ PM2.5`);
  if (divergenceText) parts.push(`— ${divergenceText}, so the city aggregate down-weights it`);

  return {
    id: s.id,
    path: paths.station(city.country_slug, city.slug, s.id),
    cityName: city.name,
    cityPath,
    lat: s.lat,
    lon: s.lon,
    sensorType: s.sensor_type,
    pm25: s.pm25,
    pm10: s.pm10,
    pm25_24h: s.pm25_24h,
    band: quiet ? "quiet" : pmBandOf(s.pm25),
    lastSeen,
    ageMinutes,
    quiet,
    historyDays: s.history_days,
    distanceKm: s.distance_km,
    divergence: s.divergence,
    divergenceText,
    indexable: s.indexable === 1,
    title: `${city.name} — station ${s.id} live PM2.5`,
    description:
      (s.pm25 !== null ? `PM2.5 ${s.pm25} µg/m³` : "No current reading") +
      ` at Sensor.Community station ${s.id}, ${city.name}` +
      (s.sensor_type ? `. ${s.sensor_type.toUpperCase()}` : "") +
      (divergenceText ? `, ${divergenceText}` : "") +
      ".",
    verdict: parts.join(" ") + ".",
  };
}

/**
 * "a" or "an", by sound rather than by spelling.
 *
 * The hardware names are initialisms — SDS011 is said "ess-dee-ess", so it takes "an" even though
 * it is spelled with a consonant. These are the letters whose *names* open with a vowel sound.
 */
function article(word: string): string {
  const first = word.trim()[0]?.toUpperCase() ?? "";
  const isAcronym = /^[A-Z]{2,}/.test(word.trim());
  const vowelSounding = isAcronym ? "AEFHILMNORSX" : "AEIOU";
  return vowelSounding.includes(first) ? "An" : "A";
}

function pmBandOf(pm: number | null): Band | "quiet" {
  if (pm === null) return "quiet";
  if (pm < 10) return "excellent";
  if (pm < 20) return "good";
  if (pm < 35) return "fair";
  if (pm < 55) return "poor";
  return "bad";
}

// ── shared bits ─────────────────────────────────────────────────────────────

/** "4 min ago", "2 h ago". A page that shows a stale number has to say that it is stale. */
export function ago(minutes: number | null): string {
  if (minutes === null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.round(minutes / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
