/**
 * GeoNames, as a second source of places.
 *
 * The embedded `cities` crate in airq-core caps at roughly 100 cities per country. That is not a
 * bug in our code — the database itself stops there — and it is the ceiling on the whole point of
 * the site: Germany has two thousand towns worth a page and we had a hundred. Measured: Germany
 * 100, France 99, Russia 83, Brazil 100.
 *
 * `cities5000` is every settlement above five thousand people, 69 577 of them across 245 countries.
 * Germany becomes 3 076, Bulgaria 138, Armenia 80.
 *
 * **This is a union, not a replacement.** Every city we already have keeps its id and its slug,
 * because a slug is a URL and GeoNames spells places differently — it has Munchen where we have
 * Muenchen, and swapping the source outright would have quietly 404'd a few thousand indexed pages
 * to gain some new ones. A GeoNames entry near a city we already have fills in its population and
 * is otherwise ignored.
 *
 * Licence: CC BY 4.0. The attribution is in the footer and on the guide.
 */

import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { zipLines } from "./zip.ts";

const BASE = "https://download.geonames.org/export/dump";

export interface GeoCity {
  geonameId: number;
  /** The local name, which is what a reader recognises. */
  name: string;
  /** ASCII, for the slug — GeoNames' own transliteration rather than ours. */
  ascii: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2. */
  cc: string;
  population: number;
}

/**
 * Nine countries whose name in the embedded crate is not the name GeoNames uses.
 *
 * Written out rather than resolved by a fuzzy match, because a fuzzy match that silently pairs the
 * wrong two countries moves several hundred cities into the wrong place and nothing ever says so.
 * Seven are simply older names; `Nepa` is a typo in the crate's own data.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  "Cape Verde": "Cabo Verde",
  "Czech Republic": "Czechia",
  "Gambia, The": "Gambia",
  "Korea, North": "North Korea",
  "Korea, South": "South Korea",
  Macedonia: "North Macedonia",
  Nepa: "Nepal",
  Netherlands: "The Netherlands",
  Swaziland: "Eswatini",
};

/** Where downloads are cached. Small files, but re-fetching them on every run is rude. */
function cacheDir(dir: string) {
  return join(dir, "geonames");
}

async function download(url: string, to: string, maxAgeDays = 30): Promise<void> {
  try {
    const s = await stat(to);
    if ((Date.now() - s.mtimeMs) / 86_400_000 < maxAgeDays) return;
  } catch {
    // Not cached. Fall through and fetch.
  }
  const res = await fetch(url, {
    headers: { "user-agent": "air-signal-web/0.1 (+https://airsignal.app)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await writeFile(to, Buffer.from(await res.arrayBuffer()));
}

export interface GeoData {
  cities: GeoCity[];
  /** ISO 3166-1 alpha-2 → the name GeoNames publishes. */
  countryNames: Map<string, string>;
  /** Our country name → ISO, for the countries we already have. */
  isoFor: (ourName: string) => string | undefined;
}

export async function loadGeoNames(dir: string, file = "cities5000"): Promise<GeoData> {
  const cache = cacheDir(dir);
  await mkdir(cache, { recursive: true });

  const zip = join(cache, `${file}.zip`);
  const info = join(cache, "countryInfo.txt");
  await Promise.all([
    download(`${BASE}/${file}.zip`, zip),
    download(`${BASE}/countryInfo.txt`, info),
  ]);

  // ISO → name, and the reverse for matching against what we already store.
  const countryNames = new Map<string, string>();
  const byName = new Map<string, string>();
  for await (const line of createInterface({ input: createReadStream(info), crlfDelay: Infinity })) {
    if (line.startsWith("#") || !line.trim()) continue;
    const p = line.split("\t");
    if (p.length < 5) continue;
    countryNames.set(p[0]!, p[4]!);
    byName.set(p[4]!, p[0]!);
  }

  const cities: GeoCity[] = [];
  for await (const line of zipLines(zip)) {
    const p = line.split("\t");
    if (p.length < 15) continue;
    const population = Number(p[14]);
    cities.push({
      geonameId: Number(p[0]),
      name: p[1]!,
      ascii: p[2] || p[1]!,
      lat: Number(p[4]),
      lon: Number(p[5]),
      cc: p[8]!,
      population: Number.isFinite(population) ? population : 0,
    });
  }

  return {
    cities,
    countryNames,
    isoFor: (ourName) => byName.get(COUNTRY_ALIASES[ourName] ?? ourName),
  };
}
