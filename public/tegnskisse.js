/* «Tegn» (U4449): the view as a picture, marked up with the kit's sketch (renderkit/sketch.js); place = viewer.hit, so each stroke
   is still [[east, north, kote]] on the site, with the camera and the mode. Replaces tegn.js. A point on the sky has no place and goes. */
import { createSketch } from "./renderkit/sketch.js";
const NONE = [null, null, null];
/** open({ viewer, host, modal, send }): send({ text, drawing }) resolves true when it went */
export function openViewSketch({ viewer, host, modal, send }) {
  const R = host.getBoundingClientRect(), image = viewer.snapshot(), camera = viewer.pose(), mode = viewer.view().mode, W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight;
  const m = modal({ title: "Tegn på bildet", closeLabel: "Lukk tegningen", className: "sk-modal", onClose: () => m.el.remove() });
  const size = () => { const i = m.body.querySelector("img"); return [i?.naturalWidth || W, i?.naturalHeight || H]; };
  const place = (x, y) => { const [w, h] = size(); return viewer.hit(R.left + x * W / w, R.top + y * H / h) || NONE; };   // picture pixel → screen → the model
  const sk = createSketch({ host: m.body, image, title: "", place, camera, labels: { send: "Send til Anton", placeholder: "Skriv hva du vil, med pennen eller tastaturet" },
    onSend: async ({ text, drawing }) => {
      const strokes = drawing.strokes.map(s => ({ ...s, points: s.points.filter(p => p[0] != null) })).filter(s => s.points.length);
      const pins = drawing.pins.map(p => p.at[0] == null ? { ...p, at: undefined } : p);
      const ok = await send({ text: text || "Se tegningen.", drawing: { ...drawing, strokes, pins, mode, size: [W, H] } });
      if (ok === true) setTimeout(() => m.close(), 0);
      return ok;
    } });
  sk.element.querySelector(".sk-build").hidden = true;   // there is no plan to build from a view
  m.open();
  return sk;
}
