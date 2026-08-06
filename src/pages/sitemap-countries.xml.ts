import type { APIRoute } from "astro";
import { listCountries } from "../lib/db";
import { abs, paths } from "../lib/site";

/**
 * The country shard. One file — there are 156 of them, not 10 000.
 *
 * Listed first in the index on purpose: these are the pages that link everything else together,
 * so a crawler that finds them early finds the rest by following links rather than by working
 * through a sitemap it may never finish.
 */
export const GET: APIRoute = async () => {
  const countries = await listCountries();

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url>\n    <loc>${abs(paths.countries())}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n` +
    countries
      .filter((c) => c.indexable === 1)
      .map((c) => {
        const lastmod = c.updated_at ? `\n    <lastmod>${c.updated_at.slice(0, 10)}</lastmod>` : "";
        // A country with sensors is worth more crawl attention than one that is modelled only.
        const priority = c.station_count > 0 ? "0.8" : "0.5";
        return `  <url>\n    <loc>${abs(paths.country(c.slug))}</loc>${lastmod}\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
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
