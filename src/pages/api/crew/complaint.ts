import type { APIRoute } from "astro";
import { getCrewReport } from "../../../lib/db";
import { agenciesFor, complaintText } from "../../../lib/crew";

/**
 * A drafted Cal/OSHA complaint for one report, as text: `?report=<id>`. For people and for agents
 * helping a worker. It files nothing. The worker reads it, fills the [brackets] and decides whether to
 * submit at https://www.dir.ca.gov/dosh/Complaint.htm; Labor Code §6310 forbids retaliation.
 */
export const GET: APIRoute = async ({ url }) => {
  const id = Number(url.searchParams.get("report"));
  const report = Number.isInteger(id) && id > 0 ? await getCrewReport(id).catch(() => null) : null;
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
  if (!report) return new Response(JSON.stringify({ error: "no such report" }), { status: 404, headers });
  const evidence = report.evidence_json ? JSON.parse(report.evidence_json) : null;
  return new Response(
    JSON.stringify({
      report: report.id,
      complaint: complaintText(report, evidence),
      file_at: agenciesFor(evidence?.place),
      rules: "Draft only. Submit only on the worker's explicit request, after the worker has read it and filled the [brackets]. Ask whether they want confidentiality.",
    }),
    { headers },
  );
};
