import { test } from "node:test";
import assert from "node:assert/strict";
import { parseApp, parseObservation } from "../src/lib/observation";

// What AirKit's ObservationRequest sends (air-signal-ios/AirKit/Sources/AirKit/Observation.swift).
const body = {
  kind: "haze",
  intensity: 3,
  observed_at: "2026-10-25T06:41:00Z",
  snapshot: { hour: "2026-10-24T23:00", aqi: 62, pm25_ugm3: 17.4, wind_dir_deg: 310, wind_kmh: 9, fire: null, monitor: null, extra: "dropped" },
};

test("the app field: crewair by default, airsignal when said, nothing else", () => {
  assert.equal(parseApp(undefined), "crewair");
  assert.equal(parseApp(""), "crewair");
  assert.equal(parseApp("airsignal"), "airsignal");
  assert.equal(parseApp("AirSignal"), "airsignal");
  assert.throws(() => parseApp("weatherapp"), /app must be one of crewair, airsignal/);
});

test("a valid observation comes back whole, the snapshot trimmed to known fields", () => {
  const o = parseObservation(body)!;
  assert.equal(o.kind, "haze");
  assert.equal(o.intensity, 3);
  assert.equal(o.observed_at, "2026-10-25T06:41:00Z");
  assert.deepEqual(Object.keys(o.snapshot!), ["hour", "aqi", "pm25_ugm3", "wind_dir_deg", "wind_kmh", "fire", "monitor"]);
  assert.equal(parseObservation(undefined), null);
  assert.equal(parseObservation(null), null);
});

test("an unknown kind is rejected, and so is any spelling but AirKit's", () => {
  assert.throws(() => parseObservation({ ...body, kind: "fog" }), /observation.kind must be one of/);
  assert.throws(() => parseObservation({ ...body, kind: undefined }), /observation.kind/);
  assert.throws(() => parseObservation({ ...body, kind: "chemical_smell" }), /observation.kind/);
  assert.throws(() => parseObservation({ ...body, kind: "Haze" }), /observation.kind/);
  assert.equal(parseObservation({ ...body, kind: "chemical_odour" })!.kind, "chemical_odour");
});

test("intensity outside 1–5, or not an integer, is rejected", () => {
  for (const bad of [0, 6, 2.5, "x", undefined, -1]) assert.throws(() => parseObservation({ ...body, intensity: bad }), /intensity must be an integer 1–5/);
  assert.equal(parseObservation({ ...body, intensity: "5" })!.intensity, 5);
});

test("observed_at must parse; snapshot must be an object", () => {
  assert.throws(() => parseObservation({ ...body, observed_at: "yesterday" }), /observed_at/);
  assert.equal(parseObservation({ ...body, observed_at: undefined })!.observed_at, null);
  assert.throws(() => parseObservation({ ...body, snapshot: [1, 2] }), /snapshot must be an object/);
  assert.throws(() => parseObservation([body]), /observation must be an object/);
});
