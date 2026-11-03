/* U3930: the app runner on bygg (the shape U3928 proves on Fab): one script in one named app (FreeCAD first, for structures), so
   the long tail of app work is not one tool per feature. Not a shell: `app` comes from the short list below, the script gets no
   network and starts no programs, and it writes only inside its version's own folder (<versions dir>/_apps/<version id>/).
   The folder rule is the fence in tools/apprun_job.py, which runs on the FreeCAD worker (SYKEHUS_WORKER_FREECAD) with the
   folder's files; the files the run changed come back and are written here. Every run leaves one audit row (apps.log, one
   JSON line) with the whole script text, the exit code, the output tail and the files it changed.
   exit: 0 ran to its end, 1 stopped on an error, 2 refused by the fence, 3 never started, 4 stopped at the time limit. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

export const APPS = ["freecad"];   // the short named list; more as their rows land
export const KINDS = ["syntax", "unknown name", "geometry", "timeout", "write outside the folder", "other"];
const TAIL = 2000, MAX_SCRIPT = 1 << 20, TIMEOUT_S = +process.env.SYKEHUS_APP_TIMEOUT_S || 300;
const JOB = readFileSync(new URL("./tools/apprun_job.py", import.meta.url), "utf8");
const err = message => Object.assign(new Error(message), { tool: true });

/* a row is added only from a failure a real run had; none is invented */
const SUGGESTIONS = [
  ["unknown name", /name '([^']+)' is not defined/, n => `${n} er ikke et navn FreeCAD kjenner. Sjekk stavingen, eller importer modulen som har det (import Part, import Arch, import Draft).`],
  ["syntax", null, () => "Skriptet er ikke gyldig Python ennå. Rett linja rapporten nevner (ofte et kolon, en parentes eller et anførselstegn som mangler) og kjør det samme skriptet igjen."],
  ["geometry", /BRep_API: command not done/, () => "Formoperasjonen feilet i geometrikjernen. En avfasing eller avrunding som er større enn kanten tillater er vanligste årsak: bruk en mindre verdi, eller gjør legemet større."],
  ["geometry", /NULL shape/, () => "Legemet er tomt: et trinn over det feilet. Les app_state og rett det trinnet først."],
  ["timeout", null, () => "Kjøringen ble stoppet ved tidsgrensen. Rapporten sier hva den rakk; behold det og del skriptet i flere kjøringer."],
  ["write outside the folder", null, () => "Skriv bare i versjonens egen mappe: bruk et relativt filnavn (kjøringen starter i mappen), så havner fila der."],
];
export function suggestion(kind, error) {
  for (const [k, re, say] of SUGGESTIONS) { if (k !== kind) continue; const m = re ? re.exec(error || "") : []; if (m) return say(...m.slice(1)); }
  return null;
}
/* the model's correction material: what to fix and where */
export const feedback = r => ({ ok: !!r.ok, exit_code: r.exit ?? 0, error: r.error ?? null, error_kind: r.kind ?? null, failed_line: r.line ?? null, traceback_tail: r.traceback || [],
  suggestion: suggestion(r.kind, r.error), output_tail: String(r.output || "").slice(-TAIL) });

/* the plain-word receipt: what the run did, or that it only tried */
export function receipt(r, app, title) {
  const files = r.changed || [];
  if (r.ok) return files.length ? `Kjørte skriptet i ${app} på «${title}». Filer i versjonens mappe: ${files.join(", ")}.` : `Kjørte skriptet i ${app} på «${title}». Det laget eller endret ingen filer.`;
  const where = r.line?.n ? ` i linje ${r.line.n}` : "";
  const kept = files.length ? ` Før det stoppet laget det: ${files.join(", ")}.` : "";
  const how = { 2: "Skriptet ble stoppet av sperren", 3: "Skriptet startet ikke", 4: "Skriptet ble stoppet ved tidsgrensen" }[r.exit] || "Skriptet stoppet på en feil";
  return `${how}${where}: ${String(r.error || "").slice(0, 300)}. Bare prøvd, ikke gjort ferdig.${kept}`;
}

