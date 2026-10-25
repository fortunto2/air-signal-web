import { test } from "node:test";
import assert from "node:assert/strict";
import { PACIFIC, localDay, localHour, localHourNumber, shiftDay, utcOffsetMinutes, zonedToUtc } from "../src/lib/tz";

test("Pacific wall clock, as the crew plan has always read it", () => {
  // 06:30Z on 25 Oct is 23:30 PDT on the 24th.
  assert.equal(localDay(new Date("2026-10-25T06:30:00Z"), PACIFIC), "2026-10-24");
  assert.equal(localHour("2026-10-25T06:30:00Z", PACIFIC), "2026-10-24T23:00");
  assert.equal(localHourNumber(new Date("2026-10-25T06:30:00Z"), PACIFIC), 23);
  assert.equal(localHour("2026-10-25T07:00:00Z", PACIFIC), "2026-10-25T00:00");
  assert.equal(utcOffsetMinutes(new Date("2026-10-25T12:00:00Z"), PACIFIC), -420);
  assert.equal(utcOffsetMinutes(new Date("2026-11-02T12:00:00Z"), PACIFIC), -480);
});

test("a wall-clock hour in a zone to its instant, across the DST change", () => {
  assert.equal(zonedToUtc("2026-10-25", 7, PACIFIC).toISOString(), "2026-10-25T14:00:00.000Z"); // PDT
  assert.equal(zonedToUtc("2026-11-02", 7, PACIFIC).toISOString(), "2026-11-02T15:00:00.000Z"); // PST
  assert.equal(zonedToUtc("2026-10-25", 24, PACIFIC).toISOString(), "2026-10-26T07:00:00.000Z"); // next midnight
  // Europe left summer time at 03:00 on 25 Oct 2026: 07:00 Berlin is CET.
  assert.equal(zonedToUtc("2026-10-25", 7, "Europe/Berlin").toISOString(), "2026-10-25T06:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-24", 7, "Europe/Berlin").toISOString(), "2026-10-24T05:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-25", 7, "UTC").toISOString(), "2026-10-25T07:00:00.000Z");
});

test("other zones read their own clock", () => {
  assert.equal(localHour("2026-10-25T06:30:00Z", "Europe/Berlin"), "2026-10-25T07:00");
  assert.equal(localDay(new Date("2026-10-25T06:30:00Z"), "Asia/Tokyo"), "2026-10-25");
  assert.equal(localHour("2026-10-25T16:30:00Z", "Asia/Tokyo"), "2026-10-26T01:00");
});

test("day arithmetic", () => {
  assert.equal(shiftDay("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
});
