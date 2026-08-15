import type { Band } from "./site";
import { SITE, abs } from "./site";
import type { CityView } from "./view";

/**
 * What a site embedding us gets back.
 *
 * Deliberately not `CityView`. That model exists so the page, the `.md` twin and the JSON-LD cannot
 * disagree, and it changes whenever any of them needs something — which is fine inside this repo and
 * unacceptable across a network boundary. Somebody else's home page must not break because we added
 * a field to a signal line.
 *
 * So this is a second, smaller model with one job: everything a small bar needs, already decided.
 * Numbers come with their units named rather than formatted, because the caller knows its own
 * language and we do not — Miralinka writes "0.4 м", we would have sent "0.4m".
 *
 * The colours travel with the payload for the same reason: an embed renders inside a stylesheet we
 * have never seen, so it cannot inherit ours and must not guess.
 */
export interface WidgetPayload {
  name: string;
  country: string;
  /** Absolute, and the thing the embed links to. A relative path would resolve against their host. */
  url: string;
  aqi: { value: number; label: string; band: Band; color: string } | null;
  comfort: { value: number; word: string; band: Band; color: string } | null;
  /** In their own units, unformatted. Absent means absent — never zero. */
  readings: {
    pm25?: number;
    pm10?: number;
    /** °C */
    temperature?: number;
    /** m/s */
    wind?: number;
    /** Degrees the wind comes *from*, so a caller can draw the arrow the site draws. */
    wind_dir?: number;
    /** Metres of significant wave height. Absent inland, which is not a failure. */
    wave?: number;
    /** Sea surface, °C */
    sea_temp?: number;
    uv?: number;
    /** % */
    humidity?: number;
  };
  /** How many community devices the numbers came from. Zero means modelled, and says so. */
  sensors: number;
  source: string;
  updatedAt: string | null;
}

/**
 * The band colours, resolved to hex.
 *
 * A third copy of the ramp, after tokens.css and the OG card, and the one hardest to justify — but
 * an embed cannot read our custom properties and an SVG served as an image cannot either. Light
 * values only: a widget on an unknown page cannot know whether that page is dark, so it picks the
 * variant that stays legible on white and lets `prefers-color-scheme` in the embed script swap it.
 */
export const BAND_HEX: Record<Band, { light: string; dark: string }> = {
  excellent: { light: "#0e7a73", dark: "#2ba79d" },
  good: { light: "#6b9a4c", dark: "#8fbf62" },
  fair: { light: "#c08d2a", dark: "#dca83c" },
  poor: { light: "#bd5c33", dark: "#de7647" },
  bad: { light: "#8b3a4d", dark: "#c15570" },
};

/** The words above a comfort score, same ladder the site uses. */
const COMFORT_WORDS: Record<Band, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  bad: "Bad",
};

/** Drops undefined rather than sending nulls: a missing reading is absent, never zero. */
function present(readings: Record<string, number | undefined>): WidgetPayload["readings"] {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(readings)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function widgetPayload(v: CityView): WidgetPayload {
  const r = v.readings as Record<string, number | undefined>;

  return {
    name: v.name,
    country: v.country,
    url: abs(v.path),
    aqi: v.aqi && {
      value: v.aqi.value,
      label: v.aqi.label,
      band: v.aqi.band,
      color: BAND_HEX[v.aqi.band].light,
    },
    comfort:
      v.comfort === null || v.band === null
        ? null
        : {
            value: v.comfort,
            word: COMFORT_WORDS[v.band],
            band: v.band,
            color: BAND_HEX[v.band].light,
          },
    readings: present({
      pm25: r.pm25,
      pm10: r.pm10,
      temperature: r.temperature,
      wind: r.wind,
      wind_dir: r.wind_dir,
      wave: r.wave,
      sea_temp: r.sea_temp,
      uv: r.uv,
      humidity: r.humidity,
    }),
    sensors: v.stationCount,
    source: SITE.origin,
    updatedAt: v.updatedAt?.toISOString() ?? null,
  };
}
