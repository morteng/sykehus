/* Constructions (U3570): a script Anton writes (IfcOpenShell, route B of the bake-off) run in the worker (worker/,
   U3531), and what it made kept by the sha of the script and its parameters: model.ifc, model.glb and mesh.json (the
   triangles by IFC class, which the page and the server's picture draw). The edits carry the script and the sha
   (design.js shape "bim"); the files are made again from them if the folder is lost.

   SYKEHUS_WORKER: the worker's address on the internal network (http://worker:8070); without it a construction is
   refused with a plain word. The folder: SYKEHUS_VERSIONS_DIR/bim, else the system's temp. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bimPlace, baseOf } from "./public/design.js";

const toolErr = message => Object.assign(new Error(message), { tool: true });
const DIR = join(process.env.SYKEHUS_VERSIONS_DIR || tmpdir(), "bim");
const FILES = { "mesh.json": "application/json", "model.ifc": "application/p21", "model.glb": "model/gltf-binary" };
/* the IFC classes in the five colours the page and the picture have */
export const CLASS_MAT = { IfcMember: "steel", IfcBeam: "steel", IfcColumn: "steel", IfcRailing: "steel", IfcPlate: "glass", IfcWindow: "glass", IfcCurtainWall: "glass",
  IfcSlab: "concrete", IfcWall: "concrete", IfcFooting: "concrete", IfcStair: "concrete", IfcRoof: "concrete", IfcDoor: "wood", IfcCovering: "wood", IfcFurnishingElement: "wood" };

export const shaOf = (script, params) => createHash("sha256").update(script + "\0" + JSON.stringify(Object.keys(params).sort().map(k => [k, params[k]]))).digest("hex");
const meshOf = sha => { try { return JSON.parse(readFileSync(join(DIR, sha, "mesh.json"), "utf8")); } catch { return null; } };

/* the worker's words in the page's language, with what the script printed last, for Anton to fix it from */
function errorOf(j) {
  const e = j.errors?.[0] || {}, tail = String(j.log || "").trim().split("\n").slice(-12).join("\n").slice(-1500);
  const say = {
    script_error: `Skriptet feilet${e.line ? ` på linje ${e.line}` : ""}: ${e.message}`,
    no_output: "Skriptet skrev ingen IFC-fil: det skal skrive model.ifc",
    time_limit: "Skriptet brukte mer enn 300 sekunder",
    memory_limit: "Skriptet brukte mer minne enn det får (4 GB)",
    network_refused: "Skriptet prøvde å nå nettet; arbeideren har ikke nett",
    file_refused: "Skriptet prøvde å skrive utenfor sin egen mappe; bare den kan skrives",
    too_big: "Det skriptet laget er større enn 64 MB",
  }[e.code] || `Arbeideren svarte ikke som ventet (${j.state || "ukjent"})`;
  return say + (e.code === "script_error" && tail ? `\nSlutten av utskriften:\n${tail}` : "");
}

/* run (or find) a construction: { sha, box, classes, buildings, storeys, triangles, result } */
export async function runBim(script, params) {
  const sha = shaOf(script, params), have = meshOf(sha);
  if (have) return { sha, ...summary(have), result: have.result ?? null };
  const W = process.env.SYKEHUS_WORKER;
  if (!W) throw toolErr("Konstruksjoner bygges av arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  let j;
  try {
    const r = await fetch(`${W.replace(/\/+$/, "")}/jobs?wait=330`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ script, params, then: ["mesh", "glb"] }), signal: AbortSignal.timeout(360000) });
    j = await r.json();
  } catch (e) { throw toolErr(`Fikk ikke kontakt med arbeideren: ${e.message}`); }
  if (j.state !== "done") throw toolErr(errorOf(j));
  const get = async f => Buffer.from(await (await fetch(`${W.replace(/\/+$/, "")}${j.files[f]}`, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const names = Object.keys(j.files || {}), ifc = names.includes("model.ifc") ? "model.ifc" : names.find(n => n.endsWith(".ifc")), glb = names.includes("model.glb") ? "model.glb" : names.find(n => n.endsWith(".glb"));
  if (!names.includes("mesh.json") || !ifc) throw toolErr("Skriptet skrev ingen IFC-fil med former: det skal skrive model.ifc");
  const mesh = JSON.parse((await get("mesh.json")).toString("utf8")); mesh.result = j.result ?? null;
  const tmp = join(DIR, `.${sha}.${process.pid}`); mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "mesh.json"), JSON.stringify(mesh)); writeFileSync(join(tmp, "model.ifc"), await get(ifc)); if (glb) writeFileSync(join(tmp, "model.glb"), await get(glb));
  writeFileSync(join(tmp, "script.py"), script); writeFileSync(join(tmp, "params.json"), JSON.stringify(params));
  if (!existsSync(join(DIR, sha))) renameSync(tmp, join(DIR, sha));
  return { sha, ...summary(mesh), result: mesh.result };
}
const summary = m => ({ box: m.box, classes: m.classes, buildings: m.buildings, storeys: m.storeys, triangles: m.triangles });

