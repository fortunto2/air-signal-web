import type { APIRoute } from "astro";
import { getCity, getNearbyCities, search } from "../lib/db";
import { computeComfort, isStale } from "../lib/comfort-server";
import { cityView } from "../lib/view";
import { SITE, abs, paths } from "../lib/site";

/**
 * The A2A endpoint. JSON-RPC 2.0 over POST, one method.
 *
 * This exists before the agent card that advertises it, and in that order on purpose: a card
 * pointing at an endpoint that does not answer is worse than no card, because it converts a site
 * that an agent would have scraped successfully into one that fails halfway through a protocol.
 *
 * The skill is deliberately narrow — one question, asked in words, answered with the numbers and a
 * link. An agent that wants structure should use the OpenAPI document; this is for the case where
 * the caller has a sentence and no idea what our endpoints are.
 *
 * No authentication. The data is open, every answer is public, and there is nothing here that a
 * credential would protect.
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    message?: { role?: string; parts?: { kind?: string; text?: string }[] };
  };
}

const ok = (id: string | number | null | undefined, result: unknown) =>
  json({ jsonrpc: "2.0", id: id ?? null, result });

const fail = (id: string | number | null | undefined, code: number, message: string) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return fail(null, -32700, "Parse error");
  }

  if (body.method !== "message/send") {
    return fail(body.id, -32601, `Unknown method ${body.method ?? "(none)"} — only message/send`);
  }

  const text = (body.params?.message?.parts ?? [])
    .filter((p) => p.kind === "text" || p.text !== undefined)
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();

  if (!text) return fail(body.id, -32602, "No text part in the message");

  const answer = await answerAbout(text);

  return ok(body.id, {
    kind: "message",
    role: "agent",
    messageId: crypto.randomUUID(),
    parts: [
      { kind: "text", text: answer.text },
      // The same answer as data, so a caller does not have to parse the sentence it just asked for.
      { kind: "data", data: answer.data },
    ],
  });
};

/**
 * Turn a sentence into a place and answer about it.
 *
 * Coordinates are looked for first: "48.78, 9.18" is unambiguous and skips the guessing entirely.
 * Otherwise the search index does the work, which means the answer covers whatever the site covers
 * and no more — sixty-two thousand cities, and a device id if that is what arrived.
 */
async function answerAbout(text: string): Promise<{ text: string; data: Record<string, unknown> }> {
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
  // next reader rather than getting an older answer than a browser would.
  if (isStale(row.updated_at)) {
    const fresh = await computeComfort(row.lat, row.lon);
    if (fresh) {
      row.comfort = fresh.total;
      row.worst_signal = (fresh.worst ?? null) as typeof row.worst_signal;
      row.signals_json = JSON.stringify(fresh.scores);
      row.readings_json = JSON.stringify(fresh.readings);
      row.updated_at = new Date().toISOString();
    }
  }

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

/** A GET is almost always a human or a confused crawler. Point them at the card. */
export const GET: APIRoute = () =>
  json({
    error: "A2A speaks JSON-RPC 2.0 over POST",
    method: "message/send",
    agentCard: abs("/.well-known/agent-card.json"),
    openapi: abs("/openapi.json"),
    site: SITE.origin,
  }, 405);
