/* Models fetched from open libraries (U3571 S4), for Anton in a signed-in person's turn: found by find_models, fetched
   by fetch_model, then brought in by bim.mjs importFile exactly as an upload is (the source URL and the licence kept).

   Fetching (pm 02:55Z): https only, to the hosts in FETCH_HOSTS and nowhere else (no redirect off the list); each
   name resolved first and refused when any address is private, loopback, link-local or CGNAT, and the address the
   socket reached checked again after it connected (a DNS rebind gets no further); at most 100 MB, counted as it
   comes; 60 s in all. Any other host: a link for the person to open, not a fetch.

   Libraries: Poly Haven (models, CC0, its API) and the FreeCAD parts library (STEP, CC-BY 3.0, its index.html).
   Those that need an account or forbid automated downloads are named in LINK_ONLY with a search link. */
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

const toolErr = message => Object.assign(new Error(message), { tool: true });
export const FETCH_HOSTS = ["raw.githubusercontent.com", "objects.githubusercontent.com", "github.com", "dl.polyhaven.org", "api.polyhaven.com", "upload.wikimedia.org", "commons.wikimedia.org"];
/* github.com: a release's file or a raw path only, not its pages */
const GITHUB_PATH = /^\/[^/]+\/[^/]+\/(raw\/|releases\/download\/)/;
export const MAX_FETCH = 100 << 20, FETCH_MS = 60000;
/* where the person goes themselves: an account, or terms that forbid a program downloading */
export const LINK_ONLY = [
  { name: "BIMobject", host: "bimobject.com", search: q => `https://www.bimobject.com/en/search?freetext=${encodeURIComponent(q)}`, why: "krever konto, og vilkårene forbyr automatisk nedlasting" },
  { name: "NBS National BIM Library", host: "nationalbimlibrary.com", search: q => `https://www.nationalbimlibrary.com/en/search/?q=${encodeURIComponent(q)}`, why: "krever konto" },
  { name: "bimstore", host: "bimstore.co", search: q => `https://www.bimstore.co/search?q=${encodeURIComponent(q)}`, why: "krever konto" },
  { name: "SketchUp 3D Warehouse", host: "3dwarehouse.sketchup.com", search: q => `https://3dwarehouse.sketchup.com/search/?q=${encodeURIComponent(q)}`, why: "krever konto; modellene er .skp (eksporter som IFC, glTF eller OBJ)" },
  { name: "Sketchfab", host: "sketchfab.com", search: q => `https://sketchfab.com/search?q=${encodeURIComponent(q)}&type=models&features=downloadable`, why: "nedlasting krever konto; lisensen står per modell" },
  { name: "TraceParts", host: "traceparts.com", search: q => `https://www.traceparts.com/en/search?Keywords=${encodeURIComponent(q)}`, why: "krever konto" },
  { name: "GrabCAD", host: "grabcad.com", search: q => `https://grabcad.com/library?query=${encodeURIComponent(q)}`, why: "krever konto" },
];

/* an address a fetch must never reach: this box, its networks, the cloud's metadata, multicast */
export function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase(), v4 = /^(?:0*:)*:?(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s) || /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (v4) return privateIp(v4[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^64:ff9b:/.test(s) || /^2001:db8:/.test(s);
  }
  return true;
}
/* the URL on the list, or the reason it is not */
export function allowed(u) {
  let url; try { url = new URL(u); } catch { return { ok: false, why: "ikke en adresse" }; }
  if (url.protocol !== "https:") return { ok: false, why: "bare https" };
  if (url.username || url.password || (url.port && url.port !== "443")) return { ok: false, why: "ingen brukernavn eller port i adressen" };
  const h = url.hostname.toLowerCase();
  if (!FETCH_HOSTS.includes(h)) return { ok: false, why: `${h} er ikke blant kildene som kan hentes automatisk`, link: LINK_ONLY.find(l => h === l.host || h.endsWith(`.${l.host}`)) };
  if (h === "github.com" && !GITHUB_PATH.test(url.pathname)) return { ok: false, why: "fra github.com bare en utgivelses fil eller en raw-sti" };
  return { ok: true, url };
}

