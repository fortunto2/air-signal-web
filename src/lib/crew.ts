/**
 * The crew shift plan: a place, a day and a shift in; Cal/OSHA smoke and heat actions out.
 *
 * Network here, maths in `airq-core` (`crew.rs`): NowCast, the rulebook engine and the BMS signal
 * are one Rust function, so the CLI, this page and the hackathon demo cannot disagree about when
 * N95s are due. The upstream is Open-Meteo's hourly *raw* PM2.5, not its `us_aqi`, which is a
 * 24-hour mean and lags a smoke front by most of a shift.
 */

import { core } from "./core";

export const CREW_TZ = "America/Los_Angeles";

export interface CrewHour {
  time: string;
  metrics: Partial<Record<"us_aqi_pm25" | "pm25_nowcast_ugm3" | "pm25_ugm3" | "temp_f" | "temp_c", number>>;
}

export interface CrewAction {
  time: string;
  rule: string;
  cite: string;
  text: string;
}

export interface CrewPlan {
  jurisdiction: string;
  hours: CrewHour[];
  actions: CrewAction[];
  peak_aqi: number | null;
  peak_temp_f: number | null;
  bms: {
    threshold_aqi: number;
    recirculate_at: string | null;
    resume_at: string | null;
    peak_aqi: number | null;
    reason: string;
  };
}

export interface CrewAnswer {
  place: { name: string; lat: number; lon: number };
  date: string;
  shift: { start: number; end: number };
  plan: CrewPlan;
}

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

/** A California place first: the rulebook is Cal/OSHA, and "Fresno" means the one in the valley. */
export async function geocode(place: string): Promise<CrewAnswer["place"] | null> {
  const name = place.split(",")[0]!.trim();
  if (!name) return null;
  const r = await json(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&countryCode=US`,
  );
  const hits: any[] = r.results ?? [];
  const g = hits.find((x) => x.admin1 === "California") ?? hits[0];
  if (!g) return null;
  return { name: [g.name, g.admin1].filter(Boolean).join(", "), lat: g.latitude, lon: g.longitude };
}

/** Today in California, as `YYYY-MM-DD`, plus `offset` days. */
export function crewDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: CREW_TZ }).format(d);
}

/** Before noon in California the plan is for today; after it, for tomorrow's shift. */
export function crewDefaultDate(): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: CREW_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return crewDate(hour < 12 ? 0 : 1);
}

/** `07-17` → `{start: 7, end: 17}`; anything malformed falls back to a day shift. */
export function parseShift(raw: string | null): { start: number; end: number } {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw ?? "");
  const start = m ? Number(m[1]) : 7;
  const end = m ? Number(m[2]) : 17;
  return start < end && end <= 24 ? { start, end } : { start: 7, end: 17 };
}

export async function crewPlan(place: string, date: string, shift: { start: number; end: number }): Promise<CrewAnswer | null> {
  const at = await geocode(place);
  if (!at) return null;
  // A day of history so the first shift hour has the 12 hours a NowCast needs.
  const q = `latitude=${at.lat}&longitude=${at.lon}&past_days=1&forecast_days=3&timezone=${encodeURIComponent(CREW_TZ)}`;
  const [aq, wx] = await Promise.all([
    json(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5`),
    json(`https://api.open-meteo.com/v1/forecast?${q}&hourly=temperature_2m`),
  ]);
  const temp = new Map<string, number | null>(
    (wx.hourly.time as string[]).map((t, i) => [t, wx.hourly.temperature_2m[i]]),
  );
  const hours = (aq.hourly.time as string[]).map((time, i) => ({
    time,
    pm25: aq.hourly.pm2_5[i] ?? null,
    temp_c: temp.get(time) ?? null,
  }));
  const out = JSON.parse(core().wasm_crew_plan(JSON.stringify({ hours, date, ...shift })));
  if (out.error) throw new Error(out.error);
  return { place: at, date, shift, plan: out as CrewPlan };
}
