import type { APIRoute } from "astro";
import { getCity, getCityHistory, getStationsForCity } from "../../lib/db";
import { cityView } from "../../lib/view";
import { abs, paths } from "../../lib/site";

/**
 * The Markdown twin of a city page.
 *
 * Same `cityView` as the HTML, on purpose: two renderings of one view-model cannot disagree, and
 * the failure this prevents is the structured data saying 78 while the sentence says 74. Anything
 * that reads better as prose than as a DOM — an agent answering "is it worth going outside in
 * Alanya" — gets the facts without parsing a page built for eyes.
 *
 * Reachable at its own URL, and served at the page's URL to anyone sending `Accept: text/markdown`
 * (see src/middleware.ts).
 */
export const GET: APIRoute = async ({ params }) => {
  const row = await getCity(params.country!, params.city!);
  if (!row) return new Response(null, { status: 404 });

  const [history, stations] = await Promise.all([
    getCityHistory(row.id, 30),
    getStationsForCity(row.id, 12),
  ]);
  const v = cityView(row, history);

  const table = v.signals
    .map((s) => {
      const measure = s.measure ?? "*no reading*";
      const score = s.score === undefined ? "—" : `${s.score}/100`;
      return `| ${s.name} | ${measure} | ${score} |`;
    })
    .join("\n");

  const known = history.filter((d) => d.comfort !== null);
  const series = known.length
    ? known.map((d) => `${d.day} ${d.comfort}`).join("\n")
    : "no history stored for this city — the model series is available from Open-Meteo directly";

  const sensors = stations.length
    ? stations
        .map(
          (s) =>
            `- Station ${s.id}${s.sensor_type ? ` (${s.sensor_type.toUpperCase()})` : ""}` +
            `${s.distance_km !== null ? `, ${s.distance_km} km` : ""}` +
            `${s.pm25 !== null ? ` — ${s.pm25} µg/m³` : " — quiet"}` +
            `  ${abs(paths.station(row.country_slug, row.slug, s.id))}`,
        )
        .join("\n")
    : "None. The readings above come from the atmospheric model, which covers every coordinate.";

  const body = `# ${v.name}, ${v.country}

${v.verdict}

**Comfort ${v.comfort ?? "—"}/100** (${v.word}) · ${v.stationCount} community sensor${
    v.stationCount === 1 ? "" : "s"
  } · ${v.updatedAt ? `computed ${v.updatedAt.toISOString()}` : "not yet computed"}

Source: ${abs(v.path)}

## The fourteen signals

| Signal | Reading | Score |
|---|---|---|
${table}

A signal with no reading is excluded from the score rather than counted as zero.

${
  v.divergence !== null && v.divergence > 1.3
    ? `## Sensors versus the model\n\nThe community sensors here and the atmospheric model disagree by a factor of ${v.divergence.toFixed(
        1,
      )}. Where they do, the sensors are treated as ground truth and the model is down-weighted.\n`
    : ""
}
## Sensors this was computed from

${sensors}

## Comfort, last 30 days

\`\`\`
${series}
\`\`\`

## Sources

Sensor.Community (ODbL) · Open-Meteo · USGS · NOAA SWPC.
Coordinates ${v.lat}, ${v.lon}.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
};
