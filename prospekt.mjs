/* «Prospekt» (Morten 2026-10-27: «a way for non-logged in users to view pictures rendered for a public project (or shared one) in a nice way,
   as well as other info on the project»): a read-only page per shared project, for anyone, signed out too.

   GET /api/prospekt/<versionId>[?nokkel=]                         the public-safe JSON (PROSPEKT_KEYS, nothing else)
   GET /api/prospekt/<versionId>/bilde/<renderId>.<ext>[?nokkel=]  a render the owner lets show, full size
   GET /api/prospekt/<versionId>/modell/<still>.jpg[?nokkel=]      a still of the model drawn server-side (mcp.mjs stills): no live 3D in the Prospekt
   GET /prospekt/<versionId> and /prospekt.html?v=<id>             the page (public/prospekt.html), by server.mjs

   Who may open it is decided from the version's sharing on EVERY request: offentlig: anyone; lenke: with the link's key (v.key), or its owner;
   privat (to anyone but its owner, who previews it), a missing id and a wrong key: the same 404, so nothing tells them apart. The JSON carries no owner address, no chat, no wishes, no
   other id than the version's and its renders'. The renders are gjengi.mjs's own (kept per version in <dir>/index.json, <dir>/<id>.<ext>). */
import { applyEdits } from "./public/edits.js";
import { loadCosts, summarize } from "./area.mjs";

export const PROSPEKT_KEYS = ["version", "title", "owner", "updated", "sharing", "edits", "hero", "renders", "stills", "numbers", "limits", "limits_say"];
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }, r1 = x => Math.round(x * 10) / 10;

/* the numbers of an after: new volumes with storeys and kote, areas as beregnet, what is torn down. Pure (no network). */
export function numbersOf(site, floors, edits, costs) {
  const m = applyEdits(site, floors, edits), s = summarize(m.site, costs), vols = (m.site.added || []).filter(a => a.kind === "volume");
  return { volumes: s.new_volumes.map((v, i) => {
      const a = vols[i] || {}, n = v.storeys, h = a.height ?? null, base = typeof a.base_kote === "number" ? a.base_kote : null;
      return { name: v.name, storeys: n, storeys_from: v.storeys_from ?? null, footprint_m2: v.footprint_m2 ?? null, bta_m2: v.bta_m2, bra_m2: v.bra_m2, volume_m3: a.volume_m3 ?? null,
        foot_kote: base, top_kote: typeof a.top_kote === "number" ? a.top_kote : null,
        storey_kotes: base != null && h ? Array.from({ length: n }, (_, k) => r1(base + k * h / n)) : [] }; }),
    bta_m2: s.totals.bta_m2, bra_m2: s.totals.bra_m2, demolished: s.demolished,
    how: "Arealene er beregnet (etasjer ganger fotavtrykk), ikke målt på tegning. Etasjenes kote er beregnet fra byggets fot og høyde." + (s.totals.bra_m2 == null ? " BRA er ikke oppgitt: det finnes ingen kildebelagt faktor fra BTA." : "") };
}
/* the plot's limits as plain lines, each with how it is known (sitefacts.mjs: NVE, NGU and Riksantikvaren through Hagekart) */
export function limitsOf(f) {
  const str = x => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return [...(f.hazards || []).map(h => ({ line: str(h.text), how: `Fra ${str(h.source) || "et offentlig kart"} (kart for tidlig vurdering, ikke en avgjørelse)` })),
    ...(f.heritage_within_50m || []).map(h => ({ line: `Kulturminne ${Number.isFinite(+h.distance_m) ? Math.round(h.distance_m) + " m unna" : "i nærheten"}: ${str(h.name)}${h.protection ? ` (${str(h.protection)})` : ""}`, how: "Fra Riksantikvarens register (Kulturminnesøk)" }))].filter(l => l.line);
}

export function createProspekt({ SECURITY = {}, login, versions, photos, site, floors = [], siteFacts = async () => ({}), stills = { list: [], of: async () => new Map() }, costs = () => loadCosts() }) {
  const json = (res, n, o) => res.writeHead(n, { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "cookie" }).end(JSON.stringify(o));
  const none = res => json(res, 404, { error: "Fant ikke prospektet." });   // one answer for a private, a missing and a wrongly keyed project
  /* the owner opens their own project's Prospekt shared or not (the preview while working, Morten 2026-10-28); nobody else gets a privat one, and a link key never opens it */
  const open = (v, key, who) => !!v && (!!who && who === v.owner || v.sharing === "offentlig" || (v.sharing === "lenke" && typeof key === "string" && key === v.key));
  const urlOf = (v, r, key) => `api/prospekt/${v.id}/bilde/${r.id}.${r.ext}${v.sharing === "lenke" && key ? `?nokkel=${encodeURIComponent(key)}` : ""}`;
  return {
    open,
    async route(req, res, path, url) {
      const m = /^\/api\/prospekt\/([^/]+)(?:\/bilde\/([a-z0-9]{16})\.(jpg|png|webp)|\/modell\/([a-z]+)\.jpg)?$/.exec(path);
      if (!m) return false;
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "GET only" }), true;
      const v = versions?.get(m[1]), key = url.searchParams.get("nokkel"), who = login?.personOf(req)?.person ?? null;
      if (!open(v, key, who)) return none(res), true;
      const shown = (photos?.rendersOf(v.id) || []).filter(r => r.prospekt);
      if (m[2]) {
        const r = shown.find(x => x.id === m[2] && x.ext === m[3]), f = r && photos.bytesOf(r.id);
        if (!f) return none(res), true;
        return res.writeHead(200, { ...SECURITY, "content-type": TYPES[f.ext], "cache-control": "private, max-age=3600", vary: "cookie", "content-length": f.bytes.length }).end(f.bytes), true;
      }
      if (m[4]) {   // a still of the model, drawn on the first request
        if (!stills.list.some(x => x.id === m[4])) return none(res), true;
        let bytes; try { bytes = (await stills.of(v)).get(m[4]); } catch (e) { console.error("prospekt still:", v.id, e.message); return json(res, 500, { error: "Bildet kunne ikke lages." }), true; }
        return res.writeHead(200, { ...SECURITY, "content-type": "image/jpeg", "cache-control": "private, max-age=600", vary: "cookie", "content-length": bytes.length }).end(bytes), true;
      }
      const ordered = [...shown].sort((a, b) => (b.hero - a.hero) || b.at.localeCompare(a.at));
      let c; try { c = costs(); } catch { c = { prices: [], bra_factor: null }; }
      let limits = [], limits_say = null; try { limits = limitsOf(await siteFacts()); } catch { limits_say = "Fikk ikke hentet opplysningene om tomta nå."; }
      return json(res, 200, { version: v.id, title: v.title, owner: v.owner, updated: v.updated, sharing: v.sharing, edits: v.edits,
        hero: ordered[0]?.id ?? null, renders: ordered.map(r => ({ id: r.id, url: urlOf(v, r, key), at: r.at })),
        stills: stills.list.map(x => ({ title: x.title, url: `api/prospekt/${v.id}/modell/${x.id}.jpg${v.sharing === "lenke" && key ? `?nokkel=${encodeURIComponent(key)}` : ""}` })),
        numbers: numbersOf(site, floors, v.edits, c), limits, limits_say }), true;
    },
  };
}
