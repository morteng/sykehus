/* Editing a new building in place (Anton's wish wI1HCE_s0yC): move, turn or resize one by its stable id, copy it, name a group of
   them and move the group, the castle parts, and the short list of what the after holds. Everything here is pure: it turns one
   change the model sent into the plain volume and reshape edits the server already checks and stores, so no new edit kind
   reaches the replay (public/design.js applyDesign), and what is stored is what a person's own page could have sent.
   node --test tests/edit-tools.test.mjs */
import { baseOf } from "./public/design.js";

const r2 = x => Math.round(x * 100) / 100, mid = e => [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
const SELECTORS = ["shift", "turn", "length"];
/* what a copy keeps of the original: the fields a volume edit takes (never a construction's or part's, which the worker made) */
const KEEP = ["name", "shape", "material", "from", "to", "width", "height", "wall_height", "high_side", "steps", "step_depth", "base_kote", "storeys", "use", "built", "note", "entrance", "on", "overhang_m", "allow_overlap"];

/* the new buildings as the stored edits leave them, by id (the replay's own rule: a volume, then its reshapes, until a demolish) */
export function volumesOf(edits) {
  const vols = new Map();
  for (const e of edits) {
    if (e.kind === "volume" && e.id != null) vols.set(e.id, { ...e });
    else if (e.kind === "reshape" && vols.has(e.id)) { const { kind, id, why, ...set } = e; Object.assign(vols.get(e.id), set); }
    else if (e.kind === "demolish") vols.delete(e.building);
  }
  return vols;
}
/* the members an id names: the building itself, else every building whose group is that name */
function membersOf(vols, key) {
  if (vols.has(key)) return [vols.get(key)];
  const g = [...vols.values()].filter(v => v.group != null && v.group === key);
  if (!g.length) throw new Error(`Fant ikke «${key}»: verken et nytt bygg eller en gruppe. Nye bygg: ${[...vols.keys()].slice(0, 8).map(k => `«${k}»`).join(", ") || "ingen ennå"}`);
  return g;
}
const turnAbout = (p, c, deg) => { const a = deg * Math.PI / 180, dx = p[0] - c[0], dy = p[1] - c[1]; return [r2(c[0] + dx * Math.cos(a) - dy * Math.sin(a)), r2(c[1] + dx * Math.sin(a) + dy * Math.cos(a))]; };
const pair = (v, what) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`${what} er [øst, nord] i meter`); return v; };

