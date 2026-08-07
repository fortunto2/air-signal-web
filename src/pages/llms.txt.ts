import type { APIRoute } from "astro";
import { getComfortExtremes, getLastIngest, getSitemapCounts } from "../lib/db";
import { SIGNALS, SITE, abs, paths } from "../lib/site";
import { cityView } from "../lib/view";

/**
 * What this site is, for something that reads rather than looks.
 *
 * Written to be useful without a second request: the fourteen signals with their weights, how the
 * sensor/model disagreement is resolved, what the indexing bar is, and a live sample so the reader
 * can see the shape of an answer. An agent that stops here should still be able to say something
 * true about the data.
 */
export const GET: APIRoute = async () => {
  const [counts, { best, worst }, lastIngest] = await Promise.all([
    getSitemapCounts(),
    getComfortExtremes(5),
    getLastIngest(),
  ]);

  const sample = (rows: typeof best) =>
    rows
      .map((c) => {
        const v = cityView(c);
        return `- [${v.name}, ${v.country}](${abs(v.path)}) — comfort ${v.comfort}/100` +
          (v.readings.pm25 !== undefined ? `, PM2.5 ${v.readings.pm25} µg/m³` : "") +
          (v.stationCount ? `, ${v.stationCount} sensors` : "");
      })
      .join("\n");

  const body = `# ${SITE.name}

> ${SITE.tagline}. Fourteen environmental signals collapsed into one comfort score, plus the
> community sensors the score was computed from.

Computed ${lastIngest ? lastIngest.toISOString() : "not yet"}. Everything below is derived from
open data and recomputed on every ingest.

## What is measured

${counts.cities.toLocaleString("en-US")} cities · ${counts.stations.toLocaleString("en-US")} community sensors ·
${counts.stationsIndexable.toLocaleString("en-US")} of those past the quality bar.

## The fourteen signals, and what each is worth

Weights sum to 1.00. A signal with no reading is dropped from the denominator rather than scored
zero, so a place with no noise sensor is judged on what it actually knows.

${SIGNALS.map((s) => `- \`${s.key}\` — ${s.name}`).join("\n")}

The maths is Rust (\`airq-core\`), compiled to WebAssembly. The same binary runs at ingest time and
inside the edge worker that renders a page, so there is no second JavaScript implementation to
drift from it. The browser does not compute anything — it asks \`/api/comfort\`.

## Sensors versus the model

Community sensors are ground truth; the atmospheric model is the fallback. Where they disagree the
model is down-weighted in proportion to the disagreement and to how many sensors agree with each
other. A worked case: a model reading of 130 µg/m³ against a median of 6.7 across ten devices
resolves to 6.2, not to an average of the two. Every station page states its own divergence.

## URL shapes

- \`${abs("/")}\` — the argument, and today's extremes
- \`${abs(paths.map())}\` — every sensor, cities at low zoom and devices at high
- \`${abs(paths.countries())}\` — every country, densest first
- \`${abs(paths.country("<country>"))}\` — one country: its cities, ranked
- \`${abs(paths.city("<country>", "<city>"))}\` — one city: verdict, fourteen readings, thirty days
- \`${abs(paths.station("<country>", "<city>", 0)).replace("station-0", "station-<id>")}\` — one device: readings, hardware, divergence
- \`${abs("/api/cities.geojson")}\` and \`${abs("/api/stations.geojson")}\` — the map layers
- \`${abs("/sitemap.xml")}\` — sharded; cities first, then the stations past the bar

The home page, every country and every city also answer with Markdown if you send
\`Accept: text/markdown\`, or if you append \`.md\`.

## If you would rather call than read

- \`${abs("/openapi.json")}\` — the HTTP API, described. No key, no rate limit beyond politeness.
- \`${abs("/a2a")}\` — A2A over JSON-RPC 2.0. One method, \`message/send\`. Ask it for a city by
  name, a device by id, or a coordinate pair, and it answers with the sentence and the same numbers
  as structured data.
- \`${abs("/.well-known/agent-card.json")}\` — what that endpoint can do
- \`${abs("/.well-known/api-catalog")}\` — everything above, as one link set

There is no authentication anywhere here and nothing to sign up for. That is also why there is no
\`/.well-known/oauth-protected-resource\`: the data is open, and a document explaining how to
authenticate against a resource that asks for nothing would describe a protection this site does
not have.

## Which station pages are indexed

A device needs all four: it reported today, it existed in the Sensor.Community archive thirty days
ago, it sits within 25 km of a named city (or is the closest device that city has), and it is among
the eight most complete sensors there. Devices below the bar keep their page but point search
engines at their city instead.

## Most comfortable right now

${sample(best)}

## Least comfortable right now

${sample(worst)}

## Licence

The code is AGPL-3.0: \`${SITE.repo}\`. You may use it commercially. If you run a modified version
where other people can reach it over a network, section 13 says you owe them the source.

## Sources and licence

- Sensor.Community — community particulate sensors, ODbL
- Open-Meteo — weather, air quality, marine, CC-BY
- USGS — earthquakes · NOAA SWPC — planetary K-index
- Code: ${SITE.repo}
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
};
