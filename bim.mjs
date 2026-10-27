/* Constructions (U3570): a script Anton writes (IfcOpenShell, route B of the bake-off) run in the worker (gulden-worker,
   U3531), and what it made kept by the sha of the script and its parameters: model.ifc, model.glb and mesh.json (the
   triangles by IFC class, which the page and the server's picture draw). The edits carry the script and the sha
   (design.js shape "bim"); the files are made again from them if the folder is lost.

   SYKEHUS_WORKER (or GULDEN_WORKER): the worker's address on the internal network (gulden-worker, its own repo since
   U3587: http://gulden-worker:8070); without it a construction is
   refused with a plain word. The folder: SYKEHUS_VERSIONS_DIR/bim, else the system's temp. */
import { CLASS_MAT, MATERIALS, ifcMaterial } from "./public/renderkit/materials.js";   // the IFC classes in the materials the page and the picture draw (U3618)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bimPlace, baseOf, bimBody } from "./public/design.js";

const workerUrl = () => process.env.SYKEHUS_WORKER || process.env.GULDEN_WORKER;
const toolErr = message => Object.assign(new Error(message), { tool: true });
const DIR = join(process.env.SYKEHUS_VERSIONS_DIR || tmpdir(), "bim");
const FILES = { "mesh.json": "application/json", "model.ifc": "application/p21", "model.glb": "model/gltf-binary" };

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
    sandbox_unavailable: "Arbeideren kan ikke kjøre skript nå (sandkassa starter ikke der); si fra til den som drifter siden",
  }[e.code] || `Arbeideren svarte ikke som ventet (${j.state || "ukjent"})`;
  return say + (e.code === "script_error" && tail ? `\nSlutten av utskriften:\n${tail}` : "");
}

