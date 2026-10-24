import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { ALL_DAY, crewDate, crewPlan, nowHour } from "../../lib/crew";
import { jsonReply as reply } from "../../lib/http";

/**
 * "Check the sky": a photo of the horizon in, what a vision decision model sees out.
 *
 * The phone blurs faces and crops to the sky before it sends anything, so what arrives here is sky.
 * One call to TypeSafe's Jev answers typed questions with calibrated probabilities (no text
 * generation). Measured on 13 known-answer photos (7 smoky, 5 clear, 1 indoor; public domain,
 * hackathon repo `work/sky_eval.md`): the smoke question separated them 12/12 at 0.5 (smoky
 * 0.63–0.98, clear 0.09–0.47), while the visibility estimate was unreliable (one smoky scene "over 10
 * miles", confidences 0–0.4). So the verdict rests on `smoke`; visibility, mapped to an AQI category
 * by the EPA/CDC table, is shown only when its confidence is 0.7 or more. The answer is compared with
 * the forecast's NowCast for this hour, so "looks worse than the model" is a fact the report can carry.
 *
 * POST multipart (`photo` = JPEG, optional `place`) or a raw image/jpeg body with ?place=.
 */

const JEV = "https://api.typesafe.ai/v1/systemone";
const MAX_BYTES = 2_500_000;
const SMOKE_YES = 0.6;
const SMOKE_UNSURE = 0.4;
const VIS_MIN_CONFIDENCE = 0.7;

// EPA/CDC, "Wildfire Smoke: A Guide for Public Health Officials", visibility index.
const VISIBILITY = [
  { label: "under 1 mile", category: "Hazardous", aqi: [301, 500] },
  { label: "1 to 1.5 miles", category: "Very unhealthy", aqi: [201, 300] },
  { label: "1.5 to 3 miles", category: "Unhealthy", aqi: [151, 200] },
  { label: "3 to 5 miles", category: "Unhealthy for sensitive groups", aqi: [101, 150] },
  { label: "5 to 10 miles", category: "Moderate", aqi: [51, 100] },
  { label: "over 10 miles", category: "Good", aqi: [0, 50] },
] as const;

const QUESTIONS = {
  sky: { type: "noul", instructions: "Does `photo` show an outdoor view with open sky and a distant horizon?" },
  smoke: { type: "noul", instructions: "Is there visible smoke or haze in the air in `photo`: a grey, brown or orange pall that softens distant objects?" },
  plume: { type: "noul", instructions: "Is a distinct column or plume of smoke visible in `photo`?" },
  ash: { type: "noul", instructions: "Is ash visible in `photo`, falling or settled on surfaces?" },
  visibility: {
    type: "score",
    instructions: "Judging by how clearly distant hills, trees or buildings show in `photo`, how far can you see?",
    criteria: VISIBILITY.map((v) => v.label),
  },
};

export const POST: APIRoute = async ({ request, url }) => {
  const key = (env as unknown as { TYPESAFE_API_KEY?: string }).TYPESAFE_API_KEY;
  if (!key) return reply({ error: "sky check is not configured" }, 503);

  let photo: Blob | null = null;
  let place = url.searchParams.get("place");
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const f = form.get("photo");
    photo = f instanceof Blob ? f : null;
    place = (form.get("place") as string | null) ?? place;
  } else if (type.startsWith("image/")) {
    photo = await request.blob();
  }
  if (!photo || photo.size === 0) return reply({ error: "photo required (multipart field `photo`, JPEG)" }, 400);
  if (photo.size > MAX_BYTES) return reply({ error: "photo too large: send the sky crop at 768 px" }, 413);

  const body = new FormData();
  body.append(
    "request",
    new Blob(
      [JSON.stringify({ state: { photo: "<image:sky>" }, model: "jev-latest", questions: QUESTIONS, assets: { "<image:sky>": { type: "image", part: "asset-0" } } })],
      { type: "application/json" },
    ),
  );
  body.append("asset-0", new Blob([await photo.arrayBuffer()], { type: "image/jpeg" }), "asset-0");

  // The forecast for this hour is fetched while the vision model looks at the photo, not after it.
  const planned = place ? crewPlan(place, crewDate(0), ALL_DAY).catch(() => null) : Promise.resolve(null);
  const t0 = Date.now();
  const res = await fetch(JEV, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "TypeSafe-Danger-Zone-Images": "true" },
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return reply({ error: "vision model did not answer" }, 502);
  const out = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return reply({ error: out?.detail?.message ?? `vision model ${res.status}` }, 502);

  const a = out.answers ?? {};
  const probs: Record<string, number> = a.visibility?.probabilities ?? {};
  const best = Object.entries(probs).sort((x, y) => y[1] - x[1])[0];
  const vis = best ? VISIBILITY[Number(best[0])] : null;
  // Low bar on purpose: one clear landscape in the eval scored "no sky"; only indoor shots go near 0.
  const skyVisible = (a.sky?.noul ?? 0) >= 0.2;
  const smoke = a.smoke?.noul ?? 0;
  const smokeCall = smoke >= SMOKE_YES ? "yes" : smoke >= SMOKE_UNSURE ? "unsure" : "no";
  // A confident "over 10 miles" on a hazy photo happened in the eval: never let visibility say Good
  // when the smoke question says smoke.
  const visTrusted =
    vis && (a.visibility?.confidence ?? 0) >= VIS_MIN_CONFIDENCE && !(smokeCall === "yes" && vis.aqi[1] <= 50) ? vis : null;

  // The forecast for this hour, when a place is given: what the photo is compared with.
  let model: { aqi: number | null; place: string } | null = null;
  const plan = await planned;
  if (plan) {
    const hour = plan?.plan.hours.find((h) => h.time === nowHour());
    model = { aqi: hour?.metrics.us_aqi_pm25 ?? null, place: plan.place.name };
  }
  const looksAqi = skyVisible && visTrusted ? visTrusted.aqi[0] : skyVisible && smokeCall === "yes" ? 101 : null;
  // Visible smoke under a forecast below "unhealthy for sensitive groups" is the mismatch a crew lead
  // should hear about; a trusted visibility reading two categories worse than the model is too.
  const worse =
    model?.aqi == null || !skyVisible
      ? null
      : (smokeCall === "yes" && model.aqi < 101) || (looksAqi !== null && looksAqi > model.aqi + 50);

  const verdict = !skyVisible
    ? "No open sky in the photo. Point the camera at the horizon."
    : smokeCall === "unsure"
      ? "Not sure. Take another photo with more of the horizon in it."
      : smokeCall === "yes"
        ? `${(a.plume?.noul ?? 0) >= 0.5 ? "Smoke plume visible" : "Smoke or haze in the air"}${visTrusted ? `; you can see ${visTrusted.label}, which reads as ${visTrusted.category}` : ""}.`
        : "No smoke seen in the sky.";

  return reply(
    {
      verdict,
      smoke_call: smokeCall,
      sky_visible: skyVisible,
      smoke: a.smoke?.noul ?? null,
      plume: a.plume?.noul ?? null,
      ash: a.ash?.noul ?? null,
      visibility: vis ? { label: vis.label, category: vis.category, aqi_range: vis.aqi, confidence: a.visibility?.confidence ?? null, trusted: visTrusted !== null } : null,
      model,
      looks_worse_than_model: worse,
      source: { model: out.model ?? "jev", ms: Date.now() - t0, visibility_table: "EPA/CDC Wildfire Smoke: A Guide for Public Health Officials" },
    },
    200,
  );
};

