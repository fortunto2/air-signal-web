import type { APIRoute } from "astro";
import { SITE } from "../lib/site";

/**
 * What the site can be asked, in a form something else can read.
 *
 * These endpoints already existed and were undocumented, which meant an agent could only reach the
 * site by parsing HTML — and the whole argument for the Markdown twins is that it should not have
 * to. This is the same idea one level up: not "here is a page rendered for you" but "here is the
 * question you can ask".
 *
 * No authentication, deliberately, and that is why there is no
 * `/.well-known/oauth-protected-resource`: the data is open, and publishing a document that
 * describes how to authenticate against a resource that requires nothing would assert a protection
 * this site does not have.
 */
export const GET: APIRoute = () => {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: `${SITE.name} API`,
      version: "1.0.0",
      description:
        "Live air quality and outdoor comfort for any coordinate on Earth, from community sensors " +
        "where they exist and an atmospheric model everywhere else. Fourteen environmental signals " +
        "combined into one 0-100 score. No API key.",
      license: {
        name: "Data: Sensor.Community ODbL, Open-Meteo, GeoNames CC BY, OpenStreetMap ODbL",
        url: "https://opendatacommons.org/licenses/odbl/",
      },
    },
    servers: [{ url: SITE.origin }],
    paths: {
      "/api/comfort": {
        get: {
          operationId: "getComfort",
          summary: "Score a coordinate on all fourteen signals",
          description:
            "Computes live comfort for a point. Coordinates are rounded to two decimals (about a " +
            "kilometre) before use, which is the cache key and also means an exact position is " +
            "never stored. Returns 503 when every upstream is unreachable rather than a guess.",
          parameters: [
            { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
            { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
          ],
          responses: {
            "200": {
              description: "The score, the fourteen sub-scores, and the readings behind them",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer", minimum: 0, maximum: 100 },
                      worst: { type: "string", description: "The signal costing the most points" },
                      scores: {
                        type: "object",
                        description: "0-100 per signal. A signal with no reading is absent, not zero.",
                        additionalProperties: { type: "integer" },
                      },
                      readings: {
                        type: "object",
                        description: "The measurements in their own units",
                        additionalProperties: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "lat or lon missing or out of range" },
            "503": { description: "Upstreams unavailable" },
          },
        },
      },
      "/api/nearest": {
        get: {
          operationId: "getNearestCity",
          summary: "The nearest city with a page",
          parameters: [
            { name: "lat", in: "query", required: true, schema: { type: "number" } },
            { name: "lon", in: "query", required: true, schema: { type: "number" } },
          ],
          responses: {
            "200": {
              description: "Name, country, path, coordinates, sensor count and current comfort",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "404": { description: "No city within reach" },
          },
        },
      },
      "/api/search": {
        get: {
          operationId: "search",
          summary: "Find a city by name, or a device by id",
          description:
            "One field for two questions. A name matches cities; a bare number matches a " +
            "Sensor.Community device id, which is what its owner searches for.",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } },
          ],
          responses: {
            "200": {
              description: "Up to eight hits, most relevant first",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/api/cities.geojson": {
        get: {
          operationId: "getCities",
          summary: "Every city with a device, as GeoJSON points",
          responses: { "200": { description: "FeatureCollection" } },
        },
      },
      "/api/stations.geojson": {
        get: {
          operationId: "getStations",
          summary: "Community sensors, as GeoJSON points",
          description:
            "Age is measured from the last ingest rather than the wall clock, so `quiet` means the " +
            "device was not reporting when we last looked — not that our data is stale.",
          parameters: [
            {
              name: "bbox",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "minLon,minLat,maxLon,maxLat. Omit for the whole network.",
            },
          ],
          responses: { "200": { description: "FeatureCollection" } },
        },
      },
    },
    externalDocs: {
      description: "How the score is computed, with every weight and curve",
      url: `${SITE.origin}/how-it-works`,
    },
  };

  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
};