/* run (or find) a construction: { sha, box, classes, buildings, storeys, triangles, result } */
/* JSON for the script: a whole ground (12) as 12.0, since IfcOpenShell refuses an int in a point's coordinates */
const asJson = o => JSON.stringify(o).replace(/"ground":(-?\d+)(?=[,}])/, '"ground":$1.0');
export async function runBim(script, params) {
  const sha = shaOf(script, params), have = meshOf(sha);
  if (have) return { sha, ...summary(have), result: have.result ?? null };
  const W = workerUrl();
  if (!W) throw toolErr("Konstruksjoner bygges av arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  let j;
  try {
    const r = await fetch(`${W.replace(/\/+$/, "")}/jobs?wait=330`, { method: "POST", headers: { "content-type": "application/json" }, body: asJson({ script, params, then: ["mesh", "glb"] }), signal: AbortSignal.timeout(360000) });
    j = await r.json();
  } catch (e) { throw toolErr(`Fikk ikke kontakt med arbeideren: ${e.message}`); }
  if (j.state !== "done") throw toolErr(errorOf(j));
  const get = async f => Buffer.from(await (await fetch(`${W.replace(/\/+$/, "")}${j.files[f]}`, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const names = Object.keys(j.files || {}), ifc = names.includes("model.ifc") ? "model.ifc" : names.find(n => n.endsWith(".ifc")), glb = names.includes("model.glb") ? "model.glb" : names.find(n => n.endsWith(".glb"));
  if (!names.includes("mesh.json") || !ifc) throw toolErr("Skriptet skrev ingen IFC-fil med former: det skal skrive model.ifc");
  const mesh = JSON.parse((await get("mesh.json")).toString("utf8")); mesh.result = j.result ?? null;
  const tmp = join(DIR, `.${sha}.${process.pid}`); mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "mesh.json"), JSON.stringify(mesh)); writeFileSync(join(tmp, "model.ifc"), await get(ifc)); if (glb) writeFileSync(join(tmp, "model.glb"), await get(glb));
  writeFileSync(join(tmp, "script.py"), script); writeFileSync(join(tmp, "params.json"), asJson(params));
  if (!existsSync(join(DIR, sha))) renameSync(tmp, join(DIR, sha));
  return { sha, ...summary(mesh), result: mesh.result };
}
/* a part (U3620): one of the worker's own, built from its name and settings (GET /parts lists them); the materials table
   (renderkit) goes with the job so the IFC carries the app's materials. Kept by the sha of the part and its settings, the
   settings as the worker settled them (its defaults filled in). ground is the foot's kote, not a setting of the part. */
let partsAt = 0, partsList = null, partsAtUrl = {};
/* a part whose engine is FreeCAD (the stair) is built by the FreeCAD worker: the plain one lists it («here: false») and refuses
   its jobs (U3620: «No such part here»), so each part is asked for where it is built (SYKEHUS_WORKER_FREECAD, as STEP is) */
export const forgetParts = () => { partsList = null; };   // the list is kept a minute; a test or a changed worker asks again
const freecadUrl = () => process.env.SYKEHUS_WORKER_FREECAD || process.env.GULDEN_WORKER_FREECAD;
export async function listParts() {
  const W = workerUrl(); if (!W) throw toolErr("Deler bygges av arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  if (partsList && Date.now() - partsAt < 60000) return partsList;
  const get = async u => (await (await fetch(`${u.replace(/\/+$/, "")}/parts`, { signal: AbortSignal.timeout(15000) })).json()).parts || {};
  try {
    const list = await get(W), at = Object.fromEntries(Object.keys(list).map(k => [k, W])), F = freecadUrl();
    if (F && F.replace(/\/+$/, "") !== W.replace(/\/+$/, "")) {
      const more = await get(F).catch(() => ({}));
      for (const [k, v] of Object.entries(more)) if (v.here !== false && (!list[k] || list[k].here === false)) { list[k] = v; at[k] = F; }
    }
    partsList = list; partsAtUrl = at; partsAt = Date.now();
  }
  catch (e) { throw toolErr(`Fikk ikke kontakt med arbeideren: ${e.message}`); }
  return partsList;
}
const materialTable = () => Object.fromEntries(Object.keys(MATERIALS).map(k => [k, { ...ifcMaterial(k), density: MATERIALS[k].density ?? null }]));
export async function runPart(part, params, name) {
  const { ground, ...own } = params || {}, base = workerUrl();
  if (!base) throw toolErr("Deler bygges av arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  await listParts().catch(() => null);   // where each part is built
  const W = partsAtUrl[part] || base;
  let j, bad = null;
  try {
    const r = await fetch(`${W.replace(/\/+$/, "")}/jobs?wait=330`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part, params: own, ...(ground != null ? { ground: +ground } : {}), ...(name ? { name } : {}), materials: materialTable(), then: ["mesh", "glb"] }), signal: AbortSignal.timeout(360000) });
    j = await r.json(); if (!r.ok) bad = j.errors?.[0];
  } catch (e) { throw toolErr(`Fikk ikke kontakt med arbeideren: ${e.message}`); }
  if (bad) {
    const names = Object.keys(await listParts().catch(() => ({})));
    throw toolErr(bad.code === "bad_params" ? `Delen «${part}» tar ikke dette: ${bad.message}` : `${bad.message}${names.length ? ` (delene er ${names.join(", ")}: list_parts sier hva hver tar)` : ""}`);
  }
  if (j.state !== "done") throw toolErr(errorOf(j));
  const settled = j.result?.params || own, full = { ...settled, ...(ground != null ? { ground: +ground } : {}) }, sha = shaOf(`part:${part}`, full), have = meshOf(sha);
  if (have) return { sha, params: full, ...summary(have), result: have.result ?? null };
  const get = async f => Buffer.from(await (await fetch(`${W.replace(/\/+$/, "")}${j.files[f]}`, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  if (!j.files?.["mesh.json"] || !j.files?.["model.ifc"]) throw toolErr("Delen ga ingen IFC-fil med former.");
  const mesh = JSON.parse((await get("mesh.json")).toString("utf8")); mesh.result = j.result ?? null;
  const tmp = join(DIR, `.${sha}.${process.pid}`); mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "mesh.json"), JSON.stringify(mesh)); writeFileSync(join(tmp, "model.ifc"), await get("model.ifc")); if (j.files["model.glb"]) writeFileSync(join(tmp, "model.glb"), await get("model.glb"));
  writeFileSync(join(tmp, "params.json"), JSON.stringify({ part, params: full }));
  if (!existsSync(join(DIR, sha))) renameSync(tmp, join(DIR, sha));
  return { sha, params: full, ...summary(mesh), result: mesh.result };
}
/* a part's IFC text, run (or found) for these settings: for partmerge.mjs */
export async function partIfc(part, params) { const r = await runPart(part, params); return readFileSync(join(DIR, r.sha, "model.ifc"), "utf8"); }
const summary = m => ({ box: m.box, classes: m.classes, buildings: m.buildings, storeys: m.storeys, triangles: m.triangles });

/* a file brought in (U3571): an IFC (or a STEP, glTF, OBJ, STL made one) a person uploaded (a manufacturer's
   greenhouse, a window), kept by the sha of its bytes in the same folder (model.ifc as it came or as the worker made
   it, original.<ext> the file as it came, mesh.json, model.glb, source.json what was said of it).
   Its units are the file's (the worker's mesh is in metres whatever they are), its origin its own: the page stands
   its box's middle on from -> to and its foot on the ground, as a construction's. { file, box, size, unit, ... } */
export const MAX_IMPORT = 100 << 20;
/* the formats a file may come in (U3571 S2): IFC as it is; STEP (the FreeCAD worker), glTF, OBJ and STL through the
   worker's import step, which makes an IFC of it (metres, one IfcBuildingElementProxy per part, Z up). OBJ and STL
   say no unit: the person says it (unit), or the file is refused */
const UNIT_NAME = { m: "metre", dm: "decimetre", cm: "centimetre", mm: "millimetre", in: "inch", ft: "foot" };
function formatOf(bytes, filename) {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(filename || "")?.[1] || "").toLowerCase(), head = bytes.subarray(0, 4096).toString("latin1");
  if (/^\s*ISO-10303-21;/.test(head)) return /FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(head) ? "ifc" : "step";
  if (head.startsWith("glTF")) return "glb";
  if (ext === "gltf" && /^\s*\{/.test(head)) return "gltf";
  if (ext === "obj") return "obj";
  if (ext === "stl") return "stl";
  if (ext === "skp") throw toolErr("SketchUp-filer (.skp) kan ikke leses her: eksporter den fra SketchUp som IFC, glTF (.glb) eller OBJ.");
  if (ext === "dwg") { if (/^AC10\d\d/.test(head)) return "dwg"; throw toolErr("Det er ikke en DWG-fil AutoCAD kan ha skrevet (den begynner ikke med AC10..)."); }
  if (ext === "dxf") return "dxf";
  throw toolErr("Ukjent filtype: send IFC (.ifc), STEP (.step, .stp), glTF (.glb, .gltf), OBJ (.obj), STL (.stl), eller en tegning som DXF (.dxf) eller DWG (.dwg).");
}
export async function importFile(bytes, meta = {}) {
  if (!bytes?.length) throw toolErr("Fila er tom.");
  if (bytes.length > MAX_IMPORT) throw toolErr("Fila er større enn 100 MB.");
  /* bare: no unit in the file (OBJ, STL); a plan (DXF, DWG) says its own, mostly: the person's is used when it does not */
  const fmt = formatOf(bytes, meta.filename), bare = fmt === "obj" || fmt === "stl", plan = fmt === "dxf" || fmt === "dwg";
  const unit = meta.unit ? String(meta.unit).toLowerCase() : null, up = meta.up ? String(meta.up).toLowerCase() : null;
  if (unit && !UNIT_NAME[unit]) throw toolErr("Enheten er m, cm, mm, in eller ft.");
  if (up && up !== "y" && up !== "z") throw toolErr("Opp er y eller z.");
  if (bare && !unit) throw toolErr(`En ${fmt.toUpperCase()}-fil sier ikke hvilken enhet den er tegnet i: velg enheten (m, cm, mm, tommer, fot).`);
  const fileSha = createHash("sha256").update(bytes).digest("hex");
  /* the same bytes in another unit or way up are another thing: the key says what it was read as */
  const sha = bare || plan && unit ? createHash("sha256").update(bytes).update(`\0unit=${unit},up=${up || ""}`).digest("hex") : fileSha, have = meshOf(sha);
  if (have) return { file: sha, ...importSummary(have, rawSource(sha)), ...sourceOf(sha) };
  const W = fmt === "step" ? process.env.SYKEHUS_WORKER_FREECAD || process.env.GULDEN_WORKER_FREECAD : workerUrl();
  if (!W) throw toolErr(fmt === "step" ? "STEP leses av FreeCAD-arbeideren, som ikke er satt opp her (SYKEHUS_WORKER_FREECAD)." : "Filer leses av arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  const base = W.replace(/\/+$/, ""), ext = { ifc: "ifc", step: "step", glb: "glb", gltf: "gltf", obj: "obj", stl: "stl", dxf: "dxf", dwg: "dwg" }[fmt];
  const stem = (String(meta.filename || "").replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)) || "modell";
  const input = fmt === "ifc" ? "model.ifc" : `${stem}.${ext}`;
  let j;
  try {
    const b = await (await fetch(`${base}/blobs`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes, signal: AbortSignal.timeout(120000) })).json();
    if (b.sha256 !== fileSha) throw new Error(b.errors?.[0]?.message || "fila kom ikke fram");
    const job = { inputs: { [input]: fileSha }, then: fmt === "ifc" ? ["mesh"] : ["import", "mesh"], ...(unit || up ? { params: { ...(unit ? { unit } : {}), ...(up ? { up } : {}) } } : {}) };
    const r = await fetch(`${base}/jobs?wait=330`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job), signal: AbortSignal.timeout(360000) });
    j = await r.json();
  } catch (e) { throw toolErr(`Fikk ikke kontakt med arbeideren: ${e.message}`); }
  const why = j.errors?.[0]?.message || "";
  if (j.state !== "done" || !j.files?.["mesh.json"]) throw toolErr(/^no unit/.test(why) ? "Tegningen sier ikke hvilken enhet den er tegnet i: velg enheten og send den igjen." : /spans/.test(why) ? `Tegningen er for stor: noe ligger langt fra resten (${why.replace(/^the drawing spans ([\d.]+) km.*/, "$1 km")}). Slett det, eller send planen alene.` : /DWG/.test(why) ? `DWG-fila kunne ikke leses: ${why}. Lagre den som DXF og prøv igjen.` : /no geometry/.test(why) ? "Fila har ingen former arbeideren kan tegne (på lag som er på)." : /too many/.test(why) ? `Fila er for tung: ${why}` : /compressed|other files/.test(why) ? `glTF-fila kan ikke leses slik: ${why}` : `Arbeideren kunne ikke lese fila: ${why || j.state || "ukjent"}`);
  const get = async f => Buffer.from(await (await fetch(`${base}${j.files[f]}`, { signal: AbortSignal.timeout(120000) })).arrayBuffer());
  const mesh = JSON.parse((await get("mesh.json")).toString("utf8")), info = j.files["import.json"] ? JSON.parse((await get("import.json")).toString("utf8")) : null;
  const tmp = join(DIR, `.${sha}.${process.pid}`); mkdirSync(tmp, { recursive: true });
  const src = { filename: String(meta.filename || `modell.${ext}`).replace(/[\p{C}\/\\"<>]/gu, "_").slice(0, 120), bytes: bytes.length, format: fmt, by: meta.by ?? null, at: new Date().toISOString(),
    ...(meta.fetched_from ? { fetched_from: String(meta.fetched_from).slice(0, 300) } : {}), ...(meta.licence ? { licence: String(meta.licence).slice(0, 120) } : {}),
    ...(info ? { unit: info.unit, unit_from: info.unit_from, up: info.up, parts: info.parts, ...(info.segments ? { segments: info.segments, layers: info.names } : {}) } : {}) };
  writeFileSync(join(tmp, "mesh.json"), JSON.stringify(mesh)); writeFileSync(join(tmp, "source.json"), JSON.stringify(src));
  writeFileSync(join(tmp, "model.ifc"), fmt === "ifc" ? bytes : await get("model.ifc"));
  if (j.files["model.glb"]) writeFileSync(join(tmp, "model.glb"), await get("model.glb"));
  if (fmt !== "ifc") writeFileSync(join(tmp, `original.${ext}`), bytes);
  if (!existsSync(join(DIR, sha))) renameSync(tmp, join(DIR, sha));
  return { file: sha, ...importSummary(mesh, src), ...sourceOf(sha) };
}
/* the worker's model check (gulden-worker steps/ifccheck.py): one IFC (or two, for a diff) sent as blobs, one job of the step
   alone, its small answer back; cfg is the step's settings without the file names. The worker's failures in plain words. */
export async function checkIfc(files, cfg) {
  const W = workerUrl();
  if (!W) throw toolErr("Modellkontrollen kjører i arbeideren, som ikke er satt opp her (SYKEHUS_WORKER).");
  const base = W.replace(/\/+$/, ""), inputs = {};
  let j;
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const b = await (await fetch(`${base}/blobs`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes, signal: AbortSignal.timeout(120000) })).json();
      if (!/^[0-9a-f]{64}$/.test(b.sha256 || "")) throw new Error(b.errors?.[0]?.message || "fila kom ikke fram");
      inputs[name] = b.sha256;
    }
    const r = await fetch(`${base}/jobs?wait=330`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs, then: ["ifccheck"], ifccheck: { ...cfg, file: "model.ifc", ...(files["other.ifc"] ? { other: "other.ifc" } : {}) } }), signal: AbortSignal.timeout(360000) });
    j = await r.json();
  } catch (e) { throw toolErr(`Modellkontrollen kan ikke kjøre nå: arbeideren svarer ikke (${String(e.message).slice(0, 150)}). Prøv igjen om litt; si fra til den som drifter siden hvis det varer.`); }
  if (j.errors?.[0]?.code === "bad_request") throw toolErr("Modellkontrollen kan ikke kjøre nå: arbeideren er ikke oppdatert med kontrollen ennå (si fra til den som drifter siden).");
  if (j.state !== "done" || !j.ifccheck) throw toolErr(`Modellkontrollen feilet i arbeideren: ${j.errors?.[0]?.message || j.state || "ukjent"}`.slice(0, 400));
  return j.ifccheck;
}
const r2 = v => Math.round(v * 100) / 100;
/* the unit the file was in: an IFC's own (mesh.json), a STEP's read by FreeCAD (the file's, not said back), glTF's
   metres, an OBJ's or STL's as the person said */
