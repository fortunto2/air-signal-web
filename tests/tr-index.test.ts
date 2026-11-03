import { test } from "node:test";
import assert from "node:assert/strict";
import { trIndex } from "../src/lib/tr-index";
import { fold, nearestTrPlace, trPlaceByName } from "../src/lib/tr-places";

test("PM10 band edges map to the index edges", () => {
  assert.deepEqual(trIndex(50)?.index, 50);
  assert.equal(trIndex(50)?.label, "İyi");
  assert.equal(trIndex(51)?.label, "Orta");
  assert.equal(trIndex(100)?.index, 100);
  assert.equal(trIndex(260)?.label, "Hassas");
  assert.equal(trIndex(261)?.label, "Sağlıksız");
  assert.equal(trIndex(450)?.label, "Kötü");
  assert.equal(trIndex(900)?.label, "Tehlikeli");
});

test("no PM10, no index: PM2.5 is not part of Turkey's index", () => {
  assert.equal(trIndex(undefined), null);
  assert.equal(trIndex(75)?.index, 75);
});

test("Turkish town names match with or without Turkish letters", () => {
  assert.equal(fold("GAZİPAŞA"), "gazipasa");
  assert.equal(trPlaceByName("Gazipaşa")?.slug, "gazipasa");
  assert.equal(trPlaceByName("kas")?.name, "Kaş");
  assert.equal(trPlaceByName("Alanya, Turkey")?.slug, "alanya");
  assert.equal(trPlaceByName("Alanya, Germany"), undefined);
  assert.equal(trPlaceByName("Fresno"), undefined);
  assert.equal(nearestTrPlace(36.27, 32.31)?.slug, "gazipasa");
  assert.equal(nearestTrPlace(36.75, -119.77), undefined);
});
