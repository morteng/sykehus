// U3888: the floor strip down the left edge is one control in the view bar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
const html = read("index.html"), app = read("app.js"), css = read("sykehus.css"), tour = read("tour.js");

test("the floor control sits in the view bar, the old strip host is gone", () => {
  const vt = html.slice(html.indexOf('<div class="vt">'), html.indexOf('<div class="nz">'));
  for (const id of ["flr", "floorBtn", "floorUp", "floorDown", "floorPop", "floorTxt"]) assert.ok(vt.includes(`id="${id}"`), id);
  assert.ok(!html.includes('id="levels"'), "no strip host");
  assert.ok(!/#levels/.test(css) && !/\$\("levels"\)/.test(app), "nothing still reads #levels");
});

test("every way to pick a floor moves the button's label", () => {
  assert.ok(!/strip\.set\(/.test(app.replace(/function floorSet[^\n]*/, "")), "strip.set only inside floorSet");
  assert.match(app, /stepStorey\(\/Up\$\/\.test\(e\.key\) \? 1 : -1\)/, "the ↑ ↓ keys use the stepper");
  assert.match(app, /\$\("floorUp"\)\.onclick = \(\) => stepStorey\(1\)/);
  assert.match(tour, /el: "#flr"/, "the guide points at the control");
});
