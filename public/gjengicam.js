/* «Gjengi»'s camera (U3652, Morten 13:28Z «have the foto renderer choose appropriate camera type with possibility to
   override», 13:29Z «different types of camera/lens combos give different feeling images, like 35mm vs imax vs iphone»):
   two choices, kept apart, one copy for the page (gjengi.js, viewer.js), the server (gjengi.mjs) and Anton (mcp.mjs).
   A. the viewpoint (VIEWPOINTS): where the real camera stands and how it projects; the viewer builds a camera of it for
      the one capture and the view the person has is not touched.
   B. the look (LOOKS): lens (35 mm-equivalent focal length), picture shape and one sentence of style for the image
      model. The lens sets the viewer's field of view before the capture, so the geometry and the look agree.
   Sizes (SIZES) are the image model's own; each is priced before the press (gjengi.mjs). */
export const VIEWPOINTS = {
  "øyehøyde": { no: "Øyehøyde", tip: "Som en person ser det, øyet 1,6 m over bakken, loddrette linjer loddrette (to-punkts perspektiv). Til byggets uttrykk fra gata.", mm: 24, aspect: "3:2", eye: 1.6, line: "Eye-level view, two-point perspective, verticals corrected." },
  "fugleperspektiv": { no: "Fugleperspektiv", tip: "Fra lufta, 30–45° ned. Viser byggene og tomta i sammenheng.", mm: 35, aspect: "16:9", line: "Aerial view looking down at about 40 degrees." },
  "aksonometri": { no: "Aksonometri", tip: "Parallellprojeksjon snudd 30°, loddrette linjer loddrette, ingen perspektiv. Som en tegning av volumene.", mm: null, aspect: "1:1", line: "Axonometric view, parallel projection, no perspective, verticals vertical." },
  "fasade": { no: "Fasade", tip: "Rett på fasaden, uten perspektiv. Som et oppriss.", mm: null, aspect: "3:2", line: "Elevation view square-on to the facade, orthographic, no perspective." },
  "froskeperspektiv": { no: "Froskeperspektiv", tip: "Lavt øye, to-punkts, ser opp. For høye bygg som høyblokka; velges aldri av seg selv.", mm: 20, aspect: "2:3", eye: 0.6, line: "Low viewpoint looking up, two-point perspective, verticals corrected." },
};
/* the look, the ones an architect's photographs and illustrations need, in this order (Morten 13:30Z); easy to extend: one
   entry. mm: 35 mm-equivalent lens (null: the viewpoint's own), aspect (null: the viewpoint's), style with {mm}, when: the
   viewpoints it is the default for */
export const LOOKS = {
  arkitektfoto: { no: "Arkitektfoto", tip: "Tilt-shift 24 mm, rette linjer, skarpt dagslys, nøytrale farger. Standard bygningsfoto, til presentasjon og dokumentasjon.", mm: null, aspect: null, when: ["øyehøyde", "fasade", "froskeperspektiv"], style: "Architectural photograph, tilt-shift lens ({mm} mm), verticals corrected, crisp daylight, neutral colour." },
  blåtime: { no: "Blåtime", tip: "Skumring: blå himmel og varmt opplyste vinduer. Det klassiske arkitekturbildet, når bygget skal vise seg fra sin beste side.", mm: null, aspect: null, when: [], style: "Architectural photograph at blue hour, tilt-shift lens ({mm} mm), verticals corrected, deep blue sky, warm lit windows." },
  konkurransebilde: { no: "Konkurransebilde", tip: "Illustrasjon som i en arkitektkonkurranse: mykt lys, folk og planter, litt stemning, i øyehøyde. For å selge en idé.", mm: null, aspect: null, when: [], style: "Architectural competition illustration, soft light, people and planting, a little atmosphere, eye level, {mm} mm." },
  drone: { no: "Drone / fugleperspektiv", tip: "24–35 mm fra lufta, skarpt, med omgivelsene i bildet. For tomta og volumene i sammenheng.", mm: null, aspect: "16:9", when: ["fugleperspektiv"], style: "Aerial photograph, {mm} mm lens, sharp, the surroundings in view." },
  hvitmodell: { no: "Hvit modell", tip: "Hvit gipsmodell: myke skygger, ingen teksturer. For volumstudier og når formen skal leses uten materialer.", mm: null, aspect: null, when: ["aksonometri"], style: "White clay massing model, soft shadows, no textures, no colour." },
  skisse: { no: "Skisse", tip: "Håndtegnet strek og akvarell over samme bilde. For tidlig fase og en løs stemning.", mm: null, aspect: null, when: [], style: "Hand-drawn line and watercolour illustration." },
};
export const lookFor = vp => Object.keys(LOOKS).find(k => LOOKS[k].when.includes(vp)) || "arkitektfoto";
/* the image model's sizes, the cheapest first; tokens: the picture's out-tokens in the list price's terms (1K as gjengi.mjs
   priced it; the others at the ratios the model's pricing page gives, assumed; what a picture really cost replaces it) */
export const SIZES = { "1K": { no: "Utkast", tokens: 1300 }, "2K": { no: "Standard", tokens: 1950 }, "4K": { no: "Stor", tokens: 2925 } };
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
  return `${V.line} ${L.style.replace("{mm}", s.mm ?? V.mm ?? 24)}`;
}
