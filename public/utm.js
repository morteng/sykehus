/* UTM zone 33 on ETRS89 (EPSG:25833), the site's grid, both ways, by Krüger's series (Karney 2011, to 4th order:
   well under a millimetre this near the zone). The site keeps metres from site.json's origin, so fromLngLat gives
   [east, north] on the site, and toLngLat takes them back. The streets (renderkit streets.js) come in lon/lat. */
const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = 15 * Math.PI / 180, E0 = 500000;
const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64);
const al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280];
const be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280];
const de = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45, 7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45, 56 * n3 / 15 - 136 * n4 / 35, 4279 * n4 / 630];
const e2 = 2 * Math.sqrt(n) / (1 + n);   // 2√n/(1+n) is the eccentricity e

export function lngLatToUtm([lon, lat]) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180 - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(p)) - e2 * Math.atanh(e2 * Math.sin(p)));
  const xi = Math.atan2(t, Math.cos(l)), eta = Math.atanh(Math.sin(l) / Math.sqrt(1 + t * t));
  let x = xi, y = eta;
  al.forEach((c, j) => { const k = 2 * (j + 1); x += c * Math.sin(k * xi) * Math.cosh(k * eta); y += c * Math.cos(k * xi) * Math.sinh(k * eta); });
  return [E0 + k0 * A * y, k0 * A * x];
}

export function utmToLngLat([E, N]) {
  const xi0 = N / (k0 * A), eta0 = (E - E0) / (k0 * A);
  let xi = xi0, eta = eta0;
  be.forEach((c, j) => { const k = 2 * (j + 1); xi -= c * Math.sin(k * xi0) * Math.cosh(k * eta0); eta -= c * Math.cos(k * xi0) * Math.sinh(k * eta0); });
  const chi = Math.asin(Math.sin(xi) / Math.cosh(eta));
  let p = chi; de.forEach((c, j) => { p += c * Math.sin(2 * (j + 1) * chi); });
  return [(lon0 + Math.atan2(Math.sinh(eta), Math.cos(xi))) * 180 / Math.PI, p * 180 / Math.PI];
}

/* the terrain's box in lon/lat, [south, west, north, east] (as renderkit streets.js asks for it): the streets are
   fetched for this box only, and the server's /gater passes this box only (gater.mjs) */
export function siteBox(site) {
  const T = site.terrain, g = siteGrid(site.origin), x1 = T.x0 + T.w * T.res, y0 = T.y1 - T.h * T.res;
  const c = [[T.x0, T.y1], [x1, T.y1], [T.x0, y0], [x1, y0]].map(g.toLngLat);
  return [Math.min(...c.map(p => p[1])), Math.min(...c.map(p => p[0])), Math.max(...c.map(p => p[1])), Math.max(...c.map(p => p[0]))];
}

/* the same on the site: metres east and north of the origin */
export const siteGrid = ([ox, oy]) => ({
  fromLngLat: q => { const [x, y] = lngLatToUtm(q); return [x - ox, y - oy]; },
  toLngLat: ([x, y]) => utmToLngLat([x + ox, y + oy]),
});
