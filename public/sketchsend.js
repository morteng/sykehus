/* U3635: what a plan's feedback says to Anton (the card and the large window send it the same way): the marks as the drawing
   (the picture with them, strokes in metres) and the pins in words. s: the plan (title, size); { text, drawing } from sketch.js. */
export const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
export function feedbackOf(s, { text, drawing }) {
  const pins = drawing.pins.map(p => `Nål ${p.n} (øst ${m1(p.at[0])}, nord ${m1(p.at[1])} m)${p.note ? `: ${p.note}` : ""}`);
  const { pins: _p, ...draw } = drawing;
  return { text: [`Tilbakemelding på skissen «${s.title}»${text ? `: ${text}` : "."}`, ...pins].join("\n"), drawing: { ...draw, camera: {}, mode: "plan", size: s.size } };
}
