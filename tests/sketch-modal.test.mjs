/* U3635: the plan large over the page. No DOM harness here, so this tests the one pure helper both the card and the window send
   with (feedbackOf) and reads anton.js for the wiring: node --test tests/sketch-modal.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feedbackOf, m1 } from "../public/sketchsend.js";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

test("feedbackOf: pins in words with metres to one decimal and a comma, the drawing without pins, plan mode, the plan's size", () => {
  const s = { title: "Ny trapp", size: [1024, 640] }, drawing = { image: "data:x", strokes: [{ colour: "rød", points: [[1, 2, 0]] }], pins: [{ n: 1, at: [12.34, -5.06], note: "flytt hit" }, { n: 2, at: [0, 3], note: "" }] };
  const r = feedbackOf(s, { text: "Lavere", drawing });
  assert.equal(r.text, "Tilbakemelding på skissen «Ny trapp»: Lavere\nNål 1 (øst 12,3, nord -5,1 m): flytt hit\nNål 2 (øst 0, nord 3 m)");
  assert.deepEqual(r.drawing, { image: "data:x", strokes: drawing.strokes, camera: {}, mode: "plan", size: [1024, 640] });
  assert.equal(feedbackOf(s, { text: "", drawing: { ...drawing, pins: [] } }).text, "Tilbakemelding på skissen «Ny trapp».");
  assert.equal(m1(2.25), "2,3");
});

test("anton.js: a live plan opens the large window, one from the thread stays a card, the card can reopen it, and both send through mountSketch", () => {
  const a = read("anton.js");
  assert.match(a, /on\("sketch", async s => \{ if \(await sketchCard\(s\)\) openSketch\(s\); \}\)/);
  assert.match(a, /\.then\(async h => \{ if \(h\) await fetch\("api\/skisser"\)[^\n]*sketchCard\(x\)/, "history only draws the card");
  assert.ok(!/openSketch/.test(a.slice(a.indexOf('fetch("api/skisser")'), a.indexOf("fromHistory();"))));
  assert.match(a, /o\.textContent = "Åpne skissen"; o\.onclick = \(\) => openSketch\(s\)/);
  assert.equal(a.split("createSketch({").length - 1, 1, "one copy of the wiring");
  assert.match(a, /sketchModal\?\.close\(\)/, "a new plan replaces the open one");
  assert.match(a, /closeLabel: "Lukk skissen"/);
});
