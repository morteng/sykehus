/* «Uteområde» (U3664): what the picker shows, as data and drawings. No DOM here, so the words and the sorting can be tested.
   The swatches are renderkit's pictures (thumb-<surface>.webp); the plants are hagekart's list (plants.js), drawn by their kind
   as a crown (a photo is not used: hagekart keeps only the name of its Wikipedia picture). */
import { PAINT_SURFACES } from "./paint-edit.js";

/* the words on the swatches, in the order they come */
export const SWATCH_NO = { grass: "Gress", meadow: "Eng", planting: "Beplantning", gravel: "Grus", paving: "Belegg", asphalt: "Asfalt", soil: "Jord" };
export const SWATCHES = PAINT_SURFACES.map(id => ({ id, no: SWATCH_NO[id], img: `renderkit/thumb-${id}.webp` }));
export const SIZES = [{ r: 0.8, no: "Smal", px: 8 }, { r: 1.5, no: "Middels", px: 16 }, { r: 3, no: "Bred", px: 28 }];

/* the terrain acts, with the one word each */
export const OPS = [{ op: "flatten", no: "Flat ut", h: false }, { op: "raise", no: "Hev", h: true }, { op: "lower", no: "Senk", h: true }, { op: "pond", no: "Dam", h: true }];
export const OP_ICON = {
  flatten: '<svg viewBox="0 0 24 24"><path d="M3 15c3-3 5 2 8-1s4-4 10-3"/><path d="M3 19h18" /></svg>',
  raise: '<svg viewBox="0 0 24 24"><path d="M3 18h18"/><path d="M6 18c2-8 10-8 12 0"/><path d="M12 4v5M9.5 6.5 12 4l2.5 2.5"/></svg>',
  lower: '<svg viewBox="0 0 24 24"><path d="M3 8h18"/><path d="M6 8c2 8 10 8 12 0"/><path d="M12 20v-5M9.5 17.5 12 20l2.5-2.5"/></svg>',
  pond: '<svg viewBox="0 0 24 24"><path d="M3 9h18"/><path d="M5 9c1 8 13 8 14 0"/><path d="M8 13c1.5 1 6.5 1 8 0"/></svg>',
};
export const ERASER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 3.5 13.5a1.4 1.4 0 0 1 0-2l7-7a1.4 1.4 0 0 1 2 0l6 6a1.4 1.4 0 0 1 0 2L12 19H20"/><path d="M7 9l8 8"/></svg>';

/* a plant's kind for the cards and the chips: tre (løvtre, fruit trees too), bar (bartre), busk, hekk, staude */
export const TYPES = [{ id: "tre", chip: "Trær", no: "Løvtre" }, { id: "bar", chip: "Trær", no: "Bartre" }, { id: "busk", chip: "Busker", no: "Busk" }, { id: "hekk", chip: "Hekk", no: "Hekk" }, { id: "staude", chip: "Stauder", no: "Staude" }];
export const CHIPS = ["Trær", "Busker", "Hekk", "Stauder"];
export const plantType = p => p.cat === "conifer" ? "bar" : p.cat === "hedge" ? "hekk" : p.cat === "perennial" ? "staude" : /^shrub|rose/.test(p.cat) ? "busk" : "tre";
export const chipOf = p => TYPES.find(t => t.id === plantType(p)).chip;
export const typeNo = p => TYPES.find(t => t.id === plantType(p)).no;
const fmt = v => String(v).replace(".", ",");
export const heightText = p => `${fmt(p.ht)} m høy`;

/* the cards of a list, by the chips picked (none picked: all), the banned left out; sorted by name */
export function cards(plants, picked = []) {
  return plants.filter(p => !p.banned && p.id !== "tre" && p.id !== "busk" && (!picked.length || picked.includes(chipOf(p))))
    .sort((a, b) => a.no.localeCompare(b.no, "nb"));
}

/* a crown drawn by kind, 64 × 64, in greens that read on a pale card */
const G = { leaf: "#6f9a4f", dark: "#4d7a3a", trunk: "#7a5c3c", bloom: "#d9a441" };
export function silhouette(p) {
  const t = plantType(p), s = (a, b) => `<svg viewBox="0 0 64 64" aria-hidden="true">${a}${b || ""}</svg>`;
  if (t === "bar") return s(`<rect x="30" y="50" width="4" height="9" fill="${G.trunk}"/>`, `<path d="M32 5 46 27H38L50 44H14L26 27H18Z" fill="${G.dark}"/>`);
  if (t === "busk") return s(`<path d="M8 54C8 30 24 20 32 20S56 30 56 54Z" fill="${G.leaf}"/>`, `<path d="M20 54c0-12 6-18 12-18s12 6 12 18" fill="none" stroke="${G.dark}" stroke-width="2"/>`);
  if (t === "hekk") return s(`<rect x="8" y="22" width="48" height="32" rx="4" fill="${G.dark}"/>`, `<path d="M8 32h48M8 42h48" stroke="${G.leaf}" stroke-width="2"/>`);
  if (t === "staude") return s(`<path d="M20 58V32M32 58V20M44 58V30" stroke="${G.dark}" stroke-width="3" stroke-linecap="round"/>`, `<circle cx="20" cy="29" r="5" fill="${G.bloom}"/><circle cx="32" cy="17" r="6" fill="${G.bloom}"/><circle cx="44" cy="27" r="5" fill="${G.bloom}"/>`);
  return s(`<rect x="29" y="38" width="6" height="21" fill="${G.trunk}"/>`, `<circle cx="32" cy="26" r="20" fill="${G.leaf}"/><circle cx="24" cy="22" r="9" fill="${G.dark}" opacity=".35"/>`);
}
