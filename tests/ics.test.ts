import { test } from "node:test";
import assert from "node:assert/strict";
import { planEvents, planIcs } from "../src/lib/ics";
import type { CrewAnswer } from "../src/lib/crew";

/** A 07–17 shift: smoke from 11:00, heat from 13:00, the morning clear. */
function answer(): CrewAnswer {
  const hours = Array.from({ length: 10 }, (_, i) => {
    const h = 7 + i;
    return { time: `2026-10-25T${String(h).padStart(2, "0")}:00`, metrics: { us_aqi_pm25: h >= 11 ? 160 : 60, temp_f: h >= 13 ? 84 : 70 } };
  });
  return {
    place: { name: "Fresno, California", town: "Fresno", state: "California", lat: 36.748, lon: -119.772, approximate: false },
    date: "2026-10-25",
    shift: { start: 7, end: 17 },
    plan: {
      jurisdiction: "us-ca", hours, actions: [], peak_aqi: 160, peak_temp_f: 84,
      confidence: { level: "model-only", fire: null, ground: null, notes: [] },
      bms: { threshold_aqi: 151, recirculate_at: "2026-10-25T11:00", resume_at: null, peak_aqi: 160, reason: "" },
    },
    alerts: [],
    home: { peak_price: { start: 16, end: 21, tariff: "PG&E E-TOU-C" }, precool: { start: 13, end: 16 }, close_windows_at: "2026-10-25T11:00", open_windows_at: null, reason: "" },
    dispatch: { sensor: "standby", bearing_deg: null, distance_km: null, detections_50km: 0, reason: "" },
    wind: [],
    fires_near: [],
  };
}

test("the five events, in time order", () => {
  const ev = planEvents(answer());
  assert.deepEqual(
    ev.map((e) => [e.summary, e.start, e.end]),
    [
      ["Heavy work window 07–11", 7, 11],
      ["N95 from 11:00 (AQI ≥151)", 11, 17],
      ["Heat: shade and water from 13:00", 13, 17],
      ["Pre-cool 13–16", 13, 16],
      ["TOU peak 16–21", 16, 21],
    ],
  );
});

test("a clean day has only the peak price", () => {
  const a = answer();
  for (const h of a.plan.hours) h.metrics = { us_aqi_pm25: 40, temp_f: 70 };
  a.home.precool = null;
  assert.deepEqual(planEvents(a).map((e) => e.summary), ["TOU peak 16–21"]);
});

test("the calendar is RFC 5545: CRLF, VTIMEZONE, local times, folded lines", () => {
  const ics = planIcs(answer(), "https://airsignal.app/crew?place=Fresno", new Date("2026-10-24T20:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 5);
  assert.match(ics, /TZID:America\/Los_Angeles/);
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20261025T110000/);
  assert.match(ics, /DTSTAMP:20261024T200000Z/);
  assert.match(ics, /SUMMARY:N95 from 11:00 \(AQI ≥151\)/);
  assert.match(ics, /SUMMARY:Pre-cool 13–16/);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  assert.doesNotMatch(ics, /[^\r]\n/);
});

test("an event ending at 24 rolls to the next day", () => {
  const a = answer();
  a.home.peak_price = { start: 20, end: 24, tariff: "x" };
  a.home.precool = null;
  const ics = planIcs(a, "u");
  assert.match(ics, /DTEND;TZID=America\/Los_Angeles:20261026T000000/);
});
