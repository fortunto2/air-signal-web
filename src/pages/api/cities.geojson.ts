import type { APIRoute } from "astro";
import { getCityAggregates } from "../../lib/db";
import { paths } from "../../lib/site";

/**
 * The low-zoom layer: one dot per city that has devices.
 *
 * Zoomed out over Europe there are 3 500 German sensors in a space the size of a thumbnail, and
 * drawing them individually is both illegible and pointless — nobody is comparing two boxes in
 * Stuttgart from orbit. What a reader wants at that scale is "how is Stuttgart", which is a number
 * the database already has.
 *
 * Cached hard at the edge: this changes once per ingest, and it is the most expensive query the
 * site makes. Without the cache header every pan would be a full table scan on D1.
 */
export const GET: APIRoute = async () => {
  const rows = await getCityAggregates();

  const body = JSON.stringify({
    type: "FeatureCollection",
    features: rows.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      properties: {
        id: c.id,
        name: c.name,
        // Through `paths`, never assembled by hand: the slugs are already canonical, and a second
        // place that builds a URL is a second place that can disagree about the trailing slash.
        path: paths.city(c.country_slug, c.slug),
        n: c.station_count,
        // Round-tripped as a number so MapLibre's `step` expression can read it directly.
        pm25: c.pm25_median === null ? -1 : Math.round(c.pm25_median * 10) / 10,
        comfort: c.comfort ?? -1,
      },
    })),
  });

  return new Response(body, {
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
    },
  });
};
