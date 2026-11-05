/**
 * The machine-facing description of airsignal.app that the kit generates: agents.txt, the ARD
 * manifest and the MCP server card (superduper-site-kit/agent). The A2A card and the API catalogue
 * stay hand-written beside them: this site has a real A2A endpoint (/a2a, JSON-RPC), which the
 * kit's MCP-transport card does not describe.
 *
 * What is published: a read-only MCP server (src/pages/mcp.ts), two tools over the same open data
 * as the pages. What is not: OAuth (nothing is protected) and any write. The crew-report and
 * observation endpoints take input from people and are deliberately not reachable through MCP.
 */
import { agentPolicyText as kitPolicy, ardCoreEntries, ardManifest as kitArd, mcpServerCard as kitMcpCard } from "superduper-site-kit/agent";
import { COMPANY } from "superduper-site-kit/company";
import { SITE, abs } from "./site";

export const DOMAIN = new URL(SITE.origin).hostname;

export const URLS = {
  llms: abs("/llms.txt"),
  llmsFull: abs("/llms-full.txt"),
  sitemap: abs("/sitemap.xml"),
  mcp: abs("/mcp"),
  mcpCard: abs("/.well-known/mcp/server-card.json"),
  agentCard: abs("/.well-known/agent-card.json"),
  a2a: abs("/a2a"),
  openapi: abs("/openapi.json"),
  apiCatalog: abs("/.well-known/api-catalog"),
  ard: abs("/.well-known/ard.json"),
} as const;

export const MCP_TOOLS = [
  {
    name: "air_quality_for_place",
    description:
      "Current outdoor comfort (0-100) and air quality for a place: a city name, a Sensor.Community device id, or a coordinate pair like " +
      "\"48.78, 9.18\". Returns the score, the signal costing the most points, the readings in their own units and the page URL. A missing " +
      "signal is reported as absent, not zero. Read-only.",
    tags: ["air quality", "pm2.5", "weather", "geo"],
    examples: ["What is the air quality in Sofia?", "48.78, 9.18", "sensor 12814"],
  },
  {
    name: "search_places",
    description: "Find cities and community air sensors by name or device id in the Air Signal index. Returns names, kinds, current PM2.5 where there is one, and page paths. Read-only.",
    tags: ["search", "cities", "sensors"],
    examples: ["Gazipasa", "Stuttgart"],
  },
] as const;

export function agentPolicyText(): string {
  return kitPolicy({
    domain: DOMAIN,
    about: [
      "Air Signal: live air quality and outdoor comfort for any place on Earth, one 0-100 score from fourteen",
      "signals, from community sensors where they exist and an atmospheric model elsewhere.",
      "Public, open data. Nothing here needs an account. robots.txt carries the same policy as a",
      "Content-Signal; this file says it in words.",
    ],
    may: [
      "read, index and link to every page                      (search=yes)",
      "quote it when answering someone, with a link to the page (ai-input=yes)",
      `call the MCP server at ${URLS.mcp}, no key needed (tools: air_quality_for_place,\nsearch_places); read-only, 120 requests a minute`,
      `call the A2A endpoint ${URLS.a2a} (message/send) or the HTTP API described at ${URLS.openapi}`,
    ],
    mustNot: ["fold the content into a training corpus                  (ai-train=no)"],
    notOffered: [
      `accounts, sign-in or OAuth: nothing on ${DOMAIN} is protected`,
      "writes of any kind through MCP or A2A: the crew-report and observation forms are for people, in the browser",
      "payments through this site",
    ],
    start: [
      ["Site map for models", URLS.llms],
      ["Every page, one file", URLS.llmsFull],
      ["Sitemap", URLS.sitemap],
      ["MCP server", URLS.mcp],
      ["MCP server card", URLS.mcpCard],
      ["Agent card (A2A)", URLS.agentCard],
      ["HTTP API", URLS.openapi],
      ["Resource catalogue", URLS.ard],
      ["API catalogue", URLS.apiCatalog],
      ["Markdown", "send \"Accept: text/markdown\" to the home page, a country or a city, or append .md"],
    ],
    contact: COMPANY.email,
  });
}

export function mcpServerCard() {
  return kitMcpCard({
    domain: DOMAIN,
    title: "Air Signal: live air quality and outdoor comfort",
    description: "Comfort score and air quality for any city, coordinate pair or community sensor, and a place search. Read-only; no key, nothing stored.",
    websiteUrl: SITE.origin,
    mcpUrl: URLS.mcp,
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}

export function ardManifest() {
  return kitArd(DOMAIN, ardCoreEntries({
    domain: DOMAIN, mcpCardUrl: URLS.mcpCard, agentCardUrl: URLS.agentCard,
    mcpDescription: "Current comfort score and air quality for a city, coordinates or community sensor, plus place search. Streamable HTTP, no authentication, read-only.",
    mcpQueries: ["air quality in Sofia right now", "is it pleasant outside in Antalya", "PM2.5 near 48.78, 9.18"],
    capabilities: ["read", "search"], tags: ["mcp", "air-quality", "read-only"],
    cardDescription: "The A2A endpoint (JSON-RPC message/send) and its skill: air quality for a place asked in words.",
    cardQueries: ["what can an agent ask airsignal.app"],
  }));
}
