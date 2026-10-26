/* The plant list is hagekart's, taken by lock (U3659): the copy is the file at the lock's sha, and what sykehus reads of it is whole.
   node --test tests/plants-lock.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blobId, unwrap } from "../tools/take-plants.mjs";
import { PLANTS, searchPlants } from "../public/plants.js";

const lock = JSON.parse(readFileSync(new URL("../hagekart-plants.lock.json", import.meta.url), "utf8"));
const copy = readFileSync(new URL("../public/hagekart-plants.js", import.meta.url), "utf8");

test("the copy is hagekart's plants.json at the locked sha, unedited (git's blob id of the file)", () => {
  assert.match(lock.hagekart, /^[0-9a-f]{40}$/);
  assert.equal(blobId(unwrap(copy)), lock.blob, "an edited copy fails here: take it again (node tools/take-plants.mjs <sha>)");
  assert.ok(copy.includes(lock.hagekart), "the copy names the sha it was taken at");
});

test("what sykehus keeps of the list: ids, names, sizes, the banned ones with their flag, no bulbs", () => {
  assert.ok(PLANTS.length > 30);
  for (const p of PLANTS) { assert.ok(p.id && p.no, JSON.stringify(p)); assert.ok(p.ht > 0 && p.sp > 0, `${p.id} has a size`); assert.ok(!["bulb"].includes(p.cat)); }
  assert.ok(PLANTS.filter(p => p.banned).length >= 3, "the banned species are kept, to be refused with a reason");
  assert.equal(PLANTS.find(p => p.id === "lind").la, "Tilia cordata");
  assert.equal(new Set(PLANTS.map(p => p.id)).size, PLANTS.length, "ids are unique");
  assert.ok(searchPlants("lupin")[0].banned);
});
