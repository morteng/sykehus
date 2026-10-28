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
  if (e?.kind === "clone" || e?.kind === "group" || e?.kind === "part" && e.part in CASTLE) return true;
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
  if (e.kind === "part") return CASTLE[e.part].make(e, site);
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
  if (e.at != null) throw new Error("Slottsdelene settes med from og to (fra og til: delens lengde), ikke med at");
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
