/* Signing in with a code (login.mjs) and Anton's relay (assistant.mjs), against a stand-in for gulden-ai's internal door.
   node --test tests/anton.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-anton-")), secret = "proxy-secret-for-tests-0123456789", bearer = "door-token-0123456789";
const seen = [], LINK = "L".repeat(32);
let jobsNow = [];   // the fake door's background jobs (U3545)
const door = createServer((req, res) => {
  let s = ""; req.on("data", c => s += c); req.on("end", () => {
    const b = s ? JSON.parse(s) : {}; seen.push({ path: req.url, auth: req.headers.authorization, device: req.headers["x-door-device"], body: b });
    if (req.headers.authorization !== `Bearer ${bearer}`) return res.writeHead(401).end("{}");
    if (req.url === "/internal/sykehus/code" && b.link != null) return b.link === LINK ? res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ person: "lars", device_id: "dev-2", name: "Lars" })) : res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "wrong_code" } }));
    if (req.url === "/internal/sykehus/code") return b.code === "4711" ? res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ person: "lars", device_id: "dev-1" })) : res.writeHead(401).end("{}");
    if (req.url === "/internal/sykehus/chat") {
      if (req.headers["x-door-device"] === "revoked") return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "device_revoked" } }));
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      if (b.message === "SJEKK") {   // U3545: the check starts and runs 300 ms
        jobsNow = [{ job: "J1", tool: "check_drawing", state: "running", reported: false }]; setTimeout(() => { jobsNow[0].state = "done"; }, 300);
        return res.end([{ type: "tool", key: "check_drawing", label: "Startet kontrollen av tegningen", kind: "read", receipt: { line: "Kontrollen kjører i bakgrunnen", step: null } }, { type: "text", delta: "Kontrollen kjører." }, { type: "done" }].map(l => JSON.stringify(l)).join("\n") + "\n");
      }
      if (b.job) { jobsNow = jobsNow.map(j => j.job === b.job ? { ...j, reported: true } : j);
        return res.end([{ type: "tool", key: "job_result", label: "Leste kontrollens funn", kind: "read", receipt: { line: "Kontrollen fant 1 avvik · 0,15 $", step: null } }, { type: "text", delta: "Fant ett avvik." }, { type: "done" }].map(l => JSON.stringify(l)).join("\n") + "\n"); }
      if (b.message === "QR") return res.end([{ type: "qr", url: "https://evil.example/inn#" + LINK, minutes: 10 }, { type: "qr", url: "https://sykehus.gulden.no/inn#" + LINK, minutes: 10, label: "Skann med iPaden" }, { type: "done" }].map(l => JSON.stringify(l)).join("\n") + "\n");
      res.write(JSON.stringify({ type: "text", delta: "Jeg river " }) + "\n");
      setTimeout(() => { res.write(JSON.stringify({ type: "tool", key: "try_change", label: "Rev Vestfløy", kind: "write", receipt: { line: "Revet: Vestfløy", step: 3 } }) + "\n" + JSON.stringify({ type: "text", delta: "Vestfløy." }) + "\n" + JSON.stringify({ type: "done" }) + "\n"); res.end(); }, 50);
      return;
    }
    if (req.url.startsWith("/internal/sykehus/jobs")) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jobs: jobsNow }));
    if (req.url.startsWith("/internal/sykehus/history")) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ items: [{ type: "message", from: "lars", text: "hei" }] }));
    if (req.url === "/internal/sykehus/new-chat") return res.writeHead(200, { "content-type": "application/json" }).end("{}");
    res.writeHead(404).end("{}");
  });
});
await new Promise(ok => door.listen(0, ok));
const PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "",
  SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789abcdef", SYKEHUS_ASSISTANT_URL: `http://127.0.0.1:${door.address().port}`, SYKEHUS_ASSISTANT_TOKEN: bearer }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const O = `http://localhost:${PORT}`;
const post = (p, body, h = {}) => fetch(O + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });

/* the events on a stream until want() is satisfied */
async function events(cookie, want, ms = 4000) {
  const ac = new AbortController(), out = [], t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(O + "/api/anton/strom", { headers: { cookie }, signal: ac.signal });
    const dec = new TextDecoder(); let buf = "";
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true }); let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(blk), d = /^data: (.*)$/m.exec(blk); if (ev && d) out.push({ event: ev[1], ...JSON.parse(d[1]) }); }
      if (want(out)) break;
    }
  } catch { } finally { clearTimeout(t); ac.abort(); }
  return out;
}

