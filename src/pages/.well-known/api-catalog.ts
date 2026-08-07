import type { APIRoute } from "astro";
import { SITE, abs, paths } from "../../lib/site";

/**
 * The API catalogue, as RFC 9727 describes it: a link set, served as `application/linkset+json`.
 *
 * The point of it is discovery in one hop. An agent that has the origin and nothing else finds the
 * OpenAPI document, the A2A card, the terms the data comes under, and the human page explaining
 * what any of it means — without guessing at paths.
 */
export const GET: APIRoute = () => {
  const linkset = {
    linkset: [
      {
        anchor: SITE.origin,
        "service-desc": [
          { href: abs("/openapi.json"), type: "application/openapi+json", title: `${SITE.name} HTTP API` },
        ],
        "service-doc": [
          { href: abs(paths.howItWorks()), type: "text/html", title: "How the score is computed" },
          { href: abs(paths.guide()), type: "text/html", title: "What each signal means" },
        ],
        "service-meta": [
          { href: abs("/.well-known/agent-card.json"), type: "application/json", title: "A2A agent card" },
          { href: abs("/llms.txt"), type: "text/plain", title: "llms.txt" },
        ],
        license: [
          { href: "https://opendatacommons.org/licenses/odbl/", title: "Sensor.Community and OpenStreetMap data: ODbL" },
          { href: "https://creativecommons.org/licenses/by/4.0/", title: "GeoNames place data: CC BY 4.0" },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(linkset, null, 2), {
    headers: {
      "content-type": "application/linkset+json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
};
