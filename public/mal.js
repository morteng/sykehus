/* «Mal» (U3655): the drag brush on the ground. Press and drag paints (or rubs out, or moves earth); a round cursor shows
   the brush's radius, and while one drags a ghost shows what would be painted: renderkit's brush (paint.js, through
   paintPlan in paint-edit.js), the same function the server paints with, so the ghost is the result. Release sends one
   change. A second finger ends the stroke and moves the view (viewer.setBrush). The ghost is drawn on a canvas over the view. */
import { paintPlan, nearWays } from "./paint-edit.js";

const GHOST = { grass: "rgba(80,150,60,.55)", planting: "rgba(120,80,50,.55)", paving: "rgba(150,150,150,.6)", gravel: "rgba(190,170,120,.6)", erase: "rgba(200,60,60,.45)", terrain: "rgba(60,110,190,.45)" };
const JUMP_M = 30, MIN_STEP = 0.4, MAX_PTS = 180, EVERY_MS = 60;

export function createMal({ viewer, host, site, ways = () => [], opts, send }) {
  const cv = document.createElement("canvas"); cv.id = "malInk"; cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4";
  host.append(cv);
  const g = cv.getContext("2d"), K = viewer.kit();
  let line = [], hover = null, plan = null, last = 0, timer = 0, on = false;

  /* the ground point under the pointer: the plane at the ground's kote, found by walking in from the kote at the middle */
  const groundPt = e => {
    let k = K.ground(0, 0), p = null;
    for (let i = 0; i < 4; i++) { p = viewer.groundAt(e.clientX, e.clientY, k); if (!p) return null; k = K.ground(p[0], p[1]); }
    return p ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : null;
  };
  const scr = p => viewer.project(p, K.ground(p[0], p[1]) + 0.15);
  const size = () => { const r = host.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); } g.setTransform(d, 0, 0, d, 0, 0); return r; };
  const path = (ring, hole) => { let first = true; for (const p of ring) { const q = scr(p); if (first) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); first = false; } g.closePath(); };
  function draw() {
    const r = size(); g.clearRect(0, 0, r.width, r.height); if (!on) return;
    const o = opts(), colour = o.mode === "terrain" ? GHOST.terrain : o.erase ? GHOST.erase : GHOST[o.surface];
    if (o.mode === "terrain" && line.length) {   // the stroke itself: terrain has no snapped result
      g.fillStyle = colour; for (const p of line) { g.beginPath(); circle(p, o.r); g.fill(); }
    } else if (plan?.polys?.length) {
      g.fillStyle = colour; g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 1.5;
      for (const poly of plan.polys) { g.beginPath(); path(poly.ring); for (const h of poly.holes || []) path(h); g.fill("evenodd"); g.stroke(); }
    }
    if (hover) { g.beginPath(); circle(hover, o.r); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); g.strokeStyle = "#23211e"; g.lineWidth = 1.2; g.stroke(); }
  }
  function circle(c, r) { for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, q = scr([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); } }

  /* the ghost, at most once in EVERY_MS: what the brush would paint of the stroke so far */
  function ghostLater() {
    if (timer) return; const wait = Math.max(0, EVERY_MS - (performance.now() - last));
    timer = setTimeout(() => {
      timer = 0; last = performance.now(); const o = opts();
      plan = o.mode === "terrain" || !line.length ? null : paintPlan(site().landscape || [], { kind: "paint", surface: o.surface, mode: o.erase ? "erase" : "add", line, r: o.r, around: nearWays(ways(), { line, r: o.r }) }, site());
      draw();
    }, wait);
  }
  const add = p => { const l = line[line.length - 1]; if (l && Math.hypot(p[0] - l[0], p[1] - l[1]) > JUMP_M) return; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= Math.max(MIN_STEP, opts().r * 0.25)) { line.push(p); ghostLater(); } };
  const stop = () => { line = []; plan = null; clearTimeout(timer); timer = 0; draw(); };
  const thin = L => L.length <= MAX_PTS ? L : Array.from({ length: MAX_PTS }, (_, i) => L[Math.round(i * (L.length - 1) / (MAX_PTS - 1))]);

  const brush = {
    down(e) { const p = groundPt(e); if (!p) return false; hover = p; line = [p]; ghostLater(); return true; },
    move(e, down) { const p = groundPt(e); hover = p; if (p && down) add(p); draw(); },
    up(e) {
      const L = thin(line), o = opts(); stop();   // the last move is the stroke's end: the release's own coordinates are not trusted
      if (L.length) send(L, o);
    },
    cancel() { stop(); },
  };
  const stopFollow = viewer.follow(() => { if (on) draw(); });
  return {
    set(v) { on = v; viewer.setBrush(v ? brush : null); if (!v) { hover = null; stop(); } else draw(); },
    destroy() { stopFollow(); viewer.setBrush(null); cv.remove(); },
  };
}
