import type { APIRoute } from "astro";
import { abs } from "../lib/site";

/**
 * Naming the AI crawlers explicitly rather than relying on `User-agent: *`.
 *
 * Several of them treat an unnamed wildcard conservatively, and this site is exactly the kind of
 * thing an assistant should be able to read on someone's behalf — "is it worth walking the dog in
 * Alanya right now" is a question with a factual answer that we publish. The Content-Signal line
 * states the position in one place: read it, answer with it, don't train on it.
 */
const AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
];

export const GET: APIRoute = () => {
  const body = [
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    "Allow: /",
    "",
    // The GeoJSON endpoints are data, not pages. Crawling them wastes budget on bytes that say
    // nothing a sitemap URL does not, and they change every ingest.
    "Disallow: /api/",
    "",
    ...AGENTS.flatMap((agent) => [`User-agent: ${agent}`, "Allow: /", "Disallow: /api/", ""]),
    "# Entry points for agents:",
    "#   /llms.txt                    what this site is and how it is computed",
    "#   Accept: text/markdown        any page, as Markdown instead of HTML",
    "#   /api/stations.geojson        every sensor, as GeoJSON (ODbL, from Sensor.Community)",
    "",
    `Sitemap: ${abs("/sitemap.xml")}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
};
