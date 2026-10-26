/* «Nytt forslag» (U3667): the first turn Anton is given (against the real firstTurn), the name typed in the dialog reaching a real
   version through /api/endring, and an empty version left a week going to the trash at the sweep. No model is called.
   node --test tests/new-proposal.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { firstTurn, CARDS } from "../public/nytt-forslag.js";
import { createVersions, EMPTY_DAYS } from "../versions.mjs";

test("first turn: choices in plain words, how to begin, zoning early; no name asks Anton to name it", () => {
  const t = firstTurn({ card: "behold", wish: "Et grønt tun mot sør." });
  assert.match(t, /slik tomta står i dag/); assert.match(t, /Behold høyblokka/); assert.match(t, /Et grønt tun mot sør\./);
  assert.match(t, /begynn å arbeide/); assert.match(t, /høyst to spørsmål/); assert.match(t, /regulering og vern/); assert.match(t, /Gi det et kort navn selv/);
  const n = firstTurn({ name: "Tun sør", card: "blank", from: "Mitt etter" });
  assert.match(n, /kopi av «Mitt etter»/); assert.match(n, /Navnet er «Tun sør»/); assert.doesNotMatch(n, /Gi det et kort navn/); assert.doesNotMatch(n, /Utgangspunkt/);
  assert.deepEqual(CARDS.map(c => c.label), ["Behold høyblokka", "Riv og bygg nytt", "Mer grønt", "Boliger", "Blank"]);
});

test("an empty version left over EMPTY_DAYS goes to the trash; one with a change, or a fresh one, stays", () => {
  let now = Date.parse("2026-10-01T00:00:00Z"); const v = createVersions(mkdtempSync(join(tmpdir(), "np-")), () => now);
  const empty = v.create("lars", "Tom"), used = v.create("lars", "Brukt", [{ kind: "demolish", building: "Østfløy" }]);
  now += (EMPTY_DAYS - 1) * 864e5; assert.equal(v.list({ owner: "lars", viewer: "lars" }).length, 2);
  now += 2 * 864e5; const left = v.list({ owner: "lars", viewer: "lars" }).map(x => x.title);
  assert.deepEqual(left, ["Brukt"]); assert.ok(v.getTrashed(empty.id), "kept in the 30-day trash, not erased"); assert.ok(v.get(used.id));
});

const dir = mkdtempSync(join(tmpdir(), "np-srv-")), secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_TOKENS: join(dir, "t.json") }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const post = body => fetch(`http://localhost:${PORT}/api/endring`, { method: "POST", headers: { "content-type": "application/json", ...lars }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));

test("«Start»: the typed name becomes the version's title; empty keeps «Nytt forslag»; a copy takes the typed name too", async () => {
  const a = await post({ fresh: true, title: "  Tun   sør " }); assert.equal(a.status, 200); assert.equal(a.j.title, "Tun sør");
  const b = await post({ fresh: true }); assert.equal(b.j.title, "Nytt forslag");
  const c = await post({ fresh: false, copy: a.j.version, title: "Tun sør 2" }); assert.equal(c.status, 200); assert.equal(c.j.title, "Tun sør 2");
  const d = await post({ copy: a.j.version }); assert.equal(d.j.title, "Tun sør (kopi)");
});
