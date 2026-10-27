/* A measure mode (U3879): click point A, then B for a distance, its height difference and its horizontal run; hold Shift
   and click a chain of points for a polygon and its area. The result stays pinned until Esc (or the next click starts a
   new one). One copy for every app. No three.js: the app hands in its hit test, its projection and its snap.

   Points are [east, north, height] in metres (the app's site frame). The helpers below are pure:
     distance3(a, b)       the straight line, metres
     horizontal(a, b)      the run on the ground plane
     heightDiff(a, b)      b's height minus a's (signed)
     pathLength(pts)       the sum of the legs
     polygonArea(pts)      shoelace on the horizontal plane, always positive
     measureOf(pts, area)  { kind, points, distance_m, dh_m, horizontal_m, area_m2 } (what lastMeasure returns)

   createMeasure({ el, host, hit, project, follow?, snap?, words?, locale?, onChange?, doc }) → { on(), off(), active, lastMeasure(), clear(), add(p, chain) }
     hit(clientX, clientY) → [e, n, h] | null        what is under the pointer
     project(p) → [x, y, inFront]                    p in pixels of host
     snap(p, e) → [e, n, h]                          optional: a catch (vertex, edge, face), else p
     follow(fn) → stop                               optional: fn runs after every frame, to keep the drawing on the model
   Colours are the UI kit's tokens (--accent, --panel, --text, --border). */

const fin = v => Number.isFinite(v);
export const horizontal = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const heightDiff = (a, b) => (b[2] ?? 0) - (a[2] ?? 0);
export const distance3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], heightDiff(a, b));
export const pathLength = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += distance3(pts[i - 1], pts[i]); return s; };
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(s) / 2;
}
export function centroid(pts) {
  const n = pts.length || 1;
  return [0, 1, 2].map(k => pts.reduce((s, p) => s + (p[k] ?? 0), 0) / n);
}
const r2 = v => Math.round(v * 100) / 100;

/* what an assistant reads. pts: the points so far; area: the chain is a polygon (3 or more points) */
export function measureOf(pts, area = false) {
  const points = pts.map(p => [r2(p[0]), r2(p[1]), r2(p[2] ?? 0)]);
  if (area && pts.length >= 3) return { kind: "area", points, distance_m: r2(pathLength([...pts, pts[0]])), dh_m: null, horizontal_m: null, area_m2: r2(polygonArea(pts)) };
  if (pts.length >= 2) { const [a, b] = pts; return { kind: "distance", points, distance_m: r2(distance3(a, b)), dh_m: r2(heightDiff(a, b)), horizontal_m: r2(horizontal(a, b)), area_m2: null }; }
  return { kind: null, points, distance_m: null, dh_m: null, horizontal_m: null, area_m2: null };
}

const WORDS = { distance: "Distance", dh: "Δh", horizontal: "Horizontal", area: "Area", perimeter: "Perimeter", hint: "Click point A, then B. Shift-click a chain for an area. Esc ends." };
const MOVE = 6;   // px a press may move and still be a click
const NS = "http://www.w3.org/2000/svg";

