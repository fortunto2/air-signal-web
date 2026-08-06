import type { APIRoute } from "astro";
import { listIndexableCities } from "../lib/db";
import { abs, paths } from "../lib/site";
import { SHARD } from "./sitemap.xml";

/** One shard of city URLs. Cities are always indexable — Open-Meteo covers every coordinate, so a
 *  city page has real numbers whether or not anyone put a sensor there. Gating cities on sensors
 *  would delete the entire non-European map to solve a problem it does not have. */
export const GET: APIRoute = async ({ params }) => {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rows = await listIndexableCities((page - 1) * SHARD, SHARD);

  if (rows.length === 0) return new Response(null, { status: 404 });

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows
      .map((c) => {
        const loc = abs(paths.city(c.country_slug, c.slug));
        const lastmod = c.updated_at ? `\n    <lastmod>${c.updated_at.slice(0, 10)}</lastmod>` : "";
        return `  <url>\n    <loc>${loc}</loc>${lastmod}\n    <changefreq>daily</changefreq>\n  </url>`;
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
