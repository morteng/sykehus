/* One part, many places (U3690, Morten 2026-10-26 12:36Z: «the system should be good at creating modules and re-using
   them»): the worker's part as IFC text (gulden-worker parts/, a part a size is one run) written into another IFC
   as often as it stands: its assembly, what the assembly holds, their property sets and quantities, each given its own
   GlobalIds, the part's own placement under the one the caller gives, its shape context the file's. The part's
   materials are the caller's (each product's material name comes back, the caller associates its own), and what is the
   part's own scaffolding (its project, site, building, storey, units, its wall, door opening, the per-element types) is
   left. The assembly's type is written once a size (typeLine) and the assemblies are occurrences of it (the caller's
   IfcRelDefinesByType).

   The part's file is read for what it says it has; one that lacks it is refused with a word, never copied half. */
import { parseIfc } from "./ifcfilter.mjs";

const refsOf = args => { const out = []; args.replace(/'(?:[^']|'')*'|#(\d+)/g, (m, d) => { if (d) out.push(+d); return m; }); return out; };
const list = s => [...s.matchAll(/#(\d+)/g)].map(m => +m[1]);

/* the part's file read once: { ents, assembly, type, place, ctx, products: [ids], keep: [ids to copy], material: Map(product → name) } */
export function readPart(text) {
  const { ents } = parseIfc(text), find = t => [...ents].find(([, e]) => e.type === t)?.[0];
  const assembly = find("IFCELEMENTASSEMBLY"), type = find("IFCELEMENTASSEMBLYTYPE"), ctx = [...ents].find(([, e]) => e.type === "IFCGEOMETRICREPRESENTATIONSUBCONTEXT" && /^'Body'/.test(e.args))?.[0];
  if (!assembly || !type || !ctx) throw new Error("Delen mangler sammenstillingen, typen eller formkonteksten: den er ikke den delen som ble bestilt");
  const place = list(ents.get(list(ents.get(assembly).args.split(",").slice(5, 6).join(","))[0]).args.split(",").slice(0, 1).join(","))[0];
  const products = new Set([assembly]), rels = [...ents].filter(([, e]) => e.type === "IFCRELAGGREGATES");
  for (let grew = true; grew;) { grew = false; for (const [, e] of rels) { const m = /,#(\d+),\(([^)]*)\)\s*$/.exec(e.args); if (m && products.has(+m[1])) for (const k of list(m[2])) if (!products.has(k)) { products.add(k); grew = true; } } }
  const keep = new Set(), material = new Map(), stop = new Set([place]);
  const walk = id => { if (keep.has(id) || stop.has(id) || !ents.has(id)) return; keep.add(id); for (const r of refsOf(ents.get(id).args)) walk(r); };
  for (const p of products) walk(p);
  for (const [id, e] of ents) {
    const m = /,\(([^)]*)\),#(\d+)\s*$/.exec(e.args), objs = m ? list(m[1]) : [];
    if (!objs.some(o => products.has(o))) continue;
    if (e.type === "IFCRELDEFINESBYPROPERTIES" && objs.every(o => products.has(o))) { keep.add(id); walk(+m[2]); }
    else if (e.type === "IFCRELASSOCIATESMATERIAL") { const name = /^'((?:[^']|'')*)'/.exec(ents.get(+m[2])?.args || "")?.[1]; for (const o of objs) if (products.has(o)) material.set(o, name); }
  }
  for (const [id, e] of ents) if (e.type === "IFCRELAGGREGATES") { const m = /,#(\d+),\(([^)]*)\)\s*$/.exec(e.args); if (m && products.has(+m[1])) keep.add(id); }
  keep.delete(type);
  return { ents, assembly, type, place, ctx, products: [...products], keep: [...keep], material };
}

const ROOTED = /^'[0-9A-Za-z_$]{22}'/;
/* write the part once more: reserve() → a fresh id, emit(id, text), gid(key) → a GlobalId; place: the id of the placement
   it stands under; body: the file's body context. → { assembly, products: [{ id, material }] } */
export function placePart(part, { reserve, emit, gid, key, place, body }) {
  const map = new Map(part.keep.map(id => [id, reserve()])), { ents } = part;
  for (const id of part.keep) {
    const e = ents.get(id);
    let args = e.args.replace(/'(?:[^']|'')*'|#(\d+)/g, (m, d) => {
      if (!d) return m; const n = +d;
      if (n === part.place) return "#" + place; if (n === part.ctx) return "#" + body;
      if (!map.has(n)) throw new Error(`Delen peker på #${n} som ikke fulgte med (${e.type}); delen er lest feil`);
      return "#" + map.get(n);
    });
    if (ROOTED.test(args)) args = args.replace(ROOTED, `'${gid(`${key}:${id}`)}'`);
    emit(map.get(id), `${e.type}(${args})`);
  }
  return { assembly: map.get(part.assembly), products: part.products.map(p => ({ id: map.get(p), material: part.material.get(p) })) };
}
/* the part's own type, as a line to write once a size: its GlobalId from key */
export function typeLine(part, gid, key) { const e = part.ents.get(part.type); return `${e.type}(${e.args.replace(ROOTED, `'${gid(key)}'`)})`; }
