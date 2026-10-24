/* renderkit sun: the sun by place and time. From hagekart public/sun.js (claude/stoic-hawking-xw30mk e636f49) by way of
   sykehus (a993cb9), 2026-10-24: sunPosition and osloTime only. The one copy (U3453): apps take it by sha. */

const RAD = Math.PI / 180;

/* Degrees: azimuth from north, clockwise; elevation above the horizon. */
export function sunPosition(date, lat, lon) {
  const d = +date / 864e5 - 10957.5;                         // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD;                // mean anomaly
  const q = 280.459 + 0.98564736 * d;                        // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra, la = lat * RAD;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { azimuth: ((az / RAD) + 360) % 360, elevation: el / RAD };
}
/* Norwegian clock time → Date: CET, CEST from the last Sunday in March to the last in October. */
const lastSunday = (y, m) => { const t = new Date(Date.UTC(y, m + 1, 0)); return t.getUTCDate() - t.getUTCDay(); };
export function osloTime(y, m, day, minutes) {
  const dst = Date.UTC(y, 2, lastSunday(y, 2), 1), std = Date.UTC(y, 9, lastSunday(y, 9), 1);
  const guess = Date.UTC(y, m, day) + minutes * 6e4 - 3600e3;
  return new Date(guess >= dst && guess < std ? guess - 3600e3 : guess);
}
