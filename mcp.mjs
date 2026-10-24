// Sykehustomta as an MCP server (Model Context Protocol), so Claude and other chat apps can use it: the documents, the
// floors and rooms, and the building in 3D inside the chat (an MCP App). No dependencies: JSON-RPC over Streamable
// HTTP (JSON answers only). The JSON-RPC handling follows hagekart's mcp.mjs (2026-10-24), without its OAuth: every
// tool here is open, as the whole site is to look at and try. Saving, when it comes, is what will need a login.
//
//   POST /mcp     JSON-RPC: initialize, tools/list, tools/call, resources/read ...
import { randomBytes } from "node:crypto";
import { wingOf, checkEdit, applyEdits } from "./public/edits.js";

/* MCP 2026-07-28 (stateless: each request names its version in _meta, server/discover instead of the handshake),
   and the older revisions' initialize for clients that still send it. MCP Apps 2026-01-26 (io.modelcontextprotocol/ui). */
const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const M = k => `io.modelcontextprotocol/${k}`;
const SERVER_INFO = { name: "sykehus", title: "Sykehustomta", version: "0.2.0" };
const INSTRUCTIONS = "Sykehustomta is the old Drammen sykehus (Dronninggata 28, 3019 Drammen, gnr. 114 bnr. 272) for an architect working on reusing the existing buildings. "
  + "The hospital is described as its wings (about_site, about_wing): each with years, storeys and their kote per wing (storeys), drawn floor plans with rooms and areas (floor_plan), and windows from the drawn facades (openings). "
  + "A store of about 200 documents (building-case drawings, sections, facades, the 2026 area plan and its reports, heritage records) is searchable (search_documents, read_document). show_building shows the hospital in 3D or plan in the chat. "
  + "Changes can be tried without saving (try_change): they go into a draft with a link to the website; nothing changes the shared model, saving comes with a login later. "
  + "The user is an architect: speak in drawing terms (plan, snitt, kote, BRA), in Norwegian unless he writes otherwise, and cite drawings and documents by title with their link. "
  + "Say how each fact is known: read off a drawing, worked out (beregnet), assumed (antatt) or measured from the laser; areas measured between drawn walls are rough (about 15 %).";

const err = (code, message) => Object.assign(new Error(message), { code });
const toolErr = message => Object.assign(new Error(message), { tool: true });
/* the store's search text is folded so "rontgen" finds "røntgen" (tools/ingest.py fold) */
const fold = s => String(s).toLowerCase().replace(/æ/g, "ae").replace(/[øö]/g, "o").replace(/[åä]/g, "a").replace(/é/g, "e").replace(/ü/g, "u");
const DIRS = { n: 0, nord: 0, no: 45, nordøst: 45, ne: 45, ø: 90, øst: 90, e: 90, sø: 135, sørøst: 135, se: 135, s: 180, sør: 180, sv: 225, sørvest: 225, sw: 225, v: 270, vest: 270, w: 270, nv: 315, nordvest: 315, nw: 315 };
const dirDeg = d => typeof d === "number" ? d : DIRS[String(d || "").toLowerCase().replace(/[\s-]/g, "")] ?? (() => { throw toolErr(`Unknown direction "${d}". Use N, NØ, Ø, SØ, S, SV, V, NV or degrees.`); })();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = v => Math.round(v * 10) / 10;

