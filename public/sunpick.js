/* The sun of a view (U3651, Morten 13:26Z «can he ask for different times of day/year?»): a date and an hour, Norwegian
   clock time, kept in a view's state as sunM (month 1-12), sunD (day), sunH (hour, 0-24, halves). One copy for the page
   (app.js), the chat app (mcp-app.js) and the server (mcp.mjs, show_building's `sun`). Default: 21 June at 14. */
import { osloTime } from "./renderkit/sun.js";

export const SUN_DEFAULT = { sunM: 6, sunD: 21, sunH: 14 };
const MONTH = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const sunDay = ({ sunM, sunD }) => DAYS.slice(0, sunM - 1).reduce((a, b) => a + b, 0) + sunD;   // 1-365
export const sunFromDay = (n, h) => { let m = 0, d = Math.min(365, Math.max(1, Math.round(n))); while (d > DAYS[m]) d -= DAYS[m++]; return { sunM: m + 1, sunD: d, sunH: h }; };
const hourWord = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `kl. ${hh}${mm ? ":" + String(mm).padStart(2, "0") : ""}`; };
export const sunLabel = s => `${s.sunD}. ${MONTH[s.sunM - 1]} ${hourWord(s.sunH)}`;
/* the view's sun if it has one (all three numbers), else null */
export const sunIn = v => v && [v.sunM, v.sunD, v.sunH].every(Number.isFinite) ? { sunM: v.sunM, sunD: v.sunD, sunH: v.sunH } : null;
export const sunDate = (s, year = new Date().getFullYear()) => osloTime(year, s.sunM - 1, s.sunD, Math.round(s.sunH * 60));
/* what show_building's `sun` says → { sunM, sunD, sunH }: an ISO date-time read as Norwegian clock time (a zone or Z
   on it is ignored: «15:00» is 15 in Oslo), or { month, day, hour }; an Error in plain words when it is not a date */
export function sunOf(x) {
  let m, d, h;
  if (typeof x === "string") {
    const r = /^\s*\d{4}-(\d\d)-(\d\d)(?:[T ](\d\d)(?::(\d\d))?)?/.exec(x);
    if (!r) throw new Error(`Sola kan ikke leses fra «${x}»: bruk for eksempel 2026-12-21T15:00, eller {month: 12, day: 21, hour: 15}.`);
    [m, d, h] = [+r[1], +r[2], (r[3] != null ? +r[3] : 14) + (r[4] ? +r[4] / 60 : 0)];
  } else if (x && typeof x === "object") [m, d, h] = [+x.month, +x.day, x.hour == null ? 14 : +x.hour];
  else throw new Error("Sola trenger en dato og et klokkeslett: {month, day, hour} eller en tid som 2026-12-21T15:00.");
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= DAYS[m - 1] + (m === 2 ? 1 : 0)) || !(h >= 0 && h <= 24)) throw new Error("Datoen eller klokkeslettet for sola finnes ikke (måned 1-12, dag i måneden, time 0-24).");
  return { sunM: m, sunD: d, sunH: Math.round(h * 2) / 2 };
}
/* the light for the image model's prompt (gjengi.mjs): the season and the time of day of the sun, in words; no sun given is the default's */
export function lightLine(x) {
  const s = sunIn(x) || SUN_DEFAULT, season = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][s.sunM - 1], h = s.sunH;
  const part = h < 5 ? "night" : h < 9 ? "early morning" : h < 12 ? "morning" : h < 16 ? "afternoon" : h < 19 ? "evening" : h < 22 ? "late evening" : "night";
  return `Natural light of a Norwegian ${["winter", "spring", "summer", "autumn"][season]} ${part} (the sun as on ${s.sunD}. ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][s.sunM - 1]} at ${Math.floor(h)}:${h % 1 ? "30" : "00"}).`;
}
