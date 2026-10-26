/* «Valgt»: what the person has picked in the model, to talk to Anton about (ruling 2026-10-25 17:42Z), as Fab lets one
   select shapes and then ask about them (atomstack hurricane/server/web/editor.js aboutSel/aboutChip, 2026-10-25).
   A click picks a wing (or a building on the site), or with a storey shown the room under it, or on a wall in 3D the
   facade it is on; shift-click adds, a click on nothing or Esc clears, a chip's × (the kit's g-pick, in the pill) takes one away,
   and a card's «Spør Anton om dette» adds its wing or storey.

   Each item is { kind: "wing" | "building" | "new" | "ground" | "road" | "storey" | "room" | "facade", id, label, storey? } (new: a
   building the after adds, by its id, U3556; ground: a surface or a path the after lays, flate-1, sti-2, U3569; road: a road
   section around, by its way's id, vei-osm-24365596, U3543), with the ids the
   connector's tools take (a wing's id, a storey's name, a room's code or name with its storey, a facade's id), so
   Anton can pass them straight on. Sent with a message as { items, ids, summary } (Fab's {ids, summary} and more). */
import { groundAt } from "./renderkit/fit.js";
import { MATERIALS } from "./renderkit/materials.js";
import { pointInRing as inRing, segDist } from "./renderkit/paths2d.js";   // one copy (DRY 1, 2)

/* a surface's or a path's name: its own, else what it is */
export const SURFACE_NO = Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, m.no]));   // renderkit materials.js (U3618)
export const groundName = g => g.kind === "trees" ? `${g.name || g.species}${g.count > 1 ? ` × ${g.count}` : ""}` : g.name || (g.kind === "path" ? `Sti (${(SURFACE_NO[g.surface] || g.surface).toLowerCase()})` : g.surface === "water" ? "Vann" : SURFACE_NO[g.surface] || "Flate");

/* a road section's name: its street's and what it is (Welhavens gate, kjørevei), else what it is */
export const roadName = r => r.name ? `${r.name} (${r.what})` : r.what[0].toUpperCase() + r.what.slice(1);

