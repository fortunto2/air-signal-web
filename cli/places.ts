/**
 * The place list, and the assignment of devices to places.
 *
 * The cities database is embedded in `airq-core` — 10 596 entries across 156 countries, capped at
 * 100 per country and ordered by population descending. That ordering is the only population
 * signal the source carries (there is no population column), and it is what `rank` becomes.
 *
 * That cap is why `expand-cities` exists. This seed still runs first, because these are the cities
 * whose slugs are already indexed and they must keep them; GeoNames is merged on top afterwards
 * and supplies the population figures this source never had.
 *
 * This runs once, under Node, and the result lands in D1. The browser never loads the cities
 * database — that is the whole reason the WASM build was split in two.
 */

import { core, haversine } from "./wasm.ts";
import { slug } from "../src/lib/site.ts";

export interface Country {
  id: number;
  slug: string;
  name: string;
}

export interface City {
  id: number;
  countryId: number;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  rank: number;
}

/**
 * Read the whole database out of WASM and give every city a stable id and a unique path.
 *
 * Ids are assigned by position, and the source is a compiled-in constant table, so they are stable
 * across runs — which matters, because `stations.city_id` points at them.
 */
export function loadPlaces(): { countries: Country[]; cities: City[] } {
  const names = JSON.parse(core.wasm_list_countries()) as string[];
  const countries: Country[] = names.map((name, i) => ({
    id: i + 1,
    slug: slug(name),
    name,
  }));

  return { countries, cities: loadCities(countries) };
}

/** Kept for callers that only need the city list; the country ids must match `loadPlaces`. */
export function loadCities(
  countries: Country[] = (JSON.parse(core.wasm_list_countries()) as string[]).map((name, i) => ({
    id: i + 1,
    slug: slug(name),
    name,
  })),
): City[] {
  const out: City[] = [];
  let id = 1;

  for (const country of countries) {
    const rows = JSON.parse(core.wasm_major_cities(country.name, 100_000)) as {
      name: string;
      country: string;
      lat: number;
      lon: number;
    }[];

    // Two cities in one country can slug to the same string (Frankfurt am Main and Frankfurt an
    // der Oder both want `frankfurt` once punctuation is stripped). The larger one — the earlier
    // one, since the source is population-ordered — keeps the clean URL, and the rest get a
    // numeric suffix. Deciding this here rather than at render time is what lets the unique index
    // on (country_id, slug) exist at all.
    const taken = new Set<string>();

    rows.forEach((c, rank) => {
      const base = slug(c.name) || `city-${id}`;
      let s = base;
      for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
      taken.add(s);

      out.push({
        id: id++,
        countryId: country.id,
        slug: s,
        name: c.name,
        lat: c.lat,
        lon: c.lon,
        rank,
      });
    });
  }
  return out;
}

/**
 * A 1°×1° bucket index over the cities, so "nearest city to this device" is a nine-cell lookup
 * instead of a scan of ten thousand rows. Over nine thousand devices that is the difference
 * between a hundred million distance calculations and about a million.
 */
export class CityIndex {
  private cells = new Map<string, City[]>();

  constructor(readonly cities: City[]) {
    for (const c of cities) {
      const key = CityIndex.key(c.lat, c.lon);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(c);
      else this.cells.set(key, [c]);
    }
  }

  private static key(lat: number, lon: number): string {
    return `${Math.floor(lat)}:${Math.floor(lon)}`;
  }

  /** Nearest city and its distance in km, searching outward until something is found. */
  nearest(lat: number, lon: number): { city: City; km: number } | null {
    for (const ring of [1, 3, 6]) {
      let best: City | null = null;
      let bestKm = Infinity;

      for (let dLat = -ring; dLat <= ring; dLat++) {
        for (let dLon = -ring; dLon <= ring; dLon++) {
          for (const c of this.cells.get(CityIndex.key(lat + dLat, lon + dLon)) ?? []) {
            const km = haversine(lat, lon, c.lat, c.lon);
            if (km < bestKm) {
              bestKm = km;
              best = c;
            }
          }
        }
      }
      if (best) return { city: best, km: bestKm };
    }
    // Mid-ocean buoys and Antarctic stations legitimately have no city. They keep their map pin
    // and lose their page, which is the honest outcome — a page needs a place to be about.
    return null;
  }
}

/**
 * The cities as the database has them, which since the GeoNames merge is more than the crate holds.
 *
 * `loadCities` reads the embedded database and stops at ~100 per country. That is the right source
 * for the *seed* — those are the slugs already indexed — and the wrong one for anything that has to
 * decide which city a device belongs to. A station two kilometres from a town added by
 * `expand-cities` was still being attributed to a city twenty kilometres away, because the index it
 * was matched against had never heard of the closer one.
 *
 * So the station pass reads from D1. Deliberately falling back to the crate when the table is
 * empty, which is the first run and only the first run.
 */
export async function citiesFromDb(
  query: <T>(sql: string, opts: { remote?: boolean }) => Promise<T[]>,
  opts: { remote?: boolean },
): Promise<City[]> {
  const rows = await query<{
    id: number;
    country_id: number;
    slug: string;
    name: string;
    lat: number;
    lon: number;
    rank: number;
  }>("SELECT id, country_id, slug, name, lat, lon, rank FROM cities", opts);

  if (rows.length === 0) return loadCities();

  return rows.map((r) => ({
    id: r.id,
    countryId: r.country_id,
    slug: r.slug,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    rank: r.rank,
  }));
}
