/* U5246: Skills over MCP on the wire: skills/list and skills/get with complete manifests, an unknown uri -32602,
   the SKILL.md readable through resources/read, the extension declared, and every backticked name a real tool. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const PORT = 19000 + Math.floor(Math.random() * 1000), BASE = `http://localhost:${PORT}`;
let srv, id = 0;
before(async () => {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => srv?.kill());
const raw = async (method, params) => (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })).json();
const rpc = async (m, p) => { const j = await raw(m, p); if (j.error) throw new Error(j.error.message); return j.result; };

test("the extension is declared and the four skills list with complete manifests", async () => {
  const i = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.ok(i.capabilities.extensions["io.modelcontextprotocol/skills"]);
  const l = await rpc("skills/list", {});
  assert.equal(l.resultType, "complete");
  assert.deepEqual(l.skills.map(s => s.frontmatter.name), ["start-a-project", "make-a-sketch", "plan-my-garden", "check-the-rules"]);
  for (const s of l.skills) {
    assert.equal(s.uri, `skill://${s.frontmatter.name}/SKILL.md`);
    assert.ok(s.frontmatter.description.length > 0 && s.frontmatter.description.length <= 1024);
    assert.equal(s.files[0].uri, s.uri);
    for (const f of s.files) {   // the manifest tells the truth about each file
      const t = (await rpc("resources/read", { uri: f.uri })).contents[0].text;
      assert.equal(f.digest, "sha256:" + createHash("sha256").update(t).digest("hex")); assert.equal(f.size, Buffer.byteLength(t));
    }
  }
  assert.ok(l.skills.find(s => s.frontmatter.name === "check-the-rules").files.some(f => f.uri.endsWith("references/tek17.md")));
});
test("skills/get: the first skill reads back; an unknown uri is -32602", async () => {
  const g = await rpc("skills/get", { uri: "skill://start-a-project/SKILL.md" });
  assert.equal(g.skill.frontmatter.name, "start-a-project");
  const t = (await rpc("resources/read", { uri: g.skill.uri })).contents[0].text;
  assert.match(t, /^---\nname: start-a-project\n/); assert.match(t, /new_version/);
  const bad = await raw("skills/get", { uri: "skill://nope/SKILL.md" });
  assert.equal(bad.error.code, -32602);
});
test("every backticked name in a skill is a real tool", async () => {
  const tools = new Set((await rpc("tools/list")).tools.map(t => t.name));
  for (const s of (await rpc("skills/list", {})).skills) {
    const t = (await rpc("resources/read", { uri: s.uri })).contents[0].text;
    for (const [, n] of t.matchAll(/`([a-z_]+)`/g)) assert.ok(tools.has(n), `${s.frontmatter.name}: ${n}`);
  }
});
