import type { APIRoute } from "astro";
import { getNearbyCities } from "../../lib/db";
import { paths } from "../../lib/site";

/**
 * The city nearest a coordinate.
 *
 * The browser knows where the reader is; the database knows where the cities are; this is the one
 * sentence between them. Everything personal about the site is built on this — "find air near me",
 * and the place a reader keeps coming back to.
 *
 * Coordinates are deliberately blunted to two decimals, about a kilometre. It makes the cache key
 * useful, and it means the site never receives, logs or caches anyone's exact position — a
 * precision nobody needs to answer "which town am I in".
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: "lat and lon required" }, 400, "no-store");
  }

  const at = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };

  // Widening rather than one big box: most readers are near a city, and starting small keeps the
  // common case to a handful of rows. The last ring is generous enough to place someone at sea or
  // in a desert on the nearest named town rather than telling them nowhere exists.
  for (const degrees of [0.5, 2, 8]) {
    const [nearest] = await getNearbyCities(at.lat, at.lon, degrees, 1);
    if (nearest) {
      return json(
        {
          name: nearest.name,
          country: nearest.country,
          path: paths.city(nearest.country_slug, nearest.slug),
          lat: nearest.lat,
          lon: nearest.lon,
          stations: nearest.station_count,
          comfort: nearest.comfort,
        },
        200,
        "public, max-age=0, s-maxage=86400",
      );
    }
  }

  return json({ error: "no city within reach" }, 404, "public, max-age=0, s-maxage=3600");
};

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl },
  });
}
