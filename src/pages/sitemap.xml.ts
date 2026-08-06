import type { APIRoute } from "astro";
import { getSitemapCounts } from "../lib/db";
import { abs } from "../lib/site";

/**
 * The sitemap index.
 *
 * Sharded because there are roughly ten thousand cities and several thousand qualifying stations,
 * and the protocol caps a single file at 50 000 URLs and 50 MB. Cities and stations go in separate
 * shards on purpose: the cities are the pages this rewrite exists for and they get submitted to
 * Search Console first, so that a brand-new domain spends its early crawl budget on the pages that
 * answer a query rather than on the long tail behind them.
 */
export const SHARD = 5_000;

export const GET: APIRoute = async () => {
  const counts = await getSitemapCounts();

  const cityShards = Math.max(1, Math.ceil(counts.citiesIndexable / SHARD));
  const stationShards = Math.ceil(counts.stationsIndexable / SHARD);

  const entries = [
    ...Array.from({ length: cityShards }, (_, i) => abs(`/sitemap-cities-${i + 1}.xml`)),
    ...Array.from({ length: stationShards }, (_, i) => abs(`/sitemap-stations-${i + 1}.xml`)),
  ];

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join("\n") +
    "\n</sitemapindex>\n";

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
      // What was left out, and why, in a header a human can curl. Silent truncation in a sitemap
      // reads as "we covered everything" when it did not — and it is invisible for months.
      "x-airsignal-coverage":
        `cities ${counts.citiesIndexable}/${counts.cities}; ` +
        `stations ${counts.stationsIndexable}/${counts.stations} ` +
        `(${counts.stations - counts.stationsIndexable} below the quality bar)`,
    },
  });
};