/* fetchOf(resolve): a fetcher whose names are looked up by resolve (dns.lookup's shape), for the tests to give their
   own; fetch(url) → { bytes, url (the last), type, filename } */
export function fetcherOf(resolve = dns.lookup) {
  const lookup = (host, opts, cb) => resolve(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIPv6(addrs) ? 6 : 4 }];
    if (!list.length || list.some(a => privateIp(a.address))) return cb(Object.assign(new Error(`${host} peker til en intern adresse`), { code: "EPRIVATE" }));
    return opts?.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
  function once(url, deadline) {
    return new Promise((ok, no) => {
      const left = deadline - Date.now(); if (left <= 0) return no(toolErr("Hentingen tok mer enn 60 sekunder."));
      const req = https.get(url, { lookup, headers: { "user-agent": "sykehus.gulden.no model import (U3571)", accept: "*/*" }, timeout: left }, res => {
        const s = res.socket.remoteAddress;
        if (!s || privateIp(s)) { req.destroy(); return no(toolErr("Adressen ble en intern adresse etter oppslaget: hentes ikke.")); }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return ok({ redirect: new URL(res.headers.location, url).href }); }
        if (res.statusCode !== 200) { res.resume(); return no(toolErr(`Kilden svarte ${res.statusCode}.`)); }
        let n = 0; const parts = [];
        res.on("data", c => { n += c.length; if (n > MAX_FETCH) { req.destroy(); no(toolErr("Fila er større enn 100 MB.")); } else parts.push(c); });
        res.on("end", () => ok({ bytes: Buffer.concat(parts), type: res.headers["content-type"] || "", disposition: res.headers["content-disposition"] || "" }));
        res.on("error", no);
      });
      /* checked again once connected: the address the socket reached, not the one looked up */
      req.on("socket", sock => sock.once("connect", () => { if (privateIp(sock.remoteAddress || "")) req.destroy(toolErr("Adressen ble en intern adresse etter oppslaget: hentes ikke.")); }));
      req.on("timeout", () => req.destroy(toolErr("Hentingen tok mer enn 60 sekunder.")));
      req.on("error", e => no(e.tool ? e : toolErr(e.code === "EPRIVATE" ? `${e.message}: hentes ikke.` : `Fikk ikke hentet: ${e.code || e.message}`)));
    });
  }
  return async function fetchUrl(u) {
    const deadline = Date.now() + FETCH_MS;
    for (let hop = 0; hop < 6; hop++) {
      const a = allowed(u); if (!a.ok) throw Object.assign(toolErr(`${hop ? "Videresendt til en adresse som ikke kan hentes" : "Kan ikke hentes"}: ${a.why}.`), { link: a.link });
      const r = await once(a.url, deadline);
      if (r.redirect) { u = r.redirect; continue; }
      const cd = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(r.disposition), name = cd ? decodeURIComponent(cd[1] || cd[2]) : decodeURIComponent(new URL(u).pathname.split("/").pop() || "modell");
      return { bytes: r.bytes, url: u, type: r.type, filename: name.slice(0, 120) };
    }
    throw toolErr("For mange videresendinger.");
  };
}

/* the libraries: each search gives {title, library, licence, format, url (what fetch_model takes), page} */
const day = 86400e3, kept = new Map();
async function cached(key, get) { const k = kept.get(key); if (k && Date.now() - k.at < day) return k.v; const v = await get(); kept.set(key, { at: Date.now(), v }); return v; }
const words = q => String(q || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 1);
const hit = (ws, text) => ws.every(w => text.includes(w));

