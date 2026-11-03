import { mergeCoverage } from "./walk.js";
/* Merging a project changed on two devices (the desktop, and the phone out on a photo walk).
   Three-way: base is the version both started from. Per key, and per object in the id'd
   lists (plants, areas, buildings, photos, quest spots): whoever changed it wins; when both
   did, this device wins. Deleting something the other side left alone deletes it. Quest
   spots done on either side stay done. */
const J = v => JSON.stringify(v ?? null);
const LISTS = new Set(["items", "areas", "buildings", "photos", "walks", "runs", "builds"]);

function pick(b, l, s) {
  if (J(l) === J(b)) return s;
  if (J(s) === J(b)) return l;
  return l;
}
/* A photo changed on both sides: field by field, and position and heading as groups with their source. What the owner set
   by hand (posSrc / dirSrc "manual") beats a guess, a sensor value or a default from the other side; a target chosen by
   hand likewise. The solved camera pose (ph.pose with its ties, ph.anchor, ph.run) is a third group ranked by ph.pose.src:
   lined up on an anchor or tapped beats a structure-from-motion solve, which beats a run correction, which beats sensors
   (the same order as pose.js poseRank, kept here so merging never depends on that file). Everything else: whoever
   changed it wins, this device when both did. */
const POSE_RANK = { none: 0, sensors: 1, exif: 1, "run-anchor": 2, sfm: 3, taps: 4, anchor: 4 };
const POSE = [
  { src: "posSrc", keys: ["lng", "lat", "acc", "posSrc", "gps"], rank: o => (o.posSrc === "manual" ? 1 : 0) },
  { src: "dirSrc", keys: ["heading", "tilt", "compass", "fov", "dirSrc", "guessed"], rank: o => (o.dirSrc === "manual" ? 1 : 0) },
  { src: "pose.src", keys: ["pose", "ties", "anchor", "run"], rank: o => POSE_RANK[o.pose?.src] ?? 0 },
];
const GROUPED = new Set(POSE.flatMap(g => g.keys));
const sub = (o = {}, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
function mergePhoto(b = {}, l, s) {
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(s)])) {
    if (GROUPED.has(k)) continue;
    const v = k === "target" && l.target?.manual !== s.target?.manual && (l.target?.manual || s.target?.manual) ? (l.target?.manual ? l : s).target : pick(b[k], l[k], s[k]);
    if (v !== undefined) out[k] = v;
  }
  for (const g of POSE) {
    const lr = g.rank(l), sr = g.rank(s);
    const v = lr !== sr ? sub(lr > sr ? l : s, g.keys) : pick(sub(b, g.keys), sub(l, g.keys), sub(s, g.keys));
    Object.assign(out, v);
  }
  return out;
}
/* The same photo under a provisional id (a ghost) and its real one: the owner's pose and target survive on the real one. */
function inherit(p, g) {
  const out = { ...p };
  for (const grp of POSE) if (grp.rank(g) > grp.rank(p)) { for (const k of grp.keys) delete out[k]; Object.assign(out, sub(g, grp.keys)); }
  if (g.target && !g.target.guess && (!out.target || out.target.guess)) out.target = g.target;
  return out;
}
/* A walk changed on both sides: this device's copy, with the coverage of both united (sectors OR-ed, counts and errors the larger). */
function mergeWalk(b, l, s) { const out = { ...(J(l) === J(b) ? s : l) }, c = mergeCoverage(l.coverage, s.coverage); if (c) out.coverage = c; return out; }
/* A photo run changed on both sides: field by field, but its anchoring (anchorSrc with bias, drift, start and end anchor)
   as one group, and the better-anchored side wins it (start and end, over start only, over pin and aim, over none), so a
   merge never loses an anchor. Frames counted: the larger. */
