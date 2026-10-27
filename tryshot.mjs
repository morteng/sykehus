/* The picture that comes back with try_change (Morten 2026-10-27: the «Prøvde en endring» cards «show a screenshot of what I, the user,
   am looking at, not what Anton should be looking at»). It was the whole-site isometric for every edit but a volume. Here it is aimed at
   what the call changed: the union of every ok edit's geometry (rings, lines with their width, points, from/to, the new parts' own
   boxes, what a demolish took), at the kote it stands at, fitted to its size, with the new in strong orange and the rest toned down.
   Framing and caption come from lookglue.mjs (say); mcp.mjs only calls tryShot. */
import { say } from "./lookglue.mjs";
import { VIEWS } from "./public/renderkit/look.js";
import { aimCamera, usedCamera, cameras } from "./camera.mjs";

const TAN = Math.tan(19 * Math.PI / 180);
const com = v => String(v).replace(".", ",");
const FLAT = new Set(["surface", "path", "paint", "ground", "terrain"]);
const SURF_NO = { grass: "gress", meadow: "eng", planting: "beplantning", gravel: "grus", paving: "belegg", asphalt: "asfalt", soil: "jord", water: "vann" };
const OP_NO = { raise: "hevet terrenget", lower: "senket terrenget", flatten: "jevnet ut terrenget", smooth: "glattet terrenget", pond: "gravde en dam", terrace: "laget en flat terrasse" };
const baseName = n => String(n ?? "").replace(/\s*\d+\/\d+$/, "").trim();
const ok2 = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const wingOfS = (s, w) => (s.wings || []).find(x => x.id === w || x.name?.toLowerCase() === String(w).toLowerCase());
const ringsOfWing = (s, w) => { const x = wingOfS(s, w); return x ? s.buildings.filter(b => b.wing === x.id) : []; };

/* a new part's own box: its triangles (a construction's mesh, a lawn), or its axis with the profile's width and height */
function boxOfPart(x) {
  const xs = [], ys = [], zs = [];
  for (const p of x.parts || []) {
    if (p.tris) for (const t of p.tris) for (const q of t) { xs.push(q[0]); ys.push(q[1]); zs.push(q[2]); }
    else for (const q of p.axis || []) { const w = Math.max(0, ...(p.profile || []).map(r => Math.abs(r[0]))); for (const z of (p.profile || []).map(r => r[1])) zs.push(z); xs.push(q[0] - w, q[0] + w); ys.push(q[1] - w, q[1] + w); }
  }
  return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) } : null;
}

/* where the change is: { box, ids (new or changed, to pick out), names, gone, kinds }. s = the after with meshes; prior = the site before this call */
export function changeArea(prior, s, edits) {
  const bx = [], ids = new Set(), zs = [], gone = [];
  const addBox = (x0, y0, x1, y1) => bx.push({ x0, y0, x1, y1 });
  const pad = (pts, p) => { const q = pts.filter(ok2); if (q.length) addBox(Math.min(...q.map(a => a[0])) - p, Math.min(...q.map(a => a[1])) - p, Math.max(...q.map(a => a[0])) + p, Math.max(...q.map(a => a[1])) + p); };
  const was = new Set((prior.added || []).map(x => x.id)), wasLand = new Set((prior.landscape || []).map(x => x.id));
  const touched = new Set(edits.filter(e => e.kind === "reshape" && e.id).map(e => e.id));
  for (const x of s.added || []) {
    const lag = x.id.startsWith("_lag-"), landId = lag ? x.id.slice(5) : null;
    if (lag ? (landId === "trær" || wasLand.has(landId)) : (was.has(x.id) && !touched.has(x.id))) continue;
    const b = boxOfPart(x); if (!b) continue;
    addBox(b.x0, b.y0, b.x1, b.y1); zs.push(b.z0, b.z1); ids.add(x.id);
  }
  for (const e of edits) {
    const r = e.r ?? e.width / 2 ?? 0;
    if (ok2(e.at)) pad([e.at], 4);
    if (Array.isArray(e.ring)) pad(e.ring, 1);
    const sh = e.shape; if (sh) { if (sh.c) pad([sh.c], sh.r ?? 5); if (sh.ring) pad(sh.ring, 1); if (sh.pts) pad(sh.pts, sh.r ?? 3); }
    if (Array.isArray(e.line)) pad(e.line, Number.isFinite(r) && r > 0 ? r : e.kind === "paint" ? 1.5 : 1);
    if (Array.isArray(e.points)) pad(e.points, (e.crown ?? 4) / 2);
    if (e.kind === "balconies" || e.kind === "level" || e.kind === "wing" || e.kind === "room" || e.kind === "note") for (const b of e.wing ? ringsOfWing(s, e.wing) : []) { pad(b.ring, 0); ids.add(b.id); zs.push(b.base, b.top ?? b.base + 8); }
    if (e.on && Number.isFinite(e.kote)) zs.push(e.kote);
    if (e.kind === "demolish" && e.building && e.building !== "alle") {
      const k = e.building, w = ringsOfWing(prior, k), b1 = w.length ? w : (prior.buildings || []).filter(b => b.id === k), a1 = (prior.added || []).find(x => x.id === k), l1 = (prior.landscape || []).find(x => x.id === k);
      for (const b of b1) { pad(b.ring, 0); zs.push(b.base, b.top ?? b.base + 8); }
      if (b1.length) gone.push(wingOfS(prior, k)?.name || b1[0].name || "en bygning");
      if (a1) { const b = boxOfPart(a1); if (b) { addBox(b.x0, b.y0, b.x1, b.y1); zs.push(b.z0, b.z1); gone.push(a1.name); } }
      if (l1) { pad(l1.ring || l1.line || [], 1); gone.push(l1.name || (l1.kind === "path" ? "en sti" : "en flate")); }
    }
  }
  if (!bx.length) return null;
  const box = { x0: Math.min(...bx.map(b => b.x0)), y0: Math.min(...bx.map(b => b.y0)), x1: Math.max(...bx.map(b => b.x1)), y1: Math.max(...bx.map(b => b.y1)) };
  return { box, zs, ids: [...ids], gone };
}

