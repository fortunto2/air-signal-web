import type { APIRoute } from "astro";
import { computeComfort } from "../../lib/comfort-server";

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
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));

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
    { total: result.total, worst: result.worst, scores: result.scores, readings: result.readings },
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
