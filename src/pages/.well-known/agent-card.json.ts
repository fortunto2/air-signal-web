import type { APIRoute } from "astro";
import { getSitemapCounts } from "../../lib/db";
import { SITE, abs } from "../../lib/site";

/**
 * The A2A agent card.
 *
 * Published after the endpoint it advertises, not before. A card pointing at a service that does
 * not answer turns a site an agent would have scraped successfully into one that fails halfway
 * through a protocol, which is worse than having no card at all.
 *
 * One skill, described narrowly. The temptation with these is to list everything the site can do;
 * the useful version says what one question this thing answers well, because that is what a
 * planner matches against.
 *
 * `securitySchemes` is absent and that is the accurate statement: there is no authentication, the
 * data is open, and every answer here is also a public URL. It is the same reason there is no
 * `/.well-known/oauth-protected-resource` — a document describing how to authenticate against a
 * resource that requires nothing would assert a protection this site does not have.
 */
export const GET: APIRoute = async () => {
  const counts = await getSitemapCounts();

  const card = {
    protocolVersion: "0.3.0",
    name: SITE.name,
    description:
      "Live air quality and outdoor comfort for any place on Earth. Fourteen environmental " +
      "signals — particulates, temperature, wind, sea, UV, pollen, pressure and more — combined " +
      `into one 0-100 score, from ${counts.stations.toLocaleString("en-US")} community sensors ` +
      "where they exist and an atmospheric model everywhere else.",
    url: abs("/a2a"),
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    provider: { organization: SITE.name, url: SITE.origin },
    documentationUrl: abs("/how-it-works"),
    iconUrl: abs("/favicon.svg"),
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "air-quality-for-place",
        name: "Air quality and outdoor comfort for a place",
        description:
          "Give it a city name, a Sensor.Community device id, or a coordinate pair, and it " +
          "returns the current comfort score out of 100, the signal costing the most points, the " +
          "underlying readings in their own units, and the URL of the page. A signal with no " +
          "reading is reported as absent rather than as zero, and when every upstream is " +
          "unreachable it says so instead of guessing.",
        tags: ["air quality", "pm2.5", "weather", "uv", "pollen", "environment", "geo"],
        examples: [
          "What is the air quality in Sofia?",
          "Berlin",
          "48.78, 9.18",
          "sensor 12814",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain", "application/json"],
      },
    ],
    additionalInterfaces: [
      { url: abs("/openapi.json"), transport: "HTTP+JSON" },
    ],
  };

  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
};
