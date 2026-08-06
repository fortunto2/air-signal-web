/**
 * One place for anything that changes when the domain or the branding is decided.
 * Nothing else in the codebase hardcodes the host — canonical, hreflang, sitemap and the absolute
 * URLs in llms.txt all derive from `origin`, so pointing it at a domain that does not resolve tells
 * Google the real pages are duplicates of nothing.
 */
export const SITE = {
  origin: "https://airsignal.app",
  name: "Air Signal",
  /** Rendered as two halves so the second can carry the accent colour. */
  brand: { head: "air", tail: "signal" },
  /**
   * The promise, and it is deliberately not "air quality". The product reports whether being
   * outside is pleasant — air is one of fourteen inputs to that answer.
   */
  tagline: "what it is actually like outside",
  repo: "https://github.com/fortunto2/air-signal-web",
  analytics: { src: "https://analytics.superduperai.co/sda.js", source: "airsignal" },
} as const;

/** Languages, English first. `ru` and `tr` land once the English tree is stable. */
export const LANGS = ["en"] as const;
export const DEFAULT_LANG = "en";
export type Lang = (typeof LANGS)[number];

/**
 * The fourteen signals, in the order `airq-core` returns them — which is also the left-to-right
 * order of the spectrum. The order is part of the visual identity: a reader who learns that UV sits
 * fifth reads the glyph faster every time after.
 */
export const SIGNALS = [
  { key: "air", label: "Air", name: "Air quality" },
  { key: "temperature", label: "Temp", name: "Temperature" },
  { key: "wind", label: "Wind", name: "Wind" },
  { key: "sea", label: "Sea", name: "Sea & waves" },
  { key: "uv", label: "UV", name: "UV index" },
  { key: "earthquake", label: "Quake", name: "Earthquake" },
  { key: "fire", label: "Fire", name: "Fire risk" },
  { key: "pollen", label: "Pollen", name: "Pollen" },
  { key: "pressure", label: "Press", name: "Pressure" },
  { key: "geomagnetic", label: "Geo", name: "Geomagnetic" },
  { key: "humidity", label: "Humid", name: "Humidity" },
  { key: "daylight", label: "Light", name: "Daylight" },
  { key: "noise", label: "Noise", name: "Noise" },
  { key: "moon", label: "Moon", name: "Moon phase" },
] as const;

export type SignalKey = (typeof SIGNALS)[number]["key"];

/** Comfort bands. Shared by every surface so a colour never means two things. */
export type Band = "excellent" | "good" | "fair" | "poor" | "bad";

export function comfortBand(score: number): Band {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "bad";
}

/** PM2.5 in µg/m³ → the same band vocabulary, so the map and the score agree by construction. */
export function pmBand(pm: number | null): Band | "quiet" {
  if (pm === null) return "quiet";
  if (pm < 10) return "excellent";
  if (pm < 20) return "good";
  if (pm < 35) return "fair";
  if (pm < 55) return "poor";
  return "bad";
}

/** `/turkey/alanya/` and `/turkey/alanya/station-68412/`. Always ends in a slash: Astro writes
 *  `<path>/index.html` and Cloudflare Pages answers the slashless form with a 308, which would
 *  otherwise cost every canonical URL a redirect hop. */
export const paths = {
  city: (country: string, city: string) => `/${slug(country)}/${slug(city)}/`,
  station: (country: string, city: string, id: number) =>
    `/${slug(country)}/${slug(city)}/station-${id}/`,
  map: () => `/map/`,
};

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const abs = (path: string) => new URL(path, SITE.origin).href;
