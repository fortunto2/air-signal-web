import type { APIRoute } from "astro";
import { ARTICLES } from "../lib/guide";
import { abs, paths } from "../lib/site";

/**
 * The guide and the other pages that are not a place.
 *
 * Small, static, and separate from the data shards for a reason: these change when someone edits
 * them, not nightly, and mixing a handful of `changefreq: monthly` articles into a file of ten
 * thousand daily city pages tells a crawler nothing useful about either.
 *
 * They are also the only pages here that answer a question rather than reporting a measurement,
 * which makes them the ones most likely to be linked to from outside.
 */
export const GET: APIRoute = async () => {
  const fixed = [
    { loc: paths.guide(), priority: "0.8" },
    { loc: paths.howItWorks(), priority: "0.7" },
    { loc: paths.ranking(), priority: "0.8" },
    { loc: paths.map(), priority: "0.8" },
    { loc: "/", priority: "1.0" },
  ];

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [
      ...fixed.map(
        (f) =>
          `  <url>\n    <loc>${abs(f.loc)}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${f.priority}</priority>\n  </url>`,
      ),
      ...ARTICLES.map(
        (a) =>
          `  <url>\n    <loc>${abs(paths.guideEntry(a.slug))}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
      ),
    ].join("\n") +
    "\n</urlset>\n";

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
};