export function createSelection({ site, floors, viewer, onChange = () => {} }) {
  let items = [];
  const known = new Map();   // key → item, for the picker's keys
  const wings = site.wings || [];
  const key = i => `${i.kind}:${i.storey ?? ""}:${i.id}`;
  function itemsAt(buildingId, at, x, y) {
    const v = viewer.view(), b = site.buildings.find(x => x.id === buildingId), out = [];
    const fs = v.storey ? floors.filter(f => f.name === v.storey) : [];
    /* the storey shown is cut 1,2 m over its floor and the ray hits the roof above it: the room is where the ray meets the floor */
    const onFloor = fs.length && x != null ? viewer.groundAt(x, y, fs[0].kote + 0.1) : null;
    if (onFloor) at = [onFloor[0], onFloor[1], fs[0].kote];
    if (v.storey && at) {   // a room on the storey shown: inside its outline, else the nearest stamp within 6 m
      const rooms = fs.flatMap(f => (f.rooms || []).map(r => ({ r, f })));
      const hit = rooms.find(({ r }) => r.poly && inRing(at, r.poly)) || rooms.map(x => ({ ...x, d: Math.hypot(x.r.at[0] - at[0], x.r.at[1] - at[1]) })).filter(x => x.d < 6).sort((a, b) => a.d - b.d)[0];
      out.push({ kind: "storey", id: v.storey, label: v.storey });
      if (hit) { out.push({ kind: "room", id: hit.r.code || hit.r.name, storey: v.storey, label: hit.r.code && hit.r.code !== hit.r.name ? `${hit.r.name} (${hit.r.code})` : hit.r.name }); return out; }
    }
    const rd = !b && viewer.roadOf?.(buildingId);   // a road section around (U3543): by its way's id
    if (rd) { out.push({ kind: "road", id: rd.id, label: roadName(rd) }); return out; }
    const g = !b && ((site.landscape || []).find(x => x.id === buildingId) || (site.plantings || []).find(x => x.id === buildingId));   // a pool, a lawn, a path, a planting (U3569)
    if (g) { out.push({ kind: "ground", id: g.id, label: groundName(g) }); return out; }
    const n = !b && (site.added || []).find(x => x.id === buildingId && x.kind === "volume");
    if (n) { out.push({ kind: "new", id: n.id, label: n.name }); return out; }
    if (!b) return out;
    const w = wings.find(x => x.id === b.wing);
    out.push(w ? { kind: "wing", id: w.id, label: w.name } : { kind: "building", id: b.id, label: b.name || (b.own ? `Bygning ${b.id} på tomta` : `Nabobygning ${b.id}`) });
    if (w && at && !v.storey && v.mode === "3d" && at[2] > b.base + 1) {   // on a wall, not the roof: the facade it is on
      const f = (site.facades || []).filter(x => x.building === w.id).map(x => ({ x, d: segDist(at, x.from, x.to) })).filter(x => x.d < 2).sort((a, c) => a.d - c.d)[0];
      if (f && (b.top == null || at[2] < b.top - 0.5)) out.push({ kind: "facade", id: f.x.id, label: f.x.name });
    }
    return out;
  }
  function changed() { viewer.mark(items.filter(i => i.kind === "wing" || i.kind === "building" || i.kind === "new" || i.kind === "ground" || i.kind === "road").flatMap(i => i.kind === "wing" ? site.buildings.filter(b => b.wing === i.id).map(b => b.id) : [i.id])); onChange(items); }
  return {
    get items() { return items; },
    pick(buildingId, { shift, at, x, y } = {}) {
      const got = itemsAt(buildingId, at, x, y); for (const i of got) known.set(key(i), i);
      if (!got.length) { if (!shift && items.length) { items = []; changed(); } return; }
      if (!shift) items = [];
      for (const i of got) if (!items.some(x => key(x) === key(i))) items.push(i);
      items = items.slice(-12); changed();
    },
    clear() { if (items.length) { items = []; changed(); } },
    /* for renderkit's picker (U3569): what a pointer on hit { id, at } takes, as keys; the picker's keys back as items */
    keysAt(hit, x, y) { const got = hit?.id ? itemsAt(hit.id, hit.at, x, y) : []; for (const i of got) known.set(key(i), i); return got.map(key); },
    setKeys(keys) { const next = keys.map(k => known.get(k) || items.find(i => key(i) === k)).filter(Boolean).slice(-12); if (next.length === items.length && next.every((i, n) => key(i) === key(items[n]))) return; items = next; changed(); },
    /* what a window takes: each wing (all its buildings), each other building, each new one, by its outline (the
       ring at the foot and at the top, and the corners' verticals); project([east, north], kote) → [x, y, front] */
    windowKeys(r, inside, project, test) {
      const pr = (x, y, z) => { const p = project([x, y], z); return p[2] ? { x: p[0], y: p[1] } : null; };
      const segs = parts => { const f = []; for (const { ring, lo, hi } of parts) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; f.push(p[0], p[1], lo, q[0], q[1], lo, p[0], p[1], hi, q[0], q[1], hi, p[0], p[1], lo, p[0], p[1], hi); } return f; };
      const gone = new Set((site.demolished || []).map(d => d.id)), out = [];
      const standing = site.buildings.filter(b => !gone.has(b.id) && b.ring?.length);
      for (const w of wings) { const bs = standing.filter(b => b.wing === w.id); if (bs.length && test(segs(bs.map(b => ({ ring: b.ring, lo: b.base, hi: b.top ?? b.base + 10 }))), r, inside, pr)) out.push({ kind: "wing", id: w.id, label: w.name }); }
      for (const b of standing.filter(b => !wings.some(w => w.id === b.wing))) if (test(segs([{ ring: b.ring, lo: b.base, hi: b.top ?? b.base + 10 }]), r, inside, pr)) out.push({ kind: "building", id: b.id, label: b.name || (b.own ? `Bygning ${b.id} på tomta` : `Nabobygning ${b.id}`) });
      for (const a of (site.added || []).filter(a => a.kind === "volume" && !gone.has(a.id))) {
        const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) || 1, n = [-(a.to[1] - a.from[1]) / L * a.width / 2, (a.to[0] - a.from[0]) / L * a.width / 2];
        const ring = [[a.from[0] + n[0], a.from[1] + n[1]], [a.to[0] + n[0], a.to[1] + n[1]], [a.to[0] - n[0], a.to[1] - n[1]], [a.from[0] - n[0], a.from[1] - n[1]]];
        if (test(segs([{ ring, lo: a.base_kote, hi: a.top_kote }]), r, inside, pr)) out.push({ kind: "new", id: a.id, label: a.name });
      }
      for (const g of site.landscape || []) {   // a surface or a path by its outline on the ground
        const z = g.ring.map(p => groundAt(site, p) + 0.2), f = g.ring.flatMap((p, i) => { const q = g.ring[(i + 1) % g.ring.length]; return [p[0], p[1], z[i], q[0], q[1], z[(i + 1) % z.length]]; });
        if (test(f, r, inside, pr)) out.push({ kind: "ground", id: g.id, label: groundName(g) });
      }
      for (const i of out) known.set(key(i), i); return out.map(key);
    },
    /* the card's «Spør Anton om dette»: its wing or storey, added; a chip's ×: one taken away (by key) */
    add(i) { known.set(key(i), i); if (!items.some(x => key(x) === key(i))) { items = [...items, i].slice(-12); changed(); } },
    remove(k) { const n = items.length; items = items.filter(x => key(x) !== k); if (items.length !== n) changed(); },
    key,
    /* «Østfløy · 5. etasje · Operasjonsstue 2»: a storey is named once, before its rooms */
    summary() { return items.filter((i, n) => i.kind !== "storey" || !items.slice(0, n).some(x => x.kind === "storey" && x.id === i.id)).map(i => i.label).join(" · "); },
    forMessage() { return items.length ? { items: items.map(({ kind, id, label, storey }) => ({ kind, id, label, ...(storey ? { storey } : {}) })), ids: items.map(i => i.id), summary: this.summary() } : null; },
  };
}
