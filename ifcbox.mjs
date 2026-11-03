/* The size of each part in an IFC, read without a geometry kernel (U3631): the box of every part the export wrote
   (Pset Sykehustomta_Del, Id = the part's id in the version) in the part's own frame (along its axis, across it, up), in
   metres. FreeCAD writes the file back in its own way (millimetres, its own entity numbers, the assembly flattened or
   not), so a part is found by its Id in the property set, or else by the GlobalId of the assembly the export gave it, and
   its geometry is read as the points of what it is made of: extruded profiles, swept discs, breps and triangle sets,
   placed by the chain of local placements. A box of the points, which is what a stair made wider changes. */
import { parseIfc } from "./ifcfilter.mjs";

/* the top-level arguments of a STEP entity: a list is one argument, a string with commas is one */
export function splitArgs(s) {
  const out = []; let d = 0, q = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "'") { if (s[i + 1] === "'") { cur += "'"; i++; } else q = false; } continue; }
    if (c === "'") { q = true; cur += c; } else if (c === "(") { d++; cur += c; } else if (c === ")") { d--; cur += c; }
    else if (c === "," && d === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
const refs = s => [...(s || "").matchAll(/#(\d+)/g)].map(m => +m[1]);
const ref = s => { const m = /^#(\d+)$/.exec((s || "").trim()); return m ? +m[1] : null; };
const nums = s => [...(s || "").matchAll(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/g)].map(m => +m[0]);
const str = s => { const m = /^'((?:[^']|'')*)'$/.exec((s || "").trim()); return m ? m[1].replace(/''/g, "'") : null; };
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const IDENT = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const apply = (M, p) => [0, 1, 2].map(k => M.o[k] + (p[0] || 0) * M.x[k] + (p[1] || 0) * M.y[k] + (p[2] || 0) * M.z[k]);
const turn = (P, v) => [0, 1, 2].map(k => v[0] * P.x[k] + v[1] * P.y[k] + v[2] * P.z[k]);
const compose = (P, R) => ({ o: apply(P, R.o), x: turn(P, R.x), y: turn(P, R.y), z: turn(P, R.z) });

export const PSET = "Sykehustomta_Del";

/* the file read: { id → { min, max } } in the frames asked for, the GlobalId → id of the parts' assemblies, the unit */
export function readParts(text, frames = new Map(), known = new Map()) {
  const { ents } = parseIfc(text), E = id => ents.get(id), A = id => splitArgs(E(id)?.args ?? "");
  let scale = 1;
  for (const [, e] of ents) if (e.type === "IFCSIUNIT" && /\.LENGTHUNIT\./.test(e.args)) scale = { MILLI: 1e-3, CENTI: 1e-2, DECI: 0.1, KILO: 1e3 }[(/\.([A-Z]+)\.,\.METRE\./.exec(e.args) || [])[1]] ?? 1;
  const point = id => nums(A(id)[0]).slice(0, 3);
  const dir = (s, d) => { const r = ref(s); return r ? nums(A(r)[0]) : d; };
  const axis3 = id => { if (id == null || !E(id)) return IDENT; const a = A(id), o = point(ref(a[0])), z = norm(dir(a[1], [0, 0, 1])), x0 = dir(a[2], Math.abs(z[0]) < 0.99 ? [1, 0, 0] : [0, 1, 0]), k = dot(x0, z), x = norm(x0.map((v, i) => v - k * z[i])); return { o: [o[0], o[1], o[2] ?? 0], x, y: cross(z, x), z }; };
  const axis2 = id => { if (id == null || !E(id)) return IDENT; const a = A(id), o = point(ref(a[0])), x = norm(dir(a[1], [1, 0, 0])); return { o: [o[0], o[1], 0], x: [x[0], x[1], 0], y: [-x[1], x[0], 0], z: [0, 0, 1] }; };
  const placed = new Map();
  const place = id => { if (id == null || !E(id)) return IDENT; if (placed.has(id)) return placed.get(id); const a = A(id), here = axis3(ref(a[1])), M = ref(a[0]) ? compose(place(ref(a[0])), here) : here; placed.set(id, M); return M; };
  const curve = id => { const t = E(id)?.type; if (t === "IFCPOLYLINE") return refs(A(id)[0]).map(point); if (t === "IFCINDEXEDPOLYCURVE") { const l = ref(A(id)[0]); return l ? (E(l).args.match(/\(\s*-?[\d.eE+-]+\s*,\s*-?[\d.eE+-]+(?:\s*,\s*-?[\d.eE+-]+)?\s*\)/g) || []).map(nums) : []; } return []; };
  const profile = id => {
    const t = E(id)?.type, a = A(id); if (!t) return [];
    if (t === "IFCARBITRARYCLOSEDPROFILEDEF" || t === "IFCARBITRARYPROFILEDEFWITHVOIDS") return curve(ref(a[2]));
    const M = axis2(ref(a[2]));
    if (t === "IFCRECTANGLEPROFILEDEF" || t === "IFCROUNDEDRECTANGLEPROFILEDEF") { const w = +a[3] / 2, h = +a[4] / 2; return [[-w, -h], [w, -h], [w, h], [-w, h]].map(p => apply(M, p)); }
    if (t === "IFCCIRCLEPROFILEDEF" || t === "IFCCIRCLEHOLLOWPROFILEDEF") { const r = +a[3]; return [[r, 0], [-r, 0], [0, r], [0, -r]].map(p => apply(M, p)); }
    return [];
  };
  const item = (id, depth = 0) => {
    const t = E(id)?.type, a = A(id); if (!t || depth > 6) return [];
    if (t === "IFCEXTRUDEDAREASOLID") { const M = axis3(ref(a[1])), d = norm(dir(a[2], [0, 0, 1])), L = +a[3]; return profile(ref(a[0])).flatMap(p => [apply(M, [p[0], p[1], 0]), apply(M, [p[0] + d[0] * L, p[1] + d[1] * L, d[2] * L])]); }
    if (t === "IFCSWEPTDISKSOLID") { const r = +a[1]; return curve(ref(a[0])).flatMap(p => [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map(d => p.map((v, i) => v + d[i]))); }
    if (t === "IFCFACETEDBREP" || t === "IFCFACETEDBREPWITHVOIDS") { const out = []; for (const f of refs(A(ref(a[0]))[0])) for (const b of refs(A(f)[0])) { const l = ref(A(b)[0]); if (l) out.push(...refs(A(l)[0]).map(point)); } return out; }
    if (t === "IFCTRIANGULATEDFACESET" || t === "IFCPOLYGONALFACESET") { const l = ref(a[0]); return l ? (E(l).args.match(/\([^()]+\)/g) || []).map(nums).filter(p => p.length >= 3) : []; }
    if (t === "IFCBOOLEANCLIPPINGRESULT" || t === "IFCBOOLEANRESULT") return item(ref(a[1]), depth + 1);
    if (t === "IFCMAPPEDITEM") {
      const src = A(ref(a[0])), M = axis3(ref(src[0])), tr = A(ref(a[1])), o = point(ref(tr[2])), k = +tr[3] || 1, rep = ref(src[1]);
      return (rep ? repPoints(rep, depth + 1) : []).map(p => apply(M, p)).map(p => [p[0] * k + (o[0] || 0), p[1] * k + (o[1] || 0), p[2] * k + (o[2] || 0)]);
    }
    return [];
  };
  const repPoints = (id, depth = 0) => refs(A(id)[3]).flatMap(i => item(i, depth));
  const bodyOf = id => { const a = A(id), d = ref(a[6]); if (!d) return []; return refs(A(d)[2]).filter(r => E(r)?.type === "IFCSHAPEREPRESENTATION" && /Body/.test(A(r)[1])).flatMap(r => repPoints(r)); };
  const worldPoints = id => { const a = A(id), M = ref(a[5]) ? place(ref(a[5])) : IDENT; return bodyOf(id).map(p => apply(M, p).map(v => v * scale)); };

  /* what each object holds: the Id its property set gives it; the assemblies' parts */
  const down = new Map(), idOf = new Map(), gidOf = new Map();
  for (const [, e] of ents) if (e.type === "IFCRELAGGREGATES") { const a = splitArgs(e.args), p = ref(a[4]); if (p) down.set(p, [...(down.get(p) || []), ...refs(a[5])]); }
  for (const [, e] of ents) {
    if (e.type !== "IFCRELDEFINESBYPROPERTIES") continue;
    const a = splitArgs(e.args), pset = ref(a[5]); if (!pset || E(pset)?.type !== "IFCPROPERTYSET") continue;
    const p = A(pset); if (str(p[2]) !== PSET) continue;
    const prop = refs(p[4]).map(r => splitArgs(E(r).args)).find(q => str(q[0]) === "Id"), v = prop && /\('((?:[^']|'')*)'\)/.exec(prop[2])?.[1];
    if (v) for (const o of refs(a[4])) idOf.set(o, v);
  }
  const reach = root => { const all = new Set(), go = i => { if (all.has(i)) return; all.add(i); for (const k of down.get(i) || []) go(k); }; go(root); return all; };
  const sets = new Map();   // id → Set of objects
  for (const [o, v] of idOf) { const s = sets.get(v) || sets.set(v, new Set()).get(v); for (const k of reach(o)) s.add(k); }
  for (const [id, e] of ents) if (e.type === "IFCELEMENTASSEMBLY") { const g = str(splitArgs(e.args)[0]); if (g) { gidOf.set(g, id); } }
  const byGid = g => { const root = gidOf.get(g); return root ? reach(root) : null; };
  const parts = new Map(), gids = new Map();
  const boxOf = (objs, frame) => {
    const u = frame?.u ?? [1, 0], v = [-u[1], u[0]]; let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], n = 0;
    for (const o of objs) if (E(o) && ref(A(o)[6])) for (const p of worldPoints(o)) { const q = [p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1], p[2]]; n++; for (let k = 0; k < 3; k++) { if (q[k] < min[k]) min[k] = q[k]; if (q[k] > max[k]) max[k] = q[k]; } }
    return n ? { min, max, n } : null;
  };
  for (const [v, objs] of sets) {
    const b = boxOf(objs, frames.get(v)); if (b) parts.set(v, b);
    for (const o of objs) if (E(o)?.type === "IFCELEMENTASSEMBLY") gids.set(str(splitArgs(E(o).args)[0]), v);
  }
  /* an Id the property set lost: the assembly whose GlobalId the export gave it */
  for (const [g, v] of known) if (!parts.has(v)) { const objs = byGid(g); const b = objs && boxOf(objs, frames.get(v)); if (b) parts.set(v, b); }
  return { parts, gids, scale };
}
