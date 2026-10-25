import type { APIRoute } from "astro";
import { formatShift, planFromQuery, siteKey } from "../../../lib/crew";
import { planIcs } from "../../../lib/ics";
import { jsonReply } from "../../../lib/http";
import { abs, paths } from "../../../lib/site";

/**
 * The shift plan as an iCalendar file: the same query as /api/crew, events on the plan's day for the
 * hour each rule starts, the heavy work window, the pre-cool hours and the peak price. Served as an
 * attachment so "Add to calendar" on /crew downloads straight into the phone's calendar.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = await planFromQuery(url);
  if (!q.ok) return jsonReply({ error: q.error }, q.status);
  const page = abs(paths.crewPlan(q.place, q.date, formatShift(q.shift)));
  return new Response(planIcs(q.answer, page), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="crew-air-${siteKey(q.answer.place)}-${q.date}.ics"`,
      "cache-control": "public, max-age=0, s-maxage=900",
      "access-control-allow-origin": "*",
    },
  });
};
