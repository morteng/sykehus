/* The words of this site's picture camera (sykehus U3652, U3814): the viewpoints and looks an architect's pictures need, as
   renderkit's photo.js takes them (cameraKit: the maths and the choice are the kit's; the ids are saved words, the English
   lines go to the image model, the Norwegian names a person reads are gjengi-no.js'). Easy to extend: one entry.
   A. VIEWPOINTS: where the real camera stands and how it projects (mm null: parallel, no lens).
   B. LOOKS, in this order (Morten 13:30Z): lens (null: the viewpoint's own), shape (null: the viewpoint's), one sentence of
      style with {mm}, `flat` the same for a parallel view, `when` the viewpoints it is the default for. */
import { cameraKit } from "./renderkit/photo.js";
export { SIZES, DEFAULT_SIZE } from "./renderkit/photo.js";

const viewpoints = {
  "øyehøyde": { mm: 24, aspect: "3:2", eye: 1.6, line: "Eye-level view, two-point perspective, verticals corrected." },
  "fugleperspektiv": { mm: 35, aspect: "16:9", line: "Aerial view looking down at about 40 degrees." },
  "aksonometri": { mm: null, aspect: "1:1", line: "Axonometric view, parallel projection, no perspective, verticals vertical." },
  "fasade": { mm: null, aspect: "3:2", line: "Elevation view square-on to the facade, orthographic, no perspective." },
  "froskeperspektiv": { mm: 20, aspect: "2:3", eye: 0.6, line: "Low viewpoint looking up, two-point perspective, verticals corrected." },
};
const looks = {
  arkitektfoto: { mm: null, aspect: null, when: ["øyehøyde", "fasade", "froskeperspektiv"], style: "Architectural photograph, tilt-shift lens ({mm} mm), verticals corrected, crisp detail, neutral white balance for the light described.",
    flat: "Architectural photograph, orthographic, verticals corrected, crisp detail, neutral white balance for the light described." },
  blåtime: { mm: null, aspect: null, when: [], style: "Architectural photograph, tilt-shift lens ({mm} mm), verticals corrected, long calm exposure, white balance for the light described.",
    flat: "Architectural photograph, orthographic, verticals corrected, long calm exposure, white balance for the light described." },
  konkurransebilde: { mm: null, aspect: null, when: [], style: "Architectural competition illustration, people and planting, a little atmosphere, eye level, {mm} mm.",
    flat: "Architectural competition illustration, people and planting, a little atmosphere, eye level." },
  drone: { mm: null, aspect: "16:9", when: ["fugleperspektiv"], style: "Aerial photograph, {mm} mm lens, sharp, the surroundings in view.", flat: "Aerial photograph, sharp, the surroundings in view." },
  hvitmodell: { mm: null, aspect: null, when: ["aksonometri"], style: "White clay massing model, no textures, no colour; shadows as the light gives them." },
  skisse: { mm: null, aspect: null, when: [], style: "Hand-drawn line and watercolour illustration." },
};

/* the viewpoint a view has when the person chose none: a facade or a section square on → fasade, plan → aksonometri,
   the eye (Gateplan) or a close 3D view → øyehøyde, a far one → fugleperspektiv. Froskeperspektiv never. */
export function viewpointFor({ mode, eye, section, dist } = {}) {
  if (mode === "section") return "fasade";
  if (mode === "plan") return "aksonometri";
  return eye || (dist != null && dist < 120) ? "øyehøyde" : "fugleperspektiv";
}

export const { VIEWPOINTS, LOOKS, lookFor, shotOf, promptLine } = cameraKit({ viewpoints, looks, viewpointFor, fallbackLook: "arkitektfoto" });
