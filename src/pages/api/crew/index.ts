import type { APIRoute } from "astro";
import { planFromQuery } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/**
 * The crew plan as JSON, and the BMS signal inside it: `plan.bms.recirculate_at` is the hour a
 * building's air handler should close outside air. `?place=Fresno&date=2026-10-24&shift=07-17`.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = await planFromQuery(url);
  if (!q.ok) return jsonReply({ error: q.error }, q.status);
  return jsonReply(q.answer, 200, "public, max-age=0, s-maxage=900");
};
