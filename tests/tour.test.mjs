/* U3658: which tour runs for whom, and the «new since last» filter */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tourFor, listFor, steps, VERSION } from "../public/tour.js";

const h = { phone: () => false, tab() { } };

test("a visitor gets the short tour, once; a visitor who has seen it is not asked again", () => {
  assert.deepEqual(tourFor({ signedIn: false }), { kind: "gjest", due: true });
  assert.deepEqual(tourFor({ signedIn: false, seen: "gjest" }), { kind: "gjest", due: false });
  assert.deepEqual(tourFor({ signedIn: false, seen: "sett" }), { kind: "gjest", due: false });
});

test("signed in: the full tour once, also after the visitor tour; only the new steps when the version seen is older; nothing when current", () => {
  assert.deepEqual(tourFor({ signedIn: true }), { kind: "full", due: true });
  assert.deepEqual(tourFor({ signedIn: true, seen: "gjest" }), { kind: "full", due: true });            // signed in after the visitor tour
  assert.deepEqual(tourFor({ signedIn: true, seen: "sett" }), { kind: "nytt", due: true, since: 1 });    // the one tour there was before: version 1
  assert.deepEqual(tourFor({ signedIn: true, seen: "sett", seenIn: "1" }), { kind: "nytt", due: true, since: 1 });
  assert.deepEqual(tourFor({ signedIn: true, seen: "sett", seenIn: String(VERSION) }), { kind: "full", due: false });
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
