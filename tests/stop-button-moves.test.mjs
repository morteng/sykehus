/* U4292 (rest of U3564): while Anton works the stop button has a moving ring (still under reduced motion) and the line
   under the text says the step in plain words. node --test tests/stop-button-moves.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8");

test("the stop button carries the working class and the ring moves, standing still under reduced motion", () => {
  assert.match(js, /"is-stop", "stop", "working"/);
  assert.match(css, /\.g-anton \.g-pill__go\.stop\.working::after \{[^}]*animation: anton-works/);
  assert.match(css, /@keyframes anton-works/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.g-anton \.g-pill__go\.stop\.working::after \{ animation: none/);
});

test("the step line is plain Norwegian from the tool, with a fallback and the time after 10 s", () => {
  assert.match(js, /try_change: "Prøver endringen"/);
  assert.match(js, /\|\| "Arbeider"/);
  assert.match(js, /step \|\| "Anton tenker"/);
  assert.match(js, /s >= 10/);
});
