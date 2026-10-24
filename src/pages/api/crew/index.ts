import type { APIRoute } from "astro";
import { crewPlan, parseDate, parseShift } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/**
 * The crew plan as JSON, and the BMS signal inside it: `plan.bms.recirculate_at` is the hour a
 * building's air handler should close outside air. `?place=Fresno&date=2026-10-24&shift=07-17`.
 */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  if (!place) return jsonReply({ error: "place required, e.g. ?place=Fresno&shift=07-17" }, 400);
  try {
    const answer = await crewPlan(place, parseDate(url.searchParams.get("date")), parseShift(url.searchParams.get("shift")));
    if (!answer) return jsonReply({ error: `place not found: ${place}` }, 404);
    return jsonReply(answer, 200, "public, max-age=0, s-maxage=900");
  } catch (e) {
    return jsonReply({ error: `forecast unavailable: ${(e as Error).message}` }, 502);
  }
};
