/**
 * The report model, pure: what a crew report may say, which app sent it, and Air Signal's structured
 * observation. The shape is AirKit's `ObservationRequest` (air-signal-ios): kind, intensity 1–5, the
 * minute it was observed, and the evidence snapshot the phone saw. No imports, so openapi.ts,
 * llms.txt and the tests read the same lists the endpoint enforces.
 */

/** A crew report's kind: what §5141.1 asks workers to report, plus the heat rule's missing items. */
export const REPORT_KINDS = ["smoke", "ash", "symptoms", "no_n95", "no_shade", "no_water", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_APPS = ["crewair", "airsignal"] as const;
export type ReportApp = (typeof REPORT_APPS)[number];

/** AirKit's `ObservationKind` raw values, exactly; no aliases, so the dataset has one spelling. */
export const OBSERVATION_KINDS = ["smoke_smell", "haze", "ash", "dust", "chemical_odour", "clear"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export interface Observation {
  kind: ObservationKind;
  intensity: 1 | 2 | 3 | 4 | 5;
  /** ISO UTC to the minute, as sent; `null` when absent. */
  observed_at: string | null;
  /** The phone's evidence snapshot, kept as given but trimmed to small fields. */
  snapshot: Record<string, unknown> | null;
}

/** `"crewair"` unless the body says `airsignal`; anything else is refused by name. */
export function parseApp(raw: unknown): ReportApp {
  if (raw === undefined || raw === null || raw === "") return "crewair";
  const app = String(raw).trim().toLowerCase();
  if (!(REPORT_APPS as readonly string[]).includes(app)) throw new Error(`app must be one of ${REPORT_APPS.join(", ")}`);
  return app as ReportApp;
}

const SNAPSHOT_KEYS = ["hour", "aqi", "pm25_ugm3", "wind_dir_deg", "wind_kmh", "fire", "monitor"];

/**
 * `null` when no observation was sent; throws, with the field named, when one was sent badly. A
 * report with a broken observation is refused rather than stored half-right: the row is the dataset.
 */
export function parseObservation(raw: unknown): Observation | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("observation must be an object");
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? "").trim();
  if (!(OBSERVATION_KINDS as readonly string[]).includes(kind)) throw new Error(`observation.kind must be one of ${OBSERVATION_KINDS.join(", ")}`);
  const intensity = Number(o.intensity);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) throw new Error("observation.intensity must be an integer 1–5");
  let observed_at: string | null = null;
  if (o.observed_at !== undefined && o.observed_at !== null && o.observed_at !== "") {
    const t = Date.parse(String(o.observed_at));
    if (!Number.isFinite(t)) throw new Error("observation.observed_at must be an ISO date-time");
    observed_at = new Date(t).toISOString().slice(0, 16) + ":00Z";
  }
  let snapshot: Record<string, unknown> | null = null;
  if (o.snapshot !== undefined && o.snapshot !== null) {
    if (typeof o.snapshot !== "object" || Array.isArray(o.snapshot)) throw new Error("observation.snapshot must be an object");
    const s = o.snapshot as Record<string, unknown>;
    snapshot = Object.fromEntries(SNAPSHOT_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
    if (JSON.stringify(snapshot).length > 4000) throw new Error("observation.snapshot too large");
  }
  return { kind: kind as ObservationKind, intensity: intensity as Observation["intensity"], observed_at, snapshot };
}

/** The body of POST /api/report, validated. */
export interface ObservationRequest {
  /** Two decimals, about a kilometre: rounded here whatever the client sent. */
  lat: number;
  lon: number;
  observation: Observation & { observed_at: string };
  /** The sky check's smoke probability, 0–1, when the person attached it. */
  sky_smoke: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `{lat, lon, observation: {kind, intensity, observed_at?}, sky?: {smoke_score}, snapshot?}` → a request,
 * or a thrown error naming the field. `observed_at` defaults to `now`; a time more than a day old or in
 * the future is refused, since the evidence is derived for that hour and a plan covers only the day.
 */
export function parseObservationRequest(raw: unknown, now = new Date()): ObservationRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("body must be a JSON object");
  const b = raw as Record<string, unknown>;
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (b.lat === undefined || b.lat === null || b.lat === "" || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error("lat must be a number between -90 and 90");
  if (b.lon === undefined || b.lon === null || b.lon === "" || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error("lon must be a number between -180 and 180");
  if (b.observation === undefined || b.observation === null) throw new Error("observation required: {kind, intensity, observed_at?}");
  // The phone's snapshot may travel beside the observation as well as inside it.
  const inner = b.observation as Record<string, unknown>;
  const observation = parseObservation(typeof inner === "object" && inner !== null && !Array.isArray(inner) && inner.snapshot === undefined ? { ...inner, snapshot: b.snapshot } : b.observation)!;
  const observed_at = observation.observed_at ?? now.toISOString().slice(0, 16) + ":00Z";
  const t = Date.parse(observed_at);
  if (t > now.getTime() + 5 * 60_000) throw new Error("observation.observed_at is in the future");
  if (t < now.getTime() - 36 * 3_600_000) throw new Error("observation.observed_at is more than 36 hours old");
  let sky_smoke: number | null = null;
  if (b.sky !== undefined && b.sky !== null) {
    if (typeof b.sky !== "object" || Array.isArray(b.sky)) throw new Error("sky must be an object {smoke_score}");
    const s = Number((b.sky as Record<string, unknown>).smoke_score ?? (b.sky as Record<string, unknown>).smoke);
    if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error("sky.smoke_score must be a number 0–1");
    sky_smoke = Math.round(s * 1000) / 1000;
  }
  return { lat: round2(lat), lon: round2(lon), observation: { ...observation, observed_at }, sky_smoke };
}