const importSummary = (m, src = {}) => ({ ...summary(m), size_m: m.box ? [0, 1, 2].map(i => r2(m.box.max[i] - m.box.min[i])) : null, origin: m.box ? m.box.min : null,
  unit: !src.format || src.format === "ifc" ? m.unit ?? null : { length: src.format === "step" ? null : UNIT_NAME[src.unit] ?? null, from: src.unit_from ?? "file" } });
const rawSource = sha => { try { return JSON.parse(readFileSync(join(DIR, sha, "source.json"), "utf8")); } catch { return {}; } };
const sourceOf = sha => { const s = rawSource(sha); return s.filename ? { filename: s.filename, bytes: s.bytes, format: s.format || "ifc" } : {}; };
/* what was said of where a file came from: kept with the edit, shown on its card */
const said = (v, n, what) => { if (v == null || v === "") return undefined; const t = String(v).replace(/\s+/g, " ").trim(); if (t.length > n) throw toolErr(`${what} er høyst ${n} tegn`); return t; };
function importBim(e) {
  const file = String(e.file ?? "");
  if (!/^[0-9a-f]{64}$/.test(file)) throw toolErr("import trenger file: sha-en /api/import ga for fila");
  const m = meshOf(file); if (!m) throw toolErr("Fila finnes ikke her (lenger): last den opp igjen.");
  /* what was said with the edit, else what was kept when it was fetched (fetch_model: the URL, the library's licence) */
  const src = sourceOf(file), kept = rawSource(file), source = said(e.source, 300, "Kilden") ?? kept.fetched_from, licence = said(e.licence, 120, "Lisensen") ?? kept.licence;
  if (!licence) throw toolErr("Si lisensen fila har (fra produsentens side), eller «ukjent»");
  return { file, sha: file, script: null, params: {}, box: m.box, classes: m.classes, filename: src.filename, ...(src.format && src.format !== "ifc" ? { format: src.format } : {}), ...(source ? { source } : {}), licence };
}

