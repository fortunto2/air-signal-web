/**
 * The shift plan as a calendar file: the hour N95s are due, the hour shade and water are, the clear
 * window for the heavy work, the pre-cool hours and the peak price, as events on the plan's day.
 *
 * Pure text from a `CrewAnswer`; no network, no date library. Times are California wall-clock with a
 * VTIMEZONE block, so a phone in another zone still shows 07:00 as the crew's 07:00.
 */

// Types only: `crew.ts` pulls in the WASM core and its `cloudflare:` imports, which a plain Node test
// cannot load. The zone is pinned to `CREW_TZ` by its literal type, so the two cannot drift apart.
import type { CREW_TZ as CrewTz, CrewAnswer, CrewHour } from "./crew";

const CREW_TZ: typeof CrewTz = "America/Los_Angeles";
const N95_AQI = 151;
const SHADE_F = 80;

/** A run of consecutive plan hours, [first hour, hour after the last]. */
interface Run {
  start: number;
  end: number;
}

/** Contiguous runs of hours (by local hour number) where `test` holds. */
function runs(hours: CrewHour[], test: (h: CrewHour) => boolean): Run[] {
  const out: Run[] = [];
  for (const h of hours) {
    const hour = Number(h.time.slice(11, 13));
    const ok = test(h);
    const last = out[out.length - 1];
    if (ok && last && last.end === hour) last.end = hour + 1;
    else if (ok) out.push({ start: hour, end: hour + 1 });
  }
  return out;
}

const hh = (h: number) => String(h).padStart(2, "0");

export interface IcsEvent {
  summary: string;
  description: string;
  /** Local hours on the plan's day; `end` may be 24. */
  start: number;
  end: number;
}

/** The events a plan yields, before any iCalendar syntax. Exported for the test. */
export function planEvents(answer: CrewAnswer): IcsEvent[] {
  const { plan, home, shift } = answer;
  const hours = plan.hours.filter((h) => {
    const hour = Number(h.time.slice(11, 13));
    return hour >= shift.start && hour < shift.end;
  });
  const out: IcsEvent[] = [];
  for (const r of runs(hours, (h) => (h.metrics.us_aqi_pm25 ?? 0) >= N95_AQI))
    out.push({
      summary: `N95 from ${hh(r.start)}:00 (AQI ≥${N95_AQI})`,
      description: "Cal/OSHA T8 §5141.1: N95s available for voluntary use, the crew told about the smoke, exposure cut where possible.",
      ...r,
    });
  for (const r of runs(hours, (h) => (h.metrics.temp_f ?? -Infinity) >= SHADE_F))
    out.push({
      summary: `Heat: shade and water from ${hh(r.start)}:00`,
      description: `Cal/OSHA T8 §3395: shade up and water close by at ${SHADE_F}°F; high-heat procedures at 95°F.`,
      ...r,
    });
  // The longest stretch where neither rule fires, worth naming only when something does fire.
  const clear = runs(hours, (h) => h.metrics.us_aqi_pm25 !== undefined && h.metrics.us_aqi_pm25 < N95_AQI && h.metrics.temp_f !== undefined && h.metrics.temp_f < SHADE_F)
    .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (clear && out.length > 0)
    out.push({
      summary: `Heavy work window ${hh(clear.start)}–${hh(clear.end)}`,
      description: `Under AQI ${N95_AQI} and under ${SHADE_F}°F for these hours: move the heavy work here.`,
      ...clear,
    });
  if (home.precool)
    out.push({
      summary: `Pre-cool ${hh(home.precool.start)}–${hh(home.precool.end)}`,
      description: `Cool the house before the ${home.peak_price.tariff} peak price; then hold.`,
      ...home.precool,
    });
  out.push({
    summary: `TOU peak ${hh(home.peak_price.start)}–${hh(home.peak_price.end)}`,
    description: `${home.peak_price.tariff}: peak electricity price every day. ${home.close_windows_at ? `Smoke: windows shut and HVAC on recirculate from ${home.close_windows_at.slice(11, 16)}.` : ""}`.trim(),
    ...home.peak_price,
  });
  return out.sort((a, b) => a.start - b.start);
}

/** RFC 5545 text: backslash, comma and semicolon escaped, newlines as \n. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** `2026-10-25`, hour 24 → `20261026T000000` (the plan's day rolls over at the end of the shift). */
function local(date: string, hour: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hour);
  return `${d.toISOString().slice(0, 10).replace(/-/g, "")}T${hh(d.getUTCHours())}0000`;
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${CREW_TZ}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "TZNAME:PDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "TZNAME:PST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** The whole calendar, CRLF-terminated. `url` is the plan page the events point back to. */
export function planIcs(answer: CrewAnswer, url: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const where = answer.place.name;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//airsignal.app//Crew Air//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`Crew Air · ${where} · ${answer.date}`)}`,
    `X-WR-TIMEZONE:${CREW_TZ}`,
    ...VTIMEZONE,
  ];
  planEvents(answer).forEach((e, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:crew-${answer.date}-${answer.place.lat.toFixed(3)}-${answer.place.lon.toFixed(3)}-${i}@airsignal.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${CREW_TZ}:${local(answer.date, e.start)}`,
      `DTEND;TZID=${CREW_TZ}:${local(answer.date, e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      `DESCRIPTION:${esc(`${e.description} Plan: ${url}`)}`,
      `LOCATION:${esc(where)}`,
      `URL:${url}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
