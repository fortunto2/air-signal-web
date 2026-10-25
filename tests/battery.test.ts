import { test } from "node:test";
import assert from "node:assert/strict";
import { backupHours, backupSizing } from "../src/lib/battery";

const home = { peak_price: { start: 16, end: 21, tariff: "PG&E E-TOU-C" }, precool: null, close_windows_at: null, open_windows_at: null, reason: "" };

test("the peak price window sizes the default: 5 h", () => {
  const { hours, basis } = backupHours(home, []);
  assert.equal(hours, 5);
  assert.match(basis, /16:00–21:00/);
});

test("a longer alert window wins, capped at a day", () => {
  const red = { event: "Red Flag Warning", onset: "2026-10-25T10:00:00-07:00", ends: "2026-10-25T22:00:00-07:00" };
  assert.deepEqual(backupHours(home, [red]), { hours: 12, basis: "the Red Flag Warning window" });
  const long = { ...red, ends: "2026-10-27T22:00:00-07:00" };
  assert.equal(backupHours(home, [long]).hours, 24);
  const short = { ...red, ends: "2026-10-25T12:00:00-07:00" };
  assert.equal(backupHours(home, [short]).hours, 5);
  assert.equal(backupHours(home, [{ event: "Heat Advisory", onset: null, ends: null }]).hours, 5);
});

test("never under four hours", () => {
  assert.equal(backupHours({ ...home, peak_price: { start: 17, end: 20, tariff: "x" } }, []).hours, 4);
});

test("kWh is watts × hours × 1.2, rounded up to 0.1", () => {
  const rows = backupSizing(5);
  assert.deepEqual(
    rows.map((r) => [r.name, r.kwh]),
    [
      ["Fridge", 0.9], // 150 × 5 = 750 Wh × 1.2 = 900 Wh
      ["CPAP", 0.3], // 240 Wh → 0.24 → up to 0.3
      ["Phone and router", 0.2], // 120 Wh → 0.12 → up to 0.2
    ],
  );
  assert.equal(backupSizing(10)[0]!.kwh, 1.8);
  assert.ok(rows.every((r) => r.hours === 5));
});
