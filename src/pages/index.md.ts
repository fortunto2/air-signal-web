import type { APIRoute } from "astro";
import { getComfortExtremes, getLastIngest, getSitemapCounts } from "../lib/db";
import { SITE, abs, paths } from "../lib/site";
import { ago } from "../lib/view";

/**
 * The home page, as Markdown.
 *
 * The agent-readiness audit reported "Markdown negotiation: text/html", which was accurate and
 * narrower than it looked: city pages have twinned since the first deploy, and the root did not.
 * An agent checking one URL checks this one.
 *
 * Written to be read in one pass by something that will not follow links: the counts, the extremes,
 * and where the rest of the site is. No navigation chrome, because there is nothing to click.
 */
export const GET: APIRoute = async () => {
  const [counts, extremes, lastIngest] = await Promise.all([
    getSitemapCounts(),
    getComfortExtremes(5),
    getLastIngest(),
  ]);

  const n = (x: number) => x.toLocaleString("en-US");
  const row = (c: { name: string; country: string; comfort: number | null; country_slug: string; slug: string }) =>
    `- **${c.name}**, ${c.country} — ${c.comfort ?? "—"}/100 · ${abs(paths.city(c.country_slug, c.slug))}`;

  const body = `# ${SITE.name}

Live air quality and outdoor comfort for ${n(counts.cities)} cities, scored on fourteen
environmental signals rather than one air quality index.

${lastIngest ? `Data updated ${ago(lastIngest)}.` : ""}

## What the score is

One number from 0 to 100, combining PM2.5, temperature, wind, sea state, UV, earthquakes, fire
proximity, pollen, barometric pressure, geomagnetic activity, humidity, daylight, noise and moon
phase. Each is normalised by a published curve with a stated midpoint; a signal with no reading is
dropped from the denominator rather than scored zero.

Air quality carries the most weight at 20 %, temperature 16 %, wind and sea 10 % each. The full
table is at ${abs(paths.howItWorks())}.

## Coverage

- ${n(counts.cities)} cities across 156 countries
- ${n(counts.stations)} community sensors from Sensor.Community
- ${n(counts.stationsIndexable)} of those meet the quality bar for their own page
- Everywhere else is modelled from Open-Meteo, which covers every coordinate on Earth

## Most comfortable right now

${extremes.best.map(row).join("\n")}

## Least comfortable right now

${extremes.worst.map(row).join("\n")}

## Where to go next

- Map of every sensor: ${abs(paths.map())}
- Ranked by comfort: ${abs(paths.ranking())}
- By country: ${abs(paths.countries())}
- What each signal means: ${abs(paths.guide())}
- Method, weights and the sensor/model merge: ${abs(paths.howItWorks())}

Any city page is available as Markdown by appending \`.md\` or by sending
\`Accept: text/markdown\`.

## Sources

Sensor.Community (ODbL) · Open-Meteo · USGS · NOAA SWPC · GeoNames (CC BY) · OpenStreetMap
`;

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
      vary: "Accept",
    },
  });
};
