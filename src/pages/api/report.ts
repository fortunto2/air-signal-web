import type { APIRoute } from "astro";
import { addObservation, countRecentObservations, purgeOldReports } from "../../lib/db";
import { ALL_DAY, crewPlanAt, geocode, senderHash, siteKey } from "../../lib/crew";
import { evidenceAt } from "../../lib/evidence";
import { jsonReply } from "../../lib/http";
import { parseObservationRequest } from "../../lib/observation";
import { localDay, localHour } from "../../lib/tz";

/**
 * An observation from the Air Signal app: what a person notices about their air, where, and when.
 *
 *   {lat, lon, observation: {kind, intensity, observed_at?}, sky?: {smoke_score}, snapshot?}
 *     → 201 {id, created_at}
 *
 * No place name and no crew kind: the point is rounded to two decimals here, named from our own
 * cities, and the evidence (NowCast AQI, PM2.5, temperature, wind, the nearest VIIRS fire and AirNow
 * monitor) is derived by the server for the hour of `observed_at` in the place's own zone. The
 * phone's snapshot is stored beside it for comparison only. Rate limit and sender hash as for crew
 * reports; nothing here appears on a crew board.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonReply({ error: "body must be JSON" }, 400);
  }
  let req;
  try {
    req = parseObservationRequest(body);
  } catch (e) {
    return jsonReply({ error: (e as Error).message }, 400);
  }

  let at;
  try {
    at = await geocode(`${req.lat},${req.lon}`);
  } catch (e) {
    // An upstream minute is not "no such place": say so, so the app keeps the observation and retries.
    return jsonReply({ error: `place lookup unavailable, try again: ${(e as Error).message}` }, 503);
  }
  if (!at) return jsonReply({ error: "no place at those coordinates" }, 404);

  const sender = await senderHash(clientAddress ?? request.headers.get("cf-connecting-ip") ?? "unknown", at.tz);
  if ((await countRecentObservations(sender)) >= 10) return jsonReply({ error: "too many observations from this device in 10 minutes" }, 429);

  // The plan for the local day the observation falls on, all 24 hours, so the evidence is for its hour.
  let answer;
  try {
    answer = await crewPlanAt(at, localDay(new Date(req.observation.observed_at), at.tz || "UTC"), ALL_DAY, { gridCo2: false });
  } catch (e) {
    return jsonReply({ error: `forecast unavailable, try again: ${(e as Error).message}` }, 503);
  }
  const tz = answer.place.tz;
  const hour = localHour(req.observation.observed_at, tz);
  const made = await addObservation({
    observed_at: req.observation.observed_at,
    date: localDay(new Date(req.observation.observed_at), tz),
    hour,
    tz,
    lat: req.lat,
    lon: req.lon,
    site: siteKey(answer.place),
    kind: req.observation.kind,
    intensity: req.observation.intensity,
    sky_smoke: req.sky_smoke,
    snapshot: req.observation.snapshot,
    evidence: evidenceAt(answer, hour),
    sender,
  });
  locals.cfContext?.waitUntil(purgeOldReports());
  return jsonReply(made, 201);
};
