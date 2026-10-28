/* The IFC of a draft or a version (U3542): the export of the before (public/data/sykehus.ifc, tools/ifc.py) without
   the wings the after tears down. ifc.py writes an IfcBuilding per wing, named as the wing; a wing goes when every
   building of it is gone (each wing is one building in site.json, so a wing goes whole). What the after builds is
   written in by ifcadd.mjs (U3556); the ground it planes is not in the file.

   The file is STEP, one entity a line (#n=IFCX(...);). Taking a wing out: its IfcBuilding and everything under it,
   down the aggregates, the containment, the openings and what fills them; then each relation that pointed at them is
   pruned (a list loses them, a relation whose single end is gone, or whose list is now empty, goes); then whatever
   only the removed things used (their placements, shapes, property sets) goes too, while what anything kept still
   uses (units, the context, the owner history, shared placements) stays. GlobalIds are untouched, so the file still
   compares with the before's element by element. */
const LINE = /^#(\d+)=([A-Z0-9_]+)\((.*)\);\s*$/;
const STR = /'(?:[^']|'')*'/g;
const refsOf = args => [...args.replace(STR, "''").matchAll(/#(\d+)/g)].map(m => +m[1]);
/* STEP's \X2\…\X0\ (UTF-16 in hex) back to text */
export const stepText = s => s.replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, h) => String.fromCharCode(...h.match(/.{4}/g).map(x => parseInt(x, 16)))).replace(/''/g, "'");

export function parseIfc(text) {
  const lines = text.split(/\r?\n/), ents = new Map();
  lines.forEach((l, i) => { const m = LINE.exec(l); if (m) ents.set(+m[1], { i, type: m[2], args: m[3] }); });
  return { lines, ents };
}

/* the buildings' names (as the wings are named) to take out → the file without them */
export function withoutBuildings(parsed, names, elements = []) {
  const { lines, ents } = parsed, want = new Set(names);
  const nameOf = e => stepText((/^'(?:[^']|'')*',[^,]*,'((?:[^']|'')*)'/.exec(e.args) || [])[1] || "");
  const roots = [...ents].filter(([, e]) => e.type === "IFCBUILDING" && want.has(nameOf(e))).map(([id]) => id), nBuildings = roots.length;
  /* elements = [[«IFCSLAB», «Balkongdekke»], …]: single elements to take out too (the built-in balconies a person's own replace) */
  for (const [id, e] of ents) if (elements.some(([t, n]) => e.type === t && nameOf(e) === n)) roots.push(id);
  if (!roots.length) return { text: lines.join("\n"), removed: [] };
  /* down from each building: what it aggregates and contains, an element's openings, what fills them */
  const down = new Map(), add = (a, b) => { if (!down.has(a)) down.set(a, []); down.get(a).push(b); };
  const list = s => (s.match(/#\d+/g) || []).map(x => +x.slice(1));
  for (const [, e] of ents) {
    const a = e.args.replace(STR, "''"), parts = a.split(/,(?![^(]*\))/);   // top-level arguments (lists kept whole)
    if (e.type === "IFCRELAGGREGATES") for (const c of list(parts[5])) add(list(parts[4])[0], c);
    else if (e.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") for (const c of list(parts[4])) add(list(parts[5])[0], c);
    else if (e.type === "IFCRELVOIDSELEMENT") add(list(parts[4])[0], list(parts[5])[0]);
    else if (e.type === "IFCRELFILLSELEMENT") add(list(parts[4])[0], list(parts[5])[0]);
  }
  const gone = new Set(), stack = [...roots];
  while (stack.length) { const id = stack.pop(); if (gone.has(id)) continue; gone.add(id); stack.push(...(down.get(id) || [])); }
  /* the relations: lists lose what is gone; a single end gone, or a list left empty, takes the relation */
  const out = new Map(), dropped = new Set();
  for (const [id, e] of ents) {
    if (gone.has(id) || !e.type.startsWith("IFCREL")) continue;
    let emptied = false;
    const args = e.args.replace(/\((#\d+(?:,#\d+)*)\)/g, (m, inner) => { const keep = inner.split(",").filter(r => !gone.has(+r.slice(1))); if (!keep.length) emptied = true; return `(${keep.join(",")})`; });
    const single = refsOf(args.replace(/\((#\d+(?:,#\d+)*)?\)/g, "()"));
    if (emptied || single.some(r => gone.has(r))) dropped.add(id); else if (args !== e.args) out.set(id, args);
  }
  /* what only the removed used: reachable from them, and not from anything kept */
  const reach = (from, skip) => { const seen = new Set(), st = [...from]; while (st.length) { const id = st.pop(); if (seen.has(id) || skip.has(id)) continue; seen.add(id); const e = ents.get(id); if (e) st.push(...refsOf(out.get(id) ?? e.args)); } return seen; };
  const off = new Set([...gone, ...dropped]);
  const theirs = reach([...off].flatMap(id => refsOf(ents.get(id).args)), new Set());
  const kept = reach([...ents.keys()].filter(id => !off.has(id) && !theirs.has(id)), off);
  for (const id of theirs) if (!kept.has(id)) off.add(id);
  const text = lines.filter((l, i) => { const m = /^#(\d+)=/.exec(l); return !m || !off.has(+m[1]); }).map(l => { const m = /^#(\d+)=([A-Z0-9_]+)\(/.exec(l); return m && out.has(+m[1]) ? `#${m[1]}=${m[2]}(${out.get(+m[1])});` : l; }).join("\n");
  return { text, removed: roots.slice(0, nBuildings).map(id => nameOf(ents.get(id))), removed_elements: roots.length - nBuildings, entities: off.size };
}
