/* Heritage records round the plot, from Riksantikvaren's open OGC API (api.ra.no): Kulturminner, Freda bygninger,
   SEFRAK-bygninger and Kulturmiljøer. The box is the lot's outline (site metres from the origin, EPSG:25833) grown by
   radius_m, asked in the API's own CRS so nothing is projected here. site_facts asks Hagekart by the address and lists
   what lies within 50 m; this lists the records themselves, with ids and links, over a wider box. */
const BASE = "https://api.ra.no", KOMMUNE = "Drammen", CRS = "http://www.opengis.net/def/crs/EPSG/0/25833";
export const OPEN_DATA = "Åpne data fra Riksantikvaren (api.ra.no). Registre, ikke et vedtak: sjekk kommunens kart og planbestemmelser, og spør kulturminnemyndigheten før riving eller store inngrep.";
const SETS = [
  { kind: "Kulturminner", path: "kulturminner/collections/kulturminner", extra: `&kommune=${KOMMUNE}`,   // without a municipality its box does not filter
    rec: p => ({ name: p.navn, type: [p.minnetype, p.enkeltminneart || p.lokalitetsart].filter(Boolean).join(": "), protection: p.vernetype, link: p.linkKulturminnesøk || p.linkAskeladden }) },
  { kind: "Freda bygninger", path: "KulturminnerFredaBygninger/collections/fredabygninger", extra: "",
    rec: p => ({ name: p.navn, type: "Freda bygning", protection: p.vernetype && `${p.vernetype}${p.vernedato ? ` (${String(p.vernedato).slice(0, 10)})` : ""}`, link: p.linkKulturminnesøk || p.linkAskeladden }) },
  { kind: "SEFRAK-bygninger", path: "KulturminnerSEFRAKbygninger/collections/sefrakbygninger", extra: "",
    rec: p => ({ name: p.objektnavn || p.lokaltNavn, type: "SEFRAK-bygning (bygd før 1900)", protection: p.fredning || p.vernevedtak || undefined, link: p.askeladdenId ? `https://askeladden.ra.no/askeladden/?kid=${encodeURIComponent(p.askeladdenId)}` : undefined }) },
  { kind: "Kulturmiljøer", path: "KulturminnerKulturmiljoer/collections/kulturmiljoer", extra: "",
    rec: p => ({ name: p.navn, type: "Kulturmiljø", protection: p.vernetype && p.vernetype !== "None" ? p.vernetype : undefined, link: p.linkKulturminnesok || p.linkKulturminnesøk }) },
];
export const KINDS = SETS.map(s => s.kind);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && v !== "None"));

export function createHeritage({ site, fetchImpl = fetch, timeoutMs = 20000 }) {
  return async function heritage({ radius_m = 100, kinds, limit = 25 } = {}) {
    const r = Math.min(500, Math.max(0, Number(radius_m) || 0)), n = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 25)), [ox, oy] = site.origin, xs = site.lot.ring.map(p => p[0]), ys = site.lot.ring.map(p => p[1]);
    const bbox = [Math.min(...xs) + ox - r, Math.min(...ys) + oy - r, Math.max(...xs) + ox + r, Math.max(...ys) + oy + r].map(Math.round);
    const want = SETS.filter(s => !kinds?.length || kinds.includes(s.kind));
    const rows = await Promise.all(want.map(async s => {
      const url = `${BASE}/${s.path}/items?f=json&limit=${n}&bbox=${bbox.join(",")}&bbox-crs=${encodeURIComponent(CRS)}${s.extra}`;
      try {
        const res = await fetchImpl(url, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`svarte ${res.status}`);
        const j = await res.json(); if (!Array.isArray(j.features)) throw new Error("svarte ikke med objekter");
        return { s, matched: j.numberMatched ?? j.features.length, records: j.features.map(f => ({ source: `Riksantikvaren: ${s.kind}`, id: String(f.id ?? f.properties?.lokalId ?? ""), ...clean(s.rec(f.properties || {})), ...(f.geometry?.type === "Point" ? { lonlat: f.geometry.coordinates.slice(0, 2).map(v => +v.toFixed(6)) } : {}) })).map(x => ({ ...x, link: x.link || `${BASE}/${s.path}/items/${encodeURIComponent(x.id)}?f=html` })) };
      } catch (e) { return { s, error: `${s.kind}: ${e.message}` }; }
    }));
    const ok = rows.filter(x => !x.error);
    if (!ok.length) throw Object.assign(new Error(`Fikk ikke kulturminnene fra Riksantikvaren: ${rows.map(x => x.error).join("; ")}`), { tool: true });
    return { box_utm33: bbox, radius_m: r, records: ok.flatMap(x => x.records), counts: Object.fromEntries(ok.map(x => [x.s.kind, { returned: x.records.length, matched: x.matched }])),
      ...(rows.some(x => x.error) ? { unavailable: rows.filter(x => x.error).map(x => x.error) } : {}), open_data: OPEN_DATA, source: "Riksantikvaren OGC API (api.ra.no)" };
  };
}
