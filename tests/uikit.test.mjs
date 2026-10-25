import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/* the kit's files (uikit.lock.json, taken by kits tools/take.mjs): each copy is the kit's file at the lock's sha, by
   git's blob id; none of them imports anything, so a copy is the file itself */
test("public/kit holds the kit's files at the lock's sha", () => {
  const lock = JSON.parse(readFileSync(new URL("../uikit.lock.json", import.meta.url), "utf8"));
  assert.ok(Object.keys(lock.files).length >= 4);
  for (const [name, id] of Object.entries(lock.files)) {
    const buf = readFileSync(new URL(`../${lock.dest}/${name}`, import.meta.url));
    assert.equal(createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex"), id, name);
  }
});
