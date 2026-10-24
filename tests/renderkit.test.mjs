/* U3453: public/renderkit/ is renderkit at the sha in renderkit.lock.json. Each copy is renderkit's file with only its
   import specifiers pointed at this site ('./three.js' -> the lock's "three"); this undoes that one change and compares
   git's blob id with the lock, so it runs without the renderkit repo. Nobody edits a copy: take a new sha with
   node <renderkit>/tools/take.mjs <sha> renderkit.lock.json.   Run: node --test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url), lock = JSON.parse(readFileSync(new URL("renderkit.lock.json", ROOT), "utf8"));
const SPEC = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g;          // the same pattern as renderkit's tools/take.mjs
const [pre, post] = lock.import.split("{}");
const back = text => text.replace(SPEC, (m, a, q, s) => s === lock.three ? `${a}${q}./three.js${q}`
  : s.startsWith(pre) && s.endsWith(post) && s.length > pre.length + post.length ? `${a}${q}./${s.slice(pre.length, s.length - post.length)}${q}` : m);
const blob = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const copy = name => readFileSync(new URL(`${lock.dest}/${lock.file.replace("{}", name)}`, ROOT));
const idOf = name => name.endsWith(".js") ? blob(Buffer.from(back(copy(name).toString("utf8")), "utf8")) : blob(copy(name));

test("each copy is renderkit's file at the locked sha", () => {
  assert.match(lock.renderkit, /^[0-9a-f]{40}$/);
  for (const [name, want] of Object.entries(lock.files)) assert.equal(idOf(name), want, `${name} is not renderkit ${lock.renderkit.slice(0, 7)}'s: take a new sha, never edit the copy`);
});
test("the check sees the import it undoes, and nothing is left over", () => {
  const ez = copy("ez-tree.js").toString("utf8");
  assert.ok(ez.includes(`from "${lock.three}"`) && back(ez).includes('from "./three.js"'));     // the control: there is a rewrite to undo
  assert.deepEqual(readdirSync(new URL(`${lock.dest}/`, ROOT)).sort(), Object.keys(lock.files).map(n => lock.file.replace("{}", n)).sort());
});