export function createMeasure({ el, host = el.parentElement, hit, project, snap = p => p, follow = null, words = {}, locale = undefined, onChange = () => {}, doc = globalThis.document, win = doc?.defaultView ?? globalThis }) {
  const W = { ...WORDS, ...words };
  const num = v => v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let pts = [], chain = false, closed = false, cursor = null, down = null, active = false, stop = null, svg = null, tip = null;

  const current = () => measureOf(pts, chain);
  /* the points to draw: while the second point (or the next in a chain) is pending, the cursor stands in for it */
  const shown = () => (cursor && !closed && pts.length && (chain || pts.length === 1)) ? [...pts, cursor] : pts;

  function node(name, attrs) { const n = doc.createElementNS(NS, name); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function label(x, y, lines) {
    const g = node("g", {}), t = node("text", { x, y, "text-anchor": "middle", "font-size": 13, "font-weight": 600, fill: "var(--text)" });
    lines.forEach((l, i) => { const s = node("tspan", { x, dy: i ? 16 : 0 }); s.textContent = l; t.appendChild(s); });
    g.appendChild(node("rect", { x: x - 104, y: y - 15, width: 208, height: 8 + lines.length * 16, rx: 6, fill: "var(--panel)", stroke: "var(--border)", "stroke-width": 1, opacity: 0.96 }));
    g.appendChild(t); return g;
  }
  function draw() {
    if (!svg) return;
    svg.replaceChildren();
    const P = shown(); if (!P.length) { tip.hidden = false; return; }
    tip.hidden = true;
    const S = P.map(p => project(p)); if (S.some(s => !s || !s[2])) return;   // a point behind the camera: nothing is drawn
    const area = chain && P.length >= 3;
    const d = S.map((s, i) => `${i ? "L" : "M"}${s[0].toFixed(1)} ${s[1].toFixed(1)}`).join("") + (area ? "Z" : "");
    svg.appendChild(node("path", { d, fill: area ? "var(--accent)" : "none", "fill-opacity": 0.18, stroke: "var(--accent)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-dasharray": closed || P.length === pts.length ? "" : "6 4" }));
    for (const s of S.slice(0, pts.length)) svg.appendChild(node("circle", { cx: s[0], cy: s[1], r: 5, fill: "var(--panel)", stroke: "var(--accent)", "stroke-width": 2.5 }));
    const m = measureOf(P, chain);
    if (m.kind === "area") {
      const c = project(centroid(P)) || S[0];
      svg.appendChild(label(c[0], c[1], [`${W.area}: ${num(m.area_m2)} m²`, `${W.perimeter}: ${num(m.distance_m)} m`]));
    } else if (m.kind === "distance") {
      svg.appendChild(label((S[0][0] + S[1][0]) / 2, (S[0][1] + S[1][1]) / 2 - 24, [`${num(m.distance_m)} m`, `${W.dh} ${num(m.dh_m)} m · ${W.horizontal} ${num(m.horizontal_m)} m`]));
    }
  }
  function mount() {
    svg = node("svg", { class: "rk-measure", "aria-hidden": "true" });
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:var(--z-canvas)";
    tip = doc.createElement("div"); tip.className = "rk-measure-tip";
    tip.style.cssText = "position:absolute;left:50%;bottom:76px;transform:translateX(-50%);width:max-content;max-width:min(560px,90%);z-index:var(--z-canvas);pointer-events:none;padding:6px 12px;border-radius:var(--radius-lg);background:var(--panel);color:var(--text);border:1px solid var(--border);box-shadow:var(--shadow-sm);font-size:var(--fs-md)";
    tip.textContent = W.hint;
    host.appendChild(svg); host.appendChild(tip);
    if (follow) stop = follow(draw);
  }
  function unmount() { stop?.(); stop = null; svg?.remove(); tip?.remove(); svg = tip = null; }

  const at = e => { const h = hit(e.clientX, e.clientY); return h && h.every(fin) ? snap(h, e) : null; };
  /* one click: the first point of a new measure, the second of a distance, or (chain) the next of a polygon */
  function add(p, shift = false) {
    if (closed || (pts.length >= 2 && !chain && !shift)) { pts = []; chain = false; closed = false; }   // the last one stays until the next click starts a new
    if (shift) chain = true;
    if (!shift && pts.length === 1) closed = true;
    pts.push(p);
    if (!chain && pts.length === 2) closed = true;
    onChange(current()); draw();
  }
  /* the window's capture comes before the picker's on the canvas (select.js takes a Shift press for its window and stops it there) */
  const onDown = e => { if (e.button === 0 && el.contains(e.target)) down = { x: e.clientX, y: e.clientY }; };
  const onUp = e => {
    if (!down || !el.contains(e.target) || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > MOVE; down = null;
    if (moved) return;
    const p = at(e); if (p) add(p, e.shiftKey);
  };
  const onMove = e => {
    if (e.buttons || !pts.length || closed) { if (cursor) { cursor = null; draw(); } return; }
    cursor = at(e); draw();
  };
  const onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); off(); } };
  /* capture, so that a click here is not also a pick or a pan of the app's */
  const swallow = e => { if (e.button === 0 && !down?.moved) e.stopPropagation(); };

  function on() {
    if (active) return; active = true; mount();
    win.addEventListener("pointerdown", onDown, true); win.addEventListener("pointerup", onUp, true); el.addEventListener("pointermove", onMove);
    el.addEventListener("click", swallow, true); doc.addEventListener("keydown", onKey, true);
    el.style.cursor = "crosshair"; draw();
  }
  function off() {
    if (!active) return; active = false;
    win.removeEventListener("pointerdown", onDown, true); win.removeEventListener("pointerup", onUp, true); el.removeEventListener("pointermove", onMove);
    el.removeEventListener("click", swallow, true); doc.removeEventListener("keydown", onKey, true);
    el.style.cursor = ""; unmount(); pts = []; chain = false; closed = false; cursor = null; onChange(current(), false);
  }
  return { on, off, add, get active() { return active; }, lastMeasure: current, clear() { pts = []; chain = false; closed = false; cursor = null; draw(); onChange(current()); } };
}
