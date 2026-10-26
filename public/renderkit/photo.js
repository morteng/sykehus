/* renderkit photo: the camera of a rendered picture (sykehus U3652, Morten 2026-10-26 «have the foto renderer choose
   appropriate camera type with possibility to override», «different types of camera/lens combos give different feeling
   images»; split U3814 so a second app can use it: Morten 2026-10-26 19:10Z «do the shared stuff and 3d kit moves if fab
   needs those»). The maths and the shape of the choice are here; the WORDS are the app's, handed to cameraKit as tables:
   A. the viewpoints: where the real camera stands and how it projects. An entry: { mm (35 mm-equivalent lens, null: a
      parallel projection, no lens), aspect ("3:2"), eye (camera height in m, when it stands on the ground), line (one
      sentence for the image model) }.
   B. the looks: lens, picture shape and one sentence of style for the image model. An entry: { mm (null: the viewpoint's
      own), aspect (null: the viewpoint's), when (the viewpoints it is the default for), style (with {mm} where the lens
      goes), flat (the same sentence for a parallel projection, with no lens; when missing, style as it is) }.
   The ids are the app's saved words; the names and tooltips a person reads are the app's too. No DOM, no three.js (the
   app's viewer builds the camera from a shot). Sizes (SIZES) are the image model's own; the app prices each before the press. */

/* the image model's sizes, the cheapest first; tokens: the picture's out-tokens in the list price's terms (1K as the first
   app priced it (one image model); the others at the ratios the model's pricing page gives, assumed; what a picture really cost replaces it) */
export const SIZES = { "1K": { tokens: 1300 }, "2K": { tokens: 1950 }, "4K": { tokens: 2925 } };
export const DEFAULT_SIZE = "2K";

/* 35 mm-equivalent focal length → the vertical field of view (degrees) of a frame of this shape (the long side 36 mm) */
export const fovFor = (mm, [aw, ah]) => 2 * Math.atan((aw >= ah ? 36 * ah / aw : 36) / 2 / mm) * 180 / Math.PI;
export const ratio = a => { const [w, h] = String(a).split(":").map(Number); return [w, h]; };

/* the camera choices of one app: { viewpoints, looks, viewpointFor(view) → a viewpoint id when the person chose none,
   fallbackLook (default: the first look) } → { VIEWPOINTS, LOOKS, lookFor, shotOf, promptLine } */
export function cameraKit({ viewpoints, looks, viewpointFor, fallbackLook = Object.keys(looks)[0] }) {
  /* the look a viewpoint has by default */
  const lookFor = vp => Object.keys(looks).find(k => looks[k].when.includes(vp)) || fallbackLook;
  /* the shot for the viewer and the server: viewpoint, look, lens and eye height over the defaults */
  function shotOf({ viewpoint, look, lens, eyeh } = {}, view = {}) {
    const vp = viewpoints[viewpoint] ? viewpoint : viewpointFor(view), lk = looks[look] ? look : lookFor(vp), V = viewpoints[vp], L = looks[lk];
    const aspect = L.aspect || V.aspect, mm = V.mm == null ? null : Math.min(200, Math.max(10, +lens || L.mm || V.mm));
    return { viewpoint: vp, look: lk, aspect, mm, ...(V.eye ? { eye: Math.min(50, Math.max(0.3, +eyeh || V.eye)) } : {}) };
  }
  /* the camera's sentence for the image model: short, one line of viewpoint and one of look; a parallel projection has no lens, so no mm */
  function promptLine(s) {
    const V = viewpoints[s.viewpoint], L = looks[s.look];
    return `${V.line} ${s.mm == null ? L.flat ?? L.style : L.style.replace("{mm}", s.mm)}`;
  }
  return { VIEWPOINTS: viewpoints, LOOKS: looks, lookFor, shotOf, promptLine };
}