export function libraries(fetchUrl = fetcherOf()) {
  async function polyhaven(ws) {
    const all = await cached("polyhaven", async () => JSON.parse((await fetchUrl("https://api.polyhaven.com/assets?type=models")).bytes.toString("utf8")));
    return Object.entries(all).filter(([id, a]) => hit(ws, `${id} ${a.name} ${(a.tags || []).join(" ")} ${(a.categories || []).join(" ")}`.toLowerCase()))
      .slice(0, 12).map(([id, a]) => ({ title: a.name, library: "Poly Haven", licence: "CC0", format: "glTF", url: `polyhaven:${id}`, page: `https://polyhaven.com/a/${id}`, size_mm: a.dimensions?.map(v => Math.round(v)) }));
  }
  async function freecad(ws) {
    const parts = await cached("freecad", async () => {
      const html = (await fetchUrl("https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/index.html")).bytes.toString("utf8");
      return [...new Set([...html.matchAll(/href="https:\/\/github\.com\/FreeCAD\/FreeCAD-library\/blob\/master\/([^"?]+\.(?:step|stp))\?raw=true"/gi)].map(m => m[1]))];
    });
    return parts.filter(p => hit(ws, decodeURIComponent(p).toLowerCase())).slice(0, 12).map(p => { const path = decodeURIComponent(p);
      return { title: path.split("/").pop().replace(/\.(step|stp)$/i, "").replace(/[_-]+/g, " "), folder: path.split("/").slice(0, -1).join(" / "), library: "FreeCAD-biblioteket", licence: "CC-BY-3.0 (navngi forfatteren)", format: "STEP",
        url: `https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/${p}`, page: `https://github.com/FreeCAD/FreeCAD-library/blob/master/${p}` }; });
  }
  /* a Poly Haven model: its glTF with its buffers put inside (the import takes a .gltf whole), its pictures left out */
  async function polyhavenFile(id) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw toolErr("Ukjent Poly Haven-modell.");
    const files = JSON.parse((await fetchUrl(`https://api.polyhaven.com/files/${id}`)).bytes.toString("utf8")), g = files.gltf?.["1k"]?.gltf || Object.values(files.gltf || {})[0]?.gltf;
    if (!g?.url) throw toolErr(`Poly Haven har ingen glTF av ${id}.`);
    const doc = JSON.parse((await fetchUrl(g.url)).bytes.toString("utf8"));
    for (const b of doc.buffers || []) {
      if (!b.uri || b.uri.startsWith("data:")) continue;
      const inc = g.include?.[b.uri]; if (!inc?.url) throw toolErr(`Poly Haven-modellen mangler ${b.uri}.`);
      b.uri = "data:application/octet-stream;base64," + (await fetchUrl(inc.url)).bytes.toString("base64");
    }
    delete doc.images; delete doc.textures; delete doc.samplers; delete doc.materials;
    for (const m of doc.meshes || []) for (const p of m.primitives || []) delete p.material;
    return { bytes: Buffer.from(JSON.stringify(doc)), filename: `${id}.gltf`, url: `https://polyhaven.com/a/${id}`, licence: "CC0" };
  }
  return {
    async find(query) {
      const ws = words(query); if (!ws.length) throw toolErr("Hva skal letes etter? (på engelsk finner bibliotekene mest: greenhouse, window, bench)");
      const [ph, fc] = await Promise.all([polyhaven(ws).catch(e => ({ error: e.message })), freecad(ws).catch(e => ({ error: e.message }))]);
      return { query, found: [...(Array.isArray(fc) ? fc : []), ...(Array.isArray(ph) ? ph : [])], ...(ph.error || fc.error ? { unavailable: [ph.error && `Poly Haven: ${ph.error}`, fc.error && `FreeCAD-biblioteket: ${fc.error}`].filter(Boolean) } : {}),
        link_only: LINK_ONLY.map(l => ({ name: l.name, link: l.search(query), why: l.why })) };
    },
    /* the bytes of what find gave (polyhaven:<id>, or a URL on the list), with the licence the library states */
    async get(u) {
      if (/^polyhaven:/.test(u)) return polyhavenFile(u.slice("polyhaven:".length));
      const r = await fetchUrl(u), fc = /^https:\/\/raw\.githubusercontent\.com\/FreeCAD\/FreeCAD-library\//.test(r.url);
      return { bytes: r.bytes, filename: r.filename, url: u, ...(fc ? { licence: "CC-BY-3.0" } : {}) };
    },
  };
}
