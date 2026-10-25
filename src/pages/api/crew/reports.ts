import type { APIRoute } from "astro";
import { listCrewReports } from "../../../lib/db";
import { geocode, parseDate, siteKey, siteKeys } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/** Today's crew reports for a site, newest first (Air Signal's observations are not listed here yet). `?place=Fresno&date=2026-10-24`. */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  if (!place) return jsonReply({ error: "place required" }, 400);
  const at = await geocode(place).catch(() => null);
  if (!at) return jsonReply({ error: `place not found: ${place}` }, 404);
  const date = parseDate(url.searchParams.get("date"), at.tz);
  const site = siteKey(at);
  // `sender` stays server-side: a daily hash is not a name, but it would let anyone link one phone's
  // reports to each other, and it exists only for the rate limit.
  // Crew rows only, so `observation_json` is always null here and is left out with `sender`.
  const reports = (await listCrewReports(siteKeys(at), date)).map(({ evidence_json, observation_json: _obs, sender: _sender, ...r }) => ({
    ...r,
    evidence: evidence_json ? JSON.parse(evidence_json) : null,
  }));
  return jsonReply({ site, date, reports });
};
