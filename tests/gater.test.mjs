import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStreets } from "../gater.mjs";
import { siteBox } from "../public/utm.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const box = siteBox(site).map(v => v.toFixed(6)).join(",");
function call(s, path) {
  const url = new URL(path, "http://x"), out = {};
  const res = { headersSent: false, writeHead(code, h) { out.code = code; out.h = h; return this; }, end(b) { out.body = b?.toString(); } };
  return s.route({ method: "GET" }, res, url.pathname, url).then(hit => ({ hit, ...out }));
}

test("/gater passes the site's own box to hagekart, keeps it, and refuses any other box", async () => {
  const asked = []; let up = true;
  const s = createStreets({ site, upstream: "https://hk.test", fetchImpl: async u => { asked.push(u); if (!up) throw new Error("down"); return new Response(JSON.stringify({ features: [{ id: 1 }] })); } });
  const a = await call(s, `/gater/api/streets?bbox=${box}`);
  assert.equal(a.code, 200); assert.deepEqual(JSON.parse(a.body), { features: [{ id: 1 }] });
  assert.equal(asked[0], `https://hk.test/api/streets?bbox=${box}`);
  up = false; assert.equal((await call(s, `/gater/api/streets?bbox=${box}`)).code, 200); assert.equal(asked.length, 1);   // kept
  assert.equal((await call(s, `/gater/api/nvdb?bbox=${box}`)).code, 502);   // never fetched, hagekart down
  assert.equal((await call(s, "/gater/api/streets?bbox=59,10,60,11")).code, 400);
  assert.equal((await call(s, "/gater/api/other")).hit, false);
});
