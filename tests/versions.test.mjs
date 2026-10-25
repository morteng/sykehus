/* Versions of the after (versions.mjs) and who may keep them (auth.mjs), against a server of their own: gulden.no in
   front (Remote-User with the proxy secret), a personal token, and claude.ai's OAuth sign-in from start to end.
   node --test tests/versions.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-versions-"));
const tok = "test-token-morten-0123456789", secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900);
writeFileSync(join(dir, "tokens.json"), JSON.stringify({ [createHash("sha256").update(tok).digest("hex")]: "morten" }));
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_TOKENS: join(dir, "tokens.json"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const O = `http://localhost:${PORT}`;
let n = 0;
async function call(name, args, headers = {}) {
  const r = await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  const j = await r.json(); if (r.status !== 200) return { status: r.status, auth: r.headers.get("www-authenticate"), j };
  const c = j.result; return { status: 200, error: c.isError ? c.content[0].text : null, out: c.structuredContent };
}
const morten = { authorization: `Bearer ${tok}` }, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };

test("trying needs no login; keeping answers 401 with the sign-in challenge", async () => {
  const d = await call("try_change", { edits: [{ kind: "demolish", building: "Vestfløy" }] });
  assert.equal(d.out.saved, false);
  for (const h of [{}, { authorization: "Bearer not-the-right-token-xx" }, { "remote-user": "lars" }, { "remote-user": "lars", "x-sykehus-proxy-auth": "wrong" }]) {
    const r = await call("new_version", { title: "Ikke lov" }, h);
    assert.equal(r.status, 401); assert.match(r.auth, /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/);
  }
});

test("a version from a draft, changed by its owner only, kept on disk", async () => {
  const d = await call("try_change", { edits: [{ kind: "demolish", building: "alle" }, { kind: "restore", building: "Sentralblokka" }] });
  const v = (await call("new_version", { title: "Bare tårnet", from: d.out.draft }, morten)).out;
  assert.equal(v.owner, "morten"); assert.equal(v.changes, 2);
  const r = await call("try_change", { version: v.version, edits: [{ kind: "volume", name: "Drivhus", shape: "triangle", from: [-46, -62], to: [27, -62], width: 24, height: 18 }] }, morten);
  assert.equal(r.out.saved, true); assert.equal(r.out.changes, 3);
  await call("undo_change", { draft: v.version, n: 3 }, morten);
  // privat: the owner only, on the web through their own link; no one else, not even its title
  const key = l => new URL(l).searchParams.get("nokkel"), list = async () => (await (await fetch(`${O}/api/versjoner`)).json()).versions.map(x => x.version);
  assert.equal(v.sharing, "privat"); const own = key(v.link); assert.ok(own);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}`)).status, 404);
  assert.match((await call("show_draft", { draft: v.version }, lars)).error, /No version/);
  assert.match((await call("try_change", { version: v.version, edits: [{ kind: "restore", building: "alle" }] }, lars)).error, /No version/, "nor its title");
  const page = await (await fetch(`${O}/api/versjon/${v.version}?nokkel=${own}`)).json();
  assert.equal(page.edits.length, 2); assert.equal(page.owner, "morten");
  assert.match((await call("set_sharing", { version: v.version, sharing: "offentlig" }, lars)).error, /No version/, "only the owner chooses");
  // lenke: anyone with the share link, never listed; the owner's own link is not the share link
  const linked = (await call("set_sharing", { version: v.version, sharing: "lenke" }, morten)).out, share = key(linked.link);
  assert.notEqual(share, own);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}?nokkel=${share}`)).status, 200);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}`)).status, 404);
  assert.deepEqual(await list(), [], "a link-only version is not listed");
  // offentlig: open to all and on the front page's list; seen, not changed, by others
  const shown = (await call("set_sharing", { version: v.version, sharing: "offentlig" }, morten)).out; assert.equal(key(shown.link), null);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}`)).status, 200);
  assert.deepEqual(await list(), [v.version]);
  assert.match((await call("try_change", { version: v.version, edits: [{ kind: "restore", building: "alle" }] }, lars)).error, /morten sin/);
  // back to privat: the share link stops working
  await call("set_sharing", { version: v.version, sharing: "privat" }, morten);
  assert.equal((await fetch(`${O}/api/versjon/${v.version}?nokkel=${share}`)).status, 404); assert.deepEqual(await list(), []);
  assert.equal((await call("new_version", { title: "Lars sin" }, lars)).out.owner, "lars");
});

test("claude.ai's way in: register, consent behind gulden.no, code with PKCE, token, save", async () => {
  const meta = await (await fetch(O + "/.well-known/oauth-authorization-server")).json();
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  const reg = await (await fetch(O + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) })).json();
  const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  const out = await fetch(`${O}/oauth/authorize?${q}`);
  assert.equal(out.status, 401, "no gulden.no login, no consent");
  const rd = new URL(/href="([^"]+)"/.exec(await out.text())[1].replace(/&amp;/g, "&")).searchParams.get("rd");
  assert.equal(rd, `${O}/oauth/authorize?${q}`, "a way to sign in, and back to this page");
  const html = await (await fetch(`${O}/oauth/authorize?${q}`, { headers: lars })).text();
  const form = /name="form" value="([^"]+)"/.exec(html)[1];
  const forged = await fetch(O + "/oauth/approve", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", "remote-user": "lars", "x-sykehus-proxy-auth": "wrong" }, body: `form=${form}&answer=yes` });
  assert.equal(forged.status, 400, "the answer must come from the same login");
  const html2 = await (await fetch(`${O}/oauth/authorize?${q}`, { headers: lars })).text(), form2 = /name="form" value="([^"]+)"/.exec(html2)[1];
  const ok = await fetch(O + "/oauth/approve", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...lars }, body: `form=${form2}&answer=yes` });
  const back = new URL(ok.headers.get("location")); assert.equal(back.searchParams.get("state"), "s1");
  const t = await (await fetch(O + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier }) })).json();
  assert.ok(t.access_token && t.refresh_token);
  const v = await call("new_version", { title: "Fra claude.ai" }, { authorization: `Bearer ${t.access_token}` });
  assert.equal(v.out.owner, "lars");
  const usage = await (await fetch(O + "/api/bruk")).json(), today = Object.values(usage.days)[0];
  assert.ok(today.calls > 5 && today.logins.lars >= 1 && today.logins.morten >= 1); assert.equal(usage.grants[0].owner, "lars");
  assert.equal((await fetch(O + "/api/bruk", { headers: { "x-forwarded-for": "203.0.113.9" } })).status, 403, "the counts are not for the outside");
});

/* the page's «Riv» and «Angre» (U3542), and the IFC without what the after tears down */
const post = (body, headers = {}) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
test("«Riv» from the page: a new draft, one more in it, «Angre», and a version only for its owner", async () => {
  const a = await post({ edits: [{ kind: "demolish", building: "Østfløy" }] });
  assert.equal(a.status, 200); assert.equal(a.j.changes_in_draft, 1); assert.ok(a.j.draft);
  const b = await post({ draft: a.j.draft, edits: [{ kind: "demolish", building: "MR-bygget" }] });
  assert.equal(b.j.changes_in_draft, 2);
  const u = await post({ draft: a.j.draft, undo: 1 });
  assert.equal(u.status, 200); assert.equal(u.j.changes_in_draft, 1); assert.equal(u.j.removed.building, "Østfløy");
  assert.equal((await post({ edits: [{ kind: "volume", name: "Drivhus" }] })).status, 400);   // only riv and sett opp from the page
  assert.equal((await post({ edits: [{ kind: "demolish", building: "Finnes ikke" }] })).status, 422);
  const v = (await call("new_version", { title: "Riv fra siden" }, morten)).out;
  assert.equal((await post({ version: v.version, edits: [{ kind: "demolish", building: "Vestfløy" }] })).status, 400);   // not signed in on the page
});
test("/api/ifc: the draft's IFC has the torn-down wing taken out, nothing left pointing at it", async () => {
  const a = await post({ edits: [{ kind: "demolish", building: "Østfløy" }] });
  const r = await fetch(`${O}/api/ifc?utkast=${a.j.draft}`); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /attachment; filename=".*\.ifc"/);
  const t = await r.text(), names = [...t.matchAll(/=IFCBUILDING\('[^']*',[^,]*,'([^']*)'/g)].map(m => m[1]);
  assert.ok(!names.includes("\\X2\\00D8\\X0\\stfl\\X2\\00F8\\X0\\y") && names.includes("Sentralblokka"), names.join(" | "));
  const ids = new Set([...t.matchAll(/^#(\d+)=/gm)].map(m => m[1]));
  for (const m of t.replace(/'(?:[^']|'')*'/g, "").matchAll(/#(\d+)/g)) assert.ok(ids.has(m[1]), `#${m[1]} dangles`);
  assert.equal((await fetch(`${O}/api/ifc?utkast=nope1234`)).status, 404);
});
