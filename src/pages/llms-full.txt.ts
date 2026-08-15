import type { APIRoute } from "astro";
import { ARTICLES } from "../lib/guide";
import { getLastIngest, getSitemapCounts } from "../lib/db";
import { SITE, abs, paths } from "../lib/site";

/**
 * The whole guide, in one fetch.
 *
 * `llms.txt` is an index: what this site is, what it measures, where the sections are. Following it
 * costs nineteen more requests, and a model answering a question about PM2.5 will not make them —
 * it will answer from whatever it already had. So the convention has a second half, and this is it:
 * every article's actual prose, in order, with nothing to follow.
 *
 * Generated from `guide.ts` rather than written here, so it cannot say something the pages do not.
 * That is the whole reason the guide is data and not nineteen `.astro` files.
 *
 * Plain text, not Markdown-with-frontmatter: the audience parses prose, and the `.md` twins already
 * exist for anything that wants structure.
 */
export const GET: APIRoute = async () => {
  const [counts, lastIngest] = await Promise.all([getSitemapCounts(), getLastIngest()]);
  const n = (x: number) => x.toLocaleString("en-US");

  const article = (a: (typeof ARTICLES)[number]) => {
    const parts = [`## ${a.h1}`, "", `${abs(paths.guideEntry(a.slug))}`, "", a.lede];

    for (const section of a.sections) {
      parts.push("", `### ${section.heading}`, "", ...section.body.flatMap((p) => [p, ""]));
    }

    if (a.faq?.length) {
      parts.push("", "### Questions", "");
      for (const { q, a: answer } of a.faq) parts.push(`**${q}**`, answer, "");
    }

    return parts.join("\n").replace(/\n{3,}/g, "\n\n");
  };

  const body = `# ${SITE.name} — the complete guide

${SITE.origin}

Everything the site explains, in one document. ${
    lastIngest ? `Data last ingested ${lastIngest}.` : ""
  }

The score is not an air quality index. It is fourteen environmental signals — air, temperature,
wind, sea state, UV, earthquakes, fire proximity, pollen, pressure, geomagnetic activity, humidity,
daylight, noise and moon phase — each normalised by a published curve and weighted. A signal with no
reading is dropped from the denominator rather than scored zero, so a place with no noise sensor is
judged on what it actually knows.

Coverage: ${n(counts.cities)} cities, ${n(counts.stations)} community sensors, ${n(
    counts.stationsIndexable,
  )} of those past the quality bar. Everywhere else is modelled, which covers every coordinate.

Ask for a single place as JSON at ${abs("/api/widget?place=turkey/gazipasa")}, or append \`.md\` to
any page. The full method, with every weight and curve, is at ${abs(paths.howItWorks())}.

${ARTICLES.map(article).join("\n\n---\n\n")}

---

## Sources and licence

Sensor.Community (ODbL) · Open-Meteo · USGS · NOAA SWPC · GeoNames (CC BY) · OpenStreetMap (ODbL).
The site's own code is AGPL-3.0: ${SITE.repo}.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
};