let cookie;
test("a wrong code is refused; the right one sets a signed cookie for that person", async () => {
  assert.equal((await (await fetch(O + "/api/meg")).json()).person, null);
  assert.equal((await post("/api/logg-inn", { code: "12" })).status, 400);
  assert.equal((await post("/api/logg-inn", { code: "0000" })).status, 401);
  const r = await post("/api/logg-inn", { code: "47 11", device: "iMac" });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie"); assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Lax/);
  cookie = set.split(";")[0];
  assert.equal(seen.at(-1).body.device, "iMac"); assert.equal(seen.at(-1).auth, `Bearer ${bearer}`);
  assert.equal((await (await fetch(O + "/api/meg", { headers: { cookie } })).json()).person, "lars");
  const forged = cookie.replace(/\.[^.]+$/, ".AAAA");
  assert.equal((await (await fetch(O + "/api/meg", { headers: { cookie: forged } })).json()).person, null);
  assert.equal((await post("/api/logg-inn", { code: "4711" }, { origin: "https://evil.example" })).status, 403);
});

test("the one-time link from the QR signs in like a code, once (U3539)", async () => {
  assert.equal((await post("/api/logg-inn", { link: "short" })).status, 400);
  const bad = await post("/api/logg-inn", { link: "M".repeat(32) }); assert.equal(bad.status, 401); assert.match((await bad.json()).error, /Lenken/);
  const r = await post("/api/logg-inn", { link: LINK, device: "iPad/iPhone" });
  assert.equal(r.status, 200); assert.equal((await r.json()).name, "Lars"); assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  const b = seen.at(-1).body; assert.equal(b.link, LINK); assert.equal(b.code, undefined); assert.equal(b.app, "sykehus");
  const inn = await fetch(O + "/inn", { redirect: "manual" }); assert.equal(inn.status, 308); assert.equal(inn.headers.get("location"), "/inn/");
  assert.equal((await fetch(O + "/inn/")).status, 200);
});

test("signed in on gulden.no (Remote-User with the proxy secret) needs no code; without the secret it is no one", async () => {
  const me = await (await fetch(O + "/api/meg", { headers: { "remote-user": "morten", "x-sykehus-proxy-auth": secret } })).json();
  assert.equal(me.person, "morten"); assert.equal(me.via, "gulden.no"); assert.equal(me.anton, true);
  assert.equal((await (await fetch(O + "/api/meg", { headers: { "remote-user": "morten" } })).json()).person, null);
  const r = await post("/api/anton", { text: "Hei" }, { "remote-user": "morten", "x-sykehus-proxy-auth": secret });
  assert.equal(r.status, 202);
  await new Promise(ok => setTimeout(ok, 300));
  const body = seen.filter(s => s.path === "/internal/sykehus/chat").at(-1).body;
  assert.equal(body.person, "morten"); assert.equal(body.device_id, undefined); assert.equal(seen.filter(x => x.path === "/internal/sykehus/chat").at(-1).device, "gulden.no"); assert.equal(body.session, "sykehus:morten");
});

test("the cookie is not a login on /mcp", async () => {
  const r = await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "new_version", arguments: { title: "x" } } }) });
  assert.equal(r.status, 401);
});

