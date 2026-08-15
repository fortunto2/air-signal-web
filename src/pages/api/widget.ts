import type { APIRoute } from "astro";
import { getCity, getNearbyCities } from "../../lib/db";
import { warmCity } from "../../lib/comfort-server";
import { cityView } from "../../lib/view";
import { widgetPayload } from "../../lib/widget";

/**
 * The reading another site puts on its own page.
 *
 * This exists because one already did. Miralinka's header bar has been calling
 * `air.miralinka.com/api/comfort` since before this rewrite, reading three numbers out of a
 * fourteen-signal answer and reshaping them itself — which meant a blog's home page depended on the
 * internal shape of an endpoint built for our own island. Retiring that host would have broken it
 * silently. Better to have a door meant for this.
 *
 * Two ways to ask, because callers arrive knowing different things:
 *   ?place=turkey/gazipasa   — a site embedding a fixed town
 *   ?lat=36.27&lon=32.31     — a site that knows where it is but not what we call it
 *
 * Both answer with the same payload, and the coordinate form names the city it resolved to, so a
 * caller can link to the page rather than to a coordinate.
 *
 * CORS is open. `/api/comfort` never sent the header — it did not need to, since the only callers
 * were our own island (same origin) and Miralinka's server. An embed runs in a browser on somebody
 * else's domain, so without this it fails on the preflight and shows nothing.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const place = url.searchParams.get("place");
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");

  const row = place
    ? await byPlace(place)
    : await byCoords(latRaw, lonRaw);

  if (row === "bad-request") {
    return json(
      { error: "pass ?place=<country>/<city> or ?lat=&lon=", example: "/api/widget?place=turkey/gazipasa" },
      400,
      "no-store",
    );
  }
  if (!row) return json({ error: "no city found" }, 404, "public, max-age=0, s-maxage=3600");

  // Same on-demand warming a visitor triggers, so an embedded bar is never staler than the page it
  // links to — and a town whose only traffic is somebody's header bar still stays current.
  await warmCity(row, locals.cfContext?.waitUntil.bind(locals.cfContext));

  return json(
    widgetPayload(cityView(row)),
    200,
    // Ten minutes at the edge. An embed on a busy page would otherwise ask on every render, and the
    // underlying readings do not move faster than this anyway.
    "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
  );
};

/** `turkey/gazipasa`, with or without the leading slash, because both get pasted. */
async function byPlace(place: string) {
  const [country, city] = place.replace(/^\/+|\/+$/g, "").split("/");
  if (!country || !city) return "bad-request" as const;
  return getCity(country, city);
}

async function byCoords(latRaw: string | null, lonRaw: string | null) {
  const lat = latRaw === null ? NaN : Number(latRaw);
  const lon = lonRaw === null ? NaN : Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return "bad-request" as const;
  }
  // Widening rings, the same shape as /api/nearest: most callers sit in a town, and starting small
  // keeps the common case to a handful of rows.
  for (const degrees of [0.5, 2, 8]) {
    const [nearest] = await getNearbyCities(lat, lon, degrees, 1);
    if (nearest) return getCity(nearest.country_slug, nearest.slug);
  }
  return null;
}

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
    },
  });
}
