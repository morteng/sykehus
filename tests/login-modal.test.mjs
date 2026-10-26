/* U3662: signed out there is nothing of Anton, and «Logg inn» takes the four digits against the real /api/logg-inn (login.mjs), with a stand-in
   for gulden-ai's door and a test code made here (4711), never a person's own. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { signIn, FLAG } from "../public/login.js";
import { listFor } from "../public/tour.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-login-")), bearer = "door-token-0123456789", door = createServer((req, res) => {
  let s = ""; req.on("data", c => s += c); req.on("end", () => {
    const b = s ? JSON.parse(s) : {}, j = (c, o) => res.writeHead(c, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.headers.authorization !== `Bearer ${bearer}`) return j(401, {});
    if (req.url === "/internal/sykehus/code") return b.code === "4711" ? j(200, { person: "lars", device_id: "dev-1" }) : b.code === "0000" ? j(429, {}) : j(401, { error: "wrong" });
    j(404, {});
  });
});
await new Promise(ok => door.listen(0, ok));
const PORT = 9000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}/`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: "proxy-secret-for-tests-0123456789",
  SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789abcdef", SYKEHUS_ASSISTANT_URL: `http://127.0.0.1:${door.address().port}`, SYKEHUS_ASSISTANT_TOKEN: bearer }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
let cookie = "";
const viaServer = async (url, init) => { const r = await fetch(O + url, { ...init, headers: { ...(init?.headers || {}), cookie } }); const c = r.headers.getSetCookie?.()[0]; if (c) cookie = c.split(";")[0]; return r; };

test("signed out: /api/meg says nobody, with login on and Anton wired; a wrong code gets the server's own sentence; too many gets the wait", async () => {
  const meg = await (await viaServer("api/meg")).json(); assert.deepEqual([meg.person, meg.login, meg.anton], [null, true, true]);
  const bad = await signIn("1234", viaServer); assert.equal(bad.ok, false); assert.match(bad.error, /Koden stemmer ikke|for gammel|Skriv/); assert.equal(cookie, "");
  assert.match((await signIn("0000", viaServer)).error, /låst etter for mange feil/);
  assert.match((await signIn("12", viaServer)).error, /Koden er fire sifre/);
});

test("the right code signs in: the person, a cookie, and /api/meg then names the person", async () => {
  const ok = await signIn("4711", viaServer); assert.deepEqual([ok.ok, ok.person], [true, "lars"]); assert.match(cookie, /^sykehus=/);
  assert.equal((await (await viaServer("api/meg")).json()).person, "lars"); assert.equal(FLAG, "sykehus-innlogget");
});

test("signed out the page shows nothing of Anton: the tab, the panel, the pill, the cards' ask button and the sheet are hidden by .anon, which early.js sets, and anton.js sets it before it fetches anything but /api/meg", () => {
  const css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8"), early = readFileSync(new URL("../public/early.js", import.meta.url), "utf8"), a = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
  assert.match(css, /body\.anon #tab-chat, body\.anon #p-chat, body\.anon \[data-ask\], body\.anon #talk-form, body\.anon \.g-chat \{ display: none !important; \}/);
  assert.match(early, /if \(!had\) \{ document\.body\.classList\.add\("anon"\)/);
  const out = a.slice(a.indexOf("if (!me.person) {"), a.indexOf("document.body.classList.remove(\"anon\")"));
  assert.match(out, /classList\.add\("anon"\)/); assert.ok(!/fetch\(|json\(|talk\(\)/.test(out), "nothing of Anton is fetched or started signed out");
});

test("the visitor's tour names nothing of Anton and ends on «Logg inn»", () => {
  const v = listFor("gjest", { phone: () => false, tab() { } });
  assert.ok(!v.some(s => /\bAnton\b|pillen/i.test(s.title + " " + s.text))); assert.equal(v.at(-1).title, "Logg inn");
});
