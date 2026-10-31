/* U3984: vendor/netkit/ is the kits repo's net kit at the sha in netkit.lock.json: the one public-address check and the
   one table agentkit's Python twin also reads. Each copy is the kit's file, byte for byte (git's blob id is compared with
   the lock, so this runs without the kits repo); new sha: node <kits>/tools/take.mjs <sha> netkit.lock.json.  Run: node --test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { privateAddress } from "../vendor/netkit/public-address.js";

const ROOT = new URL("../", import.meta.url), lock = JSON.parse(readFileSync(new URL("netkit.lock.json", ROOT), "utf8"));
const blob = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const VEC = JSON.parse(readFileSync(new URL("vendor/netkit/public-address.vectors.json", ROOT), "utf8"));

test("each copy is the kit's file at the locked sha", () => {
  assert.equal(lock.kit, "net"); assert.match(lock.kits, /^[0-9a-f]{40}$/);
  for (const [name, want] of Object.entries(lock.files)) assert.equal(blob(readFileSync(new URL(`${lock.dest}/${name}`, ROOT))), want, `${name} is not kits ${lock.kits.slice(0, 7)}'s: take a new sha, never edit the copy`);
});
test("the shared table: every refused form is private, every allowed form is public", () => {
  for (const ip of VEC.refused) assert.equal(privateAddress(ip), true, ip);
  for (const ip of VEC.allowed) assert.equal(privateAddress(ip), false, ip);
  assert.ok(VEC.refused.length >= 22 && VEC.allowed.length >= 4);
});
test("the two call sites use that one check and keep no rule of their own", () => {
  for (const f of ["fetchimport.mjs", "auth.mjs"]) {
    const text = readFileSync(new URL(f, ROOT), "utf8");
    assert.ok(text.includes('from "./vendor/netkit/public-address.js"'), f);
    assert.ok(!/172\\\.\(1\[6-9\]/.test(text) && !/groups6/.test(text), `${f} holds a rule of its own`);
  }
});
