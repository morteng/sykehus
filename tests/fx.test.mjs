import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stampFx, setFx } from "../public/fx.js";

const doc = (cookie = "") => {
  const attrs = new Map();
  return { cookie, written: [], documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k) ?? null }, attrs };
};

test("gulden_fx=off puts data-fx=off on <html>; any other cookie state does not", () => {
  for (const [c, off] of [["gulden_fx=off", true], ["a=1; gulden_fx=off; b=2", true], ["", false], ["gulden_theme=dark", false], ["gulden_fx=on", false]]) {
    const d = doc(c); stampFx(d);
    assert.equal(d.documentElement.getAttribute("data-fx"), off ? "off" : null, c);
  }
});

test("pressing Off writes the cookie with Domain=gulden.no and flips data-fx at once; On deletes it", () => {
  const d = doc(), loc = { hostname: "sykehus.gulden.no", protocol: "https:" };
  let last = ""; Object.defineProperty(d, "cookie", { get: () => (last.startsWith("gulden_fx=off") ? "gulden_fx=off" : ""), set: v => { last = v; } });
  setFx(false, d, loc);
  assert.equal(last, "gulden_fx=off; Path=/; Domain=gulden.no; SameSite=Lax; Secure; Max-Age=31536000");
  assert.equal(d.documentElement.getAttribute("data-fx"), "off");
  setFx(true, d, loc);
  assert.equal(last, "gulden_fx=; Path=/; Domain=gulden.no; SameSite=Lax; Secure; Max-Age=0");
  assert.equal(d.documentElement.getAttribute("data-fx"), null);
});

test("app.js stamps data-fx at load and the person's menu carries the pills", () => {
  assert.match(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), /import \{ stampFx \} from "\.\/fx\.js";\nstampFx\(\);/);
  assert.match(readFileSync(new URL("../public/anton.js", import.meta.url), "utf8"), /append\(fxPills\(\)\)/);
});
