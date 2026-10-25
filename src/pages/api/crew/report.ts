import type { APIRoute } from "astro";
import { REPORT_KINDS, addCrewReport, countRecentReports, handleCrewReport, purgeOldReports, type ReportKind } from "../../../lib/db";
import { ALL_DAY, crewDate, crewPlanAt, evidenceFor, formatShift, geocode, parseDate, parseShift, reportedFrom, senderHash, siteKey } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";
import { parseApp, parseObservation } from "../../../lib/observation";

/**
 * A worker's report, or the crew lead marking one handled. Takes the /crew page's plain form POST
 * (and answers with a redirect back to it) or JSON from the app (and answers with JSON).
 *
 *   {place, date?, shift?, kind, note?,
 *    lat?, lon?, accuracy_m?, heading_deg?, sky?,
 *    app?: "crewair" | "airsignal", observation?: {kind, intensity, observed_at?, snapshot?}}
 *     → {id, created_at, status: "open"}
 *   (where it was made and which way the camera faced go into the evidence, rounded to ~100 m;
 *    Air Signal's observations are stored with app = "airsignal" and stay off the crew boards)
 *   {place, date?, action: "handle", id, note?} → {id, status: "handled"}
 *
 * Cheapest checks first: the place resolves once; "handle" and the rate limit never pay for a plan.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  const fail = (error: string, status: number) =>
    isJson ? jsonReply({ error }, status) : new Response(error, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

  let body: Record<string, any>;
  try {
    body = isJson ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    return fail("unreadable body", 400);
  }

  const place = String(body.place ?? "").trim();
  const date = parseDate(body.date);
  const shift = parseShift(body.shift ?? null);
  const note = body.note ? String(body.note).trim().slice(0, 280) || null : null;
  if (!place) return fail("place required", 400);
  const back = (extra: string) =>
    new URL(`/crew?place=${encodeURIComponent(place)}&date=${date}&shift=${formatShift(shift)}${extra}#reports`, request.url);

  let at;
  try {
    at = await geocode(place);
  } catch (e) {
    // An upstream minute is not "no such place": say so, so the app keeps the report and retries.
    return fail(`forecast unavailable, try again: ${(e as Error).message}`, 503);
  }
  if (!at) return fail(`place not found: ${place}`, 404);
  const site = siteKey(at);

  if (body.action === "handle") {
    const id = Number(body.id);
    const ok = Number.isInteger(id) && (await handleCrewReport(id, site, note));
    if (!isJson) return Response.redirect(back(ok ? `&handled=${id}` : ""), 303);
    return ok ? jsonReply({ id, status: "handled" }) : fail("no open report with that id here", 404);
  }

  const kind = String(body.kind ?? "") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return fail(`kind must be one of ${REPORT_KINDS.join(", ")}`, 400);
  let app, observation;
  try {
    app = parseApp(body.app);
    observation = parseObservation(body.observation);
  } catch (e) {
    return fail((e as Error).message, 400);
  }
  const sender = await senderHash(clientAddress ?? request.headers.get("cf-connecting-ip") ?? "unknown");
  if ((await countRecentReports(sender)) >= 10) return fail("too many reports from this device in 10 minutes", 429);

  // The evidence is computed here, not taken from the client: what the sources said, not what a client
  // claims they said. Today, all 24 hours, because a report is about now, maybe outside the shift.
  let answer;
  try {
    answer = await crewPlanAt(at, crewDate(0), ALL_DAY);
  } catch (e) {
    return fail(`forecast unavailable, try again: ${(e as Error).message}`, 503);
  }
  const from = reportedFrom(
    { lat: body.lat, lon: body.lon, accuracy_m: body.accuracy_m, heading_deg: body.heading_deg, sky: body.sky },
    answer.plan.confidence.fire,
  );
  const made = await addCrewReport({ site, date, kind, note, evidence: { ...evidenceFor(answer), from }, sender, app, observation });
  // Retention, off the response path: the rate-limit hash after 2 days, raw reports after 24 months.
  locals.cfContext?.waitUntil(purgeOldReports());
  if (!isJson) return Response.redirect(back(`&sent=${made.id}`), 303);
  return jsonReply({ ...made, status: "open" }, 201);
};
