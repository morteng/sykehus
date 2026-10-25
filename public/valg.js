/* «Valgt»: what the person has picked in the model, to talk to Anton about (ruling 2026-10-25 17:42Z), as Fab lets one
   select shapes and then ask about them (atomstack hurricane/server/web/editor.js aboutSel/aboutChip, 2026-10-25).
   A click picks a wing (or a building on the site), or with a storey shown the room under it, or on a wall in 3D the
   facade it is on; shift-click adds, a click on nothing or Esc or the chip's ✕ clears.

   Each item is { kind: "wing" | "building" | "storey" | "room" | "facade", id, label, storey? }, with the ids the
   connector's tools take (a wing's id, a storey's name, a room's code or name with its storey, a facade's id), so
   Anton can pass them straight on. Sent with a message as { items, ids, summary } (Fab's {ids, summary} and more). */
const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
const segDist = ([x, y], [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };

export function createSelection({ site, floors, viewer, onChange = () => {} }) {
  let items = [];
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
    if (!b) return out;
    const w = wings.find(x => x.id === b.wing);
    out.push(w ? { kind: "wing", id: w.id, label: w.name } : { kind: "building", id: b.id, label: b.name || (b.own ? `Bygning ${b.id} på tomta` : `Nabobygning ${b.id}`) });
    if (w && at && !v.storey && v.mode === "3d" && at[2] > b.base + 1) {   // on a wall, not the roof: the facade it is on
      const f = (site.facades || []).filter(x => x.building === w.id).map(x => ({ x, d: segDist(at, x.from, x.to) })).filter(x => x.d < 2).sort((a, c) => a.d - c.d)[0];
      if (f && (b.top == null || at[2] < b.top - 0.5)) out.push({ kind: "facade", id: f.x.id, label: f.x.name });
    }
    return out;
  }
  function changed() { viewer.mark(items.filter(i => i.kind === "wing" || i.kind === "building").flatMap(i => i.kind === "wing" ? site.buildings.filter(b => b.wing === i.id).map(b => b.id) : [i.id])); onChange(items); }
  return {
    get items() { return items; },
    pick(buildingId, { shift, at, x, y } = {}) {
      const got = itemsAt(buildingId, at, x, y);
      if (!got.length) { if (!shift && items.length) { items = []; changed(); } return; }
      if (!shift) items = [];
      for (const i of got) if (!items.some(x => key(x) === key(i))) items.push(i);
      items = items.slice(-12); changed();
    },
    clear() { if (items.length) { items = []; changed(); } },
    /* «Østfløy · 5. etasje · Operasjonsstue 2»: a storey is named once, before its rooms */
    summary() { return items.filter((i, n) => i.kind !== "storey" || !items.slice(0, n).some(x => x.kind === "storey" && x.id === i.id)).map(i => i.label).join(" · "); },
    forMessage() { return items.length ? { items: items.map(({ kind, id, label, storey }) => ({ kind, id, label, ...(storey ? { storey } : {}) })), ids: items.map(i => i.id), summary: this.summary() } : null; },
  };
}
