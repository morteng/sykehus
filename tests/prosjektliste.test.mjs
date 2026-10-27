/* «Prosjekter» list (Morten 2026-10-27): a visitor who is not signed in sees no «Nytt prosjekt» and one list of public projects;
   a signed-in person sees «Dine prosjekter» first, then «Andres delte prosjekter»; an empty group has no heading; no rows keeps the one plain line.
   The server refuses a create without the login.   node --test tests/prosjektliste.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { listHtml, EMPTY_LIST } from "../public/sharing.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-pl-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, as = who => ({ "remote-user": who, "x-sykehus-proxy-auth": secret });
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());

const card = v => `<li class="fc" data-id="${v.version}">${v.title}</li>`;
const mineA = { version: "va", title: "Mitt A", mine: true }, mineB = { version: "vb", title: "Mitt B", mine: true };
const otherA = { version: "vc", title: "Andres C", owner: "pappa" }, otherB = { version: "vd", title: "Andres D", owner: "lars" };
const order = h => [...h.matchAll(/<h3>([^<]+)<\/h3>|data-id="(\w+)"/g)].map(m => m[1] || m[2]);
const rd = f => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");

test("(a) signed out: one list headed «Delte prosjekter», only public rows; the page hides «Nytt prosjekt» without a person", () => {
  assert.deepEqual(order(listHtml([otherA, otherB], { signedIn: false, card })), ["Delte prosjekter", "vc", "vd"]);
  const app = rd("app.js");
  assert.match(app, /\$\("mnp"\)\.parentElement\.hidden = !me\.person/, "the button's row is hidden without a person");
  assert.match(app, /\$\{me\.person \? `<button type="button" data-ny /, "the draft card's «Nytt prosjekt» needs a person");
  assert.match(rd("index.html"), /class="bygg-acts"><button[^>]*id="mnp"/, "the control the line above hides is the real one");
});

test("(b) signed in with own and others: «Dine prosjekter» and its rows first, then «Andres delte prosjekter»", () => {
  assert.deepEqual(order(listHtml([otherA, mineA, otherB, mineB], { signedIn: true, card })),
    ["Dine prosjekter", "va", "vb", "Andres delte prosjekter", "vc", "vd"]);
});

test("(c) signed in with only own rows: only the first heading; only others: only the second", () => {
  assert.deepEqual(order(listHtml([mineA, mineB], { signedIn: true, card })), ["Dine prosjekter", "va", "vb"]);
  assert.deepEqual(order(listHtml([otherA], { signedIn: true, card })), ["Andres delte prosjekter", "vc"]);
});

test("(d) no rows at all: the one plain line, no heading, signed in or not", () => {
  for (const signedIn of [true, false]) { const h = listHtml([], { signedIn, card }); assert.equal(h, EMPTY_LIST); assert.match(h, /Ingen prosjekter ennå\./); assert.doesNotMatch(h, /<h3/); }
});

test("the page draws the list through listHtml with its own card, which carries «Åpen»", () => {
  assert.match(rd("app.js"), /listHtml\(rows, \{ signedIn: !!me\.person, card: versionCard \}\)/);
  assert.match(rd("app.js"), /fc-open">Åpen</);
});

test("the server refuses to create a project without the login, by the page's route and by the tool; nothing is made; a signed-in person can", async () => {
  const page = (body, h) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
  const tool = async (name, args, h) => { const j = await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json(); return j.result || { isError: true, content: j.error }; };
  const r = await page({ fresh: true, title: "Anonymt" }, {});
  assert.equal(r.status, 400); assert.match(r.j.error, /Logg inn/);
  const t = await tool("new_version", { title: "Anonymt" }, {}); assert.equal(t.isError, true, JSON.stringify(t)); assert.match(JSON.stringify(t.content), /Logg inn|innlogging/i);
  assert.equal((await (await fetch(O + "/api/versjoner")).json()).versions.length, 0);
  const ok = await page({ fresh: true, title: "Mitt nye" }, as("lars")); assert.equal(ok.status, 200); assert.equal(ok.j.title, "Mitt nye");
});
