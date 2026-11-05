/**
 * /mcp: a read-only MCP server over the same open data as the pages. Two tools, no writes, nothing
 * stored. The crew-report and observation endpoints take input from people and are not exposed
 * here. Protocol: superduper-site-kit/agent-mcp; the answers are the A2A endpoint's (answerAbout).
 */
import type { APIRoute } from "astro";
import { createMcpHandler, type McpTool } from "superduper-site-kit/agent-mcp";
import { answerAbout } from "../lib/answer-about";
import { search } from "../lib/db";
import { abs } from "../lib/site";
import { MCP_TOOLS } from "../lib/agent";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };
const desc = (name: string) => MCP_TOOLS.find((t) => t.name === name)!.description;

const tools: McpTool<unknown>[] = [
  {
    name: "air_quality_for_place",
    title: "Air quality and comfort for a place",
    description: desc("air_quality_for_place"),
    inputSchema: {
      type: "object",
      properties: { place: { type: "string", description: "City name, Sensor.Community device id, or \"lat, lon\"." } },
      required: ["place"],
    },
    annotations: READ_ONLY,
    async run(args) {
      const place = String(args.place ?? "").trim().slice(0, 200);
      if (!place) return { text: "Give me a place.", isError: true };
      const a = await answerAbout(place);
      return { text: `${a.text}\n\n${JSON.stringify(a.data)}`, isError: "error" in a.data };
    },
  },
  {
    name: "search_places",
    title: "Search cities and sensors",
    description: desc("search_places"),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or device id." },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "Default 5." },
      },
      required: ["query"],
    },
    annotations: READ_ONLY,
    async run(args) {
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10);
      const hits = await search(String(args.query ?? "").slice(0, 100), limit);
      if (hits.length === 0) return { text: `Nothing matched "${String(args.query)}".` };
      return { text: hits.map((h) => `- ${h.name} (${h.kind}) ${abs(h.path)}${h.pm25 != null ? `, PM2.5 ${h.pm25} µg/m³` : ""}`).join("\n") };
    },
  },
];

const handler = createMcpHandler({
  server: { name: "airsignal.app", title: "Air Signal: live air quality and outdoor comfort", version: "1.0.0" },
  instructions:
    "Live air quality and outdoor comfort. Read-only: air_quality_for_place answers about a city, device id or coordinates; search_places finds them. Open data, may be quoted with a link back.",
  tools,
  docsUrl: abs("/llms.txt"),
});

export const ALL: APIRoute = ({ request }) => handler({ request, env: {} });