export function createAppRunner({ dir = process.env.SYKEHUS_VERSIONS_DIR, url = () => process.env.SYKEHUS_WORKER_FREECAD || process.env.GULDEN_WORKER_FREECAD, now = () => new Date() } = {}) {
  const root = join(dir || join(tmpdir(), "sykehus-data"), "_apps");
  const checkApp = app => { if (!APPS.includes(app)) throw err(`app må være en av: ${APPS.join(", ")}. Ingenting ble kjørt.`); return app; };
  const home = id => { if (!/^[A-Za-z0-9_-]{1,40}$/.test(id || "")) throw err("Ingen mappe for denne versjonen; ingenting ble kjørt."); const h = join(root, id); mkdirSync(h, { recursive: true }); return h; };
  const OK_NAME = /^[A-Za-z0-9._-]{1,80}$/;
  const files = h => Object.fromEntries(readdirSync(h).filter(n => !n.startsWith(".") && OK_NAME.test(n) && statSync(join(h, n)).isFile()).map(n => [n, readFileSync(join(h, n))]));
  const snap = h => Object.fromEntries(Object.entries(files(h)).map(([n, b]) => [n, createHash("sha256").update(b).digest("hex")]));
  const base = () => { const u = url(); if (!u) throw err("FreeCAD-arbeideren er ikke satt opp her (SYKEHUS_WORKER_FREECAD), så ingenting kan kjøres. Ingenting ble kjørt."); return u.replace(/\/+$/, ""); };
  const post = async (b, path, body, type) => { const r = await fetch(`${b}${path}`, { method: "POST", headers: { "content-type": type }, body, signal: AbortSignal.timeout((TIMEOUT_S + 60) * 1000) }); return r.json(); };

  /* one ask on the worker: the folder's files over, the ask in params.json, the changed files back */
  async function job(id, ask, seconds) {
    const h = home(id), b = base(), inputs = {}, restore = {};
    try {
      for (const [n, bytes] of Object.entries(files(h))) {
        const sha = createHash("sha256").update(bytes).digest("hex"), got = await post(b, "/blobs", bytes, "application/octet-stream");
        if (got.sha256 !== sha) throw new Error("fila kom ikke fram hel");
        inputs["in__" + n] = sha; restore["in__" + n] = n;
      }
      const j = await post(b, `/jobs?wait=${seconds + 30}`, JSON.stringify({ inputs, then: [], params: { ask, restore }, script: JOB, caps: { s: seconds } }), "application/json");
      const back = {};
      for (const [n, u] of Object.entries(j.files || {})) if (OK_NAME.test(n) && !n.startsWith("in__") && n !== "params.json" && !/^app_script/.test(n)) back[n] = Buffer.from(await (await fetch(`${b}${u}`, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
      return { j, back, h };
    } catch (e) { if (e.tool) throw e; throw err(`FreeCAD-arbeideren kunne ikke nås (${String(e.message).slice(0, 120)}). Ingenting ble kjørt.`); }
  }

  /* → the run's readings { ok, exit, kind, error, line, traceback, output, changed } */
  async function run({ app, id, script, title = id, by = null }) {
    checkApp(app); const src = String(script ?? "");
    if (!src.trim()) throw err("Skriptet er tomt. Ingenting ble kjørt.");
    if (Buffer.byteLength(src) > MAX_SCRIPT) throw err("Skriptet er lengre enn 1 MB. Ingenting ble kjørt.");
    const h = home(id), before = snap(h);
    const { j, back } = await job(id, { run: { src, name: "app_script.py" } }, TIMEOUT_S);
    for (const [n, bytes] of Object.entries(back)) if (createHash("sha256").update(bytes).digest("hex") !== before[n]) writeFileSync(join(h, n), bytes);
    const after = snap(h), changed = Object.keys({ ...before, ...after }).filter(n => before[n] !== after[n]).sort();
    const done = j.result?.done;
    let r;
    if (done && "ok" in done) r = { ok: !!done.ok, exit: done.exit ?? 1, kind: done.kind ?? null, error: done.error ?? null, line: done.line ?? null, traceback: done.traceback || [], output: String(done.output || "").slice(-TAIL), changed };
    else if (j.errors?.[0]?.code === "time_limit") r = { ok: false, exit: 4, kind: "timeout", error: `Kjøringen ble stoppet etter ${TIMEOUT_S} s; den ble ikke ferdig`, line: null, traceback: [], output: String(j.log || "").slice(-TAIL), changed };
    else r = { ok: false, exit: 1, kind: "other", error: `${app} stoppet og svarte ikke${j.errors?.[0]?.message ? `: ${String(j.errors[0].message).slice(0, 150)}` : ""}`, line: null, traceback: [], output: String(j.log || "").slice(-TAIL), changed };
    /* the audit row: the whole script text (it is no secret), who, which version, the exit code, the output tail, the files */
    try { appendFileSync(join(root, "apps.log"), JSON.stringify({ at: now().toISOString(), by, app, version: id, exit: r.exit, kind: r.kind, error: r.error, script: src, output: r.output, changed }) + "\n"); }
    catch (e) { console.error("apprun: audit row not written:", e.message); }
    return r;
  }

  /* what is in the version's work now: the documents opened from its folder, each object with its state */
  async function state({ app, id }) {
    checkApp(app); const h = home(id), want = Object.keys(files(h)).filter(n => n.toLowerCase().endsWith(".fcstd")).sort();
    const { j } = await job(id, { state: { open: want } }, 120), got = j.result?.done || {};
    const docs = got.documents || [], touched = [], failed = [];
    for (const d of docs) for (const o of d.objects || []) { if (o.touched) touched.push(o.label || o.name); if (o.failed) failed.push(o.label || o.name); }
    return { documents: docs, touched, failed, files: want, open_errors: got.open_errors || [], state_error: !docs.length && !(got.open_errors || []).length ? got.error || j.errors?.[0]?.message || null : null };
  }
  const auditRows = () => { const p = join(root, "apps.log"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []; };
  return { run, state, checkApp, home, auditRows, root };
}

/* the manual that rides with the runner (app_docs): short, for the building domain; the bygg skills (U3921, U3929) name the patterns */
export const DOCS = {
  freecad: {
    about: "FreeCAD 1.x scripts, run under freecadcmd in the version's own folder. Use it for structure and detail work no ready tool covers (a truss, a beam with a hole, a connection); the ready parts (list_parts) and try_change come first.",
    rules: [
      "The script starts in the version's own folder. Write files with relative names (FreeCAD.newDocument, doc.saveAs('bjelke.FCStd'), Part.export([shape], 'bjelke.step')); a write anywhere else is refused (exit 2).",
      "No network and no starting of other programs. Python and FreeCAD's own modules (FreeCAD, Part, Draft, Arch, Mesh) are there.",
      "Units are millimetres in FreeCAD: a 6 m beam is 6000. The model in try_change is in metres.",
      "A document saved as .FCStd stays in the folder; app_state then shows its objects and which failed. The same document is opened again by the next run.",
    ],
    example: "import FreeCAD, Part\ndoc = FreeCAD.newDocument('bjelke')\nb = doc.addObject('Part::Box', 'Bjelke')\nb.Length, b.Width, b.Height = 6000, 200, 400\nh = doc.addObject('Part::Cylinder', 'Hull')\nh.Radius, h.Height = 40, 200\nh.Placement.Base = FreeCAD.Vector(3000, 0, 200)\nh.Placement.Rotation = FreeCAD.Rotation(FreeCAD.Vector(1, 0, 0), -90)\ncut = doc.addObject('Part::Cut', 'BjelkeMedHull')\ncut.Base, cut.Tool = b, h\ndoc.recompute()\ndoc.saveAs('bjelke.FCStd')\nprint('volum mm3:', cut.Shape.Volume)",
    loop: "Read the receipt and feedback: ok, exit_code (0 ran, 1 error, 2 stopped by the folder rule, 3 never started, 4 time limit), failed_line, traceback_tail, error_kind, suggestion. Fix that line and run again; the work is kept between runs. Say to the person in plain words what the run did, or that it only tried.",
  },
};
