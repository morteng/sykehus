/* U3646: a part's settings sheet at 390 px: the parameters' grid, the scrolling form with «Ferdig» in sight, the 16 px fields */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8"), js = readFileSync(new URL("../public/float.js", import.meta.url), "utf8");
test("the parameters sit in a grid that fits, not a fixed two columns", () => {
  assert.match(js, /class="fl-params">\$\{bimKeys/);
  assert.match(css, /\.fl-params\s*\{[^}]*auto-fit[^}]*min\(140px, 100%\)/);
});
test("on a phone the form has no 340 px floor, scrolls in the sheet, fields are 16 px", () => {
  const m = css.match(/@media \(max-width: 899px\) \{\s*\.fl-form \{([^}]*)\}\s*\.fl-form input, \.fl-form select \{([^}]*)\}/);
  assert.ok(m, "the phone block");
  assert.match(m[1], /min-width: 0/); assert.match(m[1], /overflow-y: auto/); assert.match(m[1], /max-height: calc\(100dvh/);
  assert.match(m[2], /font-size: 16px/);
});
test("«Ferdig» stays in sight (sticky acts)", () => {
  assert.match(js, /class="fl-acts fl-formacts"/);
  assert.match(css, /\.fl-formacts\s*\{[^}]*position: sticky/);
});
