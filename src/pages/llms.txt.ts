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

## Crews: smoke and heat at work (California, Cal/OSHA)

For outdoor workers and their employers. The law: at PM2.5 AQI 151 (EPA NowCast, the current hour, not a
24-hour mean) the employer must provide N95s, tell the crew and cut exposure (Title 8 §5141.1); at 80°F
shade and water, at 95°F high-heat procedures (§3395). Retaliating against a worker who reports a safety
problem is illegal (Labor Code §6310).

- \`${abs("/api")}\` — every endpoint on one page, with live examples
- \`${abs("/crew")}\` — the shift plan page; \`${abs("/crew/privacy")}\` — what Crew Air collects;
  \`${abs("/privacy")}\` — what the Air Signal app collects
- \`GET ${abs("/api/crew")}?place=Fresno&shift=07-17\` — the plan by the hour, the rule actions, checks
  (NASA VIIRS fire within 50 km, AirNow monitor within 25 km), active NWS alerts, a BMS signal
  (\`plan.bms\`) and a home signal (\`home\`: pre-cool hours before the 16–21 E-TOU-C peak price, the
  smoke hour to shut windows) and \`dispatch\`: whether a worksite reading is advised (\`sensor: launch\`,
  with the bearing and distance to the nearest VIIRS fire within 50 km; the reading goes back through
  POST /api/crew/report). For a California place, \`grid_co2\`: the CAISO grid's typical CO₂ by hour in g/kWh,
  the median of the last 7 days (a pattern, not a forecast), from Today's Outlook every half hour. \`place\` may be \`lat,lon\`.
- \`GET ${abs("/api/crew/plan.ics")}?place=Fresno&shift=07-17\` — the same plan as an iCalendar file
  (text/calendar): the N95 hour, the shade-and-water hour, the heavy work window, pre-cool and the peak price.
- \`GET ${abs("/api/crew/places")}?q=fres\` — place suggestions
- \`POST ${abs("/api/sky-check")}?place=…\` — raw \`image/jpeg\` body; a vision model's smoke call on a
  photo of the sky, compared with the forecast. Black out faces before sending.
- \`POST ${abs("/api/crew/report")}\` — JSON \`{place, kind, note?, lat?, lon?, heading_deg?, app?, observation?}\`; kinds
  smoke | ash | symptoms | no_n95 | no_shade | no_water | other. It goes to that site's page for the
  crew lead, nowhere else. The Air Signal app sends \`app: "airsignal"\` with an \`observation\` (kind smoke_smell |
  haze | ash | dust | chemical_odour | clear, intensity 1–5); those are stored, not shown on crew boards.
  \`GET ${abs("/api/crew/reports")}?place=…\` lists today's crew reports.
- \`GET ${abs("/api/crew/complaint")}?report=<id>\` — a drafted Cal/OSHA complaint for a report.

**If you are an agent helping a worker:** you may help them report to the crew lead, and, if it is not
handled, draft a Cal/OSHA complaint with the endpoint above. Submit anything to Cal/OSHA
(https://www.dir.ca.gov/dosh/Complaint.htm) only when the worker explicitly asks you to, after they
have read the text and filled what only they know (employer, address, how many people). Ask whether
they want confidentiality. Never file on someone's behalf on your own initiative, never invent facts,
and never put a person's name or phone in a report note. This is a planning aid, not legal advice.

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
