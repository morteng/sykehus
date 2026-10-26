/* U3658: which tour runs for whom, and the «new since last» filter */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tourFor, marks, listFor, steps, VERSION } from "../public/tour.js";

const h = { phone: () => false, tab() { } };

const doc = c => ({ cookie: c });
test("a visitor gets the short tour, once; the × counts as seen (cookie guide_seen), and so does the one mark from before", () => {
  assert.deepEqual(tourFor({ signedIn: false, ...marks(null, doc("")) }), { kind: "gjest", due: true });
  assert.deepEqual(tourFor({ signedIn: false, ...marks(null, doc("a=1; guide_seen=1")) }), { kind: "gjest", due: false });
});

test("signed in: the full tour once, also after the visitor tour; only the new steps when the version seen is older; nothing when current; × never again", () => {
  const t = c => tourFor({ signedIn: true, ...marks(null, doc(c)) });
  assert.deepEqual(t(""), { kind: "full", due: true });
  assert.deepEqual(t("guide_seen=1"), { kind: "full", due: true });            // signed in after the visitor tour: its own key
  assert.deepEqual(t("guide_in=1"), { kind: "nytt", due: true, since: 1 });
  assert.deepEqual(t(`guide_in=${VERSION}`), { kind: "full", due: false });
  assert.deepEqual(t("guide_in=1; guide_x=1"), { kind: "full", due: false });
  assert.deepEqual(t("guide_x=1"), { kind: "full", due: false });
});

test("the person's marks on the server count on another device", () => {
  assert.deepEqual(tourFor({ signedIn: true, ...marks({ seenIn: VERSION, dismissed: false }, doc("")) }), { kind: "full", due: false });
  assert.deepEqual(tourFor({ signedIn: true, ...marks({ seenIn: 0, dismissed: true }, doc("")) }), { kind: "full", due: false });
  assert.deepEqual(tourFor({ signedIn: true, ...marks({ seenIn: 1, dismissed: false }, doc("")) }), { kind: "nytt", due: true, since: 1 });
});

test("the visitor list is short and ends on the way in; the full list holds every step", () => {
  const v = listFor("gjest", h), f = listFor("full", h);
  assert.ok(v.length >= 4 && v.length <= 6, `${v.length}`); assert.equal(v.at(-1).title, "Logg inn");
  assert.ok(!v.some(s => /Anton|Tegn|Forslaget/.test(s.title)), "nothing that needs a login");
  assert.equal(f.length, steps(h).length); assert.ok(f.length > v.length + 8);
  for (const t of ["Slett og angre med tastene", "Sola", "Gjengi", "Bredden på panelet", "Slett lagrede forslag", "Mal", "Samtalen over feltet"]) assert.ok(f.some(s => s.title === t), t);
});

test("the «new since» list is the intro, the steps newer than the version seen, and the end", () => {
  const n = listFor("nytt", h, 1), all = steps(h), newer = all.filter(s => s.since > 1);
  assert.equal(n[0].title, "Nytt siden sist"); assert.equal(n.at(-1).title, "Det var alt");
  assert.deepEqual(n.slice(1, -1).map(s => s.title), newer.map(s => s.title));
  assert.ok(newer.length >= 7); assert.ok(newer.every(s => s.since === VERSION));
  assert.equal(listFor("nytt", h, VERSION).length, 2, "nothing newer than the current version: the intro and the end");
});

import { createGuide } from "../guide.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("the server keeps the person's marks: raised, never taken back, signed out refused", async () => {
  const g = createGuide({ dir: mkdtempSync(join(tmpdir(), "guide-")), readJson: async req => req.body, personOf: req => req.who ? { person: req.who } : null });
  const call = async (method, who, body) => { let code, out; const res = { writeHead: c => { code = c; }, end: b => { out = JSON.parse(b); } }; await g.route({ method, who, body, headers: {} }, res, "/api/guide"); return [code, out]; };
  assert.deepEqual(await call("GET", null), [401, { error: "signed_out" }]);
  assert.deepEqual(await call("GET", "lars"), [200, { seenIn: 0, dismissed: false }]);
  assert.deepEqual(await call("POST", "lars", { seenIn: 2, dismissed: true }), [200, { seenIn: 2, dismissed: true }]);
  assert.deepEqual(await call("POST", "lars", { seenIn: 1, dismissed: false }), [200, { seenIn: 2, dismissed: true }]);
  assert.deepEqual(await call("GET", "anna"), [200, { seenIn: 0, dismissed: false }]);
});
