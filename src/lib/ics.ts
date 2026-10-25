/**
 * The shift plan as a calendar file: the engine's actions (the hour each rule starts, the clear
 * window for the heavy work) and the home signal (pre-cool, the peak price), as events on the plan's
 * day. No thresholds live here: the rulebook decides what fires, `plan.actions` says when, this file
 * only names it.
 *
 * Times are written in UTC from the place's own zone, so a phone anywhere shows the crew's 07:00 as
 * 07:00 there: that is the one case a VTIMEZONE block would have to be generated for every zone on
 * Earth to get right, and UTC gets it right for free.
 */

import type { CrewAction, CrewAnswer } from "./crew";
import { PACIFIC, zonedToUtc } from "./tz";

const hh = (h: number) => String(h).padStart(2, "0");
const hourOf = (time: string) => Number(time.slice(11, 13));

export interface IcsEvent {
  summary: string;
  description: string;
  /** Local hours on the plan's day; `end` may be 24. */
  start: number;
  end: number;
}

/** The rule ids the California rulebook uses; anything else falls back to the action's own text. */
const SUMMARY: Record<string, (at: string) => string> = {
  "smoke-n95": (at) => `N95 from ${at} (AQI ≥151)`,
  "smoke-respirators": (at) => `Respirators from ${at} (AQI over 500)`,
  "heat-shade": (at) => `Heat: shade and water from ${at}`,
  "heat-high": (at) => `High-heat procedures from ${at}`,
};

/** The engine writes "Heavy work in clear hours: 07:00–13:00": the first and last clear hour. */
function clearWindow(a: CrewAction): [number, number] | null {
  const m = /(\d{2}):\d{2}\s*[–-]\s*(\d{2}):\d{2}/.exec(a.text);
  return m ? [Number(m[1]), Number(m[2]) + 1] : null;
}

/** The events a plan yields, before any iCalendar syntax. Exported for the test. */
export function planEvents(answer: CrewAnswer): IcsEvent[] {
  const { plan, home, shift } = answer;
  const out: IcsEvent[] = [];
  for (const a of plan.actions) {
    if (a.rule === "plan") {
      const w = clearWindow(a);
      if (w) out.push({ summary: `Heavy work window ${hh(w[0])}–${hh(w[1])}`, description: a.text, start: w[0], end: w[1] });
      continue;
    }
    const start = hourOf(a.time);
    const at = `${hh(start)}:00`;
    out.push({
      summary: SUMMARY[a.rule]?.(at) ?? `${a.text.slice(0, 60)} from ${at}`,
      description: [a.text, a.cite].filter(Boolean).join(". "),
      start,
      end: shift.end,
    });
  }
  if (home?.precool)
    out.push({
      summary: `Pre-cool ${hh(home.precool.start)}–${hh(home.precool.end)}`,
      description: `Cool the house before the ${home.peak_price.tariff} peak price; then hold.`,
      ...home.precool,
    });
  if (home)
    out.push({
      summary: `TOU peak ${hh(home.peak_price.start)}–${hh(home.peak_price.end)}`,
      description: `${home.peak_price.tariff}: peak electricity price every day. ${home.close_windows_at ? `Smoke: windows shut and HVAC on recirculate from ${home.close_windows_at.slice(11, 16)}.` : ""}`.trim(),
      ...home.peak_price,
    });
  return out.sort((a, b) => a.start - b.start);
}

/** RFC 5545 text: backslash, comma and semicolon escaped, newlines as \n. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

const encoder = new TextEncoder();

/** Lines longer than 75 octets are folded with CRLF + space. Most lines are short and pass through. */
function fold(line: string): string {
  if (line.length <= 75 && encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
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

/** `2026-10-25`, hour 7 in the zone → `20261025T140000Z`. */
const stampUtc = (day: string, hour: number, tz: string) => zonedToUtc(day, hour, tz).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

/** The whole calendar, CRLF-terminated. `url` is the plan page the events point back to. */
export function planIcs(answer: CrewAnswer, url: string, now = new Date()): string {
  const tz = answer.place.tz ?? PACIFIC;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const where = answer.place.name;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//airsignal.app//Crew Air//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`Crew Air · ${where} · ${answer.date}`)}`,
    `X-WR-TIMEZONE:${tz}`,
  ];
  planEvents(answer).forEach((e, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:crew-${answer.date}-${answer.place.lat.toFixed(3)}-${answer.place.lon.toFixed(3)}-${i}@airsignal.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${stampUtc(answer.date, e.start, tz)}`,
      `DTEND:${stampUtc(answer.date, e.end, tz)}`,
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