test("a message is relayed as the person's turn and streamed back to their pages", async () => {
  assert.equal((await fetch(O + "/api/anton/strom")).status, 401);
  const v = (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars", "x-sykehus-proxy-auth": secret }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "new_version", arguments: { title: "Lars sin" } } }) })).json()).result.structuredContent;
  const got = events(cookie, o => o.some(e => e.event === "done"));
  await new Promise(ok => setTimeout(ok, 200));
  const r = await post("/api/anton", { text: "Riv vestfløya", version: v.version }, { cookie });
  assert.equal(r.status, 202);
  const ev = await got, { id } = await r.json();
  assert.deepEqual(ev.filter(e => e.event === "text").map(e => e.delta), ["Jeg river ", "Vestfløy."]);
  assert.ok(ev.filter(e => ["text", "tool", "done"].includes(e.event)).every(e => e.reply_to === id));
  assert.deepEqual(ev.find(e => e.event === "tool").receipt, { line: "Revet: Vestfløy", step: 3 }, "the receipt reaches the page (U3647)");
  const body = seen.find(s => s.path === "/internal/sykehus/chat" && s.body.person === "lars").body;
  assert.equal(body.person, "lars"); assert.equal(body.session, "sykehus:lars"); assert.equal(body.device_id, undefined); assert.equal(seen.filter(x => x.path === "/internal/sykehus/chat").at(-1).device, "dev-1"); assert.equal(body.version.id, v.version);
  // the page's own list now has Lars's private version, with the key that opens it
  const mine = (await (await fetch(O + "/api/versjoner", { headers: { cookie } })).json()).versions;
  assert.equal(mine[0].mine, true); assert.ok(mine[0].nokkel);
  assert.equal((await (await fetch(O + "/api/versjoner")).json()).versions.length, 0);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}`, { headers: { cookie } })).status, 200);
  // Anton changes the version (through the MCP tools, as Lars): the page is told to redraw it
  const steps = events(cookie, o => o.some(e => e.event === "steps"));
  await new Promise(ok => setTimeout(ok, 200));
  await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars", "x-sykehus-proxy-auth": secret }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "try_change", arguments: { version: v.version, edits: [{ kind: "demolish", building: "Vestfløy" }] } } }) });
  const s = (await steps).find(e => e.event === "steps"); assert.equal(s.version, v.version); assert.equal(s.changes, 1);
  const h = await (await fetch(O + "/api/anton/historikk", { headers: { cookie } })).json();
  assert.equal(h.items[0].text, "hei");
});

test("what is picked goes with the message, tidied, and its summary shows on the pages", async () => {
  const got = events(cookie, o => o.some(e => e.event === "done"));
  await new Promise(ok => setTimeout(ok, 200));
  await post("/api/anton", { text: "Riv denne", selection: { items: [{ kind: "wing", id: "ostfloy", label: "Østfløy" }, { kind: "room", id: "312", storey: "3. etasje", label: "Kontor (312)" }, { kind: "bad", id: "x" }], summary: "Østfløy · Kontor (312)" } }, { cookie });
  const msg = (await got).find(e => e.event === "message"); assert.equal(msg.about, "Østfløy · Kontor (312)");
  const body = seen.filter(s => s.path === "/internal/sykehus/chat").at(-1).body;
  assert.deepEqual(body.selection.ids, ["ostfloy", "312"]); assert.equal(body.selection.items[1].storey, "3. etasje");
});

test("«Ny samtale» asks gulden-ai for a new thread and empties every page", async () => {
  const got = events(cookie, o => o.some(e => e.event === "cleared"));
  await new Promise(ok => setTimeout(ok, 200));
  assert.equal((await post("/api/anton/ny", {}, { cookie })).status, 200);
  assert.ok((await got).some(e => e.event === "cleared"));
  const b = seen.filter(s => s.path === "/internal/sykehus/new-chat").at(-1).body; assert.equal(b.session, "sykehus:lars"); assert.equal(b.device_id, undefined); assert.match(b.request_id, /^[A-Za-z0-9._:-]{1,128}$/, "gulden-ai refuses /new-chat without one (21:05Z)"); assert.equal(seen.filter(s => s.path === "/internal/sykehus/new-chat").at(-1).device, "dev-1");
});

test("a qr line reaches the pages only when it points at this site's /inn/", async () => {
  const got = events(cookie, o => o.some(e => e.event === "done"));
  await new Promise(ok => setTimeout(ok, 200));
  await post("/api/anton", { text: "QR" }, { cookie });
  const qr = (await got).filter(e => e.event === "qr");
  assert.equal(qr.length, 1); assert.equal(qr[0].url, "https://sykehus.gulden.no/inn#" + LINK); assert.equal(qr[0].minutes, 10); assert.equal(qr[0].label, "Skann med iPaden");
});

test("a check runs in the background; when it is done Anton gets his own turn on it, with no message from the person (U3545)", async () => {
  const got = events(cookie, o => o.some(e => e.event === "text" && e.delta === "Fant ett avvik.") && o.filter(e => e.event === "done").length >= 2, 6000);
  await new Promise(ok => setTimeout(ok, 200));
  const { id } = await (await post("/api/anton", { text: "SJEKK" }, { cookie })).json();
  const ev = await got;
  assert.deepEqual(ev.filter(e => e.event === "message").map(e => e.text), ["SJEKK"], "the job turn draws no person's message");
  const result = ev.find(e => e.event === "tool" && e.key === "job_result");
  assert.deepEqual(result.receipt, { line: "Kontrollen fant 1 avvik · 0,15 $", step: null });
  assert.notEqual(result.reply_to, id, "Anton's answer on the job is its own turn");
  assert.equal(ev.find(e => e.event === "text" && e.delta === "Fant ett avvik.").reply_to, result.reply_to);
  const job = seen.filter(s => s.path === "/internal/sykehus/chat" && s.body.job);
  assert.equal(job.length, 1, "one turn per finished job"); assert.equal(job[0].body.job, "J1"); assert.equal(job[0].body.message, undefined); assert.equal(job[0].device, "dev-1");
  const asked = seen.filter(s => s.path.startsWith("/internal/sykehus/jobs")).at(-1);
  assert.match(asked.path, /person=lars/); assert.match(asked.path, /session=sykehus%3Alars/); assert.equal(asked.device, "dev-1");
  await fetch(O + "/api/anton/historikk", { headers: { cookie } }); await new Promise(ok => setTimeout(ok, 200));
  assert.equal(seen.filter(s => s.path === "/internal/sykehus/chat" && s.body.job).length, 1, "a read job gets no second turn");
});

test("the history names the device in X-Door-Device, never in the query (U3544)", async () => {
  assert.equal((await fetch(O + "/api/anton/historikk", { headers: { cookie } })).status, 200);
  const h = seen.filter(s => s.path.startsWith("/internal/sykehus/history")).at(-1);
  assert.equal(h.device, "dev-1"); assert.doesNotMatch(h.path, /device/);
});

test("a plan Anton showed is listed and served to the person it was shown to, through the server (U3635, the live read 2026-10-26)", async () => {
  /* the server hands the handlers the person's name; it once handed them the whole record, so the list was empty and the picture a 404 */
  mkdirSync(join(dir, "v", "skisser"), { recursive: true });
  const meta = (id, person) => writeFileSync(join(dir, "v", "skisser", id + ".json"), JSON.stringify({ type: "sketch", id, title: "Terrasse", url: `api/skisse/${id}.png`, at: new Date().toISOString(), person }));
  meta("AAAAAAAA", "lars"); meta("BBBBBBBB", "magnus"); for (const id of ["AAAAAAAA", "BBBBBBBB"]) writeFileSync(join(dir, "v", "skisser", id + ".png"), Buffer.from("89504e470d0a1a0a", "hex"));
  const list = await (await fetch(O + "/api/skisser", { headers: { cookie } })).json();
  assert.deepEqual(list.sketches.map(x => x.id), ["AAAAAAAA"], "only his own, and without the owner's name");
  assert.equal(list.sketches[0].person, undefined);
  const img = await fetch(O + "/api/skisse/AAAAAAAA.png", { headers: { cookie } });
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal((await fetch(O + "/api/skisse/BBBBBBBB.png", { headers: { cookie } })).status, 404, "another person's picture");
  assert.equal((await fetch(O + "/api/skisser")).status, 401);
});

test("signing out clears the cookie", async () => {
  const r = await post("/api/logg-ut", {}, { cookie });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
