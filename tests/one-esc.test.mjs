// U3986. One escaper: the kit's esc() (public/kit/html.js, & < > " '). No page defines its own.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { esc } from "../public/kit/html.js";

test("the kit esc escapes the single quote", () => {
  assert.equal(esc(`a&b<c>"d'e`), "a&amp;b&lt;c&gt;&quot;d&#x27;e");
});

test("no page script carries its own replace-chain escaper", () => {
  const bad = readdirSync("public").filter(f => f.endsWith(".js")).filter(f => {
    const s = readFileSync(`public/${f}`, "utf8");
    return /const esc = s => String\(/.test(s) || /\.replace\(\/&\/g, "&amp;"\)/.test(s);
  });
  assert.deepEqual(bad, []);
});
