import type { APIRoute } from "astro";
import { getCrewReport } from "../../../lib/db";
import { agenciesFor, complaintText } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/**
 * A drafted safety complaint for one report, as text: `?report=<id>`. For people and for agents
 * helping a worker. It files nothing. The worker reads it, fills the [brackets] and decides whether to
 * submit it to the agency listed first; Labor Code §6310 forbids retaliation.
 */
export const GET: APIRoute = async ({ url }) => {
  const id = Number(url.searchParams.get("report"));
  const report = Number.isInteger(id) && id > 0 ? await getCrewReport(id).catch(() => null) : null;
  if (!report) return jsonReply({ error: "no such report" }, 404);
  const evidence = report.evidence_json ? JSON.parse(report.evidence_json) : null;
  const agencies = agenciesFor(evidence?.place);
  return jsonReply({
    report: report.id,
    complaint: complaintText(report, evidence),
    // `file_at` stays a URL string: the app decodes it that way. The full list is `agencies`.
    file_at: agencies[0]!.url,
    agencies,
    rules: "Draft only. Submit only on the worker's explicit request, after the worker has read it and filled the [brackets]. Ask whether they want confidentiality.",
  });
};