/* the kote design.js stands a construction on: the lowest ground under its box's footprint over from -> to, or the
   roof it is on, or the kote asked */
const footOf = (site, from, to, box, at = {}) => Math.round(baseOf(site, { ...bimBody(from, to, box), on: at.on, base_kote: at.base_kote }) * 100) / 100;
/* run it so its IFC stands where the page draws it (pm 00:58Z: the script was given 12.7 from a guess at its width, the
   page stood its 30 m foot on 11.6): once its box is known, the foot under that box, and once more if it moved; and
   say so if the script did not put its foot at params.ground */
async function placed(site, run, p, from, to, at, asked) {
  let r = await run(p);
  if (!asked && r.box) { const g = footOf(site, from, to, r.box, at); if (Math.abs(g - p.ground) > 0.05) { p = { ...p, ground: g }; r = await run(p); } }
  const foot = r.box?.min?.[2];
  r = { ...r, foot_kote: p.ground, top_kote: r.box ? Math.round((p.ground + r.box.max[2] - r.box.min[2]) * 100) / 100 : null,
    ...(Number.isFinite(foot) && Math.abs(foot - p.ground) > 0.1 ? { warning: `The script's lowest point is at z ${foot}, not at params.ground ${p.ground}: the page stands it at ${p.ground}, the IFC has it at ${foot}. Put its foot at P['ground'].` } : {}) };
  return { r, p };
}

