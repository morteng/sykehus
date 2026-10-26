/* What the after builds, in its IFC (U3556): the export of the before (ifcfilter.mjs takes out what is torn down) with
   the after's new buildings written in, and the wings it renames or gives new facts under their new name.

   A new building (a volume) is its own IfcBuilding on the site, with its storeys (as many as it has, at even heights
   from its foot; one, «Hele bygget», when it gives none) and its body as one IfcBuildingElementProxy on the lowest: each
   part's profile [across, kote] extruded along its axis, as the viewer draws it; a pyramid's faces as a triangulated
   face set; a construction (bim) as its box, with its sha so its own model.ifc can be fetched beside it. Balconies are
   IfcSlab and IfcRailing in the wing they hang on, on the storey at their kote. Each says what it is and why
   (Pset Sykehustomta_Nytt), and its Status is NEW. The ground the after moves (U3616: planed areas, pools and ponds, the
   pads under new buildings) is one IfcGeographicElement TERRAIN on the site, the grid's squares that moved as triangles,
   with the m³ dug out and filled; each pool's or pond's water an IfcGeographicElement of its own (ObjectType Vann).

   Each new element names its material (U3619): one IfcMaterial per material used, its Name the FreeCAD card's (renderkit
   materials.js), its Category IFC4's, with Pset_MaterialCommon MassDensity and the card's UUID, and an
   IfcRelAssociatesMaterial to the elements in it: a new building's body in its material, a balcony's slab in concrete
   and its railing in its own, the moved ground in soil, a pool's water in water.

   GlobalIds come from the new building's id and the part's place in it, so the same after gives the same file and an
   export compares with the last one element by element. The STEP is written by hand, one entity a line, numbered on
   from the before's last. */
