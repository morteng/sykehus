// U4471: the kit's outdoor scene lit by the sun of a given hour. scenes.js' `outdoor` preset is a partly cloudy midday (60000 lux, 5800 K,
// EV100 14); here its illuminance, colour and exposure follow the sun's height from renderkit sun.js' sunPosition, so applyScene(renderer, scene,
// outdoorAt(date, lat, lon)) lights the site like the hour. Real units; basis: sourced curve points, guessed in between (stated in `basis`).
import { SCENES } from "./renderkit/scenes.js";
import { sunPosition } from "./renderkit/sun.js";

// sun height (deg) -> [illuminance on a horizontal surface in lux, colour temperature K]: clear-to-partly-cloudy day points
// (about 100000 lux at 60 deg and above in summer, 10000 at 10 deg, 400 at civil-twilight edge 0 deg, 3 lux at -6 deg: CIE/IES daylight tables)
const CURVE = [[-6, 3, 3500], [0, 400, 3000], [5, 3500, 3800], [10, 10000, 4500], [20, 30000, 5200], [40, 60000, 5800], [60, 80000, 5800], [90, 90000, 5800]];
const lerp = (a, b, t) => a + (b - a) * t;

/** {lux, K} for a sun height in degrees (clamped to the table: below -6 deg it is night, 3 lux) */
export function daylightAt(elevation) {
  const e = Math.min(90, Math.max(-6, +elevation || 0));
  for (let i = 1; i < CURVE.length; i++) {
    const [e1, l1, k1] = CURVE[i];
    if (e <= e1) { const [e0, l0, k0] = CURVE[i - 1], t = (e - e0) / (e1 - e0); return { lux: Math.exp(lerp(Math.log(l0), Math.log(l1), t)), K: lerp(k0, k1, t) }; }
  }
  return { lux: CURVE.at(-1)[1], K: CURVE.at(-1)[2] };
}
/** EV100 an incident-light meter reads for a lux level: log2(E / 2.5) */
export const evForLux = lux => Math.log2(lux / 2.5);

/** the outdoor preset for a moment and place: {...SCENES.outdoor, illuminance_lux, colour_K, ev100, sun: {azimuth, elevation}} */
export function outdoorAt(date, lat, lon) {
  const s = sunPosition(date, lat, lon), { lux, K } = daylightAt(s.elevation);
  return { ...SCENES.outdoor, illuminance_lux: Math.round(lux), colour_K: Math.round(K), ev100: Math.round(evForLux(lux) * 10) / 10,
    sun: { azimuth: s.azimuth, elevation: s.elevation }, basis: "sourced: daylight illuminance by sun height (CIE/IES tables), interpolated; " + SCENES.outdoor.basis };
}
