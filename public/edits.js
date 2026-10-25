/* Changes tried on the model, not saved: a list of edits laid over site.json and floors.json. The connector (mcp.mjs)
   checks them and keeps them under a draft's id; the page shows them with ?utkast=<id>. Each says why, so a tried
   change carries its source like the data does. Saving to the shared model comes with a login; until then nothing
   here changes the data files.

   { kind: "level", wing, storey, kote, why }            a storey's kote in one wing (adds the storey if it is new)
   { kind: "wing", wing, field, value, why }             a fact on the wing card: name, built, storeys, construction, facade, note
   { kind: "room", storey, room, set: { name, use, area_m2 }, why }   a room by its code or name on that storey
   { kind: "note", text, wing?, storey?, at?: [east, north], why? }    a note pinned to a wing, a storey or a place
   and the after's: demolish, restore, balconies, volume (design.js) */
import { checkDesign, applyDesign } from "./design.js";

export const WING_FIELDS = ["name", "built", "storeys", "use", "construction", "facade", "note"];
const MAX = { text: 400, why: 300, name: 80 };
const str = (v, n, what) => { if (typeof v !== "string" || !v.trim()) throw new Error(`${what} mangler`); if (v.length > n) throw new Error(`${what} er for lang (høyst ${n} tegn)`); return v.trim(); };

export const wingOf = (site, w) => {
  const k = String(w ?? "").toLowerCase().trim();
  return (site.wings || []).find(x => x.id === k || x.name.toLowerCase() === k || (x.aliases || []).some(a => a.toLowerCase() === k));
};
export const roomMatch = (r, key) => { const k = String(key).toLowerCase().trim(); return (r.code || "").toLowerCase().replace(/\s+/g, " ") === k.replace(/\s+/g, " ") || r.name.toLowerCase() === k; };

/* one edit, checked against the model as it stands: the edit in its tidy form, or an error that says what is wrong */
export function checkEdit(site, floors, e) {
  if (!e || typeof e !== "object") throw new Error("En endring må være et objekt");
  const why = e.why == null ? undefined : str(e.why, MAX.why, "Begrunnelsen");
  switch (e.kind) {
    case "level": {
      const w = wingOf(site, e.wing); if (!w) throw new Error(`Ukjent fløy «${e.wing}». Fløyer: ${site.wings.map(x => x.name).join(", ")}`);
      const storey = str(e.storey, 30, "Etasjen"), kote = +e.kote;
      if (!Number.isFinite(kote) || kote < 0 || kote > 120) throw new Error("Koten må være et tall i meter over havet (NN2000), mellom 0 og 120");
      if (!why) throw new Error("Si hvor koten kommer fra (why), f.eks. tegning og side");
      return { kind: "level", wing: w.id, storey: /^\d+$/.test(storey) ? `${storey}. etasje` : storey, kote: Math.round(kote * 100) / 100, why };
    }
    case "wing": {
      const w = wingOf(site, e.wing); if (!w) throw new Error(`Ukjent fløy «${e.wing}»`);
      if (!WING_FIELDS.includes(e.field)) throw new Error(`Feltet må være ett av ${WING_FIELDS.join(", ")}`);
      if (!why) throw new Error("Si hvor opplysningen kommer fra (why)");
      return { kind: "wing", wing: w.id, field: e.field, value: str(String(e.value ?? ""), e.field === "name" ? MAX.name : MAX.text, "Verdien"), why };
    }
    case "room": {
      const storey = str(e.storey, 30, "Etasjen"), name = /^\d+$/.test(storey) ? `${storey}. etasje` : storey;
      const rooms = floors.filter(f => f.name === name).flatMap(f => f.rooms || []), hit = rooms.filter(r => roomMatch(r, e.room));
      if (!hit.length) throw new Error(`Fant ikke rommet «${e.room}» i ${name}`);
      if (hit.length > 1 && !hit.every(r => r.code && roomMatch({ code: r.code, name: "" }, e.room))) throw new Error(`«${e.room}» passer ${hit.length} rom i ${name}; bruk romkoden`);
      const set = {}, s = e.set || {};
      if (s.name != null) set.name = str(s.name, MAX.name, "Navnet");
      if (s.use != null) set.use = str(s.use, MAX.name, "Bruken");
      if (s.area_m2 != null) { const a = +s.area_m2; if (!Number.isFinite(a) || a <= 0 || a > 5000) throw new Error("Arealet må være et positivt tall i m²"); set.area_m2 = Math.round(a * 10) / 10; }
      if (!Object.keys(set).length) throw new Error("Si hva som skal endres: name, use eller area_m2");
      return { kind: "room", storey: name, room: String(e.room).trim(), set, ...(why ? { why } : {}) };
    }
    case "note": {
      const out = { kind: "note", text: str(e.text, MAX.text, "Notatet") };
      if (e.wing != null) { const w = wingOf(site, e.wing); if (!w) throw new Error(`Ukjent fløy «${e.wing}»`); out.wing = w.id; }
      if (e.storey != null) out.storey = str(e.storey, 30, "Etasjen");
      if (e.at != null) { const [x, y] = e.at.map(Number); if (![x, y].every(Number.isFinite) || Math.abs(x) > 500 || Math.abs(y) > 500) throw new Error("at er [øst, nord] i meter fra tomtas origo"); out.at = [Math.round(x * 10) / 10, Math.round(y * 10) / 10]; }
      if (why) out.why = why;
      return out;
    }
    default: {
      const d = checkDesign(site, e, str); if (d) return d;
      throw new Error(`Ukjent slags endring «${e.kind}»: level, wing, room, note, demolish, restore, balconies, volume eller reshape`);
    }
  }
}

/* the edits laid over copies of the model: { site, floors, notes, changed } (the inputs are left as they were) */
export function applyEdits(site0, floors0, edits = []) {
  const { terrain, ...rest } = site0;   // the terrain grid is only read (design.js groundAt), so it is shared, not copied: a change on the page stays within a frame
  const site = { ...structuredClone(rest), ...(terrain ? { terrain } : {}) }, floors = structuredClone(floors0), notes = [], changed = new Set();
  for (const e of edits) {
    if (e.kind === "level") {
      const w = site.wings.find(x => x.id === e.wing); if (!w) continue;
      w.levels ||= []; const l = w.levels.find(x => x.name === e.storey);
      if (l) Object.assign(l, { kote: e.kote, how: "utkast", src: e.why }); else w.levels.push({ name: e.storey, kote: e.kote, how: "utkast", src: e.why });
      w.levels.sort((a, b) => a.kote - b.kote); changed.add(`wing:${w.id}`);
    } else if (e.kind === "wing") {
      const w = site.wings.find(x => x.id === e.wing); if (!w) continue;
      w[e.field] = e.value; (w.draft ||= []).push({ field: e.field, why: e.why });
      if (e.field === "name") for (const b of site.buildings) if (b.wing === w.id) b.name = e.value;
      changed.add(`wing:${w.id}`);
    } else if (e.kind === "room") {
      for (const f of floors) if (f.name === e.storey) for (const r of f.rooms || []) if (roomMatch(r, e.room)) { Object.assign(r, e.set); r.draft = e.why || true; changed.add(`floor:${f.id}`); }
    } else if (e.kind === "note") notes.push(e);
  }
  applyDesign(site, floors, edits);
  return { site, floors, notes, changed: [...changed] };
}
