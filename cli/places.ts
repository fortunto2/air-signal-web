/**
 * The place list, and the assignment of devices to places.
 *
 * The cities database is embedded in `airq-core` — 10 596 entries across 156 countries, capped at
 * 100 per country and ordered by population descending. That ordering is the only population
 * signal the source carries (there is no population column), and it is what `rank` becomes: the
 * PRD's "top-N by population" gate, expressed as the data actually allows.
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
