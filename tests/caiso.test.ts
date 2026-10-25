import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hourlyMeans, medianByHour, parseOutlook } from "../src/lib/caiso";

// Real Today's Outlook rows from 24 Oct 2026, 00:00–01:00, plus three demand rows the parser must
// drop: an hour not yet measured, a non-number, and the file's closing "00:00" for the next day.
const co2 = readFileSync(new URL("./fixtures/caiso-co2.csv", import.meta.url), "utf8");
const demand = readFileSync(new URL("./fixtures/caiso-demand.csv", import.meta.url), "utf8");

test("intensity is Σ CO2 t/h ÷ demand MW × 1000, joined on time", () => {
  const rows = parseOutlook(co2, demand);
  assert.equal(rows.length, 13);
  // 00:00: (63 + 83 + 4051 − 5 + 1699 + 7) = 5898 t/h over 21 586 MW
  assert.equal(rows[0]!.time, "00:00");
  assert.equal(Math.round(rows[0]!.g_per_kwh * 10) / 10, 273.2);
  assert.equal(Math.round(rows[1]!.g_per_kwh * 10) / 10, 269.6);
  assert.ok(rows.every((r) => r.g_per_kwh > 200 && r.g_per_kwh < 320));
});

test("rows without a demand figure are dropped, never zero; the first time stamp wins", () => {
  const rows = parseOutlook(co2, demand);
  assert.deepEqual(rows.filter((r) => r.time === "00:00").length, 1);
  assert.ok(!rows.some((r) => r.time === "01:05" || r.time === "01:10"));
  const none = parseOutlook(co2, "Time,Current demand\n00:00,\n");
  assert.deepEqual(none, []);
});

test("hourly means carry their sample count", () => {
  const means = hourlyMeans(parseOutlook(co2, demand));
  assert.deepEqual(
    means.map((m) => [m.hour, m.g_per_kwh, m.samples]),
    [
      [0, 286.0, 12],
      [1, 295.6, 1],
    ],
  );
});

test("the typical hour is the median across days, in whole grams", () => {
  const rows = [
    { day: "a", hour: 13, g_per_kwh: 120.4 },
    { day: "b", hour: 13, g_per_kwh: 410.0 }, // one dirty day does not move the median much
    { day: "c", hour: 13, g_per_kwh: 131.2 },
    { day: "a", hour: 20, g_per_kwh: 300 },
    { day: "b", hour: 20, g_per_kwh: 320 },
  ];
  assert.deepEqual(medianByHour(rows), { "13": 131, "20": 310 });
  assert.deepEqual(medianByHour([]), {});
});
