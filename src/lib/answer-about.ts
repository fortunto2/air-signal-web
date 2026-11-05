import { getCity, getNearbyCities, search } from "./db";
import { computeComfort, warmCity } from "./comfort-server";
import { cityView } from "./view";
import { abs, paths } from "./site";

/**
 * Turn a sentence into a place and answer about it.
 *
 * Coordinates are looked for first: "48.78, 9.18" is unambiguous and skips the guessing entirely.
 * Otherwise the search index does the work, which means the answer covers whatever the site covers
 * and no more — sixty-two thousand cities, and a device id if that is what arrived.
 */
export async function answerAbout(text: string): Promise<{ text: string; data: Record<string, unknown> }> {
  const coords = text.match(/(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const [near] = await getNearbyCities(lat, lon, 8, 1);
      const fresh = await computeComfort(lat, lon);
      if (!fresh) {
        return {
          text: `Upstreams are unreachable for ${lat}, ${lon} right now. Nothing was invented in their place.`,
          data: { error: "upstreams_unavailable", lat, lon },
        };
      }
      return {
        text:
          `At ${lat}, ${lon} the comfort score is ${fresh.total} out of 100` +
          (fresh.worst ? `, held back most by ${fresh.worst}` : "") +
          (fresh.readings.pm25 !== undefined ? `. PM2.5 is ${fresh.readings.pm25} µg/m³` : "") +
          (near ? `. The nearest city with a page is ${near.name}: ${abs(paths.city(near.country_slug, near.slug))}` : "") +
          ".",
        data: {
          lat,
          lon,
          comfort: fresh.total,
          worst: fresh.worst ?? null,
          scores: fresh.scores,
          readings: fresh.readings,
          nearestCity: near ? abs(paths.city(near.country_slug, near.slug)) : null,
        },
      };
    }
  }

  // Strip the words people wrap a place name in, so "what is the air quality in Sofia?" finds Sofia.
  const cleaned = text
    .replace(/[?!.]+/g, " ")
    .replace(
      /\b(what|what's|whats|how|is|are|the|air|quality|pollution|pm2\.?5|aqi|in|at|for|today|now|right|like|outside|weather|comfort|tell|me|about|sensor|station|device|id)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const hits = await search(cleaned || text, 3);
  if (hits.length === 0) {
    return {
      text:
        `Nothing here matches "${text}". This site covers cities and Sensor.Community device ids; ` +
        `a coordinate pair works too. Search: ${abs("/api/search?q=")}`,
      data: { error: "not_found", query: text },
    };
  }

  const hit = hits[0]!;
  if (hit.kind === "station") {
    return {
      text: `${hit.name} is a community sensor in ${hit.detail}, currently reading ${hit.pm25 ?? "nothing"} µg/m³ PM2.5. ${abs(hit.path)}`,
      data: { kind: "station", id: hit.id, pm25: hit.pm25, url: abs(hit.path) },
    };
  }

  const segments = hit.path.split("/").filter(Boolean);
  const row = await getCity(segments[0]!, segments[1]!);
  if (!row) {
    return {
      text: `${hit.name} exists but has no page yet. ${abs(hit.path)}`,
      data: { kind: "city", url: abs(hit.path) },
    };
  }

  // Same on-demand path a visitor triggers, so an agent asking about a cold city warms it for the
  // next reader rather than getting an older answer than a browser would. It used to recompute
  // without storing the result, which meant every agent question about a cold city paid the half
  // second again and left nothing behind.
  await warmCity(row);

  const v = cityView(row, []);
  return {
    text: `${v.verdict} Full page: ${abs(v.path)}. As Markdown: ${abs(v.path)}.md`,
    data: {
      kind: "city",
      name: v.name,
      country: v.country,
      comfort: v.comfort,
      worst: row.worst_signal,
      scores: v.scores,
      readings: v.readings,
      sensors: v.stationCount,
      url: abs(v.path),
      markdown: `${abs(v.path)}.md`,
      updatedAt: v.updatedAt?.toISOString() ?? null,
    },
  };
}
