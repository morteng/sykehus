import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/* Fab's laser.css and cardshell.css are taken as-is (public/fab/ORIGIN.txt): a copy that changes here is a fork */
test("Fab's files are the ones ORIGIN.txt names, byte for byte", () => {
  const origin = readFileSync(new URL("../public/fab/ORIGIN.txt", import.meta.url), "utf8");
  for (const [, name, sha] of origin.matchAll(/web\/(\S+)\s+sha256 ([0-9a-f]{64})/g)) {
    const got = createHash("sha256").update(readFileSync(new URL(`../public/fab/${name}`, import.meta.url))).digest("hex");
    assert.equal(got, sha, name);
  }
  assert.ok(/laser\.css/.test(origin) && /cardshell\.css/.test(origin));
});
