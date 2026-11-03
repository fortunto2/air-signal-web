import { test } from "node:test";
import assert from "node:assert/strict";
import { sprayClass, sprayWindows } from "../src/lib/spray";

test("FAO table edges", () => {
  assert.equal(sprayClass(2.9), "calm");
  assert.equal(sprayClass(3), "ideal");
  assert.equal(sprayClass(7), "ideal");
  assert.equal(sprayClass(8), "no-herbicide");
  assert.equal(sprayClass(11), "windy");
});

test("ideal runs become clock windows", () => {
  const h = (hh: number, kmh: number) => ({ time: `2026-11-04T${String(hh).padStart(2, "0")}:00`, kmh });
  assert.deepEqual(sprayWindows([h(7, 1), h(8, 4), h(9, 6), h(10, 12), h(11, 5)]), [
    { from: "08:00", to: "10:00" },
    { from: "11:00", to: "12:00" },
  ]);
  assert.deepEqual(sprayWindows([h(7, 1), h(8, 15)]), []);
});