/* what the agent sends (construction; reshape with params) made into what design.js checks (volume shape bim; reshape
   with bim), after the worker ran it. site: the model as it stands (for the ground and the construction's script) */
export async function prepare(e, site) {
  /* on is a wing's id or name; the roof lookups (baseOf) take the id, so a name must not fall through to the ground */
  if (e?.on != null) { const k = String(e.on).toLowerCase().trim(), w = (site.wings || []).find(x => x.id === k || x.name.toLowerCase() === k); if (w) e = { ...e, on: w.id }; }
  /* a file brought in (U3571): placed like a construction, the box its file's */
  if (e?.kind === "import") {
    const { kind, file, source, licence, material, ...rest } = e, bim = importBim(e);
    const m = meshOf(bim.file), mat = material || (m.classes?.IfcAnnotation ? "steel" : m.classes?.IfcPlate || m.classes?.IfcWindow || m.classes?.IfcCurtainWall ? "glass" : "concrete");
    return { ...rest, name: rest.name || bim.filename?.replace(/\.[a-z0-9]{2,5}$/i, "") || "Innhentet", kind: "volume", shape: "bim", material: mat, bim, _ran: { file: bim.file, ...importSummary(m, rawSource(bim.file)) } };
  }
  /* a part (U3620): the worker's own, by name and settings; stands as a construction does */
  if (e?.kind === "part") {
    const { kind, part, params = {}, material, ...rest } = e, specs = await listParts(), spec = specs[part];
    if (!spec) throw toolErr(`Det finnes ingen del som heter «${part}». Delene er: ${Object.keys(specs).join(", ")} (list_parts sier hva hver tar).`);
    const pts = [e.from, e.to].every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)), L = pts ? Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) : 0;
    const p = { ...params }; if (p.ground == null && pts) p.ground = Math.round(baseOf(site, { from: e.from, to: e.to, width: Math.max(1, L), on: e.on, base_kote: e.base_kote }) * 100) / 100;
    const nm = rest.name || spec.no || part, { r, p: pp } = await placed(site, q => runPart(part, q, nm), p, e.from, e.to, { on: e.on, base_kote: e.base_kote }, params.ground != null || !pts);
    delete r.warning;   // a part's foot is its own (a pool basin is dug under the ground): its box says how deep
    if (params.ground != null && e.on == null && e.base_kote == null) rest.base_kote = pp.ground;
    if (r.box?.min?.[2] < -0.01 && e.on == null && rest.base_kote == null) rest.base_kote = Math.round((pp.ground + r.box.min[2]) * 100) / 100;
    const mat = material || (MATERIALS[r.params?.material] ? r.params.material : r.classes?.IfcPlate && !r.classes?.IfcSlab ? "glass" : "concrete");
    return { ...rest, name: nm, kind: "volume", shape: "bim", material: mat, bim: { part, script: null, params: r.params ?? pp, sha: r.sha, box: r.box, classes: r.classes, ...(spec.pad === false ? { nopad: true } : {}) }, _ran: r };
  }
  if (e?.kind === "construction") {
    const { kind, script, params = {}, material, ...rest } = e;
    if (typeof script !== "string" || !script.trim()) throw toolErr("construction trenger script: Python med IfcOpenShell som skriver model.ifc");
    /* ground: where design.js will stand its foot (the lowest ground under it, or the roof it is on), its from -> to
       taken as its width too until the script has said how wide it is */
    const pts = [e.from, e.to].every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)), L = pts ? Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) : 0;
    const p = { ...params }; if (p.ground == null && pts) p.ground = Math.round(baseOf(site, { from: e.from, to: e.to, width: Math.max(1, L), on: e.on, base_kote: e.base_kote }) * 100) / 100;
    const { r, p: pp } = await placed(site, q => runBim(script, q), p, e.from, e.to, { on: e.on, base_kote: e.base_kote }, params.ground != null || !pts);
    Object.assign(p, pp);
    if (!r.buildings) throw toolErr(`Skriptet laget ${Object.entries(r.classes || {}).map(([k, n]) => `${n} ${k}`).join(", ") || "ingenting"}, men ingen IfcBuilding: legg det under IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey`);
    const mat = material || (r.classes?.IfcPlate || r.classes?.IfcWindow ? "glass" : "concrete");
    /* a ground the agent set itself is the kote the page stands it on too */
    if (params.ground != null && e.on == null && e.base_kote == null) rest.base_kote = p.ground;
    return { ...rest, kind: "volume", shape: "bim", material: mat, bim: { script, params: p, sha: r.sha, box: r.box, classes: r.classes }, _ran: r };
  }
  /* a construction's parameters changed, or it moved or turned: its script again, its foot where it now stands */
  if (e?.kind === "reshape" && ((e.params && typeof e.params === "object") || e.from || e.to || e.on)) {
    const a = (site.added || []).find(x => x.id === String(e.id) && x.shape === "bim");
    if (!a) return e;
    /* a file brought in has no script: it moves and turns as it is */
    if (a.bim.file) { if (e.params) throw toolErr(`${a.name} er en innhentet fil: den har ingen parametre å endre`); return e; }
    const { params, ...rest } = e, from = e.from || a.from, to = e.to || a.to;
    const p0 = { ...a.bim.params, ...(params || {}) }; p0.ground = footOf(site, from, to, a.bim.box, { on: e.on ?? a.on });
    const { r, p } = await placed(site, a.bim.part ? q => runPart(a.bim.part, q, a.name) : q => runBim(a.bim.script, q), p0, from, to, { on: e.on ?? a.on }, false);
    return { ...rest, bim: a.bim.part ? { part: a.bim.part, script: null, params: r.params ?? p, sha: r.sha, box: r.box, classes: r.classes, ...(a.bim.nopad ? { nopad: true } : {}) } : { script: a.bim.script, params: p, sha: r.sha, box: r.box, classes: r.classes }, _ran: r };
  }
  /* a construction as it was kept (a draft's edits shown again, or replayed into one's own version): its script and
     parameters are what count; the sha, box and classes are what the worker makes of them here, never what was sent */
  if ((e?.kind === "volume" || e?.kind === "reshape") && e.bim && typeof e.bim === "object") {
    if (e.bim.file) return { ...e, bim: importBim(e.bim) };
    if (e.bim.part) { const r = await runPart(String(e.bim.part), e.bim.params || {}, e.name); return { ...e, bim: { part: e.bim.part, script: null, params: r.params, sha: r.sha, box: r.box, classes: r.classes, ...((await listParts().catch(() => ({})))[e.bim.part]?.pad === false ? { nopad: true } : {}) } }; }
    const { script, params = {} } = e.bim;
    if (typeof script !== "string" || !script.trim()) throw toolErr("bim trenger script");
    const r = await runBim(script, params);
    return { ...e, bim: { script, params, sha: r.sha, box: r.box, classes: r.classes } };
  }
  return e;
}
/* an edit as the agent is told of it: the script left out (it has it), what the worker made in */
export function slim(e) {
  if (!e?.bim || e.bim.file) return e;
  if (e.bim.part) return e;
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
  /* a file brought in downloads under the name it came with */
  const came = m[2] === "model.ifc" && sourceOf(m[1]).filename?.replace(/\.[^.]*$/, ".ifc"), name = came || `konstruksjon-${m[1].slice(0, 8)}.${m[2].split(".")[1]}`;
  res.writeHead(200, { ...SECURITY, "content-type": FILES[m[2]], "cache-control": "public, max-age=31536000, immutable",
    ...(m[2] !== "mesh.json" ? { "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}` } : {}) });
  res.end(readFileSync(f));
}
