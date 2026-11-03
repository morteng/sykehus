/* U3822: hagekart's history.js (one undo and redo) and merge.js (a plan changed on two devices), taken by lock, run here.
   node --test tests/hagekart-history-merge.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../public/hagekart/history.js";
import { mergeDocs } from "../public/hagekart/merge.js";

test("history: undo and redo walk one stack; a new edit ends the redo; undoEntry only takes the newest", () => {
  H.clear(); let v = 0, seen = 0; const off = H.onChange(() => seen++);
  const e1 = H.record("én", () => { v -= 1; }, () => { v += 1; }); v += 1;
  const e2 = H.record("to", () => { v -= 10; }, () => { v += 10; }); v += 10;
  assert.deepEqual(H.labels(), ["én", "to"]); assert.equal(H.undoEntry(e1), null, "e1 is not the newest"); assert.equal(v, 11);
  H.undo(); assert.equal(v, 1); assert.ok(H.canRedo()); H.redo(); assert.equal(v, 11);
  H.undo(); H.record("tre", () => {}, () => {}); assert.equal(H.canRedo(), false);
  assert.ok(seen >= 5); off(); H.clear(); assert.equal(H.canUndo(), false); assert.equal(H.undo(), null); assert.equal(e2.label, "to");
});

test("merge: a thing changed on one device wins; changed on both, this device wins; a thing added on the other side is kept", () => {
  const base = { name: "A", areas: [{ id: "a1", kind: "lawn" }, { id: "a2", kind: "bed" }] };
  const local = { name: "A", areas: [{ id: "a1", kind: "paving" }, { id: "a2", kind: "bed" }] };           // the desktop changed a1
  const server = { name: "B", areas: [{ id: "a1", kind: "lawn" }, { id: "a2", kind: "bed" }, { id: "a3", kind: "lawn" }] };   // the iPad renamed and added a3
  const m = mergeDocs(base, local, server);
  assert.equal(m.name, "B"); assert.deepEqual(m.areas.map(a => [a.id, a.kind]).sort(), [["a1", "paving"], ["a2", "bed"], ["a3", "lawn"]]);
  const both = mergeDocs(base, { name: "L" }, { name: "S" }); assert.equal(both.name, "L");
});