/* one line a kind of change, in plain Norwegian, no ids; pieces of one run are one line */
export function changeLines(prior, s, edits) {
  const out = [], groups = new Map(), wn = w => wingOfS(s, w)?.name || wingOfS(prior, w)?.name || w;
  const push = (key, f) => { const g = groups.get(key); if (g) g.n++; else { const o = { n: 1, f }; groups.set(key, o); out.push(o); } };
  for (const e of edits) {
    const k = e.kind, nm = e.name || (k === "volume" ? "en ny del" : "");
    if (["volume", "construction", "part", "import"].includes(k)) push(`${k}:${baseName(nm)}:${e.on || ""}`, n => (n > 1 ? `${n} deler av «${baseName(nm)}»` : `ny: ${nm}`) + (e.on ? `, på taket til ${wn(e.on)}` : ""));
    else if (k === "surface") push(`surface:${e.surface}:${e.on || ""}`, n => `${n > 1 ? `${n} flater` : "ny flate"} (${SURF_NO[e.surface] || e.surface})${e.on ? ", på taket" : ""}`);
    else if (k === "path") push(`path:${e.on || ""}`, n => `${n > 1 ? `${n} stier` : "ny sti"}${e.on ? " på taket" : ""}`);
    else if (k === "paint") push(`paint:${e.surface}:${e.mode}`, () => e.mode === "erase" ? `visket ut ${SURF_NO[e.surface] || e.surface} med penselen` : `malt ${SURF_NO[e.surface] || e.surface} med penselen${e.on ? " på taket" : ""}`);
    else if (k === "trees") push(`trees:${e.species}`, () => `plantet trær (${e.species})${e.on ? " på taket" : ""}`);
    else if (k === "fell") push("fell", () => "tok ned trær");
    else if (k === "ground") push("ground", () => "jevnet ut terrenget");
    else if (k === "terrain") push(`terrain:${e.op}`, () => OP_NO[e.op] || "flyttet jord");
    else if (k === "demolish") push(`demolish:${e.building}`, () => e.building === "alle" ? "revet alle sykehusbyggene" : `revet: ${(wingOfS(prior, e.building)?.name) || (prior.buildings || []).find(b => b.id === e.building)?.name || (prior.added || []).find(x => x.id === e.building)?.name || (prior.landscape || []).find(x => x.id === e.building)?.name || "det valgte"}`);
    else if (k === "restore") push(`restore:${e.building}`, () => `satt tilbake: ${wingOfS(prior, e.building)?.name || "det som var revet"}`);
    else if (k === "balconies") push(`balconies:${e.wing}`, () => `balkonger på ${wn(e.wing)}`);
    else if (k === "level") push(`level:${e.wing}:${e.storey}`, () => `gulvet i ${wn(e.wing)} satt til kote ${com(e.kote)}`);
    else if (k === "wing") push(`wing:${e.wing}:${e.field}`, () => `kortet til ${wn(e.wing)} endret (${e.field})`);
    else if (k === "room") push("room", () => "et rom endret");
    else if (k === "note") push("note", () => "et notat satt på modellen");
    else if (k === "reshape") push(`reshape:${e.id}`, () => `endret ${(s.added || []).find(x => x.id === e.id)?.name || (s.landscape || []).find(x => x.id === e.id)?.name || "en del"}`);
    else push(`other:${k}`, () => "en endring");
  }
  return out.map(o => o.f(o.n));
}

