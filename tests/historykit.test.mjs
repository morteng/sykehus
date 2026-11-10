/* U6448: the fasade editor's undo stack is the kit's (public/kit/history.js, pinned by historykit.lock.json).
   node --test tests/historykit.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createHistory } from "../public/kit/history.js";

const here = p => new URL(p, import.meta.url);

test("push, push, undo returns to the first snapshot; redo goes forward", () => {
  let doc = "a"; const h = createHistory(50);
  const edit = to => { const from = doc; doc = to; h.record("x", () => { doc = from; }, () => { doc = to; }); };
  edit("b"); edit("c");
  h.undo(); assert.equal(doc, "b");
  h.undo(); assert.equal(doc, "a");
  assert.equal(h.canUndo(), false);
  h.redo(); assert.equal(doc, "b");
});

test("the copy is the file the lock names (blob id)", () => {
  const lock = JSON.parse(readFileSync(here("../historykit.lock.json"), "utf8"));
  assert.equal(lock.kit, "history");
  for (const [name, id] of Object.entries(lock.files)) {
    const buf = readFileSync(here(`../${lock.dest}/${name}`));
    const got = createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
    assert.equal(got, id, name);
  }
});

test("fasade-view uses the kit's stack", () => {
  const s = readFileSync(here("../public/fasade-view.js"), "utf8");
  assert.match(s, /createHistory\(50\)/);
  assert.doesNotMatch(s, /hist\.pop\(\)/);
});
