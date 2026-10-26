/* A pin on the ground (U3671): where the person tapped when Anton asked for a place. A red ball on a thin stalk, sized to the view so it
   reads from the plan's 90 m and from 3D; one at a time. dropPin(viewer, [x, y, kote]) puts it, clearPin() takes it away. */
import * as THREE from "./vendor/three.module.js";
import { modal } from "./kit/modal.js";

let current = null;
export function clearPin(viewer) { if (current) { viewer.remove(current); current = null; } }
export function dropPin(viewer, [x, y, kote = 0]) {
  clearPin(viewer);
  const s = Math.max(0.5, (viewer.pose().dist || 90) / 90), g = new THREE.Group(), red = new THREE.MeshBasicMaterial({ color: 0xc62828, depthTest: false }), white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 5 * s, 8), red); stalk.position.y = 2.5 * s;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 16, 12), red); ball.position.y = 5.2 * s;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35 * s, 12, 8), white); dot.position.y = 5.2 * s; dot.position.z = 0.7 * s;
  for (const m of [stalk, ball, dot]) { m.renderOrder = 30; g.add(m); }
  g.position.copy(viewer.world([x, y], kote)); viewer.add(g); current = g;
  return () => clearPin(viewer);
}

/* The dialog Anton's question opens (U3683): the question as its heading, the page's own plan view moved into it (one viewer, so the
   camera, the buildings and the tap-to-ground are the ones the page has; a second scene would be a second copy of the whole site),
   a tap sets or moves the pin, «Bruk dette stedet» sends it, «Avbryt», the × or Esc sends nothing. The view goes back to its place
   before either answer is given, so the main page shows the pin. o: question, view (the element), stage (where it lives), viewer,
   zoom(f), use([x, y, kote]), cancel(). place([x, y, kote]) is what a tap calls. */
export function pinDialog(o) {
  let at = null, sent = false;
  const m = modal({ title: o.question, closeLabel: "Avbryt", className: "pin-panel", onClose: () => {
    o.stage.prepend(o.view); o.view.classList.remove("in-pin"); m.el.remove(); at && sent ? o.use(at) : o.cancel();
  } });
  m.body.innerHTML = `<div class="pin-map" id="pinMap"></div><div class="pin-bar"><span class="pin-hint" id="pinHint">Trykk på planen der det er. Dra for å flytte kartet.</span>
    <button type="button" id="pinNo">Avbryt</button><button type="button" class="dr-p" id="pinGo" disabled>Bruk dette stedet</button></div>`;
  const map = m.body.querySelector("#pinMap"), go = m.body.querySelector("#pinGo"), hint = m.body.querySelector("#pinHint");
  map.insertAdjacentHTML("beforeend", `<div class="pin-zoom"><button type="button" data-z="in" aria-label="Zoom inn">+</button><button type="button" data-z="out" aria-label="Zoom ut">−</button></div>`);
  map.querySelector("[data-z=in]").onclick = () => o.zoom(1 / 1.5); map.querySelector("[data-z=out]").onclick = () => o.zoom(1.5);
  m.body.querySelector("#pinNo").onclick = () => m.close();
  go.onclick = () => { sent = true; m.close(); };
  return {
    open() { m.open(); o.view.classList.add("in-pin"); map.prepend(o.view); },
    place(p) { at = p; dropPin(o.viewer, p); go.disabled = false; hint.textContent = "Nålen står her. Trykk et annet sted for å flytte den."; },
    close: () => m.close(),
  };
}