/* does this edit stand for several: a copy, a group, a castle part, or a move, turn or resize (not a plain reshape the server takes as it is) */
export function needsExpand(e, edits = []) {
  if (e?.kind === "clone" || e?.kind === "group" || e?.kind === "part" && e.part in OWN) return true;
  if (e?.kind !== "reshape") return false;
  if (SELECTORS.some(k => e[k] != null)) return true;
  const vols = volumesOf(edits); return !vols.has(e.id) && [...vols.values()].some(v => v.group != null && v.group === e.id);   // a group's name where an id goes
}
/* the plain volume and reshape edits it stands for, worked out against the stored edits (and the site, for a castle part's foot) */
export function expandChange(e, edits, site) {
  const vols = volumesOf(edits);
  if (e.kind === "group") {
    const name = String(e.name ?? "").trim(); if (!name || !Array.isArray(e.ids) || !e.ids.length) throw new Error("group trenger name og ids (id-ene til byggene i gruppen)");
    return e.ids.map(id => { if (!vols.has(id)) throw new Error(`Fant ikke det nye bygget «${id}» (group tar bare nye bygg)`); return { kind: "reshape", id, group: name, ...(e.why ? { why: e.why } : {}) }; });
  }
  if (e.kind === "part") return OWN[e.part].make(e, site);
  const key = String(e.id ?? ""), src = membersOf(vols, key);
  if (e.kind === "clone") {
    if (e.offset == null) throw new Error("clone trenger offset: [øst, nord] i meter fra originalen");
    const off = pair(e.offset, "offset"), n = e.count == null ? 1 : +e.count;
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("count er et helt tall fra 1 til 20");
    const out = [];
    for (let k = 1; k <= n; k++) for (const s of src) {
      if (s.shape === "bim") throw new Error(`«${s.name}» er en konstruksjon eller del fra serveren; den kopieres ved å sende den på nytt med nytt sted`);
      const rest = Object.fromEntries(KEEP.filter(k => s[k] != null).map(k => [k, s[k]])), grp = e.group ?? (src.length > 1 ? `${key} (kopi ${k})` : null);
      out.push({ ...rest, kind: "volume", name: src.length === 1 && e.name != null ? e.name : s.name, from: [r2(s.from[0] + off[0] * k), r2(s.from[1] + off[1] * k)], to: [r2(s.to[0] + off[0] * k), r2(s.to[1] + off[1] * k)], ...(grp ? { group: grp } : {}), ...(e.why ? { why: e.why } : {}) });
    }
    return out;
  }
  /* reshape with a place, a turn or a length: worked out here into from and to, the rest passes to each member */
  const { shift, turn, length, id, name, ...rest } = e;
  const sh = shift == null ? [0, 0] : pair(shift, "shift"), deg = turn == null ? 0 : +turn;
  if (!Number.isFinite(deg)) throw new Error("turn er grader mot klokka, sett ovenfra");
  if (length != null && src.length > 1) throw new Error("length gjelder ett bygg; en gruppe flyttes og dreies samlet");
  if (length != null && !(+length >= 1 && +length <= 250)) throw new Error("length er mellom 1 og 250 m");
  const c = src.length > 1 ? [src.reduce((s, v) => s + mid(v)[0], 0) / src.length, src.reduce((s, v) => s + mid(v)[1], 0) / src.length] : mid(src[0]);
  return src.map(s => {
    const m = mid(s), L = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) || 1, u = [(s.to[0] - s.from[0]) / L, (s.to[1] - s.from[1]) / L], half = (length != null ? +length : L) / 2;
    let f = [m[0] - u[0] * half, m[1] - u[1] * half], t = [m[0] + u[0] * half, m[1] + u[1] * half];
    if (deg) { f = turnAbout(f, c, deg); t = turnAbout(t, c, deg); }
    const o = { kind: "reshape", id: s.id, ...rest, ...(shift != null || turn != null || length != null ? { from: [r2(f[0] + sh[0]), r2(f[1] + sh[1])], to: [r2(t[0] + sh[0]), r2(t[1] + sh[1])] } : {}) };
    if (name != null && src.length === 1) o.name = name;
    return o;
  });
}

/* ---- castle parts: a few volumes under one group name, from the boxes and pyramids that already exist ---- */
const P = (def, min, max, say) => ({ type: "number", default: def, min, max, say });
const params = (e, spec) => {
  const p = e.params || {}, bad = Object.keys(p).filter(k => !(k in spec) && k !== "material");
  if (bad.length) throw new Error(`Delen ${e.part} tar ikke ${bad.join(", ")} (den tar ${[...Object.keys(spec), "material"].join(", ")})`);
  const out = {};
  for (const [k, s] of Object.entries(spec)) { const v = p[k] == null ? s.default : +p[k]; if (!Number.isFinite(v) || v < s.min || v > s.max) throw new Error(`${k} er et tall fra ${s.min} til ${s.max}`); out[k] = v; }
  const mat = p.material ?? "concrete"; if (!["concrete", "brick", "steel", "wood"].includes(mat)) throw new Error("material er concrete, brick, steel eller wood");
  return { ...out, material: mat };
};
const axis = (e, min) => {
  if (e.at != null) throw new Error("Delene settes med from og to (fra og til: delens lengde), ikke med at");
  const f = pair(e.from, "from"), t = pair(e.to, "to"), L = Math.hypot(t[0] - f[0], t[1] - f[1]);
  if (L < min) throw new Error(`from til to må være minst ${min} m`);
  return { f, t, L, u: [(t[0] - f[0]) / L, (t[1] - f[1]) / L] };
};
const at = (f, u, d) => [r2(f[0] + u[0] * d), r2(f[1] + u[1] * d)];
const base = (site, e, v) => ({ kind: "volume", shape: "box", material: v.material, ...(e.why ? { why: e.why } : {}), ...v });
/* the foot of the first volume is fixed here, so the ones stacked on it stand on its top whatever the ground does */
const foot = (site, v) => r2(baseOf(site, v));

