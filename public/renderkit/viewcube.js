/* A view cube (U3882, Morten via pm): a small cube in a corner that turns with the camera. A click on a face goes to that
   view (Topp, Front, Bak, Venstre, Høyre, Under), a click on an edge or a corner to the three-quarter view between the
   faces it joins, and the home button to the home view. One copy for every app (sykehus first, Fab next).

   The world is z up, x east, y north. The camera is the orbit of camera.js: yaw (0 looks along +y, so it stands south of its
   target: the Front face), pitch (the elevation, 90° looks straight down), as stateOf/poseOf there. The cube is drawn without
   perspective, so the pick is exact: pickDir() works the click out in the cube's own space.

   The pure part (no DOM): cubeMatrix(yaw, pitch), faceDir(name), pickDir(m, px, py, half), dirToView(dir, yaw0).
   The widget: createViewCube({ host, labels, onPick, onHome, low }) → { set(yaw, pitch), el, destroy() }.
     labels  { top, front, back, left, right, bottom, home }: the app's words; a face with no label is not offered (its
             click does nothing, so an app that cannot look from below leaves bottom out)
     onPick  (view, info): view { yaw, pitch } in radians, info { dir: [x, y, z] unit vector from the target to the camera,
             name: "front" | "top-right" | "front-top-right" …, low } (low: prefers-reduced-motion, so jump, no ease). The app
             moves its camera, with camera.js ease/moveCamera, and keeps its own distance and target.
     onHome  (info { low }): the app's home view
     low     () → true to jump; default prefers-reduced-motion
     size    the box in px (default 72); the cube is 0.62 of it
     inline  true: static, in the app's own column; else absolute, top right of host
   Colours are the page's tokens (--panel, --panel-2, --border, --text, --muted, --accent, --on-accent), none are set here. */

/* the six faces: the world direction each looks along (from the target to the camera) */
export const FACES = Object.freeze({ top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0] });
export const faceDir = name => FACES[name] ? [...FACES[name]] : null;

/* the 3x3 turn that takes the cube's own axes (css: x right, y down, z toward the viewer, seen from the Front with z up)
   to the screen at a camera yaw and pitch; rows are the screen's x, y, z. At yaw 0 and pitch 0 it is the identity. */
export function cubeMatrix(yaw, pitch) {
  const sa = Math.sin(yaw), ca = Math.cos(yaw), se = Math.sin(pitch), ce = Math.cos(pitch);
  const r = [ca, sa, 0], u = [-sa * se, ca * se, ce], c = [sa * ce, -ca * ce, se];   // screen right, up and toward the viewer, in the world
  // css0 = (x, -z, -y) of the world, so a world vector w = (cx, -cz, -cy) of css0
  return [[r[0], -r[2], -r[1]], [-u[0], u[2], u[1]], [c[0], -c[2], -c[1]]];
}

/* the css matrix3d (column-major) of that turn */
export function cssMatrix(m) {
  return `matrix3d(${m[0][0]},${m[1][0]},${m[2][0]},0,${m[0][1]},${m[1][1]},${m[2][1]},0,${m[0][2]},${m[1][2]},${m[2][2]},0,0,0,0,1)`;
}

/* what a click at (px, py), px from the cube's centre (right, down), lands on: the world direction [x, y, z] of integers
   (one axis a face, two an edge, three a corner), or null off the cube. half is the cube's half side; the edge band is the
   outer quarter of a face on each side. */
export function pickDir(m, px, py, half = 1) {
  // the cube's space is the screen turned back (m is a turn, so its transpose is its inverse)
  const T = (i, v) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2], a = [T(0, [px, py, 0]), T(1, [px, py, 0]), T(2, [px, py, 0])], b = [m[2][0], m[2][1], m[2][2]];
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(b[i]) < 1e-9) { if (Math.abs(a[i]) > half) return null; continue; }
    const s = (-half - a[i]) / b[i], e = (half - a[i]) / b[i];
    t0 = Math.max(t0, Math.min(s, e)); t1 = Math.min(t1, Math.max(s, e));
  }
  if (t0 > t1) return null;
  const p = [a[0] + t1 * b[0], a[1] + t1 * b[1], a[2] + t1 * b[2]], band = half * 0.5, s = p.map(v => (Math.abs(v) > band ? Math.sign(v) : 0));
  // the face the ray enters on always counts (its coordinate is ±half, rounding aside)
  const k = p.map(Math.abs).indexOf(Math.max(...p.map(Math.abs))); s[k] = Math.sign(p[k]);
  return [s[0] + 0, 0 - s[2], 0 - s[1]];   // css0 back to the world: x = cx, y = -cz, z = -cy
}

