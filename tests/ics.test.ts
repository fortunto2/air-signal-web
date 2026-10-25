import { test } from "node:test";
import assert from "node:assert/strict";
import { planEvents, planIcs } from "../src/lib/ics";
import type { CrewAnswer } from "../src/lib/crew";

/** A 07–17 Fresno shift as the engine answers it: smoke from 11:00, heat from 13:00, the morning clear. */
function answer(): CrewAnswer {
  const hours = Array.from({ length: 10 }, (_, i) => {
    const h = 7 + i;
    return { time: `2026-10-25T${String(h).padStart(2, "0")}:00`, metrics: { us_aqi_pm25: h >= 11 ? 160 : 60, temp_f: h >= 13 ? 84 : 70 } };
  });
  return {
    place: { name: "Fresno, California", town: "Fresno", state: "California", country: "US", tz: "America/Los_Angeles", lat: 36.748, lon: -119.772, approximate: false },
    date: "2026-10-25",
    shift: { start: 7, end: 17 },
    plan: {
      jurisdiction: "US-CA", hours, peak_aqi: 160, peak_temp_f: 84,
      actions: [
        { time: "2026-10-25T07:00", rule: "plan", cite: "", text: "Heavy work in clear hours: 07:00–10:00" },
        { time: "2026-10-25T11:00", rule: "smoke-n95", cite: "Cal/OSHA T8 §5141.1, App. A", text: "AQI 160: hand out N95s, tell the crew, cut exposure" },
        { time: "2026-10-25T13:00", rule: "heat-shade", cite: "Cal/OSHA T8 §3395", text: "84°F: shade up, water at hand" },
      ],
      confidence: { level: "model-only", fire: null, ground: null, notes: [] },
      bms: { threshold_aqi: 151, recirculate_at: "2026-10-25T11:00", resume_at: null, peak_aqi: 160, reason: "" },
    },
    alerts: [],
    home: { peak_price: { start: 16, end: 21, tariff: "PG&E E-TOU-C" }, precool: { start: 13, end: 16 }, close_windows_at: "2026-10-25T11:00", open_windows_at: null, reason: "" },
    dispatch: { sensor: "standby", reading_advised: false, bearing_deg: null, distance_km: null, detections_50km: 0, reason: "" },
    wind: [],
    fires_near: [],
    grid_co2: null,
  };
}

test("the engine's actions become events, the clear window from its own text", () => {
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
  assert.equal(ev[1]!.description, "AQI 160: hand out N95s, tell the crew, cut exposure. Cal/OSHA T8 §5141.1, App. A");
});

test("a clean day has only the peak price; no home signal, no events at all", () => {
  const a = answer();
  a.plan.actions = [];
  a.home!.precool = null;
  assert.deepEqual(planEvents(a).map((e) => e.summary), ["TOU peak 16–21"]);
  a.home = null;
  assert.deepEqual(planEvents(a), []);
});

test("an unknown rule id still gets an event, named from its text", () => {
  const a = answer();
  a.plan.actions = [{ time: "2026-10-25T09:00", rule: "dust-mask", cite: "Local", text: "Dust: masks on" }];
  assert.deepEqual(planEvents(a).map((e) => e.summary)[0], "Dust: masks on from 09:00");
});

test("the calendar is RFC 5545: CRLF, UTC instants from the place's zone, folded lines", () => {
  const ics = planIcs(answer(), "https://airsignal.app/crew?place=Fresno", new Date("2026-10-24T20:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 5);
  assert.match(ics, /X-WR-TIMEZONE:America\/Los_Angeles/);
  assert.match(ics, /DTSTART:20261025T180000Z/); // 11:00 PDT
  assert.match(ics, /DTEND:20261026T040000Z/); // 21:00 PDT
  assert.match(ics, /DTSTAMP:20261024T200000Z/);
  assert.match(ics, /SUMMARY:N95 from 11:00 \(AQI ≥151\)/);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  assert.doesNotMatch(ics, /[^\r]\n/);
});

test("another zone: Berlin's 07:00 is 06:00Z on 25 Oct 2026", () => {
  const a = answer();
  a.place = { ...a.place, name: "Berlin", town: "Berlin", state: "Berlin", country: "DE", tz: "Europe/Berlin" };
  a.home = null;
  a.plan.actions = [{ time: "2026-10-25T07:00", rule: "heat-shade", cite: "", text: "x" }];
  assert.match(planIcs(a, "u"), /DTSTART:20261025T060000Z/);
});
