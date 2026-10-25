import type { APIRoute } from "astro";
import { crewPlan, formatShift, parseDate, parseShift } from "../../../lib/crew";
import { planIcs } from "../../../lib/ics";
import { jsonReply } from "../../../lib/http";
import { abs, paths } from "../../../lib/site";

/**
 * The shift plan as an iCalendar file: the same query as /api/crew, events on the plan's day for the
 * N95 hour, the shade-and-water hour, the heavy work window, the pre-cool hours and the peak price.
 * Served as an attachment so "Add to calendar" on /crew downloads straight into the phone's calendar.
 */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  if (!place) return jsonReply({ error: "place required, e.g. ?place=Fresno&shift=07-17" }, 400);
  const date = parseDate(url.searchParams.get("date"));
  const shift = parseShift(url.searchParams.get("shift"));
  try {
    const answer = await crewPlan(place, date, shift);
    if (!answer) return jsonReply({ error: `place not found: ${place}` }, 404);
    const page = abs(`${paths.crew()}?place=${encodeURIComponent(place)}&date=${date}&shift=${formatShift(shift)}`);
    const file = `crew-air-${answer.place.town.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${date}.ics`;
    return new Response(planIcs(answer, page), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "public, max-age=0, s-maxage=900",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    return jsonReply({ error: `forecast unavailable: ${(e as Error).message}` }, 502);
  }
};
