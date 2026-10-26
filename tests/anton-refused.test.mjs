/* U3668: a 401 from Anton (a device gulden-ai does not know or has revoked) never signs a person out of sykehus or reloads
   the page: it says Anton cannot answer and the page stays signed in. node --test tests/anton-refused.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
const fn = /function signedOut\(\) \{.*\}\n/.exec(src)?.[0];

test("signedOut says one line, calls no logg-ut and no reload, whatever the login came through", () => {
  assert.ok(fn, "signedOut is found in anton.js (if it moved, teach this test where)");
  for (const via of ["kode", "gulden.no"]) {
    const calls = [], lines = []; let gone = false;
    const json = u => { calls.push(u); return Promise.resolve({ ok: true }); }, line = (k, t) => lines.push([k, t]), me = { via };
    const location = { reload: () => calls.push("RELOAD") }, setTimeout = () => 0;
    new Function("json", "line", "me", "location", "setTimeout", "let gone = false;\n" + fn + "\nsignedOut(); signedOut();")(json, line, me, location, setTimeout);
    assert.deepEqual(calls, [], `no api/logg-ut and no reload (via ${via})`);
    assert.deepEqual(lines, [["err", "Anton kan ikke svare akkurat nå. Prøv igjen senere."]], "one line, said once");
  }
});
test("every 401 path of the page goes through it, and no other code in anton.js logs out but the person's own button", () => {
  assert.match(src, /r\.status === 401 \? signedOut\(\)/); assert.match(src, /r\?\.status === 401\) \{ signedOut\(\)/); assert.match(src, /on\("signed_out", signedOut\)/);
  assert.equal([...src.matchAll(/api\/logg-ut/g)].length, 1, "only «Logg ut» (meOut) calls it");
  assert.match(src, /\$\("meOut"\)\.onclick = async \(\) => \{ await json\("api\/logg-ut"\)/);
});
