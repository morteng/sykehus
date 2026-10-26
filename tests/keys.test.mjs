/* U3649: Backspace/Delete, Cmd/Ctrl-Z and the redo (public/keys.js) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyAct, createKeys } from "../public/keys.js";

const ev = (key, o = {}) => ({ key, target: { tagName: "CANVAS" }, preventDefault() { this.stopped = true; }, ...o });

test("keyAct: the keys and the text fields", () => {
  assert.equal(keyAct(ev("Backspace")), "delete");
  assert.equal(keyAct(ev("Delete")), "delete");
  assert.equal(keyAct(ev("z", { metaKey: true })), "undo");
  assert.equal(keyAct(ev("z", { ctrlKey: true })), "undo");
  assert.equal(keyAct(ev("Z", { metaKey: true, shiftKey: true })), "redo");
  assert.equal(keyAct(ev("z", { ctrlKey: true, shiftKey: true })), "redo");
  assert.equal(keyAct(ev("y", { ctrlKey: true })), "redo");
  assert.equal(keyAct(ev("y", { metaKey: true })), null);
  assert.equal(keyAct(ev("Backspace", { metaKey: true })), null);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(keyAct(ev("z", { ctrlKey: true, target: { tagName } })), null, tagName);
  assert.equal(keyAct(ev("Backspace", { target: { tagName: "DIV", isContentEditable: true } })), null);
  assert.equal(keyAct(ev("Backspace", { altKey: true })), null);
});

/* the page's own deps, as the real ones are called: undo(n, expect) goes to api/endring as { undo: n, expect }, put(edit) as { edits: [edit] } */
function rig(initial, hasCard = true) {
  const draft = initial.slice(), sent = [], said = [], redoSent = [];
  const k = createKeys({
    edits: () => draft,
    undo: async (n, expect) => { sent.push({ undo: n, expect }); assert.deepEqual(draft[n - 1], expect); draft.splice(n - 1, 1); return true; },
    put: async e => { redoSent.push({ edits: [e] }); draft.push(e); return true; },
    say: t => said.push(t), name: e => e.building || e.text, riv: () => hasCard,
  });
  return { k, draft, sent, said, redoSent };
}
const settle = () => new Promise(r => setTimeout(r, 0));
const a = { kind: "demolish", building: "A" }, b = { kind: "demolish", building: "B" };

test("Cmd-Z takes the newest change out by its number and itself; Shift-Cmd-Z puts that same change back", async () => {
  const r = rig([a, b]);
  const e1 = ev("z", { metaKey: true }); assert.ok(r.k.key(e1)); assert.equal(e1.stopped, true); await settle();
  assert.deepEqual(r.sent, [{ undo: 2, expect: b }]); assert.deepEqual(r.said, ["Angret: B"]);
  const e2 = ev("z", { metaKey: true, shiftKey: true }); assert.ok(r.k.key(e2)); await settle();
  assert.deepEqual(r.redoSent, [{ edits: [b] }]); assert.deepEqual(r.draft, [a, b]); assert.equal(r.said[1], "Gjort igjen: B");
  assert.equal(r.redoSent[0].edits[0], b, "the edit object itself");
});

test("two undos, two redos, newest first; a third redo does nothing", async () => {
  const r = rig([a, b]);
  await r.k.run("undo"); await r.k.run("undo"); assert.deepEqual(r.draft, []);
  await r.k.run("redo"); await r.k.run("redo"); assert.deepEqual(r.draft, [a, b]);   // the oldest edit first, so the order is as it was
  assert.equal(await r.k.run("redo"), false);
});

test("a new change, or a page shown again, clears the redo; undo with no changes does nothing", async () => {
  const r = rig([a]);
  await r.k.run("undo"); assert.equal(r.k.redo.length, 1); r.k.clear();
  assert.equal(await r.k.run("redo"), false); assert.deepEqual(r.redoSent, []);
  assert.equal(await r.k.run("undo"), false); assert.deepEqual(r.sent.length, 1);
});

test("a failed undo is not kept for redo; the toast's Angre feeds the redo", async () => {
  const draft = [a], said = [];
  const k = createKeys({ edits: () => draft, undo: async () => false, put: async () => true, say: t => said.push(t), name: e => e.building, riv: () => true });
  await k.run("undo"); assert.equal(k.redo.length, 0); assert.deepEqual(said, []);
  k.taken(a); assert.equal(await k.run("redo"), true); assert.deepEqual(said, ["Gjort igjen: A"]);
});

test("Backspace calls the card's act and stops the default; with nothing picked it does nothing", () => {
  const yes = rig([], true), no = rig([], false);
  const e1 = ev("Backspace"); assert.ok(yes.k.key(e1)); assert.equal(e1.stopped, true);
  const e2 = ev("Delete"); assert.equal(no.k.key(e2), false); assert.equal(e2.stopped, undefined);
});

test("the draft fetched again after one's own undo keeps the redo; one that another tab changed empties it (live drive 2026-10-26)", async () => {
  const r = rig([a, b]);
  r.k.key(ev("z", { metaKey: true })); await settle();
  r.k.echo(r.draft.slice()); assert.equal(r.k.redo.length, 1, "the echo of our own undo");
  r.k.echo([a, { kind: "demolish", building: "C" }]); assert.equal(r.k.redo.length, 0, "another change to it");
  r.k.key(ev("Z", { metaKey: true, shiftKey: true })); await settle(); assert.deepEqual(r.redoSent, [], "nothing to put back now");
});
