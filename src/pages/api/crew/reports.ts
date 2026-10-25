import type { APIRoute } from "astro";
import { listCrewReports } from "../../../lib/db";
import { geocode, parseDate, siteKey } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/** Today's crew reports for a site, newest first (Air Signal's observations are not listed here yet). `?place=Fresno&date=2026-10-24`. */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  if (!place) return jsonReply({ error: "place required" }, 400);
  const date = parseDate(url.searchParams.get("date"));
  const at = await geocode(place).catch(() => null);
  if (!at) return jsonReply({ error: `place not found: ${place}` }, 404);
  const site = siteKey(at);
  // `sender` stays server-side: a daily hash is not a name, but it would let anyone link one phone's
  // reports to each other, and it exists only for the rate limit.
  const reports = (await listCrewReports(site, date)).map(({ evidence_json, observation_json, sender: _sender, ...r }) => ({
    ...r,
    evidence: evidence_json ? JSON.parse(evidence_json) : null,
    observation: observation_json ? JSON.parse(observation_json) : null,
  }));
  return jsonReply({ site, date, reports });
};