const ANCHOR_RANK = { none: 0, "pin-aim": 1, "start-frame": 2, "start+end": 3 };
const ANCHORED = ["anchorSrc", "bias", "drift", "start", "end"];
function mergeRun(b, l, s) {
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(s)])) {
    if (ANCHORED.includes(k)) continue;
    const v = k === "frames" && Number.isFinite(l.frames) && Number.isFinite(s.frames) ? Math.max(l.frames, s.frames) : pick(b[k], l[k], s[k]);
    if (v !== undefined) out[k] = v;
  }
  const lr = ANCHOR_RANK[l.anchorSrc] ?? 0, sr = ANCHOR_RANK[s.anchorSrc] ?? 0;
  Object.assign(out, lr !== sr ? sub(lr > sr ? l : s, ANCHORED) : pick(sub(b, ANCHORED), sub(l, ANCHORED), sub(s, ANCHORED)));
  return out;
}
function mergeList(b = [], l = [], s = [], done = false, merge = null) {
  const B = new Map(b.map(o => [o.id, o])), L = new Map(l.map(o => [o.id, o])), S = new Map(s.map(o => [o.id, o]));
  const out = [];
  for (const id of [...new Set([...S.keys(), ...L.keys()])]) {
    const bo = B.get(id), lo = L.get(id), so = S.get(id);
    let o;
    if (lo && so) o = merge && bo && J(lo) !== J(bo) && J(so) !== J(bo) ? merge(bo, lo, so) : pick(bo, lo, so);
    else if (so) o = bo && J(so) === J(bo) ? null : so;       // deleted here; keep only if changed there
    else o = bo && J(lo) === J(bo) ? null : lo;               // deleted there; keep only if changed here
    if (!o) continue;
    if (done && lo && so && (lo.done || so.done)) o = { ...o, done: o.done || lo.done || so.done };
    out.push(o);
  }
  return out;
}
export function mergeDocs(base = {}, local = {}, server = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(server), ...Object.keys(local)])) {
    if (LISTS.has(k)) out[k] = mergeList(base[k], local[k], server[k], false, k === "photos" ? mergePhoto : k === "walks" ? mergeWalk : k === "runs" ? mergeRun : null);
    else if (k === "quest" && local.quest && server.quest) {
      const same = (local.quest.at || "") === (server.quest.at || "");
      out.quest = same ? { ...pick(base.quest, local.quest, server.quest), items: mergeList(base.quest?.items, local.quest.items, server.quest.items, true) }
        : (local.quest.updated || local.quest.at || "") > (server.quest.updated || server.quest.at || "") ? local.quest : server.quest;
    } else if (k === "ach") {   // achievements only ever grow: keep every id, with the earlier date
      out.ach = {}; for (const id of new Set([...Object.keys(server.ach || {}), ...Object.keys(local.ach || {})])) out.ach[id] = [server.ach?.[id], local.ach?.[id]].filter(Boolean).sort()[0];
    } else if (k === "careWeeks") {   // a week done on either device stays done
      out.careWeeks = [...new Set([...(server.careWeeks || []), ...(local.careWeeks || [])])].sort();
    } else {
      const v = pick(base[k], local[k], server[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return settleSwaps(out);
}
/* A photo that waited for coverage got its server id (swapPhotoId in walk.js, kept as `was`). A copy that still has the
   provisional one is the same photo: drop it, keep a target someone chose on it, and point quest spots at the new id. */
function settleSwaps(out) {
  const real = new Map((out.photos || []).filter(p => p.was).map(p => [p.was, p]));
  if (!real.size) return out;
  const ghosts = new Map(out.photos.filter(p => real.has(p.id)).map(p => [p.id, p]));
  out.photos = out.photos.filter(p => !real.has(p.id)).map(p => {
    const g = p.was && ghosts.get(p.was);
    return g ? inherit(p, g) : p;
  });
  if (out.quest?.items) out.quest = { ...out.quest, items: out.quest.items.map(q => real.has(q.done) ? { ...q, done: real.get(q.done).id } : q) };
  return out;
}
/* What came from the other side, for a short note. */
export function mergeNews(before = {}, after = {}) {
  const had = new Set((before.photos || []).map(p => p.id));
  const isNew = p => !had.has(p.id) && !had.has(p.was);   // a swapped id is not a new photo
  return { photos: (after.photos || []).filter(isNew).length, named: (after.photos || []).filter(p => p.ai && !(before.photos || []).find(q => q.id === p.id)?.ai).length };
}
