/* renderkit photoframe (sykehus U3663, Morten 2026-10-26 «the viz should change to reflect camera settings, show the classic
   frustum lines»): what a photo mode needs to make the live 3D view a viewfinder, with no DOM and no three.js.
   A. the lens: LENSES (35 mm-equivalent), the frame shapes ASPECTS, the frame's rectangle in the view (frameRect), and the
      field of view the view's own camera needs so the frame holds exactly the lens' picture (viewFov).
   B. the viewfinder as SVG text: frameSvg (the darkened outside, thirds, the horizon line), frustumSvg (the plan inset:
      the camera, the two rays, the wedge of the field of view, the target).
   C. the camera in a site's plan (x east, y north, as sykehus' orbit pose keeps it: centre x,y, yaw, pitch, dist): camPos,
      poseFromCam (a drag of the camera in the inset), frustum (the rays and the wedge), horizonY (where the horizon is).
   The app owns the words; the ids here are saved words. */
import { fovFor, ratio } from "./photo.js";

export const LENSES = { "24": { mm: 24 }, "35": { mm: 35 }, "50": { mm: 50 }, "85": { mm: 85 }, "iphone": { mm: 26 }, "drone": { mm: 24, aerial: true } };
export const ASPECTS = ["3:2", "16:9", "1:1", "4:5", "2:3"];
const RAD = Math.PI / 180;

/* the frame inside a view of W × H pixels: the picture's shape, centred, a share (pad) of the free side left round it */
export function frameRect(W, H, aspect, pad = 0.08) {
  const [aw, ah] = ratio(aspect), a = aw / ah, mw = W * (1 - 2 * pad), mh = H * (1 - 2 * pad);
  const w = Math.min(mw, mh * a), h = w / a;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
/* the vertical field of view (degrees) of the frame for a lens, and the one the whole view needs so the frame spans exactly that */
export const frameFov = (mm, aspect) => fovFor(mm, ratio(aspect));
export const viewFov = (frameFovDeg, rect, H) => 2 * Math.atan(Math.tan(frameFovDeg * RAD / 2) * H / rect.h) / RAD;
/* the horizontal field of view of a frame */
export const hFov = (frameFovDeg, aspect) => { const [aw, ah] = ratio(aspect); return 2 * Math.atan(Math.tan(frameFovDeg * RAD / 2) * aw / ah) / RAD; };

/* where the camera stands in the plan, from an orbit pose {x, y, yaw, pitch, dist, eye}: looking at (x, y); the eye pose stands dist away on the ground */
export function camPos(p) {
  const c = p.eye ? 1 : Math.cos(p.pitch);
  return { x: p.x + p.dist * c * Math.sin(p.yaw), y: p.y - p.dist * c * Math.cos(p.yaw) };
}
/* the pose when the camera is dragged to (px, py) in the plan: the target and the pitch stay, yaw and distance follow */
export function poseFromCam(p, px, py) {
  const c = p.eye ? 1 : Math.max(0.05, Math.cos(p.pitch)), dx = px - p.x, dz = p.y - py, r = Math.hypot(dx, dz);
  return r < 1e-6 ? { ...p } : { ...p, yaw: Math.atan2(dx, dz), dist: r / c };
}
/* the rays and the wedge in the plan: from the camera to the two edges of the horizontal field of view, len metres long, and the target */
export function frustum(p, hfovDeg, len = null) {
  const c = camPos(p), dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, L = len ?? d * 1.25, half = hfovDeg * RAD / 2;
  const turn = a => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
  const l = turn(half), r = turn(-half);
  return { camera: c, target: { x: p.x, y: p.y }, dist: d, left: { x: c.x + l[0] * L, y: c.y + l[1] * L }, right: { x: c.x + r[0] * L, y: c.y + r[1] * L }, angle: hfovDeg };
}
/* where the horizon crosses the frame, as a share of the frame's height from its top (the camera looks down by pitch; the horizon is above the middle by tan(pitch) lens-heights): null when it is out of the frame */
export function horizonY(pitch, frameFovDeg) {
  const s = 0.5 - Math.tan(pitch) / (2 * Math.tan(frameFovDeg * RAD / 2));
  return s >= 0 && s <= 1 ? s : null;
}

const n1 = v => Math.round(v * 10) / 10;
/* the viewfinder over a view of W × H: the outside of the frame darkened, rule-of-thirds lines, the horizon line (pitch given: only when it is in the frame) */
export function frameSvg(W, H, rect, { thirds = true, pitch = null, frameFovDeg = null } = {}) {
  const { x, y, w, h } = rect, line = (x1, y1, x2, y2, cls) => `<path class="${cls}" d="M${n1(x1)} ${n1(y1)}L${n1(x2)} ${n1(y2)}"/>`;
  let s = `<svg class="pf-frame" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path class="pf-dim" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${n1(x)} ${n1(y)}v${n1(h)}h${n1(w)}v${-n1(h)}Z"/><rect class="pf-edge" x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}"/>`;
  if (thirds) for (let i = 1; i < 3; i++) s += line(x + w * i / 3, y, x + w * i / 3, y + h, "pf-third") + line(x, y + h * i / 3, x + w, y + h * i / 3, "pf-third");
  const hz = pitch != null && frameFovDeg != null ? horizonY(pitch, frameFovDeg) : null;
  if (hz != null) s += line(x, y + h * hz, x + w, y + h * hz, "pf-horizon");
  return s + "</svg>";
}
/* the plan inset: size px square, centred on the target, m metres across; rings (lists of [x, y]) drawn as outlines; the camera, the two rays, the wedge and the target */
export function insetMap(p, size, m) { const k = size / m; return { k, px: x => size / 2 + (x - p.x) * k, py: y => size / 2 - (y - p.y) * k }; }
export function frustumSvg(p, hfovDeg, { size = 160, m = null, rings = [] } = {}) {
  const f = frustum(p, hfovDeg), span = m ?? Math.max(60, f.dist * 3), t = insetMap(p, size, span), X = o => `${n1(t.px(o.x))} ${n1(t.py(o.y))}`;
  const outline = rings.map(r => `<path class="pf-ring" d="M${r.map(([x, y]) => `${n1(t.px(x))} ${n1(t.py(y))}`).join("L")}Z"/>`).join("");
  return `<svg class="pf-inset" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${outline}`
    + `<path class="pf-wedge" d="M${X(f.camera)}L${X(f.left)}L${X(f.right)}Z"/><path class="pf-ray" d="M${X(f.camera)}L${X(f.left)}"/><path class="pf-ray" d="M${X(f.camera)}L${X(f.right)}"/>`
    + `<circle class="pf-target" cx="${n1(t.px(f.target.x))}" cy="${n1(t.py(f.target.y))}" r="3"/><circle class="pf-cam" cx="${n1(t.px(f.camera.x))}" cy="${n1(t.py(f.camera.y))}" r="5"/></svg>`;
}
