/* The plants Anton and the page can set on the site: hagekart's own list, taken by lock (U3659: one copy; the hand copy is gone).
   hagekart-plants.js is hagekart's public/plants.json at the sha in hagekart-plants.lock.json (node tools/take-plants.mjs <sha>
   to take it again; --check says when the copy was edited). The ids are the ones its search_plants and check_species give; ht and sp
   are the height and spread in metres, to size them in 3D. banned: forbidden to plant in Norway (forskrift om fremmede organismer),
   as hagekart has it; never planted here. What sykehus keeps of each: id, no, la, cat, ht, sp, form, banned. Bulbs and plants that
   are not planted as such (cat none) are not offered, but the banned ones are, so they are refused with a reason. */
import RAW from "./hagekart-plants.js";

export const PLANTS = RAW.filter(p => p.banned || !["bulb", "none"].includes(p.cat))
  .map(p => ({ id: p.id, no: p.no, la: p.la, cat: p.cat, ht: p.ht, sp: p.sp, form: p.look?.form, ...(p.banned ? { banned: true } : {}) }));

/* every plant hagekart lists, bulbs and "none" too: the server (landscape.js plantOf) takes them by name or id although the picker does not offer them */
export const ALL_PLANTS = RAW.map(p => ({ id: p.id, no: p.no, la: p.la, cat: p.cat, ht: p.ht, sp: p.sp, form: p.look?.form, ...(p.banned ? { banned: true } : {}) }));

/* U3655: the species picker's search over the list above: by Norwegian or Latin name or id, accents and case ignored; the
   banned ones come back too, with the reason, so the picker shows them greyed and the server (landscape.js plantOf) still refuses them */
export const fold = t => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a");
export const BANNED_WHY = "Forbudt å plante i Norge (forskrift om fremmede organismer)";
export function searchPlants(q, limit = 8) {
  const k = fold(q).trim(); if (!k) return [];
  return PLANTS.filter(p => p.id !== "tre" && p.id !== "busk" && [p.no, p.la, p.id].some(v => fold(v).includes(k)))
    .sort((a, b) => (fold(b.no).startsWith(k) - fold(a.no).startsWith(k)) || a.no.localeCompare(b.no, "nb")).slice(0, limit)
    .map(p => ({ id: p.id, no: p.no, la: p.la, cat: p.cat, ht: p.ht, sp: p.sp, banned: !!p.banned, ...(p.banned ? { why: BANNED_WHY } : {}) }));
}
