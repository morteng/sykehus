// U3646: the part's settings sheet has no 340 px floor at phone width, scrolls inside the sheet, keeps «Ferdig» in reach.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8");
const tail = css.slice(css.indexOf("U3646"));
test("form drops its floor and its grids fit", () => {
  assert.match(tail, /\.fl-form \{ min-width: 0;/);
  assert.match(tail, /\.fl-three \{?|\.fl-two, \.fl-three \{ grid-template-columns: repeat\(auto-fit/);
});
test("at 599px: scroll inside, 16px fields, sticky acts", () => {
  assert.match(tail, /max-width: 599px/);
  assert.match(tail, /max-height: calc\(100dvh - 180px\); overflow-y: auto/);
  assert.match(tail, /font-size: 16px/);
  assert.match(tail, /position: sticky; bottom: 0/);
});
test("assets are cache-busted", () => {
  assert.match(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), /sykehus\.css\?v=20261103part/);
  assert.match(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), /float\.js\?v=20261103part/);
});
