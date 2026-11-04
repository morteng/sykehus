/* tools/live-turn.py against a stub of /api/anton: one turn, the version from «steps», an approval stops the turn, no secret printed. Run: node --test tests/live-turn.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const sse = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
function stub(script) {
  const subs = new Set(), seen = { auth: [], stopped: 0 };
  const srv = http.createServer((req, res) => {
    seen.auth.push(req.headers["x-edge-auth"]);
    if (req.url === "/api/anton/strom") { res.writeHead(200, { "content-type": "text/event-stream" }); subs.add(res); res.write(sse("queue", {})); return; }
    if (req.url === "/api/anton/stopp") { seen.stopped++; res.writeHead(200); return res.end("{}"); }
    if (req.url === "/api/anton/historikk") { res.writeHead(200); return res.end(JSON.stringify({ items: [{ type: "tool", key: "try_change", result: { added: ["n1"] } }] })); }
    if (req.url === "/api/anton") { res.writeHead(202); res.end(JSON.stringify({ id: "T1" })); setTimeout(() => { for (const s of subs) for (const [e, d] of script) s.write(sse(e, d)); }, 50); return; }
    res.writeHead(404); res.end();
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
function client(base, args, stdin = JSON.stringify({ headers: { "X-Edge-Auth": "sekret-123" } })) {
  return new Promise(ok => {
    const p = spawn("python3", ["-I", new URL("../tools/live-turn.py", import.meta.url).pathname, "--base", base, "--wait", "10", ...args]);
    let o = "", e = ""; p.stdout.on("data", d => o += d); p.stderr.on("data", d => e += d); p.on("close", code => ok({ code, o, e })); p.stdin.end(stdin);
  });
}

test("a turn: answer, tools, the version from steps, the history tail; replies to other turns are ignored; no secret printed", async () => {
  const { srv, seen, base } = await stub([["steps", { version: "v1", title: "Grunn-test", changes: 1 }], ["text", { delta: "Ignorert", reply_to: "OTHER" }], ["tool", { key: "try_change", label: "Graver", reply_to: "T1" }], ["text", { delta: "Ferdig. ", reply_to: "T1" }], ["done", { type: "done", reply_to: "T1" }]]);
  const r = await client(base, ["Lag et basseng"]); srv.closeAllConnections(); srv.close();
  assert.equal(r.code, 0, r.e); const j = JSON.parse(r.o);
  assert.equal(j.answer, "Ferdig."); assert.equal(j.ended, "done"); assert.deepEqual(j.versions, [{ version: "v1", title: "Grunn-test", changes: 1 }]);
  assert.deepEqual(j.tools, [{ key: "try_change", label: "Graver" }]); assert.deepEqual(j.history[0].result.added, ["n1"]);
  assert.ok(seen.auth.every(a => a === "sekret-123")); assert.ok(!r.o.includes("sekret-123") && !r.e.includes("sekret-123"));
});
test("an error line ends with exit 1; an approval stops the turn", async () => {
  let s = await stub([["error", { code: "limit", reply_to: "T1" }]]); let r = await client(s.base, ["x"]); s.srv.closeAllConnections(); s.srv.close();
  assert.equal(r.code, 1); assert.equal(JSON.parse(r.o).error, "limit");
  s = await stub([["approval", { id: "a", reply_to: "T1" }]]); r = await client(s.base, ["x"]); s.srv.closeAllConnections(); s.srv.close();
  assert.equal(r.code, 1); assert.equal(JSON.parse(r.o).ended, "approval"); assert.equal(s.seen.stopped, 1);
});
test("refuses unknown flags, two messages and a missing header JSON", async () => {
  assert.equal((await client("http://127.0.0.1:1", ["--x", "y"])).code, 1);
  assert.notEqual((await client("http://127.0.0.1:1", ["a", "b"])).code, 0);
  assert.equal((await client("http://127.0.0.1:1", ["a"], "nope")).code, 2);
});
