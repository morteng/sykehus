// U4471: which look of the kit's library each Sykehus material wears. public/renderkit/materials.js (a kit file) keeps the
// flat colour, the three.js settings in `look` and the ambientCG `texture` {set, tile}; this file adds the library id.
// An id the library does not have yet (kits row: records for the ambientCG sets) gives null, and the viewer keeps the texture
// and the flat look; the day the kit takes the record the material is drawn by materialFor with no change here.
import { materialFor } from "./renderkit/looks.js";
import { loadLooks } from "./renderkit/looklib.js";

export const LOOK_IDS = {
  concrete: "concrete", brick: "brick", wood: "wood-planks", grass: "grass", gravel: "gravel", paving: "paving", asphalt: "asphalt", water: "water",
  glass: "glass-clear", window_glass: "glass-window", steel: "steel-satin",
  meadow: null, planting: null, soil: null,   // a plant bed and bare earth: the flat colour is what they are
};
// the glass looks transmit (three renders the site a second time behind them); the viewer keeps its see-through settings until a person has looked at the cost
export const KEPT_FLAT = new Set(["glass", "window_glass"]);

export const LIBRARY_URL = "renderkit/looklib.json";
export const siteLooks = () => loadLooks(LIBRARY_URL);

/** the library id of a material, or null when it names none or the library (an {id: record}) has no such record */
export const lookIdFor = (matId, looks) => { const id = LOOK_IDS[matId]; return id && looks && Object.hasOwn(looks, id) ? id : null; };
/** the ids the materials ask for and the library lacks: the next kits row */
export const missingLooks = looks => Object.entries(LOOK_IDS).filter(([, id]) => id && !Object.hasOwn(looks, id)).map(([m, id]) => `${m}: ${id}`);

/** {material, tile: [m, m] | null} for a material drawn from the library, or null (no record, a kept-flat glass, a failed fetch): the caller keeps its texture or flat look.
 *  tile is the record's picture size in metres for a surface the caller lays out in world units (worldUV, faceUV). */
export async function libraryMaterial(matId, { tier = null, extra = {}, tint = null } = {}) {
  if (KEPT_FLAT.has(matId)) return null;
  try {
    const looks = await siteLooks(), id = lookIdFor(matId, looks);
    if (!id) return null;
    const r = await materialFor(id, { url: n => `renderkit/${n}`, looks, tier, tint, extra });
    if (!r) return null;
    const m = r.tile_mm / 1000;
    return { material: r.face, tile: m > 0 ? [m, m] : null };
  } catch { return null; }
}
