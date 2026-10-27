/* The sun of a Gjengi picture, in words for the image model (sykehus-owned: renderkit/sunpick.js is the shared kit's copy and is not edited here; its
   lightLine said only season and part of day, so a sunset came back lit from anywhere). Sun position is renderkit sun.js' sunPosition, the one copy
   viewer.js lights the 3D view with. */
import { sunPosition } from "./renderkit/sun.js";
import { SUN_DEFAULT, sunIn, sunDate } from "./renderkit/sunpick.js";

/* Where the sun stands over the site (Drammen, 59.74 N 10.20 E, Norwegian clock time with DST) from renderkit sun.js' sunPosition, the one copy
   viewer.js lights the 3D view with. Degrees: azimuth from north clockwise, elevation above the horizon (negative: below it). */
export const SITE = { lat: 59.74, lon: 10.2 };
export const sunAt = (x, year) => { const s = sunIn(x) || SUN_DEFAULT; return sunPosition(sunDate(s, year), SITE.lat, SITE.lon); };
const wrap = d => ((d % 360) + 540) % 360 - 180;   // -180..180
/* the compass bearing (0-360, from north, clockwise) a camera looks along, from the viewer's yaw (radians; yaw 0 stands south of the centre and looks north:
   it looks along (-sin yaw, cos yaw) as east, north). The axonometric view is turned 30 degrees, a facade view square on (viewer.js shotCamera) */
export const bearingOf = (viewpoint, yaw) => yaw == null || yaw === "" || !Number.isFinite(+yaw) ? null
  : (((-(viewpoint === "aksonometri" ? Math.PI / 6 : viewpoint === "fasade" ? Math.round(+yaw / (Math.PI / 2)) * Math.PI / 2 : +yaw) * 180 / Math.PI) % 360) + 360) % 360;
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/* the sun against the camera: elevation, where the sun is in the picture, where shadows fall, the colour of the light. bearing null: the camera's way is not known, so no side */
export function sunGeometry(x, bearing = null, year) {
  const { azimuth: az, elevation: el } = sunAt(x, year), e = Math.round(el * 10) / 10;
  const word = el < 15 ? "low" : el < 40 ? "mid" : "high", compass = COMPASS[Math.round(az / 45) % 8];
  const rel = Number.isFinite(bearing) && bearing !== null ? wrap(az - bearing) : null, a = rel == null ? null : Math.abs(rel), side = rel == null ? null : rel > 0 ? "right" : "left", other = side === "right" ? "left" : "right";
  const where = rel == null ? null : a <= 22.5 ? "straight ahead, so the view is backlit" : a < 67.5 ? `ahead and to the ${side}, a mostly backlit view` : a <= 112.5 ? `to the ${side}, side light from the ${side}` : a < 157.5 ? `behind the camera on the ${side}` : "straight behind the camera, so the view is front-lit";
  const sh = rel == null ? null : a <= 22.5 ? "toward the viewer" : a < 67.5 ? `toward the viewer and to the ${other}` : a <= 112.5 ? `sideways to the ${other}` : a < 157.5 ? `away from the viewer and to the ${other}` : "away from the viewer";
  const len = el <= 0 ? "none" : el < 10 ? "very long" : el < 25 ? "long" : el < 45 ? "medium" : "short";
  const phase = el >= 45 ? "high" : el >= 25 ? "mid" : el >= 10 ? "lowish" : el > 0 ? "golden" : el > -6 ? "blue" : "night";
  return { azimuth: Math.round(az * 10) / 10, elevation: e, word, compass, rel, where, shadowDir: sh, shadowLen: len, phase };
}
const COLOUR = {
  high: "High sun: hard white light, short sharp shadows, a deep blue sky.",
  mid: "Mid-height sun: clear, slightly warm light, shadows of medium length.",
  lowish: "Lowish sun: warm light and long shadows.",
  golden: "Golden hour: warm orange-gold low light, long soft shadows, sun-facing facades glowing orange, the sky warm near the sun and blue away from it.",
  blue: "The sun is below the horizon: blue hour, a deep blue sky with a faint glow at the horizon, no cast shadows, warm lit windows and lamps.",
  night: "The sun is far below the horizon: night, a dark sky, no daylight and no cast shadows, only artificial light: lit windows, street lamps and path lights.",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/* the light for the image model's prompt (gjengi.mjs), the first thing after the geometry: the date and hour, the sun's height and side, where shadows fall,
   the colour of the light. It decides direction, time and colour; the look and the camera line do not. The look blåtime is the person's own ask for dusk and
   is honoured (warn only): the light is then said as blue hour. No sun given is the default's. */
export function lightLine(x, bearing = null, look = null) {
  const s = sunIn(x) || SUN_DEFAULT, h = s.sunH, g = sunGeometry(s, bearing), when = `${s.sunD}. ${MONTHS[s.sunM - 1]} at ${Math.floor(h)}:${h % 1 ? "30" : "00"}`;
  const ph = look === "blåtime" && g.phase !== "night" ? "blue" : g.phase, up = ph !== "blue" && ph !== "night";
  const pos = up ? `The sun is ${g.elevation} degrees above the horizon (${g.word}), in the ${g.compass}${g.where ? `: ${g.where}` : ""}.` : ph === "blue" && g.rel != null ? `The faint glow of the sky is in the ${g.compass}.` : "";
  const shade = up ? `${g.shadowLen[0].toUpperCase()}${g.shadowLen.slice(1)} shadows${g.shadowDir ? ` fall ${g.shadowDir}` : ""}. ` : "";
  const keep = up ? "The supplied view already has cast shadows from this same sun: the light direction and shadows in it are correct, so keep their direction and do not relight from another side."
    : "The supplied view has daylight shadows from a placeholder sun at the horizon: do not keep them; keep every volume, and light the scene as said here.";
  return `Light, which decides direction, time and colour (no other line changes it): Norwegian ${when}. ${pos} ${shade}${COLOUR[ph]} ${keep}`.replace(/ {2,}/g, " ");
}
/* the phase of the light a picture is asked for (high, mid, lowish, golden, blue, night), as lightLine says it: the materials line reads it too */
export function phaseOf(x, look = null) { const g = sunGeometry(sunIn(x) || SUN_DEFAULT).phase; return look === "blåtime" && g !== "night" ? "blue" : g; }
