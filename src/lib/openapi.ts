import { SITE } from "./site";
import { OBSERVATION_KINDS, REPORT_APPS, REPORT_KINDS } from "./observation";

/**
 * The OpenAPI document, built once here so `/openapi.json` and the `/api` page describe the same
 * endpoints: the page is rendered from this object, never written by hand beside it.
 */
export function openapiSpec() {

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
      "/api/widget": {
        get: {
          operationId: "getWidget",
          summary: "A city's reading, shaped for showing on another site",
          description:
            "The payload behind /embed.js, and a stable contract in its own right. Smaller than " +
            "getComfort and pre-decided: band names and hex colours travel with the numbers, " +
            "because a caller rendering this inside its own stylesheet cannot read ours. Units " +
            "are named, never formatted — the caller knows its own language. A missing reading " +
            "is omitted rather than sent as zero.",
          parameters: [
            {
              name: "place",
              in: "query",
              required: false,
              schema: { type: "string", examples: ["turkey/gazipasa"] },
              description: "`<country>/<city>` as it appears in the URL. Either this or lat+lon.",
            },
            { name: "lat", in: "query", required: false, schema: { type: "number" } },
            {
              name: "lon",
              in: "query",
              required: false,
              schema: { type: "number" },
              description: "With lat: resolves to the nearest city that has a page, and names it.",
            },
          ],
          responses: {
            "200": {
              description: "Name, country, canonical URL, AQI, comfort, readings and sensor count",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "Neither place nor a valid lat/lon" },
            "404": { description: "No city there" },
          },
        },
      },
      "/api/crew": {
        get: {
          operationId: "getCrewPlan",
          summary: "Smoke and heat shift plan against Cal/OSHA rules, with fire and monitor checks, a BMS signal, a home signal, NWS alerts, wind, nearby fires, the grid's typical CO2 by hour and whether a worksite reading is advised",
          description:
            "`place` is the resolved place: name, town, state, `country` (ISO 3166-1 alpha-2) and `tz`, the IANA zone every hour in the " +
            "answer is written in (the place's own; `place` may be any town on Earth or `lat,lon`). `plan.jurisdiction` is the rulebook " +
            "applied: US-CA in California, null everywhere else today, where `plan.actions` is empty and `home` is null. " +
            "`plan.hours` is the NowCast AQI and temperature by hour; `plan.actions` the hour each rule starts; " +
            "`plan.bms` when a building closes outside air; `home` the pre-cool hours before the 16–21 E-TOU-C peak " +
            "and the smoke hour for windows; `alerts` active NWS alerts; `wind` by hour; `fires_near` VIIRS " +
            "detections within 150 km; `dispatch.reading_advised` whether a worksite reading is advised, with the bearing and distance to the nearest fire within 50 km " +
            "(`dispatch.sensor` launch | standby is the same fact in the first clients' words, deprecated); " +
            "`grid_co2` (California only) the CAISO grid's typical carbon intensity by hour, `g_per_kwh` keyed \"00\"–\"23\", the median of the " +
            "last 7 days (`days`, `basis`), a pattern rather than a forecast, `null` elsewhere. " +
            "`fallback` is set when the forecast was held at the nearest monitor.",
          parameters: [
            { name: "place", in: "query", required: true, schema: { type: "string" }, description: "Town name anywhere (\"Fresno\", \"Paris, France\") or `lat,lon`" },
            { name: "date", in: "query", schema: { type: "string", format: "date" }, description: "Defaults to today before noon in the place's zone, tomorrow after" },
            { name: "shift", in: "query", schema: { type: "string", example: "07-17" } },
          ],
          responses: { "200": { description: "Plan" } },
        },
      },
      "/api/crew/plan.ics": {
        get: {
          operationId: "getCrewPlanCalendar",
          summary: "The shift plan as an iCalendar file (text/calendar, attachment)",
          description:
            "Same query as /api/crew. Events on the plan's day, America/Los_Angeles with a VTIMEZONE: " +
            "\"N95 from HH:00 (AQI ≥151)\", \"Heat: shade and water from HH:00\", \"Heavy work window HH–HH\" " +
            "(the longest stretch under both thresholds, when a rule fires), \"Pre-cool HH–HH\" and \"TOU peak 16–21\" " +
            "from `home`. Always at least the peak-price event.",
          parameters: [
            { name: "place", in: "query", required: true, schema: { type: "string" }, description: "Town name or `lat,lon`" },
            { name: "date", in: "query", schema: { type: "string", format: "date" } },
            { name: "shift", in: "query", schema: { type: "string", example: "07-17" } },
          ],
          responses: { "200": { description: "Calendar", content: { "text/calendar": { schema: { type: "string" } } } } },
        },
      },
      "/api/crew/places": {
        get: {
          operationId: "searchCrewPlaces",
          summary: "US place suggestions, California first",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Places" } },
        },
      },
      "/api/sky-check": {
        post: {
          operationId: "checkSky",
          summary: "A vision model's smoke call on a photo of the sky, compared with the forecast",
          parameters: [{ name: "place", in: "query", schema: { type: "string" } }],
          requestBody: { required: true, content: { "image/jpeg": { schema: { type: "string", format: "binary" } } } },
          responses: { "200": { description: "Verdict" } },
        },
      },
      "/api/report": {
        post: {
          operationId: "fileObservation",
          summary: "An Air Signal observation: what a person notices about their air, where and when",
          description:
            `\`lat\`, \`lon\` are rounded to two decimals (about 1 km) by the server. \`observation.kind\` is one of ${OBSERVATION_KINDS.join(" | ")}; ` +
            "`intensity` 1–5; `observed_at` ISO UTC (default now; refused if in the future or over 36 h old). `sky.smoke_score` 0–1 is the " +
            "sky check's probability, optional. `snapshot` is the phone's own evidence, stored for comparison only. No place name and no crew " +
            "kind: the server names the point from its own cities and derives the evidence for the hour of `observed_at` in the place's own " +
            "zone (NowCast AQI, PM2.5, temperature, wind, nearest VIIRS fire and AirNow monitor). Never shown on a crew board. Same rate " +
            "limit and daily salted sender hash as crew reports; no name, account or device id.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["lat", "lon", "observation"],
                  properties: {
                    lat: { type: "number", minimum: -90, maximum: 90 },
                    lon: { type: "number", minimum: -180, maximum: 180 },
                    observation: {
                      type: "object",
                      required: ["kind", "intensity"],
                      properties: {
                        kind: { type: "string", enum: [...OBSERVATION_KINDS] },
                        intensity: { type: "integer", minimum: 1, maximum: 5 },
                        observed_at: { type: "string", format: "date-time" },
                      },
                    },
                    sky: { type: "object", properties: { smoke_score: { type: "number", minimum: 0, maximum: 1 } } },
                    snapshot: { type: "object", description: "hour, aqi, pm25_ugm3, wind_dir_deg, wind_kmh, fire, monitor; other keys dropped" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Stored: {id, created_at}" },
            "400": { description: "A field is wrong, named in `error`" },
            "404": { description: "No place near those coordinates" },
            "429": { description: "Too many from this device in 10 minutes" },
            "503": { description: "Forecast or place lookup unavailable; keep it and retry" },
          },
        },
      },
      "/api/crew/report": {
        post: {
          operationId: "fileCrewReport",
          summary: "A worker's report to the crew lead (site page only; goes nowhere else)",
          description:
            `\`kind\` is one of ${REPORT_KINDS.join(", ")}. The server attaches its own evidence for the hour: ` +
            "NowCast AQI, temperature, wind, the nearest VIIRS fire and AirNow monitor. " +
            `Deprecated for one release: \`app: airsignal\` with an \`observation\` (kind ${OBSERVATION_KINDS.join(" | ")}, intensity 1–5, ` +
            "observed_at, snapshot) is still accepted from Air Signal 1.0 and stored off the crew boards; new clients post observations to " +
            "POST /api/report instead.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["place", "kind"],
                  properties: {
                    place: { type: "string", description: "Town name or `lat,lon`" },
                    date: { type: "string", format: "date" },
                    kind: { type: "string", enum: [...REPORT_KINDS] },
                    note: { type: "string", maxLength: 280 },
                    lat: { type: "number" },
                    lon: { type: "number" },
                    heading_deg: { type: "number" },
                    sky: { type: "object", description: "The sky check's summary: smoke, smoke_call, verdict" },
                    app: { type: "string", enum: [...REPORT_APPS], default: "crewair", deprecated: true, description: "Deprecated: observations go to POST /api/report" },
                    observation: {
                      type: "object",
                      deprecated: true,
                      required: ["kind", "intensity"],
                      properties: {
                        kind: { type: "string", enum: [...OBSERVATION_KINDS] },
                        intensity: { type: "integer", minimum: 1, maximum: 5 },
                        observed_at: { type: "string", format: "date-time" },
                        snapshot: { type: "object", description: "The phone's evidence: hour, aqi, pm25_ugm3, wind_dir_deg, wind_kmh, fire, monitor" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created: id, created_at, status" }, "400": { description: "A field is wrong, named" }, "429": { description: "Too many from this device" } },
        },
      },
      "/api/crew/reports": {
        get: {
          operationId: "listCrewReports",
          summary: "Today's reports for a site",
          parameters: [{ name: "place", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Reports" } },
        },
      },
      "/api/crew/complaint": {
        get: {
          operationId: "draftCrewComplaint",
          summary: "A drafted Cal/OSHA complaint for a report; files nothing. Submit only on the worker's explicit request.",
          parameters: [{ name: "report", in: "query", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Draft" }, "404": { description: "No such report" } },
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
  return spec;
}