const TOWER = { width: P(0, 0, 40, "m across; 0 = as long as from to to (a square tower)"), height: P(14, 3, 60, "m from the foot to the eaves"), spire_height: P(6, 1, 40, "m, the spire's own") };
const WALL = { thickness: P(1.2, 0.5, 6, "m"), height: P(6, 2, 30, "m, the wall without its battlements"), merlon_height: P(1, 1, 3, "m, the battlements"), merlons: P(0, 0, 16, "how many battlements; 0 = about one every 3 m") };
const GATE = { depth: P(6, 3, 30, "m through the gate, across the wall"), height: P(10, 4, 40, "m"), passage_width: P(3.5, 2, 12, "m, the opening"), passage_height: P(4, 2.5, 12, "m, the opening; at least 1 m under the top") };
export const CASTLE = {
  castle_tower: { no: "Slottstårn", say: "A square tower with a pointed spire (a box and a pyramid on its top, one group); from to to is its side, params.width its other side", params: TOWER, classes: ["volumes"],
    make(e, site) {
      const { f, t, L } = axis(e, 3), p = params(e, TOWER), w = p.width || L, name = e.name ?? "Slottstårn", g = e.group ?? name;
      const body = base(site, e, { name, from: f, to: t, width: w, height: p.height, material: p.material, group: g });
      body.base_kote = foot(site, body);
      return [body, base(site, e, { shape: "pyramid", name: `${name} (spir)`, from: f, to: t, width: w, height: p.spire_height, material: p.material, group: g, base_kote: r2(body.base_kote + p.height) })];
    } },
  castle_wall: { no: "Slottsmur", say: "A wall with battlements (a box, and a row of small boxes on its top, one group); from to to is its length", params: WALL, classes: ["volumes"],
    make(e, site) {
      const { f, L, u, t } = axis(e, 3), p = params(e, WALL), name = e.name ?? "Slottsmur", g = e.group ?? name, n = p.merlons ? Math.round(p.merlons) : Math.min(16, Math.max(2, Math.round(L / 3))), pitch = L / n;
      const body = base(site, e, { name, from: f, to: t, width: p.thickness, height: p.height, material: p.material, group: g });
      body.base_kote = foot(site, body);
      const out = [body], top = r2(body.base_kote + p.height);
      for (let k = 0; k < n; k++) out.push(base(site, e, { name: `${name} (tinne ${k + 1})`, from: at(f, u, pitch * k + pitch / 4), to: at(f, u, pitch * k + pitch * 3 / 4), width: p.thickness, height: p.merlon_height, material: p.material, group: g, base_kote: top }));
      return out;
    } },
  castle_gatehouse: { no: "Porthus", say: "A gatehouse with a passage through it (two blocks and a lintel, one group); from to to is its length along the wall, params.depth through it", params: GATE, classes: ["volumes"],
    make(e, site) {
      const { f, L, u, t } = axis(e, 6), p = params(e, GATE), name = e.name ?? "Porthus", g = e.group ?? name, pw = p.passage_width;
      if (pw > L - 2) throw new Error(`Porten (${pw} m) må være minst 2 m smalere enn porthuset (${r2(L)} m)`);
      if (p.height - p.passage_height < 1) throw new Error("passage_height må være minst 1 m under height");
      const side = (a, b, nm) => base(site, e, { name: `${name} (${nm})`, from: at(f, u, a), to: at(f, u, b), width: p.depth, height: p.height, material: p.material, group: g });
      const left = side(0, (L - pw) / 2, "venstre"), right = side((L + pw) / 2, L, "høyre");
      left.base_kote = right.base_kote = foot(site, { ...left, from: f, to: t });
      return [left, right, base(site, e, { name: `${name} (bue)`, from: at(f, u, (L - pw) / 2), to: at(f, u, (L + pw) / 2), width: p.depth, height: r2(p.height - p.passage_height), material: p.material, group: g, base_kote: r2(left.base_kote + p.passage_height) })];
    } },
};