/* a world direction (any length) as the camera's yaw and pitch; straight up or down keeps yaw0 */
export function dirToView(d, yaw0 = 0) {
  const L = Math.hypot(d[0], d[1], d[2]) || 1, x = d[0] / L, y = d[1] / L, z = d[2] / L;
  return { yaw: Math.hypot(x, y) < 1e-6 ? yaw0 : Math.atan2(x, -y), pitch: Math.asin(Math.max(-1, Math.min(1, z))) };
}

/* the name of a direction: the faces it joins, in the order top|bottom, front|back, left|right («front-top-right») */
export function dirName(d) {
  const n = [];
  if (d[2]) n.push(d[2] > 0 ? "top" : "bottom");
  if (d[1]) n.push(d[1] < 0 ? "front" : "back");
  if (d[0]) n.push(d[0] > 0 ? "right" : "left");
  return n.length === 1 ? n[0] : [n.find(x => x === "front" || x === "back"), n.find(x => x === "top" || x === "bottom"), n.find(x => x === "left" || x === "right")].filter(Boolean).join("-");
}

const HOME_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>';
// each face: where it sits on the cube (css0: z toward the viewer, y down, so the top is -y)
const PLACE = { front: "", back: "rotateY(180deg)", right: "rotateY(90deg)", left: "rotateY(-90deg)", top: "rotateX(90deg)", bottom: "rotateX(-90deg)" };

export function createViewCube({ host, labels = {}, onPick = () => {}, onHome = () => {}, low = null, size = 72, inline = false, doc = globalThis.document }) {
  const side = Math.round(size * 0.62), half = side / 2;
  const isLow = low || (() => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const el = doc.createElement("div"); el.className = "rk-viewcube"; el.setAttribute("role", "group"); el.setAttribute("aria-label", labels.cube || "");
  el.style.cssText = `${inline ? "position:relative" : "position:absolute;top:var(--sp-3);right:var(--sp-3)"};z-index:var(--z-canvas);width:${size}px;height:${size}px;user-select:none;touch-action:none`;
  const stage = doc.createElement("div");
  stage.style.cssText = `position:absolute;left:50%;top:50%;width:${side}px;height:${side}px;margin:${-half}px 0 0 ${-half}px;transform-style:preserve-3d;cursor:pointer`;
  const faces = {};
  for (const name of Object.keys(FACES)) {
    const f = doc.createElement("div"); f.dataset.face = name; f.textContent = labels[name] || "";
    f.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;backface-visibility:hidden;transform:${PLACE[name]} translateZ(${half}px);`
      + `font-size:var(--fs-xs);color:${labels[name] ? "var(--text)" : "var(--muted)"};background:var(--panel);border:1px solid var(--border-strong,var(--border));border-radius:var(--radius-xs,2px);pointer-events:none`;
    faces[name] = f; stage.append(f);
  }
  el.append(stage);
  const home = doc.createElement("button"); home.type = "button"; home.className = "rk-viewcube-home"; home.innerHTML = HOME_SVG;
  if (labels.home) { home.title = labels.home; home.setAttribute("aria-label", labels.home); }
  home.style.cssText = "position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer";
  home.onclick = () => onHome({ low: isLow() });
  el.append(home);

  let m = cubeMatrix(0, 0.5), yaw = 0, hot = [];
  const lit = names => {
    hot = names;
    for (const [n, f] of Object.entries(faces)) {
      const on = names.includes(n) && labels[n];
      f.style.background = on ? "var(--accent)" : "var(--panel)"; f.style.color = on ? "var(--on-accent)" : labels[n] ? "var(--text)" : "var(--muted)";
    }
  };
  const at = e => { const b = stage.getBoundingClientRect(); return pickDir(m, e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2), half); };
  /* the faces a direction touches, one name an axis; a direction that touches a face with no label is not offered */
  const AX = [d => d[0] > 0 ? "right" : "left", d => d[1] < 0 ? "front" : "back", d => d[2] > 0 ? "top" : "bottom"];
  const parts = d => (d ? AX.flatMap((f, i) => (d[i] ? [f(d)] : [])) : []);
  const offered = d => !!d && parts(d).every(n => labels[n]);
  stage.addEventListener("pointermove", e => { const d = at(e); lit(offered(d) ? parts(d) : []); });
  stage.addEventListener("pointerleave", () => lit([]));
  stage.addEventListener("click", e => {
    const d = at(e); if (!offered(d)) return;
    const v = dirToView(d, yaw), n = Math.hypot(...d);
    onPick(v, { dir: d.map(x => x / n), name: dirName(d), low: isLow() });
  });

  function set(y, p) { yaw = y; m = cubeMatrix(y, p); stage.style.transform = cssMatrix(m); }
  set(0, 0.5);
  host.append(el);
  return { el, set, get hot() { return hot.slice(); }, destroy() { el.remove(); } };
}
