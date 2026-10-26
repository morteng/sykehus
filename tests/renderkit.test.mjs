/* U3453, U3814: public/renderkit/ is the kits repo's render kit at the sha in renderkit.lock.json. Each copy is the kit's file
   with only its import specifiers pointed at this site (the lock's "map": './three.js' -> this site's three); this undoes
   that one change and compares git's blob id with the lock, so it runs without the kits repo. Nobody edits a copy: take a
   new sha with node <kits>/tools/take.mjs <sha> renderkit.lock.json.   Run: node --test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url), lock = JSON.parse(readFileSync(new URL("renderkit.lock.json", ROOT), "utf8"));
const THREE = lock.map["./three.js"], SPEC = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g;          // the same pattern as kits' tools/take.mjs
const [pre, post] = lock.import.split("{}");
const back = text => text.replace(SPEC, (m, a, q, s) => s === THREE ? `${a}${q}./three.js${q}`
  : s.startsWith(pre) && s.endsWith(post) && s.length > pre.length + post.length ? `${a}${q}./${s.slice(pre.length, s.length - post.length)}${q}` : m);
const blob = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const copy = name => readFileSync(new URL(`${lock.dest}/${lock.file.replace("{}", name)}`, ROOT));
const idOf = name => name.endsWith(".js") ? blob(Buffer.from(back(copy(name).toString("utf8")), "utf8")) : blob(copy(name));

test("each copy is the kit's file at the locked sha", () => {
  assert.equal(lock.kit, "render"); assert.match(lock.kits, /^[0-9a-f]{40}$/);
  for (const [name, want] of Object.entries(lock.files)) assert.equal(idOf(name), want, `${name} is not kits ${lock.kits.slice(0, 7)}'s: take a new sha, never edit the copy`);
});
test("the check sees the import it undoes, and nothing is left over", () => {
  const ez = copy("ez-tree.js").toString("utf8");
  assert.ok(ez.includes(`from "${THREE}"`) && back(ez).includes('from "./three.js"'));     // the control: there is a rewrite to undo
  assert.deepEqual(readdirSync(new URL(`${lock.dest}/`, ROOT)).sort(), Object.keys(lock.files).map(n => lock.file.replace("{}", n)).sort());
});
