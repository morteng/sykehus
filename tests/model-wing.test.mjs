/* model_wing (U3650): Anton turns a kept wing into a real model in the draft's IFC. The worker is a stub that answers the
   envelope job with the base file where one wing's building holds walls, a slab, a roof, a window and a material (the shape ifc.py writes).
   Run: node --test tests/model-wing.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepText } from "../ifcfilter.mjs";

const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
let srv, worker, id = 0; const jobs = [];
/* the base IFC with the Østfløyen building given five elements, as ifc.py's envelope run writes them */
const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8")), WING = site.wings.find(w => w.id === "ostfloy");
const baseText = readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8");
function envelopeFile() {
  const lines = baseText.split("\n"); let n = 0; for (const l of lines) { const m = /^#(\d+)=/.exec(l); if (m) n = Math.max(n, +m[1]); }
  const bld = lines.map(l => /^#(\d+)=IFCBUILDING\('[^']*',[^,]*,'((?:[^']|'')*)'/.exec(l)).find(m => m && stepText(m[2]) === WING.name);
  assert.ok(bld, "the base has the wing's building");
  const at = ++n, ids = Array.from({ length: 5 }, () => ++n), mat = ++n, rel = ++n, rel2 = ++n;
  const els = [`#${ids[0]}=IFCWALL('w1',$,'Yttervegg',$,$,$,$,$,.NOTDEFINED.);`, `#${ids[1]}=IFCSLAB('s1',$,'Etasjeskille',$,$,$,$,$,.FLOOR.);`, `#${ids[2]}=IFCSLAB('s2',$,'Tak',$,$,$,$,$,.ROOF.);`, `#${ids[3]}=IFCWINDOW('x1',$,'Vindu',$,$,$,$,$,$,$,.WINDOW.,.NOTDEFINED.);`, `#${ids[4]}=IFCWALL('w2',$,'Yttervegg',$,$,$,$,$,.NOTDEFINED.);`,
    `#${mat}=IFCMATERIAL('Betong',$,'concrete');`, `#${rel}=IFCRELCONTAINEDINSPATIALSTRUCTURE('r1',$,$,$,(${ids.map(i => "#" + i).join(",")}),#${bld[1]});`, `#${rel2}=IFCRELASSOCIATESMATERIAL('r2',$,$,$,(#${ids[0]},#${ids[1]}),#${mat});`];
  void at; const end = lines.lastIndexOf("ENDSEC;");
  return [...lines.slice(0, end), ...els, ...lines.slice(end)].join("\n");
}
before(async () => {
  const file = envelopeFile();
  worker = createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => {
    if (req.url.startsWith("/files/")) return res.end(file);
    jobs.push(JSON.parse(Buffer.concat(b)));
    res.end(JSON.stringify({ state: "done", files: { "model.ifc": "/files/model.ifc" } }));
  }); });
  await new Promise(r => worker.listen(0, "127.0.0.1", r));
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_WORKER: `http://127.0.0.1:${worker.address().port}`, SYKEHUS_VERSIONS_DIR: mkdtempSync(join(tmpdir(), "mw-")) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => { srv?.kill(); worker?.close(); });
const call = async (name, args = {}) => {
  const r = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json();
  if (r.error) throw new Error(r.error.message); return { ...r.result, data: r.result.structuredContent };
};

test("«Gjør Østfløyen om til en ekte modell»: the draft's IFC has the wing's walls, slabs, windows and roof with materials, quoted", async () => {
  const d = (await call("try_change", { edits: [{ kind: "volume", id: "ntakhage", name: "Takhage", shape: "box", from: [30, -90], to: [40, -90], width: 6, height: 3, material: "wood", why: "test" }], include_screenshot: false })).data.draft;
  const r = await call("model_wing", { draft: d, wing: "Østfløyen" });
  assert.ok(!r.isError, JSON.stringify(r));
  for (const k of ["vegger", "dekker", "tak", "vinduer"]) assert.ok(r.data.contents[k] >= 1, k);   // the stub adds to the base block, so the counts are the base's plus its five
  assert.ok(r.data.materials.includes("Betong"));
  assert.match(r.data.say, /^Østfløy er nå en ekte modell i IFC-fila: \d+ \p{L}+.*materialer: .*Betong/u);
  assert.equal(jobs.length, 1); assert.deepEqual(jobs[0].params.envelope, [WING.id]); assert.match(jobs[0].script, /def build\(/);
  const ifc = await (await fetch(r.data.ifc)).text();
  assert.match(ifc, /IFCWINDOW\('x1'/); assert.match(ifc, /IFCSLAB\('s2'/);
  await call("model_wing", { draft: d, wing: WING.id });   // again: no second worker job
  assert.equal(jobs.length, 1);
});

test("a wing that does not exist is said, not guessed", async () => {
  const d = (await call("try_change", { edits: [{ kind: "volume", id: "ntakhage", name: "Takhage", shape: "box", from: [30, -90], to: [40, -90], width: 6, height: 3, material: "wood", why: "test" }], include_screenshot: false })).data.draft;
  const r = await call("model_wing", { draft: d, wing: "Månefløyen" });
  assert.ok(r.isError); assert.match(JSON.stringify(r.content), /Ukjent fløy/);
});
