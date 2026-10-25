import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceAt } from "../src/lib/evidence";
import type { CrewAnswer } from "../src/lib/crew";

function answer(): CrewAnswer {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    time: `2026-10-25T${String(h).padStart(2, "0")}:00`,
    metrics: { us_aqi_pm25: 40 + h, pm25_nowcast_ugm3: 9 + h / 10, temp_f: 60 + h },
  }));
  return {
    place: { name: "Fresno, California", town: "Fresno", state: "California", country: "US", tz: "America/Los_Angeles", lat: 36.75, lon: -119.77, approximate: true },
    date: "2026-10-25",
    shift: { start: 0, end: 24 },
    plan: {
      jurisdiction: "US-CA", hours, actions: [], peak_aqi: 63, peak_temp_f: 83,
      confidence: { level: "model-adjusted", fire: { nearest_km: 9.4, direction: "NW", bearing_deg: 333, within_50km: 4 }, ground: null, notes: [] },
      bms: { threshold_aqi: 151, recirculate_at: null, resume_at: null, peak_aqi: 63, reason: "" },
    },
    alerts: [],
    home: null,
    dispatch: { sensor: "launch", reading_advised: true, bearing_deg: 333, distance_km: 9.4, detections_50km: 4, reason: "" },
    wind: hours.map((h, i) => ({ time: h.time, dir_deg: 100 + i, kmh: 5 })),
    fires_near: [],
    grid_co2: null,
  };
}

test("the evidence is for the asked hour: that hour's metrics and wind, the plan's checks", () => {
  const e = evidenceAt(answer(), "2026-10-25T06:00");
  assert.equal(e.hour, "2026-10-25T06:00");
  assert.deepEqual(e.metrics, { us_aqi_pm25: 46, pm25_nowcast_ugm3: 9.6, temp_f: 66 });
  assert.deepEqual(e.wind, { dir_deg: 106, kmh: 5 });
  assert.equal(e.confidence, "model-adjusted");
  assert.equal(e.fire?.nearest_km, 9.4);
  assert.equal(e.place.tz, "America/Los_Angeles");
});

test("an hour the plan does not cover gives absent metrics and wind, never zero", () => {
  const e = evidenceAt(answer(), "2026-10-26T06:00");
  assert.equal(e.metrics, null);
  assert.equal(e.wind, null);
  assert.equal(e.fire?.nearest_km, 9.4);
});
