/* Photos taken on site land on the thing the camera points at (U3824): where the person stands (GPS) and which way the
   camera points (compass) say which wing and which side of it the picture shows. No DOM here: sitephotos.js asks.
   The pose maths for fixing a photo from known roof lines is hagekart's pose.js and anchor.js, taken as they are
   (tools/take-pose.mjs); this file is only the sykehus end: the site's wings and the form's fields. */
import { siteGrid } from "./utm.js";

const RAD = Math.PI / 180, SIDE_OF = ["nord", "øst", "sør", "vest"];

/* heading of the rear camera in degrees from north, from a deviceorientation event (W3C formula; needs an absolute alpha).
   iOS gives it as webkitCompassHeading. Null when the device cannot say. */
export function cameraHeading(e) {
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) return e.webkitCompassHeading;
  if (!e.absolute || e.alpha == null || e.beta == null || e.gamma == null) return null;
  const a = e.alpha * RAD, b = e.beta * RAD, g = e.gamma * RAD;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  const rA = -cA * sG - sA * sB * cG, rB = -sA * sG + cA * sB * cG;
  let h = Math.atan(rA / rB);
  if (rB < 0) h += Math.PI; else if (rA < 0) h += 2 * Math.PI;
  return h / RAD;
}

const bearing = ([x, y]) => (Math.atan2(x, y) / RAD + 360) % 360;
const sideWord = b => SIDE_OF[Math.round(b / 90) % 4];

/* The wing the view line from `at` (site metres, east/north) along `heading` meets first, within `max` m, and the side of it
   the line meets: the side whose wall faces back at the camera. Buildings that are no wing (the OSM ones) are not asked.
   Standing inside a wing's outline looks past it. Null when the line meets none. */
export function aimAt(site, at, heading, { max = 120 } = {}) {
  if (heading == null || !at) return null;
  const d = [Math.sin(heading * RAD), Math.cos(heading * RAD)]; let best = null;
  for (const b of site.buildings || []) {
    if (!b.wing || !b.ring) continue;
    const r = b.ring; let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > at[1]) !== (yj > at[1]) && at[0] < ((xj - xi) * (at[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) continue;
    for (let i = 1; i < r.length; i++) {
      const [ax, ay] = r[i - 1], [bx, by] = r[i], ex = bx - ax, ey = by - ay, den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = ax - at[0], wy = ay - at[1], t = (wx * ey - wy * ex) / den, u = (wx * d[1] - wy * d[0]) / den;
      if (t < 0.5 || t > max || u < 0 || u > 1) continue;
      if (best && t >= best.dist) continue;
      let n = [ey, -ex]; if (n[0] * d[0] + n[1] * d[1] > 0) n = [-n[0], -n[1]];   // the wall's normal, turned back toward the camera
      best = { wing: b.wing, side: sideWord(bearing(n)), dist: +t.toFixed(1) };
    }
  }
  return best;
}

/* the same from a GPS fix: [lng, lat] */
export const aimFromFix = (site, lngLat, heading, opts) => aimAt(site, siteGrid(site.origin).fromLngLat(lngLat), heading, opts);

/* one reading of where the camera points: a GPS fix and a compass heading, both from the browser (injected so a test needs no device).
   Resolves { wing, side, dist } or { why: "no-position" | "no-compass" | "nothing" } */
export async function pointedAt(site, { geo = navigator.geolocation, onOrientation = f => { addEventListener("deviceorientationabsolute", f, { once: true }); addEventListener("deviceorientation", f, { once: true }); }, timeout = 4000 } = {}) {
  const fix = await new Promise(res => geo ? geo.getCurrentPosition(p => res([p.coords.longitude, p.coords.latitude]), () => res(null), { enableHighAccuracy: true, timeout }) : res(null));
  if (!fix) return { why: "no-position" };
  const heading = await new Promise(res => { const t = setTimeout(() => res(null), timeout); onOrientation(e => { clearTimeout(t); res(cameraHeading(e)); }); });
  if (heading == null) return { why: "no-compass" };
  return aimFromFix(site, fix, heading) || { why: "nothing" };
}
export const WORDS = { here: "Bruk der jeg står", no_position: "Fikk ikke posisjonen din. Velg fløy selv.", no_compass: "Fikk ikke kompasset. Velg fløy selv.", nothing: "Fant ingen fløy der kameraet peker. Velg fløy selv.", found: w => `Kameraet peker på ${w}.` };