/* ---- household parts (U3639): what a house gets built round it, from the same boxes and slopes; from to to is the length, a group each ---- */
const TERRACE = { width: P(4, 1, 30, "m deep, across from to to"), thickness: P(0.4, 0.1, 3, "m, the deck's own height over the ground") };
const FENCE = { height: P(1.2, 0.5, 3, "m"), post_spacing: P(2.4, 1, 6, "m between posts"), thickness: P(0.1, 0.03, 0.4, "m, the boards and the posts") };
const SHED = { width: P(3, 1.5, 12, "m across"), wall_height: P(2.2, 1.8, 4, "m to the eaves"), height: P(3, 2, 6, "m to the ridge") };
const RETAIN = { thickness: P(0.4, 0.2, 2, "m"), height: P(1.5, 0.3, 6, "m above the lower ground") };
const PERGOLA = { width: P(3, 1.5, 10, "m across"), height: P(2.5, 2, 4, "m to the beams"), post_size: P(0.15, 0.08, 0.4, "m, each post's side"), beams: P(0, 0, 40, "how many cross beams; 0 = about one every 0.6 m") };
const CARPORT = { width: P(3, 2.5, 8, "m across (one car 3 m)"), height: P(2.5, 2.1, 4, "m to the eaves"), roof_thickness: P(0.25, 0.1, 1, "m, the roof's own") };
/* the card's material when the person gave none: wood for a house's own timber parts */
const withMat = (e, def) => ({ ...e, params: { material: def, ...(e.params || {}) } });
/* four posts at the corners of a length × width footprint, standing on one foot */
const posts = (site, e, f, t, u, L, w, s, h, name, g, material) => {
  const v = [-u[1], u[0]], mk = (a, side, k) => { const c = [f[0] + u[0] * a + v[0] * side, f[1] + u[1] * a + v[1] * side]; return base(site, e, { name: `${name} (stolpe ${k})`, from: at(c, u, -s / 2), to: at(c, u, s / 2), width: s, height: h, material, group: g }); };
  const ps = [mk(s / 2, (w - s) / 2, 1), mk(L - s / 2, (w - s) / 2, 2), mk(s / 2, -(w - s) / 2, 3), mk(L - s / 2, -(w - s) / 2, 4)];
  const kote = foot(site, { kind: "volume", shape: "box", from: f, to: t, width: w, height: h }); ps.forEach(x => { x.base_kote = kote; });
  return { ps, kote };
};
export const HOUSEHOLD = {
  terrace: { no: "Terrasse", say: "A deck over the ground (one box, wood; from to to is its length, params.width how deep)", params: TERRACE, classes: ["volumes"],
    make(e, site) { const { f, t } = axis(e, 1), p = params(withMat(e, "wood"), TERRACE), name = e.name ?? "Terrasse";
      return [base(site, e, { name, from: f, to: t, width: p.width, height: p.thickness, material: p.material, group: e.group ?? name })]; } },
  fence: { no: "Gjerde", say: "A fence: boards along from to to and a post every post_spacing (boxes in one group)", params: FENCE, classes: ["volumes"],
    make(e, site) { const { f, t, L, u } = axis(e, 1), p = params(withMat(e, "wood"), FENCE), name = e.name ?? "Gjerde", g = e.group ?? name, n = Math.max(1, Math.round(L / p.post_spacing)), pitch = L / n, h = p.thickness;
      const board = base(site, e, { name, from: f, to: t, width: h / 2, height: r2(p.height * 0.8), material: p.material, group: g }), k0 = foot(site, board); board.base_kote = r2(k0 + p.height * 0.1);
      const out = [board]; for (let k = 0; k <= n; k++) { const c = at(f, u, pitch * k); out.push(base(site, e, { name: `${name} (stolpe ${k + 1})`, from: at(c, u, -h / 2), to: at(c, u, h / 2), width: h, height: p.height, material: p.material, group: g, base_kote: k0 })); }
      return out; } },
  shed: { no: "Bod", say: "A shed with a gable roof (one volume; from to to is its length along the ridge, params.width across)", params: SHED, classes: ["volumes"],
    make(e, site) { const { f, t } = axis(e, 1.5), p = params(withMat(e, "wood"), SHED), name = e.name ?? "Bod"; if (p.height <= p.wall_height) throw new Error("height (mønet) må være over wall_height (raftet)");
      return [base(site, e, { name, shape: "gable", from: f, to: t, width: p.width, height: p.height, wall_height: p.wall_height, material: p.material, group: e.group ?? name })]; } },
  retaining_wall: { no: "Støttemur", say: "A retaining wall (one box; from to to is its length, params.thickness across, params.height above the lower ground)", params: RETAIN, classes: ["volumes"],
    make(e, site) { const { f, t } = axis(e, 1), p = params(withMat(e, "concrete"), RETAIN), name = e.name ?? "Støttemur";
      return [base(site, e, { name, from: f, to: t, width: p.thickness, height: p.height, material: p.material, group: e.group ?? name })]; } },
  pergola: { no: "Pergola", say: "A pergola: four posts and cross beams on top (boxes in one group); from to to is its length, params.width across", params: PERGOLA, classes: ["volumes"],
    make(e, site) { const { f, t, L, u } = axis(e, 1.5), p = params(withMat(e, "wood"), PERGOLA), name = e.name ?? "Pergola", g = e.group ?? name, s = p.post_size, w = p.width, n = p.beams ? Math.round(p.beams) : Math.max(2, Math.round(L / 0.6));
      if (L < 3 * s || w < 3 * s) throw new Error("Pergolaen er for liten for stolpene");
      const { ps, kote } = posts(site, e, f, t, u, L, w, s, p.height, name, g, p.material), out = [...ps], pitch = (L - s) / Math.max(1, n - 1);
      for (let k = 0; k < n; k++) { const c = at(f, u, s / 2 + pitch * k); out.push(base(site, e, { name: `${name} (bjelke ${k + 1})`, from: at(c, u, -s / 4), to: at(c, u, s / 4), width: w, height: s, material: p.material, group: g, base_kote: r2(kote + p.height) })); }
      return out; } },
  carport: { no: "Carport", say: "A carport: a flat roof on four posts (boxes in one group); from to to is its length, params.width across", params: CARPORT, classes: ["volumes"],
    make(e, site) { const { f, t, L, u } = axis(e, 3), p = params(withMat(e, "wood"), CARPORT), name = e.name ?? "Carport", g = e.group ?? name;
      const { ps, kote } = posts(site, e, f, t, u, L, p.width, 0.15, p.height, name, g, p.material);
      return [...ps, base(site, e, { name: `${name} (tak)`, from: f, to: t, width: p.width, height: p.roof_thickness, material: p.material, group: g, base_kote: r2(kote + p.height) })]; } },
};
/* every part the server builds itself */
export const OWN = { ...CASTLE, ...HOUSEHOLD };