/* what the agent sends (construction; reshape with params) made into what design.js checks (volume shape bim; reshape
   with bim), after the worker ran it. site: the model as it stands (for the ground and the construction's script) */
export async function prepare(e, site) {
  if (e?.kind === "construction") {
    const { kind, script, params = {}, material, ...rest } = e;
    if (typeof script !== "string" || !script.trim()) throw toolErr("construction trenger script: Python med IfcOpenShell som skriver model.ifc");
    /* ground: where design.js will stand its foot (the lowest ground under it, or the roof it is on), its from -> to
       taken as its width too until the script has said how wide it is */
    const pts = [e.from, e.to].every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)), L = pts ? Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) : 0;
    const p = { ...params }; if (p.ground == null && L > 0) p.ground = Math.round(baseOf(site, { from: e.from, to: e.to, width: L, on: e.on, base_kote: e.base_kote }) * 100) / 100;
    const r = await runBim(script, p);
    if (!r.buildings) throw toolErr(`Skriptet laget ${Object.entries(r.classes || {}).map(([k, n]) => `${n} ${k}`).join(", ") || "ingenting"}, men ingen IfcBuilding: legg det under IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey`);
    const mat = material || (r.classes?.IfcPlate || r.classes?.IfcWindow ? "glass" : "concrete");
    return { ...rest, kind: "volume", shape: "bim", material: mat, bim: { script, params: p, sha: r.sha, box: r.box, classes: r.classes }, _ran: r };
  }
  if (e?.kind === "reshape" && e.params && typeof e.params === "object") {
    const a = (site.added || []).find(x => x.id === String(e.id) && x.shape === "bim");
    if (!a) return e;
    const { params, ...rest } = e, p = { ...a.bim.params, ...params, ground: Math.round(a.base_kote * 100) / 100 };   // where it stands now
    const r = await runBim(a.bim.script, p);
    return { ...rest, bim: { script: a.bim.script, params: p, sha: r.sha, box: r.box, classes: r.classes }, _ran: r };
  }
  /* a construction as it was kept (a draft's edits shown again, or replayed into one's own version): its script and
     parameters are what count; the sha, box and classes are what the worker makes of them here, never what was sent */
  if ((e?.kind === "volume" || e?.kind === "reshape") && e.bim && typeof e.bim === "object") {
    const { script, params = {} } = e.bim;
    if (typeof script !== "string" || !script.trim()) throw toolErr("bim trenger script");
    const r = await runBim(script, params);
    return { ...e, bim: { script, params, sha: r.sha, box: r.box, classes: r.classes } };
  }
  return e;
}
/* an edit as the agent is told of it: the script left out (it has it), what the worker made in */
export function slim(e) {
  if (!e?.bim) return e;
  const { script, ...b } = e.bim;
  return { ...e, bim: { ...b, script_chars: script.length } };
}

/* the model with each construction's triangles in place, for the server's picture (look.js draws tris) */
export function withMeshes(site) {
  if (!(site.added || []).some(a => a.shape === "bim")) return site;
  return { ...site, added: site.added.map(a => {
    if (a.shape !== "bim") return a;
    const m = meshOf(a.bim.sha); if (!m) return a;
    const at = bimPlace(a, a.base_kote), parts = [];
    for (const p of m.parts) {
      const v = i => at([p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]]), tris = [];
      for (let k = 0; k + 2 < p.idx.length; k += 3) tris.push([v(p.idx[k]), v(p.idx[k + 1]), v(p.idx[k + 2])]);
      parts.push({ axis: [a.from, a.to], tris, mat: CLASS_MAT[p.cls] || "concrete", role: "volume" });
    }
    return { ...a, parts };
  }) };
}

/* GET /api/bim/<sha>/<mesh.json | model.ifc | model.glb>: what a construction made; the same sha is the same file */
export function handleBim(req, res, rest, SECURITY = {}) {
  const m = /^([0-9a-f]{64})\/(mesh\.json|model\.ifc|model\.glb)$/.exec(rest);
  const f = m && join(DIR, m[1], m[2]);
  if (!f || !existsSync(f)) return res.writeHead(404, { ...SECURITY, "content-type": "application/json" }).end(JSON.stringify({ error: "Finnes ikke." }));
  res.writeHead(200, { ...SECURITY, "content-type": FILES[m[2]], "cache-control": "public, max-age=31536000, immutable",
    ...(m[2] !== "mesh.json" ? { "content-disposition": `attachment; filename="konstruksjon-${m[1].slice(0, 8)}.${m[2].split(".")[1]}"` } : {}) });
  res.end(readFileSync(f));
}
