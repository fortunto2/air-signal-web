/**
 * An Air Signal observation, validated: what a person says about their own air, structured so it
 * can be counted against monitors later. The shape is AirKit's `ObservationRequest.Body`
 * (air-signal-ios): kind, intensity 1–5, the minute it was observed, and the evidence snapshot the
 * phone saw. Pure, so the test can hand it bad input without a server.
 */

export const REPORT_APPS = ["crewair", "airsignal"] as const;
export type ReportApp = (typeof REPORT_APPS)[number];

export const OBSERVATION_KINDS = ["smoke_smell", "haze", "ash", "dust", "chemical_odour", "clear"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** Spellings the kinds have gone by; stored as AirKit's raw values. */
const KIND_ALIASES: Record<string, ObservationKind> = { chemical_smell: "chemical_odour", chemical: "chemical_odour", smoke: "smoke_smell" };

export interface Observation {
  kind: ObservationKind;
  intensity: 1 | 2 | 3 | 4 | 5;
  /** ISO UTC to the minute, as sent; `null` when absent or unreadable. */
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
  const kindRaw = String(o.kind ?? "").trim().toLowerCase();
  const kind = (OBSERVATION_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ObservationKind) : KIND_ALIASES[kindRaw];
  if (!kind) throw new Error(`observation.kind must be one of ${OBSERVATION_KINDS.join(", ")}`);
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
  return { kind, intensity: intensity as Observation["intensity"], observed_at, snapshot };
}
