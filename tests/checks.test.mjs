/* U3678 slice 1: the building rules (rules/tek17.json) held against the after. The pure part (checks.mjs) on made-up
   sites, then the connector end to end: check_design in the tool list with its schema, try_change carrying checks[].
   No worker and no model call. Run: node --test tests/checks.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { check, RULES, summary } from "../checks.mjs";

/* a flat terrain at kote 10 with a hollow 4 m deep at east of x = 5 (so a railing at x = 0 stands over a drop on its east side) */
const T = { x0: -20, y1: 20, res: 1, w: 40, h: 40, z: Array.from({ length: 1600 }, (_, i) => (i % 40) >= 25 ? 6 : 10) };
const site = (...added) => ({ terrain: T, added });
const stair = (id, params) => ({ kind: "volume", id, name: "Trapp " + id, from: [-10, 0], to: [-8, 0], bim: { part: "stair", params: { height: 1.2, width: 1.2, max_riser: 0.18, railing: true, ...params } } });
const railing = (id, params, at = [-1, 0]) => ({ kind: "volume", id, name: "Rekkverk " + id, from: [at[0], at[1]], to: [at[0], at[1] + 4], bim: { part: "railing", params: { height: 1.1, ground: 10, ...params } } });
const row = (rows, rule, id) => rows.find(r => r.rule === rule && (!id || r.thing.id === id));

