import type { APIRoute } from "astro";
import { listCrewReports } from "../../../lib/db";
import { crewDefaultDate, geocode, siteKey } from "../../../lib/crew";

/** Today's reports for a site, newest first. `?place=Fresno&date=2026-10-24`. */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
  if (!place) return new Response(JSON.stringify({ error: "place required" }), { status: 400, headers });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : crewDefaultDate();
  const at = await geocode(place).catch(() => null);
  if (!at) return new Response(JSON.stringify({ error: `place not found: ${place}` }), { status: 404, headers });
  const reports = (await listCrewReports(siteKey(at.name), date)).map(({ evidence_json, ...r }) => ({
    ...r,
    evidence: evidence_json ? JSON.parse(evidence_json) : null,
  }));
  return new Response(JSON.stringify({ site: siteKey(at.name), date, reports }), { headers });
};