/* ---- the short list: what the after holds, one line each, small enough for a chat turn ---- */
const ms = x => String(r2(x)).replace(".", ",");
export function briefOf(site, max = 40) {
  const added = site.added || [], vols = added.filter(a => a.kind === "volume");
  const line = a => { const m = mid(a), L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    return `${a.id} «${a.name}» ${a.shape === "bim" ? (a.bim?.part || "bim") : a.shape}${a.material ? " " + a.material : ""}${a.group ? `, gruppe «${a.group}»` : ""}${a.on ? `, på taket (${a.on})` : ""}: midt (${ms(m[0])}, ${ms(m[1])}), ${ms(L)}×${ms(a.width)}×${ms(a.height)} m, fot ${ms(a.base_kote)}`; };
  const groups = {}; for (const a of vols) if (a.group) (groups[a.group] ||= []).push(a.id);
  const other = { ...(added.filter(a => a.kind === "balconies").length ? { balconies: added.filter(a => a.kind === "balconies").reduce((n, a) => n + (a.count || 0), 0) } : {}), ...(site.landscape?.length ? { ground: site.landscape.length } : {}), ...(site.plantings?.length ? { plantings: site.plantings.length } : {}) };
  return { built: vols.slice(0, max).map(line), ...(vols.length > max ? { more: vols.length - max } : {}), total: vols.length, ...(Object.keys(groups).length ? { groups } : {}), demolished: (site.demolished || []).map(d => d.name), ...(Object.keys(other).length ? { other } : {}) };
}
