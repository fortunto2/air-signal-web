import type { APIRoute } from "astro";
import { search } from "../../lib/db";

/**
 * The search box's back end.
 *
 * Cached at the edge by query string, and generously: "berlin" resolves to the same eight rows for
 * everybody, and the answer only changes when the ETL runs. That matters more than it sounds —
 * search fires on keystrokes, so an uncached endpoint would turn one reader typing a city name into
 * six D1 queries.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);

  // Under two characters every prefix matches and the answer is meaningless — refuse rather than
  // return the eight largest cities on Earth, which looks like a broken filter.
  if (q.trim().length < 2) {
    return json({ hits: [] }, "public, max-age=0, s-maxage=60");
  }

  const hits = await search(q);
  return json({ hits }, "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
};

function json(body: unknown, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl },
  });
}
