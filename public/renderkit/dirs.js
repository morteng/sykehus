/* Directions, one copy for sykehus and hagekart (the plan's DRY 5): bearings in degrees clockwise from north, points and
   vectors as [east, north]. Pure.
     norm360(b)            a bearing in 0 ≤ b < 360
     bearing(from, to)     the bearing from one point to another; bearingOf(v) a vector's, to the whole degree
     turn(a, b)            how far apart two bearings are, 0–180
     SIDES                 the four sides as unit vectors: N, Ø, S, V; SIDE_KEYS their order; SIDE_WORD nord, øst, sør, vest
     WORDS, dirWord(b)     the eight words (nord, nordøst, … nordvest) and the one nearest a bearing
     dirDeg(d)             a direction as a person or a model writes it (any case, Norwegian or English, short or whole,
                           NØ or no or northeast, or degrees as a number or a string) → degrees, or null when it is none */
export const norm360 = b => ((b % 360) + 360) % 360;
export const bearing = (from, to) => norm360(Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI);
export const bearingOf = v => norm360(Math.round(Math.atan2(v[0], v[1]) * 180 / Math.PI));
export const turn = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

export const SIDES = Object.freeze({ N: [0, 1], "Ø": [1, 0], S: [0, -1], V: [-1, 0] });
export const SIDE_KEYS = Object.freeze(Object.keys(SIDES));
export const SIDE_WORD = Object.freeze({ N: "nord", "Ø": "øst", S: "sør", V: "vest" });
export const WORDS = Object.freeze(["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"]);
export const dirWord = b => WORDS[Math.round(norm360(b) / 45) % 8];

const DEG = { n: 0, nord: 0, north: 0, no: 45, ne: 45, nordost: 45, northeast: 45, o: 90, e: 90, ost: 90, east: 90, so: 135, se: 135, sorost: 135, southeast: 135,
  s: 180, sor: 180, south: 180, sv: 225, sw: 225, sorvest: 225, southwest: 225, v: 270, w: 270, vest: 270, west: 270, nv: 315, nw: 315, nordvest: 315, northwest: 315 };
const fold = s => s.normalize("NFC").toLowerCase().replace(/æ/g, "ae").replace(/[øö]/g, "o").replace(/[åä]/g, "a").normalize("NFD").replace(/[̀-ͯ]/g, "");
export function dirDeg(d) {
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  const k = fold(String(d ?? "")).replace(/[^a-z0-9.-]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(k)) return +k;
  return DEG[k.replace(/-/g, "")] ?? null;
}
