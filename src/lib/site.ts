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

/**
 * The city every embed example is drawn from when a page has no better one of its own.
 *
 * Stuttgart, and not arbitrarily: Sensor.Community started there as OK Lab Stuttgart, and it has
 * twenty devices — so the example is a dense real measurement rather than a lone sensor on someone's
 * balcony. A constant rather than "whatever ranks first today", because an example that changes
 * under the reader is one they cannot check against what they just pasted.
 */
export const EMBED_SAMPLE = { place: "germany/stuttgart", name: "Stuttgart" } as const;

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
  countries: () => `/countries`,
  country: (country: string) => `/${slug(country)}`,
  city: (country: string, city: string) => `/${slug(country)}/${slug(city)}`,
  station: (country: string, city: string, id: number) =>
    `/${slug(country)}/${slug(city)}/station-${id}`,
  map: () => `/map`,
  ranking: () => `/ranking`,
  howItWorks: () => `/how-it-works`,
  api: () => `/api`,
  /**
   * The widget, explained. Note this is `/embed` and the script is `/embed.js` — two routes, and
   * the static page wins over `[country].astro` the same way `/map` and `/ranking` do.
   */
  embed: () => `/embed`,
  /** Smoke and heat shift plans for outdoor crews, Cal/OSHA. Static, so it wins over `[country]`. */
  crew: () => `/crew`,
  /** Crew Air's privacy policy and terms; the Crew Air app's App Store privacy URL. */
  crewPrivacy: () => `/crew/privacy`,
  /** Air Signal's privacy policy; the Air Signal app's App Store privacy URL. Static, wins over `[country]`. */
  privacy: () => `/privacy`,
  /**
   * The guide. `/guide` is the index; `/guide/<signal>` is one signal explained at length.
   *
   * Note the shape: a signal's article lives under the guide, not at the root. A reader arriving
   * on `/guide/pm25` should be able to delete the last segment and land somewhere that makes
   * sense — and it keeps fourteen article slugs out of the namespace that `[country].astro`
   * catches, where `/pollen` would otherwise be indistinguishable from a country.
   */
  guide: () => `/guide`,
  guideEntry: (topic: string) => `/guide/${slug(topic)}`,
  cityMarkdown: (country: string, city: string) => `/${slug(country)}/${slug(city)}.md`,
  countryMarkdown: (country: string) => `/${slug(country)}.md`,
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


/**
 * PM2.5 → US AQI, on the EPA's 2024 breakpoints.
 *
 * Lives here because three list pages print it a few hundred times each, and routing that through
 * the WASM core would be instantiating a binary to interpolate between two pairs of numbers. The
 * table is the one `airq-core` holds — if it moves there it moves here, and that is the single
 * thing to remember about this function.
 */
const PM25_BREAKS: readonly (readonly [number, number, number, number])[] = [
  [0, 9, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
] as const;

/**
 * An AQI's own band, on the EPA's category boundaries.
 *
 * `pmBand` breaks at 10/20/35/55 µg/m³ and is right for a concentration; the EPA's categories break
 * at 50/100/150/200 AQI. Using the first to colour the second put "52 · Moderate" in the excellent
 * green, because 9.5 µg/m³ is under pmBand's first threshold and over the EPA's. One number, one
 * band function, and the colour now agrees with the word beside it.
 */
/**
 * How many devices before a city's number is a measurement rather than a sample.
 *
 * Three is a judgement with arithmetic behind it: 420 of the scored cities have exactly one device
 * and 587 have fewer than three. A single fifty-euro sensor is a reading about the balcony it sits
 * on. With three there is a median, and a median of three survives one of them being wrong.
 *
 * Lives here rather than in db.ts because the ETL needs it too, and db.ts opens with an import of
 * `cloudflare:workers` that Node cannot load — the same hazard that crashed the ETL once already.
 */
export const RANK_MIN_SENSORS = 3;

export function aqiBand(aqi: number | null): Band | "quiet" {
  if (aqi === null) return "quiet";
  if (aqi <= 50) return "excellent";
  if (aqi <= 100) return "good";
  if (aqi <= 150) return "fair";
  if (aqi <= 200) return "poor";
  return "bad";
}

/** PM10, whose scale is coarser and whose brackets are its own. */
const PM10_BREAKS: readonly (readonly [number, number, number, number])[] = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
] as const;

function interpolate(
  v: number,
  table: readonly (readonly [number, number, number, number])[],
): number {
  for (const [cLo, cHi, aLo, aHi] of table) {
    if (v <= cHi) return Math.round(((aHi - aLo) / (cHi - cLo)) * (v - cLo) + aLo);
  }
  return 500;
}

export function pm25Aqi(v: number): number {
  return interpolate(v, PM25_BREAKS);
}

/**
 * The AQI, by the EPA's own rule: the worst of the pollutants, not an average of them.
 *
 * This exists because the site briefly had two numbers called AQI. The city page took the max of
 * both channels through the Rust core; the list pages interpolated PM2.5 alone. A dust-dominated
 * city — the case `classify_source` exists to detect — showed one AQI in a list and a higher one on
 * its own page, both labelled the same. Coarse particles are exactly what a dust day is made of, so
 * dropping PM10 was dropping the reading that mattered.
 *
 * PM10 may be absent; the answer is then PM2.5's, which is what the EPA does with a missing
 * pollutant.
 */
export function overallAqi(pm25: number | null, pm10: number | null): number | null {
  const a = pm25 === null || !Number.isFinite(pm25) ? null : pm25Aqi(pm25);
  const b = pm10 === null || !Number.isFinite(pm10) ? null : interpolate(pm10, PM10_BREAKS);
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** The six EPA category names. Fixed strings, so no runtime is needed to say them. */
export function aqiLabel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

export const abs = (path: string) => new URL(path, SITE.origin).href;
