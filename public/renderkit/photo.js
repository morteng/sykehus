/* renderkit photo: the camera of a rendered picture (sykehus U3652, Morten 2026-10-26 «have the foto renderer choose
   appropriate camera type with possibility to override», «different types of camera/lens combos give different feeling
   images»): two choices, kept apart. The ids are the app's saved words (Norwegian); the names and tooltips a person reads
   are the app's too. No DOM, no three.js (the app's viewer builds the camera from a shot).
   A. the viewpoint (VIEWPOINTS): where the real camera stands and how it projects; the viewer builds a camera of it for
      the one capture and the view the person has is not touched.
   B. the look (LOOKS): lens (35 mm-equivalent focal length), picture shape and one sentence of style for the image
      model. The lens sets the viewer's field of view before the capture, so the geometry and the look agree.
   Sizes (SIZES) are the image model's own; the app prices each before the press. */
export const VIEWPOINTS = {
  "øyehøyde": { mm: 24, aspect: "3:2", eye: 1.6, line: "Eye-level view, two-point perspective, verticals corrected." },
  "fugleperspektiv": { mm: 35, aspect: "16:9", line: "Aerial view looking down at about 40 degrees." },
  "aksonometri": { mm: null, aspect: "1:1", line: "Axonometric view, parallel projection, no perspective, verticals vertical." },
  "fasade": { mm: null, aspect: "3:2", line: "Elevation view square-on to the facade, orthographic, no perspective." },
  "froskeperspektiv": { mm: 20, aspect: "2:3", eye: 0.6, line: "Low viewpoint looking up, two-point perspective, verticals corrected." },
};
/* the look, the ones an architect's photographs and illustrations need, in this order (Morten 13:30Z); easy to extend: one
   entry. mm: 35 mm-equivalent lens (null: the viewpoint's own), aspect (null: the viewpoint's), style with {mm}, when: the
   viewpoints it is the default for */
export const LOOKS = {
  arkitektfoto: { mm: null, aspect: null, when: ["øyehøyde", "fasade", "froskeperspektiv"], style: "Architectural photograph, tilt-shift lens ({mm} mm), verticals corrected, crisp daylight, neutral colour." },
  blåtime: { mm: null, aspect: null, when: [], style: "Architectural photograph at blue hour, tilt-shift lens ({mm} mm), verticals corrected, deep blue sky, warm lit windows." },
  konkurransebilde: { mm: null, aspect: null, when: [], style: "Architectural competition illustration, soft light, people and planting, a little atmosphere, eye level, {mm} mm." },
  drone: { mm: null, aspect: "16:9", when: ["fugleperspektiv"], style: "Aerial photograph, {mm} mm lens, sharp, the surroundings in view." },
  hvitmodell: { mm: null, aspect: null, when: ["aksonometri"], style: "White clay massing model, soft shadows, no textures, no colour." },
  skisse: { mm: null, aspect: null, when: [], style: "Hand-drawn line and watercolour illustration." },
};
export const lookFor = vp => Object.keys(LOOKS).find(k => LOOKS[k].when.includes(vp)) || "arkitektfoto";
/* the image model's sizes, the cheapest first; tokens: the picture's out-tokens in the list price's terms (1K as gjengi.mjs
   priced it (one image model); the others at the ratios the model's pricing page gives, assumed; what a picture really cost replaces it) */
export const SIZES = { "1K": { tokens: 1300 }, "2K": { tokens: 1950 }, "4K": { tokens: 2925 } };
export const DEFAULT_SIZE = "2K";

/* the viewpoint a view has when the person chose none: a facade or a section square on → fasade, plan → aksonometri,
   the eye (Gateplan) or a close 3D view → øyehøyde, a far one → fugleperspektiv. Froskeperspektiv never. */
export function viewpointFor({ mode, eye, section, dist } = {}) {
  if (mode === "section") return "fasade";
  if (mode === "plan") return "aksonometri";
  return eye || (dist != null && dist < 120) ? "øyehøyde" : "fugleperspektiv";
}
/* 35 mm-equivalent focal length → the vertical field of view (degrees) of a frame of this shape (the long side 36 mm) */
export const fovFor = (mm, [aw, ah]) => 2 * Math.atan((aw >= ah ? 36 * ah / aw : 36) / 2 / mm) * 180 / Math.PI;
export const ratio = a => { const [w, h] = String(a).split(":").map(Number); return [w, h]; };
/* the shot for the viewer and the server: viewpoint, look, lens and eye height over the defaults */
export function shotOf({ viewpoint, look, lens, eyeh } = {}, view = {}) {
  const vp = VIEWPOINTS[viewpoint] ? viewpoint : viewpointFor(view), lk = LOOKS[look] ? look : lookFor(vp), V = VIEWPOINTS[vp], L = LOOKS[lk];
  const ortho = vp === "aksonometri" || vp === "fasade", aspect = L.aspect || V.aspect;
  const mm = ortho ? null : Math.min(200, Math.max(10, +lens || L.mm || V.mm));
  return { viewpoint: vp, look: lk, aspect, mm, ...(V.eye ? { eye: Math.min(50, Math.max(0.3, +eyeh || V.eye)) } : {}) };
}
/* the camera's sentence for the image model: short, one line of viewpoint and one of look */
export function promptLine(s) {
  const V = VIEWPOINTS[s.viewpoint], L = LOOKS[s.look];
  /* a parallel projection (aksonometri, fasade) has no lens: the sentence says orthographic and names no mm */
  const style = s.mm == null ? L.style.replace("tilt-shift lens ({mm} mm)", "orthographic").replace("{mm} mm lens, ", "").replace(", {mm} mm.", ".") : L.style.replace("{mm}", s.mm);
  return `${V.line} ${style}`;
}
