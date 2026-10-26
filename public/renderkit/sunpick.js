/* renderkit sunpick: the sun of a view as a date and an hour (sykehus U3651, Morten 2026-10-26 «can he ask for different
   times of day/year?»), Norwegian clock time, kept in a view's state as sunM (month 1-12), sunD (day), sunH (hour, 0-24,
   halves). The maths only: no words for a person (the app words the label and the errors), no DOM. sun.js has the sun's
   position for a Date. Default: 21 June at 14. */
import { osloTime } from "./sun.js";

export const SUN_DEFAULT = { sunM: 6, sunD: 21, sunH: 14 };
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const sunDay = ({ sunM, sunD }) => DAYS.slice(0, sunM - 1).reduce((a, b) => a + b, 0) + sunD;   // 1-365
export const sunFromDay = (n, h) => { let m = 0, d = Math.min(365, Math.max(1, Math.round(n))); while (d > DAYS[m]) d -= DAYS[m++]; return { sunM: m + 1, sunD: d, sunH: h }; };
/* the view's sun if it has one (all three numbers), else null */
export const sunIn = v => v && [v.sunM, v.sunD, v.sunH].every(Number.isFinite) ? { sunM: v.sunM, sunD: v.sunD, sunH: v.sunH } : null;
export const sunDate = (s, year = new Date().getFullYear()) => osloTime(year, s.sunM - 1, s.sunD, Math.round(s.sunH * 60));
/* what a caller's `sun` says → { sunM, sunD, sunH }: an ISO date-time read as Norwegian clock time (a zone or Z on it is
   ignored: «15:00» is 15 in Oslo), or { month, day, hour }; else an Error with a code the app words: «sun_unreadable»
   (a string that is not a time), «sun_missing» (neither), «sun_range» (a month, day or hour that does not exist) */
const fail = code => Object.assign(new Error(code), { code });
export function sunOf(x) {
  let m, d, h;
  if (typeof x === "string") {
    const r = /^\s*\d{4}-(\d\d)-(\d\d)(?:[T ](\d\d)(?::(\d\d))?)?/.exec(x);
    if (!r) throw fail("sun_unreadable");
    [m, d, h] = [+r[1], +r[2], (r[3] != null ? +r[3] : 14) + (r[4] ? +r[4] / 60 : 0)];
  } else if (x && typeof x === "object") [m, d, h] = [+x.month, +x.day, x.hour == null ? 14 : +x.hour];
  else throw fail("sun_missing");
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= DAYS[m - 1] + (m === 2 ? 1 : 0)) || !(h >= 0 && h <= 24)) throw fail("sun_range");
  return { sunM: m, sunD: d, sunH: Math.round(h * 2) / 2 };
}
/* the light for the image model's prompt (gjengi.mjs): the season and the time of day of the sun, in words; no sun given is the default's */
export function lightLine(x) {
  const s = sunIn(x) || SUN_DEFAULT, season = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][s.sunM - 1], h = s.sunH;
  const part = h < 5 ? "night" : h < 9 ? "early morning" : h < 12 ? "morning" : h < 16 ? "afternoon" : h < 19 ? "evening" : h < 22 ? "late evening" : "night";
  return `Natural light of a Norwegian ${["winter", "spring", "summer", "autumn"][season]} ${part} (the sun as on ${s.sunD}. ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][s.sunM - 1]} at ${Math.floor(h)}:${h % 1 ? "30" : "00"}).`;
}
