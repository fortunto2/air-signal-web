import type { APIRoute } from "astro";
import { aqi, computeComfort } from "../../lib/comfort-server";

/**
 * Live comfort for a coordinate.
 *
 * The browser used to do this itself: load 91 KB of WebAssembly, call four upstreams, and score
 * the result. That worked, but it made the visitor pay for a calculation the Worker was already
 * set up to do — and it forced the binary to be imported two different ways, which is what broke
 * WASM in the Worker entirely (see comfort-server.ts).
 *
 * So there is one place that computes comfort now, and this is the door to it. The island asks
 * here; the answer is cached at the edge, so the second visitor to a city gets it without touching
 * an upstream at all.
 */
export const GET: APIRoute = async ({ url }) => {
  // `Number(null)` is 0, so a missing parameter would silently become a valid coordinate in the
  // Gulf of Guinea rather than a 400. Read them as strings first.
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  const lat = latRaw === null ? NaN : Number(latRaw);
  const lon = lonRaw === null ? NaN : Number(lonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: "lat and lon required" }, 400, "no-store");
  }

  // Rounded to the cache key we actually want. Two visitors half a kilometre apart are asking the
  // same question, and giving them separate cache entries would multiply the upstream calls for a
  // difference no model resolves.
  const at = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };

  const result = await computeComfort(at.lat, at.lon);
  if (!result) {
    // The upstreams said no. Say so plainly and briefly — the page keeps the numbers it has, and
    // a short cache means the next visitor tries again rather than inheriting the outage.
    return json({ error: "upstreams unavailable" }, 503, "public, max-age=0, s-maxage=60");
  }

  return json(
    {
      total: result.total,
      worst: result.worst,
      scores: result.scores,
      readings: result.readings,
      // The headline number, computed here rather than in the browser: the EPA breakpoint table
      // lives in Rust and in two page templates already, and a fourth copy in an island would be
      // the one that goes stale.
      aqi: aqi(result.readings.pm25 ?? null, result.readings.pm10 ?? null),
    },
    200,
    "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
  );
};

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}
