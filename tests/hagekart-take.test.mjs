/* hagekart's shared logic, taken by lock (U3820, U3822, U3824): every copy is the file at the lock's sha, unedited.
   node --test tests/hagekart-take.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blobId, original, FILES } from "../tools/take-hagekart.mjs";

const lock = JSON.parse(readFileSync(new URL("../hagekart.lock.json", import.meta.url), "utf8"));

test("each copy is hagekart's file at the locked sha with only the render-kit import pointed (git's blob id)", () => {
  assert.match(lock.hagekart, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(lock.files).sort(), [...FILES].sort());
  for (const [f, blob] of Object.entries(lock.files)) {
    const copy = readFileSync(new URL(`../public/hagekart/${f}`, import.meta.url), "utf8");
    assert.equal(blobId(original(copy)), blob, `${f} was edited: take it again (node tools/take-hagekart.mjs <sha>)`);
  }
});

test("the copies import nothing outside sykehus's own files", () => {
  for (const f of FILES) {
    const copy = readFileSync(new URL(`../public/hagekart/${f}`, import.meta.url), "utf8");
    for (const m of copy.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) assert.ok(m[2].startsWith("./") || m[2] === "../renderkit/paths2d.js", `${f}: ${m[2]}`);
  }
});
