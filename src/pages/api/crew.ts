import type { APIRoute } from "astro";
import { crewDefaultDate, crewPlan, parseShift } from "../../lib/crew";

/**
 * The crew plan as JSON, and the BMS signal inside it: `plan.bms.recirculate_at` is the hour a
 * building's air handler should close outside air. `?place=Fresno&date=2026-10-24&shift=07-17`.
 */
export const GET: APIRoute = async ({ url }) => {
  const place = url.searchParams.get("place")?.trim();
  if (!place) return reply({ error: "place required, e.g. ?place=Fresno&shift=07-17" }, 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "")
    ? url.searchParams.get("date")!
    : crewDefaultDate();
  try {
    const answer = await crewPlan(place, date, parseShift(url.searchParams.get("shift")));
    if (!answer) return reply({ error: `place not found: ${place}` }, 404);
    return reply(answer, 200);
  } catch (e) {
    return reply({ error: `forecast unavailable: ${(e as Error).message}` }, 502);
  }
};

function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=0, s-maxage=900" : "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