/* the camera: target at the change's middle and kote, distance from its size, pitch from what kind it is. Explicit view_name wins for the angle. */
export function tryAim(prior, s, edits, a = {}, ground = () => 0) {
  const area = changeArea(prior, s, edits); if (!area) return null;
  const { box } = area, W = box.x1 - box.x0, Hh = box.y1 - box.y0, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const z0 = area.zs.length ? Math.min(...area.zs) : null, z1 = area.zs.length ? Math.max(...area.zs) : null, side = Math.max(W, Hh);
  const roof = edits.some(e => e.on) || (s.added || []).some(x => area.ids.includes(x.id) && x.on);
  const flat = edits.every(e => FLAT.has(e.kind)), dem = edits.some(e => e.kind === "demolish"), big = side >= 60;
  const view = VIEWS[a.view_name] ? { ...VIEWS[a.view_name] } : null;
  const plan = view ? !!view.plan : flat;
  const pitch = roof ? 50 : big ? 35 : dem ? 40 : 55;
  const tilt = plan ? null : view?.tilt ?? pitch, from = plan ? null : view?.from ?? 225;
  const tz = z0 == null ? ground(s, [cx, cy]) : plan ? z0 : z0 + (z1 - z0) * 0.4;
  const span = Math.max(side, z0 == null ? 0 : (z1 - z0)), dist = Math.round(Math.max(dem ? 80 : 35, Math.min(400, 2.2 * span)));
  /* a demolish: the neighbours (what stands within the frame) are what the gap is judged against */
  const gap = b => Math.min(...b.ring.map(p => Math.hypot(Math.max(box.x0 - p[0], 0, p[0] - box.x1), Math.max(box.y0 - p[1], 0, p[1] - box.y1))));
  const near = dem ? (s.buildings || []).map(b => [b, gap(b)]).filter(([, d]) => d < 25).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([b]) => b) : [];   // the ones next to the gap, in orange
  const ids = [...area.ids, ...near.map(b => b.id)];
  return { target: [cx, cy, tz], dist, tilt, from, plan, ids, accent: ids.length > 0, area, near: [...new Set(near.map(b => (s.wings || []).find(w => w.id === b.wing)?.name || b.name).filter(Boolean))] };
}

/* the picture and its caption. deps: picture (the kit's), ground (terrain height), annotate (the scale bar), before (the before model with meshes, for era før),
   dirDeg, err. a.picture: the camera fields (camera.mjs) over the automatic framing; views: up to 3 pictures. null: nothing to aim at (the caller draws the old picture) */
export async function tryShot({ prior, s, edits, a, picture, ground, annotate, before, dirDeg, err }) {
  const auto = tryAim(prior, s, edits, a, ground); if (!auto) return null;
  const lines = changeLines(prior, s, edits), gone = auto.area.gone, images = [];
  const seen = new Set(), dedup = { ...s, added: (s.added || []).filter(x => !x.id.startsWith("_")).map(x => ({ ...x, name: baseName(x.name) })).filter(x => !seen.has(x.name) && seen.add(x.name)) };
  const centre = gone.length ? `stedet etter ${gone.join(" og ")}` : lines.length === 1 ? lines[0].replace(/^ny: /, "") : (dedup.added.find(x => auto.ids.includes(x.id))?.name || lines[0]);
  for (const c of cameras(a.picture)) {
    const base = { target: auto.target, dist: auto.dist, tilt: auto.tilt ?? 55, from: auto.from ?? 225, plan: auto.plan };
    const cam = aimCamera(c, base, { site: s, ground, dirDeg, err }), W = c.width || 1024, H = c.height || 640, v = cam.plan ? { plan: true } : { from: cam.from, tilt: cam.tilt };
    const draw = c.era === "før" ? before : s;
    let png = await picture(draw, { ...v, target: cam.target, dist: cam.dist, focus: c.era === "før" ? [] : auto.ids, accent: c.era !== "før" && auto.accent, width: W, height: H });
    png = annotate(png, { plan: cam.plan, dist: cam.dist, target: cam.target, levels: null, width: W, height: H });
    const used = usedCamera(cam, c.era), shown = c.era === "før" ? "" : say(dedup, { target: cam.target, dist: cam.dist, levels: null }, { name: centre, ids: auto.area.ids, target: cam.target }, v, { accent: auto.accent });
    const text = c.era === "før" ? `Bildet: ${cam.plan ? "plan, rett ovenfra, nord opp" : "samme sted"}, modellen slik den var før endringen (uten det nye). ${used.say}`
      : `Bildet: ${cam.plan ? "plan, rett ovenfra, nord opp" : `sett fra ${SIDE(cam.from)}, ${Math.round(cam.tilt)}° over bakken`}, ${Math.round(cam.dist)} m unna, midt i bildet ${centre}. Nordpilen øverst til høyre${cam.plan ? "; målestokken nederst til venstre er 50 m" : ""}. ` +
        `Endret: ${lines.join("; ")}.${auto.accent ? " Det nye står i sterk oransje, resten er dempet." : ""}${auto.near.length ? ` Naboer i bildet: ${auto.near.join(", ")}.` : ""}${shown ? " I bildet: " + shown : ""} ${used.say}`;
    images.push({ png, text, camera: used.num, opts: { ...v, target: cam.target, dist: cam.dist, width: W, height: H } });
  }
  return { images, png: images[0].png, text: images[0].text, aim: auto };
}
const SIDE = d => ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"][Math.round(((d ?? 0) % 360 + 360) % 360 / 45) % 8];
