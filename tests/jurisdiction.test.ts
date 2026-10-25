import { test } from "node:test";
import assert from "node:assert/strict";
import { jurisdictionFor } from "../src/lib/jurisdiction";

test("only California has a rulebook today", () => {
  assert.equal(jurisdictionFor("US", "California"), "US-CA");
  assert.equal(jurisdictionFor("us", "California"), "US-CA");
  assert.equal(jurisdictionFor("US", "Illinois"), null);
  assert.equal(jurisdictionFor("US", "Oregon"), null);
  assert.equal(jurisdictionFor("DE", "State of Berlin"), null);
  assert.equal(jurisdictionFor("US", null), null);
  assert.equal(jurisdictionFor(null, "California"), null);
});
