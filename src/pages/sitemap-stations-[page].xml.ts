import type { APIRoute } from "astro";
import { listIndexableStations } from "../lib/db";
import { abs, paths } from "../lib/site";
import { SHARD } from "./sitemap.xml";

/**
 * One shard of station URLs — only the devices past the bar.
 *
 * The bar is four things (see `applyGate` in cli/ingest.ts): reported today, present in the
 * archive thirty days ago, within 25 km of a named city or the closest device that city has, and
 * among the eight most complete sensors there. Everything below it still has a page; it just
 * canonicals to its city instead of competing with it.
 *
 * The PRD's original bar — reported today plus thirty days of history — was assumed to leave a few
 * hundred pages. Measured against the archive it passed 8 420 of 9 155, so it was not a bar at all.
 */
export const GET: APIRoute = async ({ params }) => {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rows = await listIndexableStations((page - 1) * SHARD, SHARD);

  if (rows.length === 0) return new Response(null, { status: 404 });

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows
      .map((s) => {
        const loc = abs(paths.station(s.country_slug, s.slug, s.id));
        const day = s.last_seen ? s.last_seen.slice(0, 10) : null;
        const lastmod = day ? `\n    <lastmod>${day}</lastmod>` : "";
        return `  <url>\n    <loc>${loc}</loc>${lastmod}\n    <changefreq>hourly</changefreq>\n    <priority>0.5</priority>\n  </url>`;
      })
      .join("\n") +
    "\n</urlset>\n";

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
};
