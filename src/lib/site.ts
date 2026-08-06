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

/**
 * `/turkey/alanya` and `/turkey/alanya/station-68412`. No trailing slash, anywhere.
 *
 * The site serves a `.md` twin of every city and a sharded `.xml` sitemap, and a URL ending in an
 * extension cannot also end in a slash. Since the router applies one rule to every route, the
 * extensionless pages are the ones that give it up. Middleware 301s the slashed form so an old
 * link still lands.
 */
export const paths = {
  city: (country: string, city: string) => `/${slug(country)}/${slug(city)}`,
  station: (country: string, city: string, id: number) =>
    `/${slug(country)}/${slug(city)}/station-${id}`,
  map: () => `/map`,
  cityMarkdown: (country: string, city: string) => `/${slug(country)}/${slug(city)}.md`,
};

/**
 * The one place a URL segment is made, used by the pages, the sitemap and the ETL alike. If two
 * implementations of this existed, half the site's links would 404 and the other half would work.
 *
 * The combining-mark range is written as an escape on purpose: it used to be typed as literal
 * U+0300–U+036F, which renders as invisible marks hanging off a bracket and reads like a typo.
 */
export function slug(s: string): string {
  return s
    .toLowerCase()
    // NFD splits é into e + ◌́; ß and đ have no decomposition, so they are spelled out first.
    .replace(/ß/g, "ss")
    .replace(/[đð]/g, "d")
    .replace(/ı/g, "i")
    .replace(/ø/g, "o")
    .replace(/[æ]/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const abs = (path: string) => new URL(path, SITE.origin).href;