import { createHash } from "node:crypto";
import { stepText } from "./ifcfilter.mjs";
import { ifcMaterial, MATERIALS } from "./public/renderkit/materials.js";   // U3619: the one list of materials

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
/* ifcopenshell.guid.compress of the first 128 bits of a sha1 of key: 22 characters, the first of 2 bits */
export function gid(key) {
  let n = BigInt("0x" + createHash("sha1").update("sykehus-after:" + key).digest("hex").slice(0, 32)), s = "";
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
/* text as STEP: quotes doubled, what is not plain ASCII as \X2\…\X0\ */
export const stepStr = v => v == null || v === "" ? "$" : "'" + String(v).replace(/'/g, "''").replace(/\\/g, "\\\\").replace(/[^\x20-\x7e]+/g, m => "\\X2\\" + [...m].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("") + "\\X0\\") + "'";
const num = v => { const s = String(Math.round(v * 1e4) / 1e4 || 0); return /[.eE]/.test(s) ? s : s + "."; };
const pt = p => `(${p.map(num).join(",")})`;

/* the before's ids this needs: the site, the body context, each wing's IfcBuilding and its storeys (with their kote) */
function anchors(parsed) {
  const { ents } = parsed, nameOf = e => stepText((/^'(?:[^']|'')*',[^,]*,'((?:[^']|'')*)'/.exec(e.args) || [])[1] || "");
  let site = null, body = null, top = 0; const building = new Map(), storeys = new Map(), kote = new Map();
  for (const [id, e] of ents) {
    top = Math.max(top, id);
    if (e.type === "IFCSITE") site ??= id;
    else if (e.type === "IFCGEOMETRICREPRESENTATIONSUBCONTEXT" && /^'Body'/.test(e.args)) body ??= id;
    else if (e.type === "IFCBUILDING") building.set(nameOf(e), id);
    else if (e.type === "IFCBUILDINGSTOREY") kote.set(id, +e.args.split(",").pop());
  }
  for (const [, e] of ents) if (e.type === "IFCRELAGGREGATES") {
    const m = /,#(\d+),\(([^)]*)\)\s*$/.exec(e.args); if (!m) continue;
    const kids = m[2].split(",").map(x => +x.slice(1)).filter(k => kote.has(k));
    if (kids.length) storeys.set(+m[1], kids.map(k => [k, kote.get(k)]).sort((a, b) => a[1] - b[1]));
  }
  return { site, body, top, building, storeys };
}

/* the before's IFC text (parsed) and the after (applyEdits(...).site) and the before's site → the lines to add, and the
   wings' new names by IfcBuilding id */
export function addedLines(parsed, after, before) {
  const none = { lines: [], renamed: new Map(), counts: {} };
  const moved = !!(after.terrain?.z && before.terrain?.z && after.terrain.z !== before.terrain.z), waters = (after.landscape || []).filter(w => w.basin && w.level != null);
  if (!(after.added || []).length && !(after.wings || []).some(w => w.draft?.length) && !moved && !waters.length) return none;
  const A = anchors(parsed); if (!A.site || !A.body) return none;
  let n = A.top; const lines = [], put = s => { lines.push(`#${++n}=${s};`); return n; }, counts = { buildings: 0, elements: 0 };
  const zUp = put(`IFCDIRECTION(${pt([0, 0, 1])})`);
  const placeAt = z => put(`IFCLOCALPLACEMENT($,IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT(${pt([0, 0, z])}),$,$))`);
  const pset = (key, objs, name, props) => {
    const vs = Object.entries(props).filter(([, v]) => v != null && v !== "").map(([k, v]) => put(`IFCPROPERTYSINGLEVALUE(${stepStr(k)},$,${typeof v === "boolean" ? `IFCBOOLEAN(.${v ? "T" : "F"}.)` : `IFCLABEL(${stepStr(v)})`},$)`));
    if (!vs.length) return;
    const ps = put(`IFCPROPERTYSET('${gid(key + ":" + name)}',$,${stepStr(name)},$,(${vs.map(v => "#" + v).join(",")}))`);
    put(`IFCRELDEFINESBYPROPERTIES('${gid(key + ":" + name + ":rel")}',$,$,$,(${objs.map(o => "#" + o).join(",")}),#${ps})`);
  };
  /* one part's solid: its profile along its axis (left of the axis is +across), or a pyramid's triangles */
  const solid = p => {
    if (p.tris) {
      const pts = p.tris.flat(), list = put(`IFCCARTESIANPOINTLIST3D((${pts.map(pt).join(",")}),$)`);
      return [put(`IFCTRIANGULATEDFACESET(#${list},$,.T.,(${p.tris.map((_, i) => `(${3 * i + 1},${3 * i + 2},${3 * i + 3})`).join(",")}),$)`), "Tessellation"];
    }
    const [[x0, y0], [x1, y1]] = p.axis, L = Math.hypot(x1 - x0, y1 - y0) || 1, u = [(x1 - x0) / L, (y1 - y0) / L];
    const ring = p.profile.map(q => put(`IFCCARTESIANPOINT(${pt(q)})`)), poly = put(`IFCPOLYLINE((${[...ring, ring[0]].map(r => "#" + r).join(",")}))`);
    const prof = put(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${poly})`);
    const at = put(`IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT(${pt([x0, y0, 0])}),IFCDIRECTION(${pt([u[0], u[1], 0])}),IFCDIRECTION(${pt([-u[1], u[0], 0])}))`);
    return [put(`IFCEXTRUDEDAREASOLID(#${prof},#${at},#${zUp},${num(L)})`), "SweptSolid"];
  };
  const shape = parts => {
    const made = parts.map(solid), kind = made.every(m => m[1] === made[0][1]) ? made[0][1] : "SweptSolid";
    const rep = put(`IFCSHAPEREPRESENTATION(#${A.body},'Body',${stepStr(kind)},(${made.map(m => "#" + m[0]).join(",")}))`);
    return put(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
  };
  const box = a => { const h = a.width / 2, z0 = a.base_kote, z1 = a.top_kote; return [{ axis: [a.from, a.to], profile: [[-h, z0], [h, z0], [h, z1], [-h, z1]] }]; };
  const contain = (key, els, storey) => put(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid(key + ":in")}',$,$,$,(${els.map(e => "#" + e).join(",")}),#${storey})`);
  const byMat = new Map(), made = (key, el) => { if (MATERIALS[key]) (byMat.get(key) || byMat.set(key, []).get(key)).push(el); return el; };
  const newBuildings = [], wingName = id => before.wings?.find(w => w.id === id)?.name;

  for (const a of after.added || []) {
    const key = a.id;
    if (a.kind === "volume") {
      const bld = put(`IFCBUILDING('${gid(key)}',$,${stepStr(a.name)},${stepStr(a.use)},$,#${placeAt(0)},$,$,.ELEMENT.,$,$,$)`); newBuildings.push(bld);
      const k = Math.max(1, a.storeys || 1), sh = (a.top_kote - a.base_kote) / k;
      const sts = Array.from({ length: k }, (_, i) => { const z = a.base_kote + i * sh; return put(`IFCBUILDINGSTOREY('${gid(`${key}:storey:${i}`)}',$,${stepStr(a.storeys ? `${i + 1}. etasje` : "Hele bygget")},$,$,#${placeAt(z)},$,$,.ELEMENT.,${num(z)})`); });
      put(`IFCRELAGGREGATES('${gid(key + ":storeys")}',$,$,$,#${bld},(${sts.map(s => "#" + s).join(",")}))`);
      const parts = a.shape === "bim" || !a.parts?.some(p => p.profile || p.tris) ? box(a) : a.parts.filter(p => p.profile || p.tris);
      const el = put(`IFCBUILDINGELEMENTPROXY('${gid(key + ":body")}',$,${stepStr(a.name)},$,${stepStr(a.shape === "bim" ? "Konstruksjon" : a.shape)},#${placeAt(0)},#${shape(parts)},$,.ELEMENT.)`);
      contain(key, [el], sts[0]); made(a.material, el);
      pset(key, [bld], "Sykehustomta_Nytt", { Id: a.id, Bruk: a.use, Etasjer: a.storeys ? String(a.storeys) : null, Byggeår: a.built, Merknad: a.note, Hvorfor: a.why, Status: "NEW" });
      pset(key + ":body", [el], "Sykehustomta_Nytt", { Form: a.shape, Materiale: a.material, Fot: `kote +${a.base_kote}`, Topp: `kote +${a.top_kote}`, Grunnflate: a.footprint_m2 != null ? `${a.footprint_m2} m²` : null, Volum: a.volume_m3 != null ? `${a.volume_m3} m³` : null,
        ...(a.bim ? { Konstruksjon: a.bim.sha, Fil: `api/bim/${a.bim.sha}/model.ifc`, Kilde: a.bim.source?.url || a.bim.fetched_from, Lisens: a.bim.licence } : {}), ...(a.on ? { "Står på": wingName(a.on) } : {}) });
      pset(key + ":body", [el], "Pset_BuildingElementProxyCommon", { Status: "NEW" });
      counts.buildings++; counts.elements++;
    } else if (a.kind === "balconies") {
      const bid = A.building.get(wingName(a.wing)), sts = A.storeys.get(bid); if (!bid || !sts?.length || !(after.buildings || []).some(b => b.wing === a.wing)) continue;
      const by = new Map();
      a.parts.forEach((p, i) => {
        if (!p.profile) return;
        /* a slab is on the storey its top is the floor of; a railing on the one it stands on */
        const ks = p.profile.map(q => q[1]), z = p.role === "railing" ? Math.min(...ks) : Math.max(...ks), st = sts.reduce((s, x) => x[1] <= z + 0.05 ? x : s, sts[0])[0];
        const cls = p.role === "railing" ? "IFCRAILING" : "IFCSLAB", type = p.role === "railing" ? ".BALUSTRADE." : ".FLOOR.";
        const el = put(`${cls}('${gid(`${key}:${i}`)}',$,${stepStr(p.role === "railing" ? "Rekkverk" : "Balkong")},$,$,#${placeAt(0)},#${shape([p])},$,${type})`);
        (by.get(st) || by.set(st, []).get(st)).push(el); made(p.mat, el); counts.elements++;
      });
      for (const [st, els] of by) contain(`${key}:${st}`, els, st);
      const all = [...by.values()].flat(); if (all.length) pset(key, all, "Sykehustomta_Nytt", { Hvorfor: a.why, Status: "NEW" });
    }
  }
  if (newBuildings.length) put(`IFCRELAGGREGATES('${gid("site:new")}',$,$,$,#${A.site},(${newBuildings.map(b => "#" + b).join(",")}))`);
  /* U3616: the ground as the after leaves it, and the water on it */
  const onSite = [];
  if (moved) {
    const Ta = after.terrain, Tb = before.terrain, W = Ta.w, ch = i => Ta.z[i] != null && Tb.z[i] != null && Math.abs(Ta.z[i] - Tb.z[i]) >= 0.005, at = new Map(), xyz = [], tris = [];
    const ix = i => { if (!at.has(i)) { at.set(i, at.size + 1); xyz.push([Ta.x0 + (i % W + 0.5) * Ta.res, Ta.y1 - (Math.floor(i / W) + 0.5) * Ta.res, Ta.z[i]]); } return at.get(i); };
    for (let r = 0; r < Ta.h - 1; r++) for (let c = 0; c < W - 1; c++) {
      const q = [r * W + c, r * W + c + 1, (r + 1) * W + c, (r + 1) * W + c + 1];
      if (!q.some(ch) || q.some(i => Ta.z[i] == null)) continue;
      tris.push([ix(q[0]), ix(q[2]), ix(q[1])], [ix(q[1]), ix(q[2]), ix(q[3])]);
    }
    if (tris.length) {
      const list = put(`IFCCARTESIANPOINTLIST3D((${xyz.map(pt).join(",")}),$)`), face = put(`IFCTRIANGULATEDFACESET(#${list},$,.F.,(${tris.map(t => `(${t.join(",")})`).join(",")}),$)`);
      const rep = put(`IFCSHAPEREPRESENTATION(#${A.body},'Body','Tessellation',(#${face}))`), shp = put(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
      const el = put(`IFCGEOGRAPHICELEMENT('${gid("terrain")}',$,${stepStr("Terreng etter")},${stepStr("Bakken der etter-forslaget graver ut og fyller")},$,#${placeAt(0)},#${shp},$,.TERRAIN.)`); onSite.push(el); made("soil", el);
      const sum = k => (after.grading || []).reduce((a, g) => a + (g[k] || 0), 0) + waters.reduce((a, w) => a + (w.basin[k] || 0), 0) + (after.added || []).reduce((a, x) => a + (x.ground?.[k] || 0), 0);
      pset("terrain", [el], "Sykehustomta_Terreng", { Utgraving: `${sum("cut_m3")} m³`, Fylling: `${sum("fill_m3")} m³`, Flater: (after.grading || []).map(g => `${g.name}: kote +${g.kote}`).join("; ") || null, Status: "NEW" });
      counts.elements++;
    }
  }
  for (const w of waters) {
    const bottom = w.basin.bottom ?? w.level - w.basin.depth, ps = w.ring.map(p => put(`IFCCARTESIANPOINT(${pt(p)})`)), poly = put(`IFCPOLYLINE((${[...ps, ps[0]].map(r => "#" + r).join(",")}))`);
    const prof = put(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,${stepStr("Vann")},#${poly})`), sol = put(`IFCEXTRUDEDAREASOLID(#${prof},IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT(${pt([0, 0, bottom])}),$,$),#${zUp},${num(w.level - bottom)})`);
    const rep = put(`IFCSHAPEREPRESENTATION(#${A.body},'Body','SweptSolid',(#${sol}))`), shp = put(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    const el = put(`IFCGEOGRAPHICELEMENT('${gid(w.id + ":water")}',$,${stepStr(w.name || (w.pool ? "Basseng" : "Dam"))},$,${stepStr("Vann")},#${placeAt(0)},#${shp},$,.USERDEFINED.)`); onSite.push(el); made("water", el);
    pset(w.id, [el], "Sykehustomta_Nytt", { Vannstand: `kote +${w.level}`, Dybde: `${w.basin.depth} m`, Kant: w.pool ? `kote +${w.basin.kote}` : null, Utgraving: `${w.basin.cut_m3} m³`, Hvorfor: w.why, Status: "NEW" });
    counts.elements++;
  }
  for (const [key, els] of byMat) {
    const m = ifcMaterial(key), mat = put(`IFCMATERIAL(${stepStr(m.name)},${stepStr(m.description)},${stepStr(m.category)})`), d = MATERIALS[key];
    const props = [d.density && put(`IFCPROPERTYSINGLEVALUE('MassDensity',$,IFCMASSDENSITYMEASURE(${num(d.density)}),$)`)].filter(Boolean);
    if (props.length) put(`IFCMATERIALPROPERTIES('Pset_MaterialCommon',$,(${props.map(v => "#" + v).join(",")}),#${mat})`);
    const own = [m.card && put(`IFCPROPERTYSINGLEVALUE('FreeCAD_kort',$,IFCLABEL(${stepStr(m.card)}),$)`), d.density && d.density_from !== "card" && put(`IFCPROPERTYSINGLEVALUE('Densitet_kilde',$,IFCLABEL(${stepStr(d.density_from)}),$)`)].filter(Boolean);
    if (own.length) put(`IFCMATERIALPROPERTIES('Sykehustomta_Materiale',$,(${own.map(v => "#" + v).join(",")}),#${mat})`);
    put(`IFCRELASSOCIATESMATERIAL('${gid("material:" + key)}',$,${stepStr(m.description)},$,(${els.map(e => "#" + e).join(",")}),#${mat})`);
  }
  counts.materials = byMat.size;
  if (onSite.length) put(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid("site:ground")}',$,$,$,(${onSite.map(e => "#" + e).join(",")}),#${A.site})`);
  /* the wings the after renames or gives new facts: their IfcBuilding under the new name, what changed in a set of its own */
  const renamed = new Map();
  for (const w of after.wings || []) {
    if (!w.draft?.length) continue;
    const was = before.wings?.find(x => x.id === w.id), bid = was && A.building.get(was.name); if (!bid) continue;
    if (w.name !== was.name) renamed.set(bid, w.name);
    const fields = [...new Set(w.draft.map(d => d.field))];
    pset(`wing:${w.id}`, [bid], "Sykehustomta_Endret", Object.fromEntries(fields.map(f => [f, w[f] == null ? "" : String(w[f])]).concat([["Hvorfor", w.draft.map(d => d.why).filter(Boolean).join("; ")]])));
  }
  return { lines, renamed, counts };
}

/* the whole file: the lines before ENDSEC, the renamed buildings' name in place */
export function withAdded(text, parsed, after, before) {
  const { lines, renamed, counts } = addedLines(parsed, after, before);
  if (!lines.length && !renamed.size) return { text, counts };
  let out = renamed.size ? text.replace(/^#(\d+)=IFCBUILDING\('([^']*)',([^,]*),'(?:[^']|'')*'/gm, (m, id, g, oh) => renamed.has(+id) ? `#${id}=IFCBUILDING('${g}',${oh},${stepStr(renamed.get(+id))}` : m) : text;
  const at = out.lastIndexOf("\nENDSEC;");
  out = out.slice(0, at) + "\n" + lines.join("\n") + out.slice(at);
  return { text: out, counts };
}
