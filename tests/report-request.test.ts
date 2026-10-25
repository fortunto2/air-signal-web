import { test } from "node:test";
import assert from "node:assert/strict";
import { parseObservationRequest } from "../src/lib/observation";

const now = new Date("2026-10-25T14:00:00Z");
const body = {
  lat: 36.748123,
  lon: -119.772456,
  observation: { kind: "smoke_smell", intensity: 4, observed_at: "2026-10-25T13:42:30Z" },
  sky: { smoke_score: 0.8123 },
  snapshot: { hour: "2026-10-25T06:00", aqi: 120, wind_dir_deg: 300, wind_kmh: 9, ignored: true },
};

test("a good body: the point rounded to two decimals, the minute kept, the snapshot trimmed", () => {
  const r = parseObservationRequest(body, now);
  assert.equal(r.lat, 36.75);
  assert.equal(r.lon, -119.77);
  assert.equal(r.observation.kind, "smoke_smell");
  assert.equal(r.observation.intensity, 4);
  assert.equal(r.observation.observed_at, "2026-10-25T13:42:00Z");
  assert.equal(r.sky_smoke, 0.812);
  assert.deepEqual(Object.keys(r.observation.snapshot!), ["hour", "aqi", "wind_dir_deg", "wind_kmh"]);
});

test("observed_at defaults to now; sky and snapshot are optional", () => {
  const r = parseObservationRequest({ lat: 1, lon: 2, observation: { kind: "clear", intensity: 1 } }, now);
  assert.equal(r.observation.observed_at, "2026-10-25T14:00:00Z");
  assert.equal(r.sky_smoke, null);
  assert.equal(r.observation.snapshot, null);
});

test("bad coordinates are named", () => {
  assert.throws(() => parseObservationRequest({ ...body, lat: 91 }, now), /lat must be a number between -90 and 90/);
  assert.throws(() => parseObservationRequest({ ...body, lon: "x" }, now), /lon must be a number/);
  assert.throws(() => parseObservationRequest({ ...body, lat: undefined }, now), /lat must be/);
});

test("the observation is required and validated as before", () => {
  assert.throws(() => parseObservationRequest({ lat: 1, lon: 2 }, now), /observation required/);
  assert.throws(() => parseObservationRequest({ ...body, observation: { kind: "fog", intensity: 2 } }, now), /observation.kind must be one of/);
  assert.throws(() => parseObservationRequest({ ...body, observation: { kind: "haze", intensity: 7 } }, now), /intensity must be an integer 1–5/);
});

test("a time in the future or more than 36 hours old is refused", () => {
  assert.throws(() => parseObservationRequest({ ...body, observation: { ...body.observation, observed_at: "2026-10-25T15:00:00Z" } }, now), /in the future/);
  assert.throws(() => parseObservationRequest({ ...body, observation: { ...body.observation, observed_at: "2026-10-23T12:00:00Z" } }, now), /more than 36 hours old/);
  assert.ok(parseObservationRequest({ ...body, observation: { ...body.observation, observed_at: "2026-10-24T12:00:00Z" } }, now));
});

test("the sky score must be 0–1; `smoke` is read as a fallback name", () => {
  assert.throws(() => parseObservationRequest({ ...body, sky: { smoke_score: 1.5 } }, now), /sky.smoke_score must be a number 0–1/);
  assert.throws(() => parseObservationRequest({ ...body, sky: "yes" }, now), /sky must be an object/);
  assert.equal(parseObservationRequest({ ...body, sky: { smoke: 0.25 } }, now).sky_smoke, 0.25);
});

test("not an object", () => {
  assert.throws(() => parseObservationRequest([1], now), /body must be a JSON object/);
  assert.throws(() => parseObservationRequest(null, now), /body must be a JSON object/);
});
