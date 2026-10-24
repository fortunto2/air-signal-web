import type { APIRoute } from "astro";
import { REPORT_KINDS, addCrewReport, countRecentReports, handleCrewReport, type ReportKind } from "../../../lib/db";
import { crewDate, crewDefaultDate, crewPlan, evidenceFor, parseShift, reportedFrom, senderHash, siteKey } from "../../../lib/crew";

/**
 * A worker's report, or the crew lead marking one handled. Takes the /crew page's plain form POST
 * (and answers with a redirect back to it) or JSON from the app (and answers with JSON).
 *
 *   {place, date?, shift?, kind, note?,
 *    lat?, lon?, accuracy_m?, heading_deg?, sky?} → {id, created_at, status: "open"}
 *   (where it was made and which way the camera faced go into the evidence, rounded to ~100 m)
 *   {place, date?, action: "handle", id, note?} → {id, status: "handled"}
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let body: Record<string, any>;
  try {
    body = isJson
      ? await request.json()
      : (Object.fromEntries((await request.formData()).entries()) as Record<string, string>);
  } catch {
    return reply(isJson, { error: "unreadable body" }, 400);
  }

  const place = String(body.place ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date! : crewDefaultDate();
  const shift = parseShift(body.shift ?? null);
  const note = body.note ? String(body.note).trim().slice(0, 280) || null : null;
  if (!place) return reply(isJson, { error: "place required" }, 400);

  const back = (extra: string) =>
    `/crew?place=${encodeURIComponent(place)}&date=${date}&shift=${String(shift.start).padStart(2, "0")}-${String(shift.end).padStart(2, "0")}${extra}#reports`;

  // The plan is computed again here, not taken from the form: the evidence a report carries must be
  // what the sources said, not what a client claims they said. Today, all 24 hours, because a
  // report is about now, which may be outside the shift it is filed under.
  const answer = await crewPlan(place, crewDate(0), { start: 0, end: 24 }).catch(() => null);
  if (!answer) return reply(isJson, { error: `place not found: ${place}` }, 404);
  const site = siteKey(answer.place.name);

  if (body.action === "handle") {
    const id = Number(body.id);
    const ok = Number.isInteger(id) && (await handleCrewReport(id, site, note));
    if (!isJson) return Response.redirect(new URL(back(ok ? `&handled=${id}` : ""), request.url), 303);
    return reply(true, ok ? { id, status: "handled" } : { error: "no open report with that id here" }, ok ? 200 : 404);
  }

  const kind = String(body.kind ?? "") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return reply(isJson, { error: `kind must be one of ${REPORT_KINDS.join(", ")}` }, 400);

  const sender = await senderHash(clientAddress ?? request.headers.get("cf-connecting-ip") ?? "unknown");
  if ((await countRecentReports(sender)) >= 10) {
    return reply(isJson, { error: "too many reports from this device in 10 minutes" }, 429);
  }

  const from = reportedFrom(
    { lat: body.lat, lon: body.lon, accuracy_m: body.accuracy_m, heading_deg: body.heading_deg, sky: (body as Record<string, unknown>).sky },
    answer.plan.confidence.fire,
  );
  const made = await addCrewReport({ site, date, kind, note, evidence: { ...evidenceFor(answer), from }, sender });
  if (!isJson) return Response.redirect(new URL(back(`&sent=${made.id}`), request.url), 303);
  return reply(true, { ...made, status: "open" }, 201);
};

function reply(isJson: boolean, body: Record<string, unknown>, status: number) {
  if (!isJson && status >= 400) {
    return new Response(`${body.error}`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