export function createMcp({ site, floors, sections = [], docs, docUrl, SECURITY, readJson }) {
  const counts = new Map();
  const bump = (key, max, windowMs) => {
    const now = Date.now(), h = counts.get(key);
    if (!h || now - h.t > windowMs) { counts.set(key, { t: now, n: 1 }); return; }
    if (++h.n > max) throw toolErr("For mange forespørsler akkurat nå. Prøv igjen om litt.");
  };
  const originOf = req => process.env.PUBLIC_ORIGIN || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "") ? `http://${req.headers.host}` : `https://${req.headers.host}`);
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

  // ---------- the site, its wings and storeys ----------
  const height = b => b.top != null ? round1(b.top - b.base) : null;
  const wingsAll = () => site.wings || [];
  const wingOrErr = w => { const x = wingOf(site, w); if (!x) throw toolErr(`No wing "${w}". Wings: ${wingsAll().map(v => `${v.name} (${v.id})`).join(", ")}.`); return x; };
  const piecesOf = id => site.buildings.filter(b => b.wing === id);
  const inside = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
  const wingAt = p => wingsAll().find(w => piecesOf(w.id).some(b => inside(p, b.ring)))?.id || null;
  const storeyName = s => { const t = String(s ?? "").trim().toLowerCase(); if (/^\d+$/.test(t)) return `${t}. etasje`; const m = t.match(/^(\d+)\.?\s*(etg|etasje|et)?\.?$/); return m ? `${m[1]}. etasje` : String(s).trim(); };
  const docRef = ref => { const id = String(ref).slice(0, 12), d = docs ? docRow(id) : null; return { ref, title: d?.title ?? null, download: d ? docUrl(d.file) : null }; };
  const wingOut = (w, full) => {
    const bs = piecesOf(w.id), base = Math.min(...bs.map(b => b.base)), top = Math.max(...bs.map(b => b.top ?? b.base));
    const out = { id: w.id, name: w.name, aliases: w.aliases || [], sure: !!w.sure, built: w.built ?? null, storeys: w.storeys ?? null,
      construction: w.construction ?? null, facade: w.facade ?? null, note: w.note ?? null,
      footprint_m2: Math.round(bs.reduce((a, b) => a + (b.area_m2 || 0), 0)), ground_kote: round1(base), top_kote: round1(top),
      levels: (w.levels || []).map(l => ({ storey: l.name, kote: l.kote, how: l.how, source: l.src })) };
    if (!full) return out;
    const drawn = floors.filter(f => f.walls.some(r => wingAt(r[0]) === w.id) || (f.rooms || []).some(r => wingAt(r.at) === w.id));
    return { ...out, drawn_storeys: [...new Set(drawn.map(f => f.name))], facades: (site.facades || []).filter(f => f.building === w.id).map(f => ({ id: f.id, name: f.name, openings: f.openings.length, source: f.src })),
      drawn_sections: sections.filter(d => d.wing === w.id).map(d => ({ id: d.id, title: d.title, year: d.year, kind: d.kind, levels: d.levels, note: d.note, placement_sure: !!d.sure, sheet_image: d.image, download: d.url })),
      sources: (w.sources || []).map(d => ({ title: d.title, year: d.year ?? null, page: d.page ?? null, note: d.note ?? null, download: d.url ?? null })), draft_changes: w.draft || [] };
  };
  const roomOut = (f, r) => ({ name: r.name, code: r.code ?? null, use: r.use ?? null, wing: wingAt(r.at), area_m2: r.area_m2 ?? null, area_measured_m2: r.area_calc ?? null,
    east_m: round1(r.at[0]), north_m: round1(r.at[1]), sheet: f.source, ...(r.draft ? { draft: r.draft } : {}) });

  // ---------- documents ----------
  const docRow = id => docs?.prepare("SELECT id, title, kind, year, file, pages, has_text, urls FROM docs WHERE id=?").get(String(id));
  const docOut = d => ({ id: d.id, title: d.title, kind: d.kind, year: d.year ?? null, pages: d.pages, has_text: !!d.has_text, download: docUrl(d.file), source: JSON.parse(d.urls || "[]")[0] || null });
  const needDocs = () => { if (!docs) throw toolErr("The document store is not loaded on this server."); };
  /* a query as FTS5 terms: each word folded and quoted (so nothing in it is FTS syntax), longer words as prefixes, all must match */
  const ftsQuery = q => { const w = fold(q).match(/[\p{L}\p{N}]+/gu) || []; if (!w.length) throw toolErr("Give some words to search for."); return w.slice(0, 8).map(x => `"${x}"${x.length >= 4 ? "*" : ""}`).join(" "); };
  /* a snippet from the page as written, around the first word that matches, found through the folded copy */
  function snippet(text, q) {
    const words = (fold(q).match(/[\p{L}\p{N}]+/gu) || []), map = [];
    let f = ""; for (let i = 0; i < text.length; i++) { const c = fold(text[i]); for (let k = 0; k < c.length; k++) map.push(i); f += c; }
    let at = -1; for (const w of words) { const k = f.indexOf(w); if (k >= 0 && (at < 0 || k < at)) at = k; }
    const i = at < 0 ? 0 : map[at], a = Math.max(0, i - 90), b = Math.min(text.length, i + 160);
    return (a ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ").trim() + (b < text.length ? "…" : "");
  }

  // ---------- drafts: changes tried on the model, kept here for a day, never written to the data ----------
  const drafts = new Map(), DRAFT_MS = 24 * 3600e3, MAX_DRAFTS = 500, MAX_EDITS = 200;
  const newId = () => randomBytes(6).toString("base64url");
  const draftOf = id => { const d = drafts.get(String(id)); if (!d || Date.now() - d.t > DRAFT_MS) { drafts.delete(String(id)); throw toolErr(`No draft "${id}" (drafts last a day). Start a new one with try_change.`); } return d; };
  const draftUrl = (o, id) => `${o}/?utkast=${id}`;
  const model = id => id ? applyEdits(site, floors, draftOf(id).edits) : { site, floors, notes: [], changed: [] };

  // ---------- the picture ----------
  const APP_URI = "ui://sykehus/bygget";
  const viewOf = a => {
    const v = {};
    if (a.storey) { const n = storeyName(a.storey); if (!floors.some(f => f.name === n) && !wingsAll().some(w => (w.levels || []).some(l => l.name === n))) throw toolErr(`No storey "${a.storey}".`); v.storey = n; }
    if (a.wing) { const w = wingOrErr(a.wing); v.wing = w.id; v.building = piecesOf(w.id)[0]?.id; }
    if (a.mode === "plan" || a.mode === "3d") v.mode = a.mode;
    if (a.drawn_section) {
      const d = sections.find(x => x.id === a.drawn_section); if (!d) throw toolErr(`No drawn section "${a.drawn_section}". Drawn sections: ${sections.map(x => x.id).join(", ")} (about_wing lists them).`);
      const w = wingOrErr(d.wing); Object.assign(v, { wing: w.id, building: piecesOf(w.id)[0]?.id, mode: "section", section: d.kind, drawn: d.id }); delete v.storey; return v;
    }
    if (a.mode === "tverrsnitt" || a.mode === "lengdesnitt") {
      if (!v.wing) throw toolErr("A section needs wing: the wing to cut through.");
      v.mode = "section"; v.section = a.mode === "lengdesnitt" ? "lengde" : "tverr"; delete v.storey;
    }
    if (a.from_direction != null) v.yaw = Math.PI - dirDeg(a.from_direction) * Math.PI / 180;
    if (a.tilt_deg != null) v.pitch = clamp(+a.tilt_deg, 5, 85) * Math.PI / 180;
    if (a.distance_m != null) v.dist = clamp(+a.distance_m, 30, 1200);
    if (a.draft) { draftOf(a.draft); v.draft = String(a.draft); }
    return v;
  };
  const appCsp = origin => ({ connectDomains: [origin], resourceDomains: [origin], baseUriDomains: [origin] });
  const appHtml = origin => `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${origin}/"><title>Sykehustomta</title></head><body><script type="module" src="${origin}/mcp-app.js"></script></body></html>`;

  // ---------- tools ----------
  const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
  const WING = { type: "string", description: `Wing name or id: ${wingsAll().map(w => `${w.name} (${w.id})`).join(", ")}` };
  const STOREY = { type: "string", description: "Storey as the hospital numbers them across wings: 1 … 14 or \"5. etasje\"" };
  const DRAFT = { type: "string", description: "A draft id from try_change: answer from the model with those changes laid over it" };
  const EDIT = { type: "object", description: "One change. kind level: {wing, storey, kote, why}; kind wing: {wing, field (name|built|storeys|construction|facade|note), value, why}; kind room: {storey, room (code or name), set: {name?, use?, area_m2?}, why}; kind note: {text, wing?, storey?, at?: [east_m, north_m], why?}. why says where it comes from (drawing and page, a measurement, the architect's own judgement).",
    properties: { kind: { type: "string", enum: ["level", "wing", "room", "note"] }, wing: { type: "string" }, storey: { type: "string" }, kote: { type: "number" }, field: { type: "string" }, value: { type: "string" },
      room: { type: "string" }, set: { type: "object", properties: { name: { type: "string" }, use: { type: "string" }, area_m2: { type: "number" } }, additionalProperties: false },
      text: { type: "string" }, at: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, why: { type: "string" } }, required: ["kind"], additionalProperties: false };
  const TOOLS = [
    { name: "about_site", title: "Tomta og fløyene", ro: true, schema: S({ draft: DRAFT }),
      description: "The site and the hospital as its wings (Sentralblokka, Østfløy, Østre nordfløy, Midtfløy …): each wing's years, storeys, construction, facade, footprint and kote from ground to roof, how sure the identification is, the storeys that have a drawn plan, and where the facts come from. Positions are metres east and north of the site origin (EPSG:25833), heights NN2000.",
      run: async a => { const m = model(a.draft), names = [...new Set(m.floors.map(f => f.name))];
        return { name: site.name, address: "Dronninggata 28, 3019 Drammen", gnr_bnr: "114/272", lot_area_m2: site.lot.area_m2, heights: "NN2000", origin_utm33: site.origin,
          wings: (m.site.wings || []).map(w => { const o = wingOut(w, false); return { id: o.id, name: o.name, sure: o.sure, built: o.built, storeys: o.storeys, footprint_m2: o.footprint_m2, ground_kote: o.ground_kote, top_kote: o.top_kote, levels_known: o.levels.length }; }),
          drawn_storeys: names.map(n => ({ storey: n, sheets: m.floors.filter(f => f.name === n).map(f => f.source) })),
          bim: "Last ned som BIM-modell: /data/sykehus.ifc (IFC4, FreeCAD/Revit/Solibri)", sources: site.sources, documents: docs ? docs.prepare("SELECT COUNT(*) n FROM docs").get().n : 0,
          ...(a.draft ? { draft: a.draft, notes: m.notes } : {}) }; } },
    { name: "about_wing", title: "Én fløy", ro: true, schema: S({ wing: WING, draft: DRAFT }, ["wing"]),
      description: "One wing as on its card: names and aliases, years built, storeys, construction, facade, footprint, ground and roof kote, each storey's kote with how it is known (tegning = read off a drawing, beregnet = worked out, antatt = assumed) and its source, the storeys with a drawn plan, its drawn facades, and the documents it is identified from, with download links.",
      run: async a => { const m = model(a.draft), w = wingOf(m.site, a.wing) || wingOrErr(a.wing); return { ...wingOut(w, true), ...(a.draft ? { draft: a.draft, notes: m.notes.filter(n => n.wing === w.id) } : {}) }; } },
    { name: "storeys", title: "Etasjene", ro: true, schema: S({ wing: { ...WING, description: WING.description + ". Leave out for all wings" }, draft: DRAFT }),
      description: "The storey ladder: for each storey (1 … 14) the kote in every wing that has it, how each is known and from where, and which sheets draw that storey. The wings' floors do not line up exactly (Sentralblokka 5. etasje +31,77, Østfløy +32,02).",
      run: async a => { const m = model(a.draft), ws = a.wing ? [wingOf(m.site, a.wing) || wingOrErr(a.wing)] : m.site.wings || [];
        const names = [...new Set([...ws.flatMap(w => (w.levels || []).map(l => l.name)), ...m.floors.map(f => f.name)])].sort((x, y) => parseInt(x) - parseInt(y));
        return { storeys: names.map(n => ({ storey: n, wings: ws.map(w => [w, (w.levels || []).find(l => l.name === n)]).filter(r => r[1]).map(([w, l]) => ({ wing: w.name, kote: l.kote, how: l.how, source: l.src })),
          sheets: m.floors.filter(f => f.name === n).map(f => ({ sheet: f.source, drawn_kote: f.kote, storey_height_m: f.height })) })).filter(s => s.wings.length || s.sheets.length) }; } },
    { name: "floor_plan", title: "Én etasje: rom og arealer", ro: true, schema: S({ storey: STOREY, wing: { ...WING, description: "Only this wing" }, name_contains: { type: "string", description: "Only rooms whose name has this, e.g. operasjon, lager, wc" }, draft: DRAFT }, ["storey"]),
      description: "The rooms of one storey from its drawn plans, across the wings: name, room code, the wing it stands in, the area the architect wrote on the drawing (area_m2, net) and the area measured between the drawn walls (area_measured_m2, about 15 % rough; given where an outline closes), position (metres east/north of the site origin) and the sheet. Sums per wing. Many sheets name rooms without areas.",
      run: async a => { const m = model(a.draft), n = storeyName(a.storey), fs = m.floors.filter(f => f.name === n);
        if (!fs.length) throw toolErr(`No drawn plan of "${n}". Drawn: ${[...new Set(floors.map(f => f.name))].join(", ")}.`);
        const w = a.wing ? wingOrErr(a.wing).id : null, q = a.name_contains ? fold(a.name_contains) : null;
        const rooms = fs.flatMap(f => (f.rooms || []).map(r => roomOut(f, r))).filter(r => (!w || r.wing === w) && (!q || fold(r.name).includes(q)));
        const per = {}; for (const r of rooms) { const k = r.wing || "utenfor fløyene"; per[k] ||= { rooms: 0, stamped_m2: 0, measured_m2: 0 }; per[k].rooms++; per[k].stamped_m2 += r.area_m2 || 0; per[k].measured_m2 += r.area_m2 ? 0 : r.area_measured_m2 || 0; }
        for (const v of Object.values(per)) { v.stamped_m2 = round1(v.stamped_m2); v.measured_m2 = round1(v.measured_m2); }
        return { storey: n, sheets: fs.map(f => ({ sheet: f.source, kote: f.kote, storey_height_m: f.height, walls: f.walls.length })), per_wing: per, rooms }; } },
    { name: "openings", title: "Vinduer og dører i en fasade", ro: true, schema: S({ wing: WING }, ["wing"]),
      description: "The windows, doors and glazing read from a wing's drawn facades: per facade, how many of each kind per storey band, and each opening's position along the wall (metres from the left end as one stands outside) and kote of sill and head, with the sheet.",
      run: async a => { const w = wingOrErr(a.wing), fs = (site.facades || []).filter(f => f.building === w.id);
        if (!fs.length) throw toolErr(`No drawn facade for ${w.name} yet. Drawn: ${[...new Set((site.facades || []).map(f => f.building))].join(", ")}.`);
        const lv = (w.levels || []).slice().sort((x, y) => x.kote - y.kote), band = z => [...lv].reverse().find(l => l.kote <= z + 0.3)?.name || "under laveste etasje";
        return { wing: w.name, facades: fs.map(f => { const per = {}; for (const o of f.openings) { const k = band(o.z[0]); per[k] ||= {}; per[k][o.kind] = (per[k][o.kind] || 0) + 1; }
          return { id: f.id, name: f.name, wall_length_m: round1(Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1])), per_storey: per,
            openings: f.openings.map(o => ({ kind: o.kind, along_m: o.u.map(round1), sill_kote: round1(o.z[0]), head_kote: round1(o.z[1]), panes: o.panes.length })), sheet: f.src.map(docRef) }; }) }; } },
    /* documents: see below */
    { name: "try_change", title: "Prøv en endring", schema: S({ edits: { type: "array", items: EDIT, minItems: 1, maxItems: 50 }, draft: { type: "string", description: "Add to this draft (from an earlier try_change); leave out to start a new one" } }, ["edits"]),
      description: "Tries changes on the model without saving them: a storey's kote in a wing, a fact on a wing's card, a room's name, use or area, or a note pinned to a wing, storey or place. Each is checked; those that pass go into a draft that lasts a day, with a link that opens the website showing the model with them (?utkast=…), and every other tool takes draft: to answer from it. Nothing changes the shared model: saving needs a login, which comes later. Say where each change comes from in why.",
      run: async (a, req) => {
        let d; if (a.draft) d = draftOf(a.draft); else { if (drafts.size >= MAX_DRAFTS) for (const [k, v] of drafts) if (Date.now() - v.t > DRAFT_MS || drafts.size >= MAX_DRAFTS) drafts.delete(k); d = { id: newId(), t: Date.now(), edits: [] }; drafts.set(d.id, d); }
        const ok = [], bad = [];
        for (const [i, e] of a.edits.entries()) { try { const c = checkEdit(applyEdits(site, floors, d.edits).site, applyEdits(site, floors, d.edits).floors, e); if (d.edits.length >= MAX_EDITS) throw new Error(`A draft holds at most ${MAX_EDITS} changes`); d.edits.push(c); ok.push(c); } catch (x) { bad.push({ index: i, error: x.message }); } }
        d.t = Date.now();
        return { draft: d.id, link: draftUrl(originOf(req), d.id), added: ok, rejected: bad, changes_in_draft: d.edits.length, saved: false,
          note: "Ikke lagret: utkastet varer et døgn og endrer ikke fellesmodellen. Åpne lenken for å se det." }; } },
    { name: "show_draft", title: "Se et utkast", ro: true, schema: S({ draft: { type: "string" } }, ["draft"]),
      description: "The changes in a draft, in order, numbered, with the link that shows it on the website.",
      run: async (a, req) => { const d = draftOf(a.draft); return { draft: d.id, link: draftUrl(originOf(req), d.id), changes: d.edits.map((e, i) => ({ n: i + 1, ...e })), saved: false }; } },
    { name: "undo_change", title: "Angre en endring", schema: S({ draft: { type: "string" }, n: { type: "integer", minimum: 1, description: "The change's number from show_draft" } }, ["draft", "n"]),
      description: "Takes one change out of a draft by its number from show_draft.",
      run: async (a, req) => { const d = draftOf(a.draft); if (a.n > d.edits.length) throw toolErr(`The draft has ${d.edits.length} changes.`); const [gone] = d.edits.splice(a.n - 1, 1); return { draft: d.id, removed: gone, link: draftUrl(originOf(req), d.id), changes_in_draft: d.edits.length }; } },
    { name: "search_documents", title: "Søk i dokumentene", ro: true, schema: S({ query: { type: "string", description: "Words to find, in Norwegian (all must occur; æøå optional)" }, kind: { type: "string", enum: ["tegning", "rapport", "plan", "saksdokument", "kulturminne", "figur", "notat"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]),
      description: "Full-text search in the document store: building-case drawings 2008–2026 (plans, sections, facades), the 2026 area plan for Bragernes sentrum vest and its reports (DIVE analysis, heritage, geotechnics, the high-rise report), heritage records and a research report. Returns documents with the pages that match and a snippet; read more with read_document. Scanned drawings have no text and are found by title only.",
      run: async a => { needDocs();
        const q = ftsQuery(a.query), lim = a.limit || 8;
        const hits = docs.prepare(`SELECT f.doc, f.n, bm25(fts, 4.0, 1.0) AS score FROM fts f JOIN docs d ON d.id = f.doc WHERE fts MATCH ? ${a.kind ? "AND d.kind = ?" : ""} ORDER BY score LIMIT 200`).all(...[q, a.kind].filter(Boolean));
        const by = new Map(); for (const h of hits) { if (!by.has(h.doc)) by.set(h.doc, []); by.get(h.doc).push(h.n); }
        const out = [...by].slice(0, lim).map(([id, ns]) => { const d = docRow(id), page = docs.prepare("SELECT text FROM pages WHERE doc=? AND n=?").get(id, ns[0]); return { ...docOut(d), matching_pages: ns.slice(0, 10), snippet: page?.text ? snippet(page.text, a.query) : null }; });
        return { query: a.query, documents: out, more: by.size > lim ? by.size - lim : 0 }; } },
    { name: "read_document", title: "Les et dokument", ro: true, schema: S({ doc_id: { type: "string", description: "Document id from search_documents or list_documents" }, from_page: { type: "integer", minimum: 1 }, pages: { type: "integer", minimum: 1, maximum: 10, description: "How many pages (default 3)" } }, ["doc_id"]),
      description: "The text of a document, a few pages at a time, with its download link. Drawings carry little text (title block, room names); scanned ones none: then give the person the link to open it.",
      run: async a => { needDocs();
        const d = docRow(a.doc_id); if (!d) throw toolErr(`No document "${a.doc_id}".`);
        const from = a.from_page || 1, n = a.pages || 3, rows = docs.prepare("SELECT n, text FROM pages WHERE doc=? AND n>=? AND n<? ORDER BY n").all(d.id, from, from + n);
        let budget = 24000; const pages = [];
        for (const r of rows) { const t = r.text.length > budget ? r.text.slice(0, budget) + " …[cut]" : r.text; budget -= t.length; pages.push({ page: r.n, text: t }); if (budget <= 0) break; }
        return { ...docOut(d), pages, next_page: from + pages.length <= d.pages ? from + pages.length : null }; } },
    { name: "list_documents", title: "Dokumentliste", ro: true, schema: S({ kind: { type: "string", enum: ["tegning", "rapport", "plan", "saksdokument", "kulturminne", "figur", "notat"] }, title_contains: { type: "string" } }),
      description: "The documents in the store by kind (drawings, reports, plan documents, case documents, heritage records, figures, notes), with year, page count and download link.",
      run: async a => { needDocs();
        const t = a.title_contains ? `%${String(a.title_contains).slice(0, 60)}%` : null;
        const rows = docs.prepare(`SELECT id, title, kind, year, file, pages, has_text, urls FROM docs WHERE 1=1 ${a.kind ? "AND kind=?" : ""} ${t ? "AND title LIKE ?" : ""} ORDER BY kind, year, title LIMIT 250`).all(...[a.kind, t].filter(Boolean));
        return { documents: rows.map(docOut) }; } },
    { name: "show_building", title: "Vis bygget", ro: true, ui: true, schema: S({
        storey: { ...STOREY, description: STOREY.description + ". Cuts every wing 1.2 m above that floor, as a plan is cut; leave out for the whole site" },
        wing: { ...WING, description: "Look at this wing and ring it in yellow" },
        mode: { type: "string", enum: ["3d", "plan", "tverrsnitt", "lengdesnitt"], description: "3d: tilted view (default). plan: straight down, north up, with scale bar. tverrsnitt / lengdesnitt: a section across or along the wing (needs wing) through its middle, looked at square on, with what the cut goes through filled black and the wing's storeys and kote on the right" },
        from_direction: { type: ["string", "number"], description: "Where the camera stands: N, NØ, Ø, SØ, S, SV, V, NV or degrees (3d)" },
        tilt_deg: { type: "number", minimum: 5, maximum: 85, description: "Camera angle above the ground (3d)" },
        distance_m: { type: "number", minimum: 30, maximum: 1200 },
        drawn_section: { type: "string", description: "A drawn section's id from about_wing (drawn_sections): the model cut where that sheet cuts, the sheet shown beside it" }, draft: DRAFT }),
      description: "Shows the hospital in 3D inside the chat: terrain, lot, the wings with their drawn facades and the operating module, and with a storey chosen every wing cut 1.2 m above that floor with the drawn walls and rooms (names and m² when zoomed in). Plan mode looks straight down like a drawing, with a scale bar; tverrsnitt and lengdesnitt cut one wing through its middle like a drawn section (outer walls are an assumed 0.35 m; inner walls only where a floor plan is drawn). With draft: the model with those tried changes. The person can turn, zoom and change storey; the app sends a small picture of the view back, so look at it before describing it. Needs a chat app that shows MCP Apps; otherwise give the link to the website.",
      run: async (a, req) => { const view = viewOf(a), w = view.wing && wingOf(site, view.wing);
        const text = `Sykehustomta: ${view.storey ? `${view.storey}, snitt 1,2 m over gulv` : "hele anlegget"}${w ? `, ${w.name}` : ""}, ${view.mode === "plan" ? "plan" : view.mode === "section" ? (view.section === "lengde" ? "lengdesnitt" : "tverrsnitt") : "3D"}${view.draft ? `, utkast ${view.draft}` : ""}. The picture is in the app; it sends back an image of the view. On the web: ${originOf(req)}/${view.draft ? `?utkast=${view.draft}` : ""}`;
        return { _result: { content: [{ type: "text", text }], structuredContent: { app: "sykehus", view } } }; } },
  ];
  const BY = Object.fromEntries(TOOLS.map(t => [t.name, t]));
  const toolList = () => TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.schema,
    annotations: { title: t.title, readOnlyHint: !!t.ro, destructiveHint: false, idempotentHint: !!t.ro, openWorldHint: false },
    ...(t.ui ? { _meta: { ui: { resourceUri: APP_URI, visibility: ["model", "app"] } } } : {}) }));

  // ---------- JSON-RPC ----------
  const CACHE = { ttlMs: 3600e3, cacheScope: "public" };   // 2026-07-28 CacheableResult: lists and the app change only with a deploy
  async function rpc(req, msg) {
    const { method, params = {} } = msg;
    const caps = { tools: { listChanged: false }, resources: {}, extensions: { [M("ui")]: { mimeTypes: ["text/html;profile=mcp-app"] } } };
    /* 2026-07-28: the version comes with every request; a version we do not speak is an error, none means an older client */
    const asked = params._meta?.[M("protocolVersion")];
    if (asked && !VERSIONS.includes(asked)) throw Object.assign(err(-32022, `Unsupported protocol version ${asked}`), { data: { supported: VERSIONS } });
    switch (method) {
      case "initialize": return { protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1], capabilities: caps, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
      case "server/discover": return { supportedVersions: VERSIONS, capabilities: caps, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
      case "ping": return {};
      case "tools/list": return { tools: toolList(), ...CACHE };
      case "resources/list": return { resources: [{ uri: APP_URI, name: "Sykehustomta 3D", title: "Sykehustomta: bygget i 3D og plan", mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: appCsp(originOf(req)), prefersBorder: true } } }], ...CACHE };
      case "resources/read": {
        if (params.uri !== APP_URI) throw err(-32602, `Unknown resource: ${params.uri}`);
        const o = originOf(req); return { contents: [{ uri: APP_URI, mimeType: "text/html;profile=mcp-app", text: appHtml(o), _meta: { ui: { csp: appCsp(o), prefersBorder: true } } }], ...CACHE };
      }
      case "resources/templates/list": return { resourceTemplates: [], ...CACHE };
      case "prompts/list": return { prompts: [{ name: "start", title: "Start med bygget", description: "Get an overview of the old hospital, its wings and its documents" }], ...CACHE };
      case "prompts/get": return { description: "Start", messages: [{ role: "user", content: { type: "text", text: "Gi meg en oversikt over gamle Drammen sykehus: fløyene, etasjene vi har tegninger av, og hvilke dokumenter som finnes. Vis anlegget i 3D." } }] };
      case "tools/call": {
        const t = BY[params.name]; if (!t) throw err(-32602, `Unknown tool: ${params.name}`);
        try {
          bump("open", 3000, 3600e3);
          const out = await t.run(params.arguments || {}, req);
          if (out?._result) return out._result;
          return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
        } catch (e) {
          if (e.tool) return { content: [{ type: "text", text: e.message }], isError: true };
          throw e;
        }
      }
      default:
        if (method?.startsWith("notifications/")) return undefined;
        throw err(-32601, `Method not found: ${method}`);
    }
  }
  async function handleMcp(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" }, { allow: "POST" });
    const origin = req.headers.origin;
    if (origin && !/^https:\/\//.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: "Bad origin" });
    let body; try { body = await readJson(req, 2e5); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    /* 2026-07-28 routing headers: when sent they must match the body (HeaderMismatch) */
    const hm = req.headers["mcp-method"], hn = req.headers["mcp-name"];
    if (!Array.isArray(body) && ((hm && hm !== body.method) || (hn && hn !== (body.params?.name ?? body.params?.uri))))
      return send(res, 400, { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32020, message: "Mcp-Method or Mcp-Name header does not match the body" } });
    const msgs = Array.isArray(body) ? body : [body], out = [];
    for (const m of msgs) {
      if (m?.jsonrpc !== "2.0" || typeof m.method !== "string") { out.push({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32600, message: "Invalid request" } }); continue; }
      try {
        const result = await rpc(req, m);
        /* 2026-07-28 requires resultType on every result; older clients ignore it */
        if (m.id !== undefined && m.id !== null) out.push({ jsonrpc: "2.0", id: m.id, result: result && typeof result === "object"
          ? { resultType: "complete", ...result, _meta: { ...(result._meta || {}), [M("serverInfo")]: SERVER_INFO } } : result });
      } catch (e) {
        console.error("mcp", m.method, m.params?.name || "", e.message);
        const known = Number.isInteger(e.code) && e.code < 0;
        out.push({ jsonrpc: "2.0", id: m.id ?? null, error: { code: known ? e.code : -32603, message: known ? e.message : "Internal error", ...(known && e.data ? { data: e.data } : {}) } });
      }
    }
    if (!out.length) { res.writeHead(202, SECURITY); return res.end(); }
    return send(res, 200, Array.isArray(body) ? out : out[0]);
  }
  /* GET /api/utkast/<id>: the page's ?utkast=<id> lays these over the data it loads (public/edits.js) */
  function handleDraft(req, res, id) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const open = { "access-control-allow-origin": "*" };   // the chat app reads it from the host's frame
    try { const d = draftOf(id); return send(res, 200, { draft: d.id, edits: d.edits, saved: false }, open); }
    catch { return send(res, 404, { error: "Utkastet finnes ikke (de varer et døgn)." }, open); }
  }
  return { handleMcp, handleDraft, TOOLS };
}
