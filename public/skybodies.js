/* The sun's disc and the moon in the sky of the 3D view (Morten: «render a sun disc and moon»). Visual only: two sprites on a
   sphere that follows the camera, so they do not parallax; neither lights anything or casts a shadow (the light is viewer.js's
   own sunL). A plan, a section and any parallel camera see neither, as they see no sky dome (atmosphere.js forCamera).
   The moon's place and phase are SunCalc's low-precision formulas (Meeus), written here: good to about a degree, which
   a disc 2 degrees wide does not show. Both discs are drawn larger than the real half degree, so they can be seen.
   No imports of three.js: it comes in as an argument, so the maths tests without a browser.
     const sb = createSkyBodies({ THREE, scene }); sb.update(date, lat, lon); sb.forCamera(cam); */
import { sunPosition } from "./renderkit/sun.js";
import { sunAt } from "./renderkit/atmosphere.js";

const RAD = Math.PI / 180, DAY_MS = 864e5, OBLIQ = 23.4397 * RAD;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const days = date => +date / DAY_MS - 10957.5;   // since 2000-01-01 12:00 UTC
const rightAsc = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l));
const declin = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l));
const siderial = (d, lon) => (280.147 + 360.9856235 * d + lon) * RAD;   // local sidereal angle

function sunCoords(d) {
  const M = (357.5291 + 0.98560028 * d) * RAD, C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD, L = M + C + 102.9372 * RAD + Math.PI;
  return { dec: declin(L, 0), ra: rightAsc(L, 0), dist: 149598000 };
}
function moonCoords(d) {
  const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.229350 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M), b = 5.128 * RAD * Math.sin(F);
  return { ra: rightAsc(l, b), dec: declin(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/* the moon: { azimuth (deg from north, clockwise), elevation (deg, refracted by nothing, parallax taken), fraction lit 0..1, limb (rad): the
   turn, anticlockwise on the screen, that takes a picture with its lit limb up to the real one (a sprite's rotation) } */
export function moonPosition(date, lat, lon) {
  const d = days(date), m = moonCoords(d), s = sunCoords(d), la = lat * RAD;
  const H = siderial(d, lon) - m.ra;
  let el = Math.asin(Math.sin(la) * Math.sin(m.dec) + Math.cos(la) * Math.cos(m.dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(m.dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  el -= Math.asin(6371 / m.dist) * Math.cos(el);   // the moon is near: seen from the ground it stands about a degree lower
  const phi = Math.acos(clamp(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra), -1, 1));
  const inc = Math.atan2(s.dist * Math.sin(phi), m.dist - s.dist * Math.cos(phi));
  /* the bright limb faces the sun: the direction from the moon to the sun on the sky seen from the ground, from the zenith, clockwise
     (to the right, with the viewer facing the moon). Worked from the two places, so no sign of a parallactic angle can go wrong. */
  const sp = sunPosition(date, lat, lon), dA = (sp.azimuth - ((az / RAD) + 360) % 360) * RAD, se = sp.elevation * RAD;
  const toSun = Math.atan2(Math.cos(se) * Math.sin(dA), Math.sin(se) * Math.cos(el) - Math.cos(se) * Math.sin(el) * Math.cos(dA));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { azimuth: ((az / RAD) + 360) % 360, elevation: el / RAD, fraction: (1 + Math.cos(inc)) / 2, limb: -toSun, waxing: angle < 0 };
}

/* how much of a body shows at a height (degrees): none at or under the horizon, full from 6 degrees up */
export const bodyFade = el => (el > 0 ? clamp(el / 6, 0, 1) : 0);

/* a point on the sky sphere: x east, y up, z south (viewer.js's frame) */
export const skyDir = (az, el) => { const a = az * RAD, e = el * RAD; return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]; };

/* the moon's picture, size px square, the lit limb up; frac 0..1 lit. Lit where the height above the centre is more than -k * the
   chord (k = 2 frac - 1): the terminator is half an ellipse, as on the real moon. Earthshine keeps the dark part faintly there. */
export function moonPixels(size, frac) {
  const px = new Uint8ClampedArray(size * size * 4), r = size / 2 - 2, k = 2 * frac - 1;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i + 0.5 - size / 2, u = size / 2 - (j + 0.5), rr = Math.hypot(x, u), o = (j * size + i) * 4;
    const edge = clamp(r - rr + 0.5, 0, 1); if (!edge) continue;
    const chord = Math.sqrt(Math.max(0, r * r - x * x)), lit = clamp((u + k * chord) / 1.5 + 0.5, 0, 1);   // 1.5 px soft terminator
    const mare = 0.86 + 0.14 * Math.sin(x * 0.19 + 1.3) * Math.cos(u * 0.23 - 0.4) * Math.sin((x + u) * 0.11);   // a few darker patches
    const v = (0.07 + 0.93 * lit) * mare;
    px[o] = 238 * v + 20 * (1 - lit) * 0.6; px[o + 1] = 240 * v + 24 * (1 - lit) * 0.6; px[o + 2] = 232 * v + 34 * (1 - lit) * 0.6; px[o + 3] = 255 * edge * (0.22 + 0.78 * lit);
  }
  return px;
}

export function createSkyBodies({ THREE, scene, radius = 2000, sunDeg = 3, moonDeg = 2.2 }) {
  const mk = (map, deg, order) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    m.scale.setScalar(2 * radius * Math.tan(deg * RAD / 2)); m.renderOrder = order; m.frustumCulled = false; m.visible = false;
    m.userData.skipGuide = true; m.raycast = () => {};   // not a thing to pick or to measure
    scene.add(m); return m;
  };
  const sunTex = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const g = cv.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.2, "rgba(255,250,235,1)"); gr.addColorStop(0.27, "rgba(255,236,190,0.55)"); gr.addColorStop(0.5, "rgba(255,214,150,0.16)"); gr.addColorStop(1, "rgba(255,200,130,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv);
  })();
  const sunS = mk(sunTex, sunDeg * 4, -9), moonS = mk(null, moonDeg, -8);   // the sun's sprite holds its glow: the disc is a fifth of it
  let moonFrac = -1, state = { sun: null, moon: null };
  const put = (s, az, el, cam) => { const [x, y, z] = skyDir(az, el); s.position.set(cam.position.x + x * radius, cam.position.y + y * radius, cam.position.z + z * radius); s.updateMatrixWorld(); };   // the scene's own matrix update is already done when onBeforeRender runs
  const api = {
    sun: sunS, moon: moonS,
    /* the sun and the moon for a time and a place (the same sunPosition as the light); the discs are put by forCamera */
    update(date, lat, lon) {
      const s = sunPosition(date, lat, lon), m = moonPosition(date, lat, lon); state = { sun: s, moon: m };
      sunS.material.color.set(sunAt(Math.max(s.elevation, 0)).color); sunS.material.opacity = bodyFade(s.elevation); sunS.visible = s.elevation > 0;
      if (Math.abs(m.fraction - moonFrac) > 0.01 || !moonS.material.map) {
        moonFrac = m.fraction; const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
        cv.getContext("2d").putImageData(new ImageData(moonPixels(N, m.fraction), N, N), 0, 0);
        moonS.material.map?.dispose(); moonS.material.map = new THREE.CanvasTexture(cv); moonS.material.needsUpdate = true;
      }
      moonS.material.rotation = m.limb; moonS.material.opacity = bodyFade(m.elevation); moonS.visible = m.elevation > 0;
      return state;
    },
    /* a perspective camera sees them, on the sphere round it; a parallel one sees neither */
    forCamera(cam) {
      const persp = !!cam.isPerspectiveCamera;
      if (state.sun) { sunS.visible = persp && state.sun.elevation > 0; if (sunS.visible) put(sunS, state.sun.azimuth, state.sun.elevation, cam); }
      if (state.moon) { moonS.visible = persp && state.moon.elevation > 0; if (moonS.visible) put(moonS, state.moon.azimuth, state.moon.elevation, cam); }
    },
    get state() { return state; },
  };
  return api;
}
