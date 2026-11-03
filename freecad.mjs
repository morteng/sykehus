/* A version through FreeCAD and back (U3631). Out: GET /api/ifc?versjon=…&for=freecad (ifcadd.mjs: one project, each part of the
   worker's an assembly with its type, its Id in the version in the set Sykehustomta_Del). Back: the file FreeCAD saved is read
   for the size of each of those parts (ifcbox.mjs) and held against the same part in the file that went out; what grew, shrank
   or moved becomes one reshape of that part, with its settings changed (width, height, length) and where it now stands, so
   the version takes the change in Forslag as any other and the part keeps its id. A part FreeCAD did not give back is left
   as it is, and said. */
import { readParts } from "./ifcbox.mjs";

const TOL_SIZE = 0.02, TOL_MOVE = 0.05;   // m: under this FreeCAD's rounding, not a hand
const r2 = v => Math.round(v * 100) / 100;
/* the setting each way of a part is, in the order tried: along its axis, across it, up */
const KEYS = [["length"], ["width", "bredde"], ["height", "depth"]];
const WAY = ["lengde", "bredde", "høyde"];
const m = v => String(r2(v)).replace(".", ",");

/* the parts of an after the worker made (a volume with a part), each with the way its axis runs */
export function partsOf(added) {
  const out = new Map();
  for (const a of added || []) if (a.kind === "volume" && a.bim?.part && a.from && a.to) { const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) || 1; out.set(a.id, { ...a, u: [(a.to[0] - a.from[0]) / L, (a.to[1] - a.from[1]) / L] }); }
  return out;
}

/* → { edits: [reshape …], changed: [{ id, name, say }], same: n, missing: [name] } */
export function reshapesFrom(oldText, newText, added) {
  const parts = partsOf(added), frames = new Map([...parts].map(([id, a]) => [id, { u: a.u }]));
  const was = readParts(oldText, frames), now = readParts(newText, frames, was.gids);
  const edits = [], changed = [], missing = []; let same = 0;
  for (const [id, a] of parts) {
    const b0 = was.parts.get(id), b1 = now.parts.get(id);
    if (!b0) continue;   // not in the file that went out (the export is of an older version): nothing to compare
    if (!b1) { missing.push(a.name); continue; }
    const ext0 = b0.min.map((v, k) => b0.max[k] - v), ext1 = b1.min.map((v, k) => b1.max[k] - v), c0 = b0.min.map((v, k) => (v + b0.max[k]) / 2), c1 = b1.min.map((v, k) => (v + b1.max[k]) / 2);
    const d = ext1.map((v, k) => v - ext0[k]), params = a.bim.params || {}, set = {}, say = [];
    let len = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < TOL_SIZE) continue;
      const key = KEYS[k].find(q => Number.isFinite(+params[q]));
      if (key) { const was = +params[key]; set[key] = r2(was + d[k]); say.push(`${WAY[k]} ${m(was)} → ${m(set[key])} m`); }
      else if (k === 0) { len = Math.max(0.1, len + d[0]); say.push(`lengde ${m(Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]))} → ${m(len)} m`); }
      else say.push(`${WAY[k]} endret ${m(d[k])} m, men delen har ingen innstilling for det`);
    }
    const [u, v] = [a.u, [-a.u[1], a.u[0]]], shift = [c1[0] - c0[0], c1[1] - c0[1]], moved = Math.abs(shift[0]) >= TOL_MOVE || Math.abs(shift[1]) >= TOL_MOVE;
    const sized = say.some(q => !/ingen innstilling/.test(q));
    if (!sized && !moved) { same++; continue; }
    /* the part stands on its from and to, its middle between them: the middle FreeCAD gives it is where it now stands */
    const mid = [(a.from[0] + a.to[0]) / 2 + u[0] * shift[0] + v[0] * shift[1], (a.from[1] + a.to[1]) / 2 + u[1] * shift[0] + v[1] * shift[1]];
    const from = [r2(mid[0] - u[0] * len / 2), r2(mid[1] - u[1] * len / 2)], to = [r2(mid[0] + u[0] * len / 2), r2(mid[1] + u[1] * len / 2)];
    if (moved) say.push(`flyttet ${m(Math.hypot(...shift))} m`);
    edits.push({ kind: "reshape", id, ...(Object.keys(set).length ? { params: set } : {}), ...(moved || len !== Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) ? { from, to } : {}) });
    changed.push({ id, name: a.name, say: say.join(", ") });
  }
  return { edits, changed, same, missing };
}