test("the rules file: each rule has a §, a sentence for the person, what it reads, and a checker that answers it", () => {
  assert.ok(RULES.length >= 8 && RULES.length <= 12, `${RULES.length} rules`);
  for (const r of RULES) { assert.match(r.section, /^§ \d+-\d+$/, r.id); assert.ok(r.no.length > 20 && r.reads && r.limit, r.id); assert.match(r.source.url, /^https:\/\/dibk\.no\/regelverk\/byggteknisk-forskrift-tek17\//, r.id); assert.ok(r.source.quote.split(/\s+/).length <= 15, `${r.id}: quote over 15 words`); assert.ok(r.source.ref, r.id); assert.equal(typeof r.verify, "boolean", r.id); }
  assert.equal(new Set(RULES.map(r => r.id)).size, RULES.length);
});

test("a stair that breaks 2·S+I: a low step (12 cm) gives 25-32 cm tread under the 600 mm line", () => {
  const rows = check(site(stair("a", { max_riser: 0.12, height: 1.2 })));
  const r = row(rows, "trapp_stigningsforhold");
  assert.equal(r.ok, false); assert.equal(r.status, "brudd"); assert.equal(r.value, 560); assert.match(r.said, /2 × 120 mm \+ 320 mm = 560 mm/); assert.equal(r.section, "§ 12-14");
});
test("a stair that passes: 18 cm steps, 27 cm treads = 630 mm; all four stair rules ok", () => {
  const rows = check(site(stair("b", {})));
  assert.deepEqual(rows.map(r => r.rule), ["trapp_stigningsforhold", "trapp_inntrinn", "trapp_bredde", "trapp_handlist"]);
  assert.ok(rows.every(r => r.ok === true), JSON.stringify(rows.map(r => [r.rule, r.said])));
  assert.equal(row(rows, "trapp_stigningsforhold").value, 630);
});
test("a stair's own printed riser and tread win over the worked-out ones; a stair too narrow and with no handrail breaks", () => {
  const rows = check(site(stair("c", { width: 0.7, railing: false })), { printed: { c: { riser_m: 0.2, tread_m: 0.26 } } });
  assert.equal(row(rows, "trapp_inntrinn").ok, true); assert.equal(row(rows, "trapp_inntrinn").value, 260);
  assert.match(row(rows, "trapp_stigningsforhold").said, /delens eget mål/); assert.equal(row(rows, "trapp_stigningsforhold").value, 660);
  assert.equal(row(rows, "trapp_bredde").ok, false); assert.equal(row(rows, "trapp_handlist").ok, false);
});
test("a railing too low with a drop breaks; high enough passes; with no drop no rail is needed", () => {
  const low = row(check(site(railing("r1", { height: 0.9 }, [4.5, 0]))), "rekkverk_hoyde");   // x = 4.5: its east side (x = 6) is 4 m down
  assert.equal(low.ok, false); assert.match(low.said, /Fallet er 4 m; rekkverket er 0,9 m høyt, minst 1 m kreves/);
  assert.equal(row(check(site(railing("r2", { height: 1.1 }, [4.5, 0]))), "rekkverk_hoyde").ok, true);
  const flat = row(check(site(railing("r3", { height: 0.9 }, [-10, 0]))), "rekkverk_hoyde");
  assert.equal(flat.ok, true); assert.match(flat.said, /annen forsvarlig måte/);
});
test("a railing's height: not measured when the model holds no foot or no terrain, and never ok then", () => {
  const noFoot = row(check(site({ ...railing("r4", {}), bim: { part: "railing", params: { height: 1.1 } } })), "rekkverk_hoyde");
  assert.equal(noFoot.ok, null); assert.equal(noFoot.status, "ikke målt"); assert.match(noFoot.said, /^Ikke målt/);
  const noTerrain = row(check({ added: [railing("r5", { height: 0.9 })] }), "rekkverk_hoyde");
  assert.equal(noTerrain.ok, null);
});
test("a ramp too steep breaks, a step-free entrance on a gentle ramp passes, a level one needs none, one that never meets the ground says so", () => {
  const ent = en => ({ kind: "volume", id: "h", name: "Hus", ground: { entrance: { side: "S", ...en } } });
  const steep = check(site(ent({ ok: true, rise: 0.5, ramp_m: 5, up: true, rests: 0 })));
  assert.equal(row(steep, "rampe_stigning").ok, false); assert.equal(row(steep, "rampe_stigning").value, "1:10");
  assert.equal(row(check(site(ent({ ok: true, rise: 0.8, ramp_m: 10, up: true, rests: 0 }))), "rampe_stigning").ok, false, "1:12,5 over 10 m is steeper than 1:15");
  assert.equal(row(check(site(ent({ ok: true, rise: 0.4, ramp_m: 4.8, up: true, rests: 0 }))), "rampe_stigning").ok, true, "1:12 is allowed on a stretch up to 5 m");
  const gentle = check(site(ent({ ok: true, rise: 0.5, ramp_m: 10, up: true, rests: 0 })));
  assert.equal(row(gentle, "rampe_stigning").ok, true); assert.equal(row(gentle, "rampe_stigning").value, "1:20");
  assert.equal(row(check(site(ent({ ok: true, rise: 0, ramp_m: 0 }))), "rampe_stigning").ok, true);
  const far = check(site(ent({ ok: false, rise: 7, ramp_m: null })));
  assert.equal(row(far, "atkomst_trinnfri").ok, null); assert.match(row(far, "atkomst_trinnfri").said, /1:15/); assert.equal(row(far, "rampe_stigning").ok, null);
});
test("a balcony: low railing over a drop and a narrow door break; balconies on a wing are listed as not measured", () => {
  const bal = { kind: "volume", id: "bk", name: "Balkong", from: [4.5, 0], to: [4.5, 3], bim: { part: "balcony", params: { railing_height: 0.9, ground: 10, depth: 0.8, door: true, door_width: 0.8, door_height: 2.1 } } };
  const rows = check(site(bal, { kind: "balconies", id: "w", name: "Balkonger", railing: "glass" }));
  assert.equal(row(rows, "balkong_rekkverk_hoyde", "bk").ok, false); assert.equal(row(rows, "balkong_dorbredde").ok, false); assert.equal(row(rows, "balkong_dorhoyde").ok, true);
  const wing = row(rows, "balkong_rekkverk_balkonger"); assert.equal(wing.ok, null); assert.equal(wing.status, "ikke målt");
  assert.ok(rows.every(r => r.ok !== undefined) && !rows.some(r => r.ok === true && r.status !== "ok"));
  assert.deepEqual(summary(rows), { ok: 1, brudd: 2, ikke_målt: 1 });
});
test("only what was asked: ids narrows to the tried change, and a site with nothing measurable gives an empty list", () => {
  const s = site(stair("x", {}), railing("y", {}, [4.5, 0]));
  assert.ok(check(s, { ids: new Set(["y"]) }).every(r => r.thing.id === "y"));
  assert.deepEqual(check(site({ kind: "volume", id: "z", name: "Hus", shape: "box" })), []);
});

/* the connector */
const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
let srv, rid = 0;
before(async () => {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => srv?.kill());
const rpc = async (method, params) => { const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
const call = async (name, args = {}) => { const r = await rpc("tools/call", { name, arguments: args }); return { ...r, data: r.structuredContent }; };

test("check_design is a read-only tool with target and draft, an output schema, and says what it is not", async () => {
  const t = (await rpc("tools/list")).tools.find(x => x.name === "check_design");
  assert.ok(t, "check_design is listed"); assert.equal(t.annotations?.readOnlyHint, true);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ["draft", "target"]);
  assert.ok(t.outputSchema.properties.checks && t.outputSchema.properties.ikke_målt);
  assert.match(t.description, /ikke målt.*never ok/); assert.match(t.description, /verify: true/); assert.match(t.description, /not a building permit/);
});
test("try_change carries checks[] for the change it tried; check_design reads the same rows back; an unrelated change carries none", async () => {
  const v = { kind: "volume", name: "Hus", shape: "box", from: [-15, -62], to: [5, -62], width: 12, height: 6, entrance: "sør" };
  const t = (await call("try_change", { edits: [v], include_screenshot: false })).data;
  assert.equal(t.rejected.length, 0, JSON.stringify(t.rejected));
  assert.ok(Array.isArray(t.checks) && t.checks.length === 2, JSON.stringify(t.added.map(a => [a.id, a.kind, a.ground?.entrance]).concat([t.checks])));
  const slope = t.checks.find(c => c.rule === "rampe_stigning");
  assert.equal(slope.section, "§ 8-6"); assert.match(slope.source, /dibk\.no/); assert.equal(slope.ok, true); assert.match(slope.value, /^1:\d+$/); assert.equal(slope.thing.name, "Hus"); assert.ok(slope.said.length > 10);
  const back = (await call("check_design", { draft: t.draft })).data;
  assert.deepEqual(back.checks, t.checks); assert.equal(back.counted, 2); assert.equal(back.ok + back.brudd + back.ikke_målt, 2);
  const steep = (await call("try_change", { draft: t.draft, edits: [{ ...v, name: "Bratt", from: [50, 40], to: [70, 40] }], include_screenshot: false })).data;
  assert.deepEqual(steep.checks.map(c => c.thing.name), ["Bratt", "Bratt"], "only the tried change's rows");
  assert.equal(steep.checks.find(c => c.rule === "atkomst_trinnfri").ok, null);
  const note = (await call("try_change", { draft: t.draft, edits: [{ kind: "note", text: "x", wing: "midtfloy" }], include_screenshot: false })).data;
  assert.equal(note.checks, undefined);
  assert.equal((await call("check_design", { draft: "nodraft1" })).isError, true);
  assert.equal((await call("check_design")).data.counted, 0);   // the before: nothing proposed, nothing to measure
});
