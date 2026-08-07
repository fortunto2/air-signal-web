import type { APIRoute } from "astro";
import { getCitiesInCountry, getCountry } from "../lib/db";
import { abs, paths } from "../lib/site";

/**
 * A country, as Markdown.
 *
 * The country page is the hub every city hangs off, so this is the file an agent reads to find out
 * what a country contains without walking two thousand links.
 */
export const GET: APIRoute = async ({ params }) => {
  const country = await getCountry(params.country!);
  if (!country) return new Response("Not found\n", { status: 404 });

  const cities = await getCitiesInCountry(country.id, 200);
  const withSensors = cities.filter((c) => c.station_count > 0);
  const n = (x: number) => x.toLocaleString("en-US");

  const body = `# Air quality in ${country.name}

${n(country.city_count)} cities${
    country.station_count > 0
      ? `, ${n(country.station_count)} community sensors across ${withSensors.length} of them`
      : ", none with a community sensor — every reading here is modelled"
  }.

- Median city PM2.5: ${country.pm25_median !== null ? `${country.pm25_median.toFixed(1)} µg/m³` : "unknown"}
- Median comfort: ${country.comfort ?? "unknown"}/100
- Page: ${abs(paths.country(country.slug))}

## Cities

Sensor cities first, then by population. ${cities.length} of ${n(country.city_count)} shown.

| City | Sensors | PM2.5 µg/m³ | Comfort | URL |
| --- | --- | --- | --- | --- |
${cities
  .map(
    (c) =>
      `| ${c.name} | ${c.station_count || "modelled"} | ${
        c.pm25_median !== null ? c.pm25_median.toFixed(1) : "—"
      } | ${c.comfort ?? "—"} | ${abs(paths.city(c.country_slug, c.slug))} |`,
  )
  .join("\n")}

Every city URL above also serves Markdown with \`.md\` appended.

## Method

Fourteen signals, each normalised by a published curve: ${abs(paths.howItWorks())}
What each one means: ${abs(paths.guide())}
`;

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
      vary: "Accept",
    },
  });
};
