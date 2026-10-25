// Sykehustomta as an MCP server (Model Context Protocol), so Claude and other chat apps can use it: the documents, the
// floors and rooms, and the building in 3D inside the chat (an MCP App). No dependencies: JSON-RPC over Streamable
// HTTP (JSON answers only). The JSON-RPC handling follows hagekart's mcp.mjs (2026-10-24): looking and trying (drafts)
// are open to everyone; keeping a version (versions.mjs) needs a login (auth.mjs: gulden.no in front, a personal
// token, or OAuth for claude.ai), and a tool that keeps one answers 401 with the sign-in challenge without it.
//
//   POST /mcp     JSON-RPC: initialize, tools/list, tools/call, resources/read ...
import { randomBytes } from "node:crypto";
import { SCOPE } from "./auth.mjs";
import { wingOf, checkEdit, applyEdits } from "./public/edits.js";
import { MAX_EDITS as MAX_VERSION_EDITS, SHARING } from "./versions.mjs";
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseIfc, withoutBuildings } from "./ifcfilter.mjs";
import { picture, aimAt, VIEWS } from "./public/renderkit/look.js";   // renderkit (U3559)
import { fitOf } from "./public/design.js";

/* MCP 2026-07-28 (stateless: each request names its version in _meta, server/discover instead of the handshake),
   and the older revisions' initialize for clients that still send it. MCP Apps 2026-01-26 (io.modelcontextprotocol/ui). */
const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const M = k => `io.modelcontextprotocol/${k}`;
const SERVER_INFO = { name: "sykehus", title: "Sykehustomta", version: "0.2.0" };
const INSTRUCTIONS = "Sykehustomta is the old Drammen sykehus (Dronninggata 28, 3019 Drammen, gnr. 114 bnr. 272) for an architect working on reusing the existing buildings. "
  + "The hospital is described as its wings (about_site, about_wing): each with years, storeys and their kote per wing (storeys), drawn floor plans with rooms and areas (floor_plan), and windows from the drawn facades (openings). "
  + "A store of about 200 documents (building-case drawings, sections, facades, the 2026 area plan and its reports, heritage records) is searchable (search_documents, read_document). show_building shows the hospital in 3D or plan in the chat. "
  + "Changes go through try_change; the shared model, the before, is never changed. Every tool that reads or changes the after takes one target: a version id (v and 8 more) or a draft id (8); leave it out for the version the person has open on the website (signed in, their «Mitt etter»): that is nearly always right. "
  + "Tell the person only what a tool result shows: a change is made only when it is in the result's added and the result names the version it went into; when it is rejected or refused, say so and what you do next. "
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

export function createMcp({ site, floors, sections = [], docs, docUrl, SECURITY, readJson, versions = null, auth = null, wishes = null, pages }) {
  /* who is asking (auth.mjs): a login name, or null; looking and trying need none */
  const userOf = req => auth?.userOf(req) ?? null;
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

  // ---------- drafts: changes tried on the model, kept a day from their last change, never written to the data ----------
  /* kept on disk too (U3555, Morten 20:18Z «everything should be autosaved»): a file a draft in
     SYKEHUS_VERSIONS_DIR/utkast, written whole and renamed over, read back at start, so a restart keeps them */
  const drafts = new Map(), DRAFT_MS = 24 * 3600e3, MAX_DRAFTS = 500, MAX_EDITS = 200, DID = /^[A-Za-z0-9_-]{8}$/;
  const ddir = process.env.SYKEHUS_VERSIONS_DIR ? join(process.env.SYKEHUS_VERSIONS_DIR, "utkast") : null;
  if (ddir) { mkdirSync(ddir, { recursive: true }); for (const f of readdirSync(ddir)) { if (!f.endsWith(".json") || !DID.test(f.slice(0, -5))) continue;
    try { const d = JSON.parse(readFileSync(join(ddir, f), "utf8")); if (d.id === f.slice(0, -5) && Date.now() - d.t <= DRAFT_MS && Array.isArray(d.edits)) drafts.set(d.id, d); else unlinkSync(join(ddir, f)); } catch (e) { console.error("drafts: skipping", f, e.message); } } }
  const keepDraft = d => { if (!ddir) return; const p = join(ddir, d.id + ".json"); try { writeFileSync(p + ".tmp", JSON.stringify(d)); renameSync(p + ".tmp", p); } catch (e) { console.error("drafts: write", e.message); } };
  const dropDraft = id => { drafts.delete(String(id)); if (ddir && DID.test(String(id))) try { unlinkSync(join(ddir, id + ".json")); } catch { } };
  const newId = () => randomBytes(6).toString("base64url");
  /* signed in, the person's work is one private version (U3555), marked work; made on the first change */
  const workOf = me => { const v = versions.list({ owner: me, viewer: me }).find(x => x.work); if (v) return v;
    const n = versions.create(me, "Mitt etter"); n.work = true; return versions.save(n); };
  /* where a signed-in person's change goes when none is named: the version their page has open (assistant.mjs tells
     pages.open with each turn), if it is theirs, else their work (Morten 20:34Z: Anton's change went into a new
     version and the open page never changed) */
  const openOf = me => { const v = versions?.get(pages?.open.get(me)); return v && v.owner === me ? v : workOf(me); };
  const draftOf = id => { const d = drafts.get(String(id)); if (!d || Date.now() - d.t > DRAFT_MS) { dropDraft(id); throw toolErr(`No draft "${id}" (drafts last a day). Start a new one with try_change.`); } return d; };
  const draftUrl = (o, id) => `${o}/?utkast=${id}`;
  /* a version (versions.mjs) by its id, for anyone to look at; and one to change, for its owner only */
  const versionOf = (id, req) => { const v = versions?.get(id); if (!v || (req && !versions.visible(v, userOf(req)))) throw toolErr(versions ? `No version "${id}" that you can see (a private version opens for its owner only). list_versions shows them.` : "Versions are not kept on this server."); return v; };
  const ownVersion = (id, req) => {
    const who = userOf(req); if (!who) throw toolErr("Å lagre en versjon krever innlogging: på sykehus.gulden.no via gulden.no, eller med et personlig token i MCP-klienten. Utkast (try_change uten version) virker uten.");
    const v = versionOf(id, req); if (v.owner !== who) throw toolErr(`Versjonen «${v.title}» er ${v.owner} sin; lag din egen med new_version (from: "${v.id}").`); return v;
  };
  /* its link as the asker may give it: plain when public; the share link when link-only; the owner's own when private */
  const SHARE_NOTE = { privat: "Privat: bare du ser den. Lenken er din egen; ikke del den. Endre med set_sharing.", lenke: "Bare de med lenken ser den; den står ikke i lista.", offentlig: "Offentlig: står i lista på forsiden og åpner for alle." };
  const versionOut = (v, o, req) => { const mine = !!req && userOf(req) === v.owner, k = v.sharing === "offentlig" ? null : v.sharing === "lenke" ? v.key : mine ? v.own : null;
    return { version: v.id, title: v.title, owner: v.owner, sharing: v.sharing, changes: v.edits.length, updated: v.updated,
      link: `${o}/?versjon=${v.id}${k ? `&nokkel=${k}` : ""}`, ...(mine ? { note: SHARE_NOTE[v.sharing] } : {}) }; };
  /* a draft's or a version's changes (version ids are v and 8 more, a draft's 8 in all) */
  /* a draft's or a version's changes (version ids are v and 8 more, a draft's 8 in all); a version only for who may see it */
  const editsOf = (id, req) => /^v.{8}$/.test(String(id)) ? versionOf(id, req).edits : draftOf(id).edits;
  const model = (id, req) => id ? applyEdits(site, floors, editsOf(id, req)) : { site, floors, notes: [], changed: [] };

  // ---------- the picture ----------
  const APP_URI = "ui://sykehus/bygget";
  const viewOf = (a, req) => {
    const v = {};
    if (a.storey) { const n = storeyName(a.storey); if (!floors.some(f => f.name === n) && !wingsAll().some(w => (w.levels || []).some(l => l.name === n))) throw toolErr(`No storey "${a.storey}".`); v.storey = n; }
    if (a.wing) { const w = wingOrErr(a.wing); v.wing = w.id; v.building = piecesOf(w.id)[0]?.id; }
    if (a.mode === "plan" || a.mode === "3d") v.mode = a.mode;
    if (a.drawn_section) {
      const d = sections.find(x => x.id === a.drawn_section); if (!d) throw toolErr(`No drawn section "${a.drawn_section}". Drawn sections: ${sections.map(x => x.id).join(", ")} (about_wing lists them).`);
      const w = wingOrErr(d.wing); Object.assign(v, { wing: w.id, building: piecesOf(w.id)[0]?.id, mode: "section", section: d.kind, drawn: d.id }); delete v.storey; return v;
    }
    if (a.mode === "fasade") {
      if (!v.wing) throw toolErr("A facade needs wing: the wing to look at.");
      const deg = a.from_direction != null ? dirDeg(a.from_direction) : 0, side = ["N", "Ø", "S", "V"][Math.round(((deg % 360) + 360) % 360 / 90) % 4];
      Object.assign(v, { mode: "section", section: "fasade", side }); delete v.storey; delete v.yaw; return v;
    }
    if (a.mode === "tverrsnitt" || a.mode === "lengdesnitt") {
      if (!v.wing) throw toolErr("A section needs wing: the wing to cut through.");
      v.mode = "section"; v.section = a.mode === "lengdesnitt" ? "lengde" : "tverr"; delete v.storey;
    }
    if (a.from_direction != null) v.yaw = Math.PI - dirDeg(a.from_direction) * Math.PI / 180;
    if (a.tilt_deg != null) v.pitch = clamp(+a.tilt_deg, 5, 85) * Math.PI / 180;
    if (a.distance_m != null) v.dist = clamp(+a.distance_m, 30, 1200);
    if (a.draft) { editsOf(a.draft, req); v.draft = String(a.draft); const ver = versions?.get(a.draft); if (ver && ver.sharing !== "offentlig") v.key = ver.sharing === "lenke" ? ver.key : ver.own; }   // the asker may see it: the app in their chat opens it with its key
    return v;
  };
  const appCsp = origin => ({ connectDomains: [origin], resourceDomains: [origin], baseUriDomains: [origin] });
  const appHtml = origin => `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${origin}/"><title>Sykehustomta</title></head><body><script type="module" src="${origin}/mcp-app.js"></script></body></html>`;

  // ---------- tools ----------
  const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
  const WING = { type: "string", description: `Wing name or id: ${wingsAll().map(w => `${w.name} (${w.id})`).join(", ")}` };
  const STOREY = { type: "string", description: "Storey as the hospital numbers them across wings: 1 … 14 or \"5. etasje\"" };
  /* one target for every tool (Morten 21:08Z «make sure to use best practices»; the toolkit audit: one id field, the
     server resolves it, so the model never picks between two): a version id, a draft id, or none for the version the
     person has open. draft and version are its older names, kept while chat clients still hold the old schemas
     (2026-10-25 21:05Z: Anton put a version id in draft and two of Morten's changes were lost) */
  const TARGET = { type: "string", description: "Which after: a version id (v and 8 more, from list_versions or a result) or a draft id (8, from try_change). Leave it out for the version the person has open on the website (signed in: their «Mitt etter»), which is nearly always right" };
  const OLD = { type: "string", description: "Older name for target; use target" };
  const DRAFT = TARGET, T_ = { target: TARGET, draft: OLD };
  const POINTS = { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, maxItems: 200 };
  /* one schema per kind (the toolkit audit: a call is checked against its own kind's fields before it is sent) */
  const PT = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[east_m, north_m] from the site origin" };
  const WHY = { type: "string", description: "Where it comes from: a drawing and page, a measurement, the person's wish, the architect's judgement" };
  const K = (kind, about, props, required = []) => ({ type: "object", description: about, properties: { kind: { const: kind }, ...props, why: WHY }, required: ["kind", ...required], additionalProperties: false });
  const FACTS = { storeys: { type: "integer", minimum: 1, maximum: 30, description: "Storeys; the height then defaults to 3.2 m each" }, use: { type: "string" }, built: { type: "string" }, note: { type: "string" } };
  const SHAPE = { type: "string", enum: ["box", "gable", "triangle", "lean_to", "pyramid", "terraces"], description: "box; gable (walls wall_height high and a ridge along from -> to); triangle (an A frame: two slopes from the ridge to the ground, NOT a pyramid); lean_to (one slope); pyramid (four sloping faces to one point over the middle); terraces (steps one on another, each step_depth narrower, flush at the back on high_side: stepped terraces, not balconies)" };
  const EDIT = { description: "One change; its kind picks its fields. Site positions are metres east and north of the site origin; about_wing gives a wing's footprint and kote.", anyOf: [
    K("level", "A storey's floor kote in a wing", { wing: WING, storey: STOREY, kote: { type: "number" } }, ["wing", "storey", "kote"]),
    K("wing", "A fact on a wing's card", { wing: WING, field: { type: "string", enum: ["name", "built", "storeys", "use", "construction", "facade", "note"] }, value: { type: "string" } }, ["wing", "field", "value"]),
    K("room", "A room's name, use or area", { storey: STOREY, room: { type: "string", description: "Its code or name" }, set: { type: "object", properties: { name: { type: "string" }, use: { type: "string" }, area_m2: { type: "number" } }, additionalProperties: false } }, ["storey", "room", "set"]),
    K("note", "A note on the model", { text: { type: "string" }, wing: WING, storey: STOREY, at: PT }, ["text"]),
    K("demolish", "Tear down: a wing, a building id, a new building's id, or \"alle\" for every hospital building (then restore the ones to keep)", { building: { type: "string" } }, ["building"]),
    K("restore", "Put back what a demolish took", { building: { type: "string" } }, ["building"]),
    K("balconies", "Balconies on a wing's facades facing side (within 45°)", { wing: WING, side: { type: "string", enum: ["N", "Ø", "S", "V"] }, from_storey: STOREY, to_storey: STOREY, depth: { type: "number", minimum: 0.8, maximum: 4, description: "m out, default 1.8" }, bay: { type: "number", description: "m wide each, else along the whole wall" }, gap: { type: "number", description: "m between bays, default 0.6" }, railing: { type: "string", enum: ["glass", "steel", "concrete"] } }, ["wing", "side"]),
    K("volume", "A new building or structure over its middle or ridge line from -> to", { name: { type: "string" }, shape: SHAPE, from: PT, to: PT, width: { type: "number", minimum: 1, maximum: 120, description: "m across the line" }, height: { type: "number", minimum: 1, maximum: 80, description: "m from its foot to the top" },
      wall_height: { type: "number", description: "gable, lean_to: the low eaves" }, high_side: { type: "string", enum: ["left", "right"], description: "lean_to: the high side; terraces: the back, where the steps are flush (walking from -> to)" },
      steps: { type: "integer", minimum: 2, maximum: 10, description: "terraces: how many (default 3)" }, step_depth: { type: "number", minimum: 0.5, maximum: 20, description: "terraces: m each step is narrower than the one under it (default 3)" },
      on: { type: "string", description: "A wing (id or name) whose roof it stands on: its foot is that roof's kote under its middle (a roof garden, a greenhouse on a roof)" },
      base_kote: { type: "number", description: "Its foot's kote; default the lowest ground under it (leave out with on)" }, material: { type: "string", enum: ["glass", "concrete", "steel", "wood", "brick"], description: "glass = a greenhouse" },
      id: { type: "string", description: "n and 4-12 letters/digits, to name it later" }, ...FACTS }, ["from", "to", "width"]),
    K("reshape", "Change a new building: rename, re-fact, move or resize it", { id: { type: "string", description: "Its id, from show_draft's after.built or fit" }, name: { type: "string" }, from: PT, to: PT, width: { type: "number" }, height: { type: "number" }, ...FACTS }, ["id"]),
    K("surface", "A surface on the ground", { ring: POINTS, surface: { type: "string", enum: ["grass", "meadow", "planting", "gravel", "paving", "asphalt", "water"] }, name: { type: "string" }, plants: { type: "array", items: { type: "string" }, maxItems: 30, description: "hagekart ids or Latin names, for a bed" } }, ["ring", "surface"]),
    K("path", "A path", { line: POINTS, width: { type: "number", description: "m, default 2" }, surface: { type: "string", enum: ["gravel", "paving", "asphalt", "wood"] }, name: { type: "string" } }, ["line"]),
    K("trees", "Trees planted (hagekart's species; check_species first: banned species are refused)", { species: { type: "string" }, points: POINTS, line: POINTS, spacing: { type: "number", description: "m along line, default 8" }, height: { type: "number" }, crown: { type: "number", description: "m wide" } }, ["species"]),
    K("fell", "Take down today's trees inside a ring", { ring: POINTS }, ["ring"]),
  ] };
  /* what a draft builds and takes away, without the geometry: for the agent to report back */
  const afterOf = m => (m.site.demolished || m.site.added || m.site.landscape) ? { demolished: (m.site.demolished || []).map(d => ({ name: d.name, footprint_m2: d.footprint_m2, gross_volume_m3: d.gross_volume_m3 })),
    demolished_gross_volume_m3: (m.site.demolished || []).reduce((a, d) => a + (d.gross_volume_m3 || 0), 0),
    built: (m.site.added || []).map(({ parts, ...a }) => a),
    ...(m.site.landscape ? { ground: m.site.landscape.map(({ ring, line, ...g }) => g), planted: m.site.planted, trees_felled: m.site.felled } : {}) } : null;
  const isVid = id => /^v.{8}$/.test(String(id ?? ""));
  /* the version the person has open on the website (assistant.mjs pages.open), else their work; none signed out */
  const openFor = req => { const who = userOf(req); if (!who || !versions) return null; const v = versions.get(pages?.open.get(who)); return v && v.owner === who ? v : versions.list({ owner: who, viewer: who }).find(x => x.work) || null; };
  const openHint = req => { const v = openFor(req); return v ? `Utelat target for versjonen personen har åpen, «${v.title}» (${v.id}).` : userOf(req) ? "Utelat target for versjonen personen har åpen." : "Utelat target for dagens modell, eller start et utkast med try_change."; };
  /* target (or its older names) to what each tool's run reads: read tools and undo_change draft (a draft or a version
     id), try_change version or draft, the version tools version. Checked here, at the boundary, with an error that
     says what to do: never a bare «No draft» (21:05Z) */
  function resolveTarget(t, a, req) {
    if (!t.tgt) return a;
    const { target, draft, version, ...rest } = a, given = [target, draft, version].find(x => x != null && String(x).trim() !== "");
    let id = given == null ? null : String(given).trim();
    if (id == null && t.tgt !== "write") id = openFor(req)?.id ?? null;   // try_change finds its own (openOf, or a new draft)
    if (id == null) { if (t.tgt === "version") throw toolErr(`Hvilken versjon? ${openHint(req)}`); if (t.tgt === "draft") throw toolErr(`Hvilket utkast eller hvilken versjon? ${openHint(req)}`); return rest; }
    if (isVid(id)) {
      const v = versions?.get(id), who = userOf(req);
      if (!v || !versions.visible(v, who)) throw toolErr(`Fant ingen versjon «${id}» du kan se (en privat versjon åpner bare for eieren; list_versions viser dem). ${openHint(req)}`);
      if ((t.tgt === "write" || t.tgt === "draft" || t.tgt === "version") && v.owner !== who) throw toolErr(`«${v.title}» (${id}) er ${v.owner} sin; endringer går bare inn i egne versjoner. ${openHint(req)} Eller lag en egen kopi med new_version (from: "${id}").`);
      return t.tgt === "write" || t.tgt === "version" ? { ...rest, version: id } : { ...rest, draft: id };
    }
    if (t.tgt === "version") throw toolErr(`«${id}» er et utkast, ikke en lagret versjon. Lagre det med new_version (from: "${id}"). ${openHint(req)}`);
    const d = drafts.get(id); if (!DID.test(id) || !d || Date.now() - d.t > DRAFT_MS) throw toolErr(`Fant ikke utkastet «${id}» (utkast varer et døgn; en lagret versjon begynner med v). ${openHint(req)}`);
    return { ...rest, draft: id };
  }
  /* each change's own fields, before it is checked (the toolkit audit: refuse at the boundary, naming what is missing) */
  function fieldsOf(e) {
    const k = EDIT.anyOf.find(x => x.properties.kind.const === e?.kind);
    if (!k) return `kind «${e?.kind}» finnes ikke; kind er en av ${EDIT.anyOf.map(x => x.properties.kind.const).join(", ")}`;
    const miss = k.required.filter(f => e[f] == null || e[f] === ""), extra = Object.keys(e).filter(f => !(f in k.properties));
    if (miss.length) return `${e.kind} mangler ${miss.join(", ")} (${e.kind} tar ${Object.keys(k.properties).filter(f => f !== "kind").join(", ")})`;
    if (extra.length) return `${e.kind} tar ikke ${extra.join(", ")} (${e.kind} tar ${Object.keys(k.properties).filter(f => f !== "kind").join(", ")})`;
    return null;
  }
  const VIEW_NAME = { type: "string", enum: Object.keys(VIEWS), description: "isometrisk (from the south-west, from above; default), plan (straight down, north up), N / Ø / S / V (from that side, low), NØ / SØ / SV / NV (from that corner, higher)" };
  /* a picture of a model (render.mjs) and what it shows, in words */
  const hospital = (() => { const ps = site.buildings.filter(b => b.own).flatMap(b => b.ring); return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length, 25]; })();
  async function look(s, a = {}) {
    const name = VIEWS[a.view_name] ? a.view_name : "isometrisk", v = { ...VIEWS[name] }, f = a.focus ? aimAt(s, a.focus) : null;
    if (a.focus && !f) throw toolErr(`Fant ikke «${a.focus}» å se på: en fløy, en bygnings id eller et nytt bygg (id eller navn).`);
    if (a.from_direction != null) { v.from = dirDeg(a.from_direction); if (v.plan) delete v.plan; v.tilt ??= 30; }
    if (a.tilt_deg != null && !v.plan) v.tilt = a.tilt_deg;
    const dist = a.distance_m ?? (f ? Math.max(50, f.size * 2.6) : v.plan ? 220 : 330);
    const png = await picture(s, { ...v, target: f ? f.target : hospital, dist, focus: f ? f.ids : [], width: a.width || 1024, height: a.height || 640 });
    const deg = v.from ?? 0, side = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    return { png, text: `Bildet: ${v.plan ? "plan, rett ovenfra, nord opp" : `sett fra ${side}, ${Math.round(v.tilt)}° over bakken`}, ${Math.round(dist)} m unna${f ? `, ${f.name} i oransje` : ""}. Nordpilen øverst til høyre.` };
  }
  const TOOLS = [
    { name: "about_site", tgt: "read", title: "Tomta og fløyene", ro: true, schema: S({ target: TARGET, draft: OLD }),
      description: "The site and the hospital as its wings (Sentralblokka, Østfløy, Østre nordfløy, Midtfløy …): each wing's years, storeys, construction, facade, footprint and kote from ground to roof, how sure the identification is, the storeys that have a drawn plan, and where the facts come from. Positions are metres east and north of the site origin (EPSG:25833), heights NN2000.",
      run: async (a, req) => { const m = model(a.draft, req), names = [...new Set(m.floors.map(f => f.name))];
        return { name: site.name, address: "Dronninggata 28, 3019 Drammen", gnr_bnr: "114/272", lot_area_m2: site.lot.area_m2, heights: "NN2000", origin_utm33: site.origin,
          wings: (m.site.wings || []).map(w => { const o = wingOut(w, false); return { id: o.id, name: o.name, sure: o.sure, built: o.built, storeys: o.storeys, footprint_m2: o.footprint_m2, ground_kote: o.ground_kote, top_kote: o.top_kote, levels_known: o.levels.length }; }),
          drawn_storeys: names.map(n => ({ storey: n, sheets: m.floors.filter(f => f.name === n).map(f => f.source) })),
          bim: "Last ned som BIM-modell: /data/sykehus.ifc (IFC4, FreeCAD/Revit/Solibri)", sources: site.sources, documents: docs ? docs.prepare("SELECT COUNT(*) n FROM docs").get().n : 0,
          ...(a.draft ? { draft: a.draft, notes: m.notes } : {}) }; } },
    { name: "about_wing", tgt: "read", title: "Én fløy", ro: true, schema: S({ wing: WING, target: TARGET, draft: OLD }, ["wing"]),
      description: "One wing as on its card: names and aliases, years built, storeys, construction, facade, footprint, ground and roof kote, each storey's kote with how it is known (tegning = read off a drawing, beregnet = worked out, antatt = assumed) and its source, the storeys with a drawn plan, its drawn facades, and the documents it is identified from, with download links.",
      run: async (a, req) => { const m = model(a.draft, req), w = wingOf(m.site, a.wing) || wingOrErr(a.wing); return { ...wingOut(w, true), ...(a.draft ? { draft: a.draft, notes: m.notes.filter(n => n.wing === w.id) } : {}) }; } },
    { name: "storeys", tgt: "read", title: "Etasjene", ro: true, schema: S({ wing: { ...WING, description: WING.description + ". Leave out for all wings" }, target: TARGET, draft: OLD }),
      description: "The storey ladder: for each storey (1 … 14) the kote in every wing that has it, how each is known and from where, and which sheets draw that storey. The wings' floors do not line up exactly (Sentralblokka 5. etasje +31,77, Østfløy +32,02).",
      run: async (a, req) => { const m = model(a.draft, req), ws = a.wing ? [wingOf(m.site, a.wing) || wingOrErr(a.wing)] : m.site.wings || [];
        const names = [...new Set([...ws.flatMap(w => (w.levels || []).map(l => l.name)), ...m.floors.map(f => f.name)])].sort((x, y) => parseInt(x) - parseInt(y));
        return { storeys: names.map(n => ({ storey: n, wings: ws.map(w => [w, (w.levels || []).find(l => l.name === n)]).filter(r => r[1]).map(([w, l]) => ({ wing: w.name, kote: l.kote, how: l.how, source: l.src })),
          sheets: m.floors.filter(f => f.name === n).map(f => ({ sheet: f.source, drawn_kote: f.kote, storey_height_m: f.height })) })).filter(s => s.wings.length || s.sheets.length) }; } },
    { name: "floor_plan", tgt: "read", title: "Én etasje: rom og arealer", ro: true, schema: S({ storey: STOREY, wing: { ...WING, description: "Only this wing" }, name_contains: { type: "string", description: "Only rooms whose name has this, e.g. operasjon, lager, wc" }, target: TARGET, draft: OLD }, ["storey"]),
      description: "The rooms of one storey from its drawn plans, across the wings: name, room code, the wing it stands in, the area the architect wrote on the drawing (area_m2, net) and the area measured between the drawn walls (area_measured_m2, about 15 % rough; given where an outline closes), position (metres east/north of the site origin) and the sheet. Sums per wing. Many sheets name rooms without areas.",
      run: async (a, req) => { const m = model(a.draft, req), n = storeyName(a.storey), fs = m.floors.filter(f => f.name === n);
        if (!fs.length) throw toolErr(`No drawn plan of "${n}". Drawn: ${[...new Set(floors.map(f => f.name))].join(", ")}.`);
        const w = a.wing ? wingOrErr(a.wing).id : null, q = a.name_contains ? fold(a.name_contains) : null;
        const rooms = fs.flatMap(f => (f.rooms || []).map(r => roomOut(f, r))).filter(r => (!w || r.wing === w) && (!q || fold(r.name).includes(q)));
        const per = {}; for (const r of rooms) { const k = r.wing || "utenfor fløyene"; per[k] ||= { rooms: 0, stamped_m2: 0, measured_m2: 0 }; per[k].rooms++; per[k].stamped_m2 += r.area_m2 || 0; per[k].measured_m2 += r.area_m2 ? 0 : r.area_measured_m2 || 0; }
        for (const v of Object.values(per)) { v.stamped_m2 = round1(v.stamped_m2); v.measured_m2 = round1(v.measured_m2); }
        return { storey: n, sheets: fs.map(f => ({ sheet: f.source, kote: f.kote, storey_height_m: f.height, walls: f.walls.length })), per_wing: per, rooms }; } },
    { name: "openings", title: "Vinduer og dører i en fasade", ro: true, schema: S({ wing: WING }, ["wing"]),
      description: "The windows, doors and glazing read from a wing's drawn facades: per facade, how many of each kind per storey band, and each opening's position along the wall (metres from the left end as one stands outside) and kote of sill and head, with the sheet.",
      run: async (a, req) => { const w = wingOrErr(a.wing), fs = (site.facades || []).filter(f => f.building === w.id);
        if (!fs.length) throw toolErr(`No drawn facade for ${w.name} yet. Drawn: ${[...new Set((site.facades || []).map(f => f.building))].join(", ")}.`);
        const lv = (w.levels || []).slice().sort((x, y) => x.kote - y.kote), band = z => [...lv].reverse().find(l => l.kote <= z + 0.3)?.name || "under laveste etasje";
        return { wing: w.name, facades: fs.map(f => { const per = {}; for (const o of f.openings) { const k = band(o.z[0]); per[k] ||= {}; per[k][o.kind] = (per[k][o.kind] || 0) + 1; }
          return { id: f.id, name: f.name, wall_length_m: round1(Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1])), per_storey: per,
            openings: f.openings.map(o => ({ kind: o.kind, along_m: o.u.map(round1), sill_kote: round1(o.z[0]), head_kote: round1(o.z[1]), panes: o.panes.length })), sheet: f.src.map(docRef) }; }) }; } },
    /* documents: see below */
    { name: "try_change", tgt: "write", title: "Prøv en endring", writeIf: a => !!a.version, schema: S({ edits: { type: "array", items: EDIT, minItems: 1, maxItems: 50 }, target: { ...TARGET, description: TARGET.description + ". Signed out with none open: a new draft (a day, no login)" }, draft: OLD, version: OLD,
      include_screenshot: { type: "boolean", description: "A picture of the model after the change comes back (default true). false for the middle steps of a sequence; look at the last one" },
      view_name: VIEW_NAME }, ["edits"]),
      description: "Tries changes on the model: a storey's kote in a wing, a fact on a wing's card, a room's name, use or area, a note, and the after: demolish or restore buildings, balconies on a wing, a new volume such as a greenhouse, and the ground: surfaces, paths, trees (hagekart's species) and felling. Each is checked; those that pass go into the target. Leave target out: signed in, the changes go into the version the person has open on the website (their «Mitt etter») and their page redraws with them; signed out, into a draft that lasts a day. The result names where they went (version or draft), how many changes it now has and its link: report from that. The before, the shared model, is never changed. Say where each change comes from in why. " +
        "The result has a picture of the model after it (a plain massing drawing: new buildings in their material's colour, the newest picked out in orange, a north arrow top right) and fit: for each new building what its foot stands on (the ground, a roof, nothing = it floats, or buried), the ground under it, the wings it overlaps (m²) and the nearest gap. Look at both before you tell the person what you made: say what you see, and if it is wrong (it floats, cuts into a wing, stands on the wrong side, is not the shape asked for), fix it with another try_change (reshape, or demolish its id and build it again) before you answer. look gives other views.",
      run: async (a, req) => {
        let d, v = null;
        if (!a.version && !a.draft && versions && userOf(req)) a = { ...a, version: openOf(userOf(req)).id };
        if (a.version) { v = ownVersion(a.version, req); d = { edits: v.edits }; }
        else if (a.draft) d = draftOf(a.draft); else { if (drafts.size >= MAX_DRAFTS) for (const [k, x] of drafts) if (Date.now() - x.t > DRAFT_MS || drafts.size >= MAX_DRAFTS) dropDraft(k); d = { id: newId(), t: Date.now(), edits: [] }; drafts.set(d.id, d); }
        const ok = [], bad = [], max = v ? MAX_VERSION_EDITS : MAX_EDITS;
        for (const [i, e] of a.edits.entries()) { try { const f = fieldsOf(e); if (f) throw new Error(f); const m = applyEdits(site, floors, d.edits), c = checkEdit(m.site, m.floors, e); if (d.edits.length >= max) throw new Error(`At most ${max} changes`); d.edits.push(c); ok.push(c); } catch (x) { bad.push({ index: i, error: x.message }); } }
        const m = applyEdits(site, floors, d.edits), after = afterOf(m), fit = fitOf(m.site);
        let out;
        if (v) { if (ok.length) versions.save(v); out = { ...versionOut(v, originOf(req), req), added: ok, rejected: bad, ...(after ? { after } : {}), ...(fit.length ? { fit } : {}), saved: true }; }
        else { d.t = Date.now(); keepDraft(d);
          out = { draft: d.id, link: draftUrl(originOf(req), d.id), added: ok, rejected: bad, changes_in_draft: d.edits.length, ...(after ? { after } : {}), ...(fit.length ? { fit } : {}), saved: false,
            note: "Ikke lagret: utkastet varer et døgn. Lagre det som en egen versjon med new_version (from: utkastet), som krever innlogging." }; }
        if (a.include_screenshot === false || !ok.length) return out;
        /* the picture of what it made (the FreeCAD MCP's pattern): aimed at the last new or changed building, else the whole site */
        const last = ok.findLast(e => e.kind === "volume" || e.kind === "reshape"), id = last && (last.id ?? m.site.added?.findLast(x => x.kind === "volume" && x.name === last.name)?.id);
        try { const { png, text } = await look(m.site, { view_name: a.view_name, focus: id && m.site.added?.some(x => x.id === id) ? id : null });
          return { _result: { content: [{ type: "text", text: JSON.stringify(out) }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text }], structuredContent: out } };
        } catch (e) { console.error("look:", e.message); return out; } } },
    { name: "show_draft", tgt: "read", title: "Se et utkast eller en versjon", ro: true, schema: S({ target: TARGET, draft: OLD }),
      description: "The changes in a draft or a saved version, in order, numbered, with what the after demolishes and builds, and the link that shows it on the website.",
      run: async (a, req) => { const isV = /^v.{8}$/.test(String(a.draft)), edits = editsOf(a.draft, req), after = afterOf(applyEdits(site, floors, edits)), o = originOf(req);
        return { ...(isV ? versionOut(versionOf(a.draft, req), o, req) : { draft: String(a.draft), link: draftUrl(o, a.draft) }), changes: edits.map((e, i) => ({ n: i + 1, ...e })), ...(after ? { after } : {}), saved: isV }; } },
    { name: "undo_change", tgt: "draft", title: "Angre en endring", writeIf: a => /^v.{8}$/.test(String(a.draft)), schema: S({ target: TARGET, draft: OLD, n: { type: "integer", minimum: 1, description: "The change's number from show_draft" } }, ["n"]),
      description: "Takes one change out of a draft, or out of the person's own version, by its number from show_draft.",
      run: async (a, req) => {
        const v = /^v.{8}$/.test(String(a.draft)) ? ownVersion(a.draft, req) : null, edits = v ? v.edits : draftOf(a.draft).edits;
        if (a.n > edits.length) throw toolErr(`It has ${edits.length} changes.`);
        const [gone] = edits.splice(a.n - 1, 1); if (v) versions.save(v); else { const d = draftOf(a.draft); d.t = Date.now(); keepDraft(d); }
        return { ...(v ? versionOut(v, originOf(req), req) : { draft: a.draft, link: draftUrl(originOf(req), a.draft), changes_in_draft: edits.length }), removed: gone }; } },
    { name: "new_version", title: "Ny versjon", write: true, schema: S({ title: { type: "string", description: "Its name, e.g. «Drivhus mot sør, alt revet unntatt Sentralblokka»" }, from: { type: "string", description: "Start from this draft or version (anyone's: it is copied); leave out to start from the before" } }, ["title"]),
      description: "Only when the person asks for a new, separate alternative (their changes otherwise go into the version they have open, through try_change without target). Makes a saved version of the after, owned by the person asking (needs the login): a named list of changes over the before, kept until they change it. It starts privat (only they see it); set_sharing makes it lenke (anyone with the link) or offentlig (on the front page). from: copies a draft's or a visible version's changes into it. Then add to it with try_change (version:).",
      run: async (a, req) => {
        const who = userOf(req); if (!who) throw toolErr("Å lagre en versjon krever innlogging: på sykehus.gulden.no via gulden.no, eller med et personlig token i MCP-klienten.");
        if (!versions) throw toolErr("Versions are not kept on this server.");
        const title = String(a.title || "").trim(); if (!title || title.length > 120) throw toolErr("Gi versjonen et navn (høyst 120 tegn).");
        bump(`new:${who}`, 20, 3600e3);
        try { const v = versions.create(who, title, a.from ? structuredClone(editsOf(a.from, req)) : []); return { ...versionOut(v, originOf(req), req), saved: true }; } catch (e) { if (e.tool) throw e; throw toolErr(e.message); } } },
    { name: "list_versions", title: "Versjonene", ro: true, schema: S({ owner: { type: "string", description: "Only this person's (a login name), or \"me\" for the asker's own; leave out for everyone's" } }),
      description: "The saved versions of the after one may see, newest first: everyone's public ones and all the asker's own; title, owner, who sees it (sharing), how many changes, when, and the link to show it.",
      run: async (a, req) => { if (!versions) return { versions: [], note: "Versions are not kept on this server." };
        const me = userOf(req), owner = a.owner === "me" ? me : a.owner; if (a.owner === "me" && !owner) throw toolErr("Ikke innlogget, så det finnes ingen egne versjoner.");
        return { versions: versions.list({ owner, viewer: me }).slice(0, 100).map(v => versionOut(v, originOf(req), req)), you: me }; } },
    { name: "set_sharing", tgt: "version", title: "Hvem ser versjonen", write: true, schema: S({ target: TARGET, version: OLD, sharing: { type: "string", enum: SHARING, description: "privat: only you. lenke («Bare de med lenken»): anyone you give its link, not listed. offentlig («Vis offentlig»): listed on the front page, open to all without a login" } }, ["sharing"]),
      description: "Chooses who sees one of the person's own versions: privat (only them; a new version is privat), lenke (anyone with its link, never listed) or offentlig (on the front page's list and open to everyone). Give the person the link from the answer.",
      run: async (a, req) => { const v = ownVersion(a.version, req); if (!SHARING.includes(a.sharing)) throw toolErr(`sharing er ${SHARING.join(", ")}`); v.sharing = a.sharing; versions.save(v); return { ...versionOut(v, originOf(req), req), saved: true }; } },
    { name: "send_wish", title: "Send et ønske", write: true, schema: S({ text: { type: "string", description: "What they want, in their own words (Norwegian is fine)" }, tried: { type: "string", description: "What was tried and why the tools could not do it" }, version_id: { type: "string", description: "The version it is about, if any" } }, ["text"]),
      description: "Sends Morten a wish: something the person wants Sykehustomta to do that its tools cannot do yet (a kind of change, a drawing, an export, a view). Use it only after asking them «Skal jeg sende dette som et ønske?» and getting a yes, and only for what the tools truly cannot do; never for a fault you can fix yourself (a wrong position, a bad argument: try again instead). Needs the login. The person sees their wishes and Morten's answers under «Ønsker» on the website.",
      run: async (a, req) => {
        const who = userOf(req); if (!who) throw toolErr("Å sende et ønske krever innlogging.");
        if (!wishes) throw toolErr("Ønsker tas ikke imot på denne serveren.");
        const v = a.version_id ? versions?.get(a.version_id) : null, link = v && versions.visible(v, who) ? versionOut(v, originOf(req), req).link : "";
        try { const w = wishes.add(who, { text: a.text, tried: a.tried, version: v ? v.id : "", link }); return { sent: true, wish: w.id, status: w.status, receipt: "Sendt. Morten ser det.", see_them: `${originOf(req)}/ (Ønsker)` }; }
        catch (e) { throw toolErr(e.message); } } },
    { name: "rename_version", tgt: "version", title: "Gi versjonen nytt navn", write: true, schema: S({ target: TARGET, version: OLD, title: { type: "string" } }, ["title"]),
      description: "Renames one of the person's own versions.",
      run: async (a, req) => { const v = ownVersion(a.version, req), t = String(a.title || "").trim(); if (!t || t.length > 120) throw toolErr("Gi versjonen et navn (høyst 120 tegn)."); v.title = t; versions.save(v); return { ...versionOut(v, originOf(req), req), saved: true }; } },
    { name: "search_documents", title: "Søk i dokumentene", ro: true, schema: S({ query: { type: "string", description: "Words to find, in Norwegian (all must occur; æøå optional)" }, kind: { type: "string", enum: ["tegning", "rapport", "plan", "saksdokument", "kulturminne", "figur", "notat"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]),
      description: "Full-text search in the document store: building-case drawings 2008–2026 (plans, sections, facades), the 2026 area plan for Bragernes sentrum vest and its reports (DIVE analysis, heritage, geotechnics, the high-rise report), heritage records and a research report. Returns documents with the pages that match and a snippet; read more with read_document. Scanned drawings have no text and are found by title only.",
      run: async (a, req) => { needDocs();
        const q = ftsQuery(a.query), lim = a.limit || 8;
        const hits = docs.prepare(`SELECT f.doc, f.n, bm25(fts, 4.0, 1.0) AS score FROM fts f JOIN docs d ON d.id = f.doc WHERE fts MATCH ? ${a.kind ? "AND d.kind = ?" : ""} ORDER BY score LIMIT 200`).all(...[q, a.kind].filter(Boolean));
        const by = new Map(); for (const h of hits) { if (!by.has(h.doc)) by.set(h.doc, []); by.get(h.doc).push(h.n); }
        const out = [...by].slice(0, lim).map(([id, ns]) => { const d = docRow(id), page = docs.prepare("SELECT text FROM pages WHERE doc=? AND n=?").get(id, ns[0]); return { ...docOut(d), matching_pages: ns.slice(0, 10), snippet: page?.text ? snippet(page.text, a.query) : null }; });
        return { query: a.query, documents: out, more: by.size > lim ? by.size - lim : 0 }; } },
    { name: "read_document", title: "Les et dokument", ro: true, schema: S({ doc_id: { type: "string", description: "Document id from search_documents or list_documents" }, from_page: { type: "integer", minimum: 1 }, pages: { type: "integer", minimum: 1, maximum: 10, description: "How many pages (default 3)" } }, ["doc_id"]),
      description: "The text of a document, a few pages at a time, with its download link. Drawings carry little text (title block, room names); scanned ones none: then give the person the link to open it.",
      run: async (a, req) => { needDocs();
        const d = docRow(a.doc_id); if (!d) throw toolErr(`No document "${a.doc_id}".`);
        const from = a.from_page || 1, n = a.pages || 3, rows = docs.prepare("SELECT n, text FROM pages WHERE doc=? AND n>=? AND n<? ORDER BY n").all(d.id, from, from + n);
        let budget = 24000; const pages = [];
        for (const r of rows) { const t = r.text.length > budget ? r.text.slice(0, budget) + " …[cut]" : r.text; budget -= t.length; pages.push({ page: r.n, text: t }); if (budget <= 0) break; }
        return { ...docOut(d), pages, next_page: from + pages.length <= d.pages ? from + pages.length : null }; } },
    { name: "list_documents", title: "Dokumentliste", ro: true, schema: S({ kind: { type: "string", enum: ["tegning", "rapport", "plan", "saksdokument", "kulturminne", "figur", "notat"] }, title_contains: { type: "string" } }),
      description: "The documents in the store by kind (drawings, reports, plan documents, case documents, heritage records, figures, notes), with year, page count and download link.",
      run: async (a, req) => { needDocs();
        const t = a.title_contains ? `%${String(a.title_contains).slice(0, 60)}%` : null;
        const rows = docs.prepare(`SELECT id, title, kind, year, file, pages, has_text, urls FROM docs WHERE 1=1 ${a.kind ? "AND kind=?" : ""} ${t ? "AND title LIKE ?" : ""} ORDER BY kind, year, title LIMIT 250`).all(...[a.kind, t].filter(Boolean));
        return { documents: rows.map(docOut) }; } },
    { name: "look", tgt: "read", title: "Se på modellen", ro: true, schema: S({ view_name: VIEW_NAME, focus: { type: "string", description: "A wing (id or name), a building id, or a new building's id or name: aimed at and picked out in orange" },
        from_direction: { type: ["string", "number"], description: "Where the camera stands: N, NØ, Ø, SØ, S, SV, V, NV or degrees; overrides view_name's" },
        tilt_deg: { type: "number", minimum: 5, maximum: 85 }, distance_m: { type: "number", minimum: 30, maximum: 1200 },
        draft: DRAFT, width: { type: "integer", minimum: 320, maximum: 1280 }, height: { type: "integer", minimum: 240, maximum: 960 } }),
      description: "A picture of the model for you to look at: the terrain, the lot line (red dashes), the buildings as massing (the hospital light, neighbours grey), new buildings in their material's colour (glass pale green), trees as cones, a north arrow top right; plan has a 50 m scale bar bottom left. With target: that version or draft; without, the version the person has open. Use it to check your own work from the side that shows it best, e.g. S for something built on the south side, plan for where it stands. The person does not see this picture; to show them, use show_building.",
      run: async (a, req) => {
        const who = userOf(req), open = who && versions ? versions.get(pages?.open.get(who)) : null, id = a.draft || (open?.owner === who ? open.id : null), m = model(id, req);
        const { png, text } = await look(m.site, a);
        return { _result: { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: text + (id ? ` Modellen: ${id}.` : " Modellen slik den står i dag.") }] } }; } },
    { name: "show_building", tgt: "read", title: "Vis bygget", ro: true, ui: true, schema: S({
        storey: { ...STOREY, description: STOREY.description + ". Cuts every wing 1.2 m above that floor, as a plan is cut; leave out for the whole site" },
        wing: { ...WING, description: "Look at this wing and ring it in yellow" },
        mode: { type: "string", enum: ["3d", "plan", "tverrsnitt", "lengdesnitt", "fasade"], description: "3d: tilted view (default). plan: straight down, north up, with scale bar. fasade: the wing's facade seen square on from from_direction (N, Ø, S or V; needs wing), what stands in front taken away; windows from the drawings where a facade sheet exists (openings), else from photos. tverrsnitt / lengdesnitt: a section across or along the wing (needs wing) through its middle, looked at square on, with what the cut goes through filled black and the wing's storeys and kote on the right" },
        from_direction: { type: ["string", "number"], description: "Where the camera stands: N, NØ, Ø, SØ, S, SV, V, NV or degrees (3d)" },
        tilt_deg: { type: "number", minimum: 5, maximum: 85, description: "Camera angle above the ground (3d)" },
        distance_m: { type: "number", minimum: 30, maximum: 1200 },
        drawn_section: { type: "string", description: "A drawn section's id from about_wing (drawn_sections): the model cut where that sheet cuts, the sheet shown beside it" }, target: TARGET, draft: OLD }),
      description: "Shows the hospital in 3D inside the chat: terrain, lot, the wings with their drawn facades and the operating module, and with a storey chosen every wing cut 1.2 m above that floor with the drawn walls and rooms (names and m² when zoomed in). Plan mode looks straight down like a drawing, with a scale bar; tverrsnitt and lengdesnitt cut one wing through its middle like a drawn section (outer walls are an assumed 0.35 m; inner walls only where a floor plan is drawn). With target: that version or draft; without, the version the person has open. The person can turn, zoom and change storey. You do not see this view: never describe what it shows from it. To see the model yourself, use look. Needs a chat app that shows MCP Apps, or the website open (the pill on sykehus.gulden.no moves the person's page); otherwise give the link.",
      run: async (a, req) => { const view = viewOf(a, req), w = view.wing && wingOf(site, view.wing), who = userOf(req);
        /* through the pill: the person's open pages go to this view (assistant.mjs pages.show), else say they did not */
        /* a version's id names a version, not a draft (21:05Z: the page went to ?utkast=v…, a draft that is not there) */
        const { draft: dv, ...rest } = view, isV = /^v.{8}$/.test(String(dv ?? ""));
        const moved = who && pages ? pages.show(who, { ...rest, ...(dv && !isV ? { draft: dv } : { version: isV ? dv : pages.open.get(who) || null }) }) : null;
        const text = `Sykehustomta: ${view.storey ? `${view.storey}, snitt 1,2 m over gulv` : "hele anlegget"}${w ? `, ${w.name}` : ""}, ${view.mode === "plan" ? "plan" : view.mode === "section" ? (view.section === "lengde" ? "lengdesnitt" : "tverrsnitt") : "3D"}${view.draft ? `, utkast ${view.draft}` : ""}. You have not seen this view (use look for a picture). On the web: ${originOf(req)}/${view.draft ? (isV ? `?versjon=${view.draft}` : `?utkast=${view.draft}`) : ""}${moved === true ? " The person's open page on the website has moved to this view." : moved === false ? " The person has no page of the website open, so nothing moved there; say so, and give the link." : ""}`;
        return { _result: { content: [{ type: "text", text }], structuredContent: { app: "sykehus", view } } }; } },
  ];
  const BY = Object.fromEntries(TOOLS.map(t => [t.name, t]));
  const toolList = () => TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.schema,
    annotations: { title: t.title, readOnlyHint: !!t.ro, destructiveHint: false, idempotentHint: !!t.ro, openWorldHint: false },
    ...(t.write ? { securitySchemes: [{ type: "oauth2", scopes: [SCOPE] }] } : t.writeIf ? { securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [SCOPE] }] } : {}),
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
        const who = userOf(req);
        let a; try { a = resolveTarget(t, params.arguments || {}, req); } catch (e) { if (e.tool) return { content: [{ type: "text", text: e.message }], isError: true }; throw e; }
        /* a tool that keeps a version, with no one logged in: the sign-in challenge, so a chat app asks the person to connect */
        if (!who && (t.write || (t.writeIf && t.writeIf(a)))) throw Object.assign(err(401, "Sign-in needed"), { auth: true });
        try {
          auth?.count(req, who); bump("open", 3000, 3600e3);
          const out = await t.run(a, req);
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
        if (e.auth) return send(res, 401, { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32001, message: "Logg inn for å lagre egne versjoner (koble til Sykehustomta)." } }, { "www-authenticate": auth ? auth.challenge(req) : "Bearer" });
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
  /* GET /api/versjon/<id>: a saved version for the page's ?versjon=<id>; GET /api/versjoner: all of them, newest first */
  function handleVersion(req, res, id) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const open = { "access-control-allow-origin": "*" }, v0 = versions?.get(id), key = new URL(req.url, "http://x").searchParams.get("nokkel");
    const v = v0 && versions.visible(v0, userOf(req), key) ? v0 : null;
    return v ? send(res, 200, { version: v.id, title: v.title, owner: v.owner, sharing: v.sharing, updated: v.updated, edits: v.edits, saved: true }, open) : send(res, 404, { error: "Versjonen finnes ikke." }, open);
  }
  function handleVersions(req, res) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const me = req.webUser ?? null;   // signed in on the page: their own versions too, each with the key that opens it
    return send(res, 200, { versions: (versions?.list({ viewer: me }) || []).slice(0, 200).map(v => ({ version: v.id, title: v.title, owner: v.owner, changes: v.edits.length, updated: v.updated,
      ...(me && v.owner === me ? { mine: true, sharing: v.sharing, ...(v.work ? { work: true } : {}), ...(v.sharing === "offentlig" ? {} : { nokkel: v.own }) } : {}) })), you: me }, { "access-control-allow-origin": "*", vary: "cookie" });
  }
  /* POST /api/endring: the page's «Riv» and «Angre» (U3542), the same as try_change and undo_change: {edits, draft?,
     version?} adds (no draft: a new one), {undo: n, draft | version} takes the n-th out. A version is the signed-in
     owner's only (req.webUser); a draft needs no login, as through the connector. */
  async function handleChange(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" }, { allow: "POST" });
    let a; try { a = await readJson(req, 1e5); } catch { return send(res, 400, { error: "Ugyldig forespørsel." }); }
    try {
      bump(`web:${req.socket.remoteAddress}`, 60, 600e3);
      const me = req.webUser ?? null, o = originOf(req);
      /* signed in, the person's work is one private version, saved on every change (U3555): the one marked work */
      const work = () => workOf(me);
      if (a.adopt || a.copy || a.fresh || a.rename || a.share) {
        if (!me || !versions) throw toolErr("Logg inn for å beholde det.");
        if (a.rename) {   // the title on the «Forslag» card, edited in place
          const v = ownVersion(String(a.rename), req), t = String(a.title || "").trim(); if (!t || t.length > 120) throw toolErr("Gi forslaget et navn (høyst 120 tegn).");
          v.title = t; versions.save(v); return send(res, 200, { ...versionOut(v, o, req), nokkel: v.own });
        }
        if (a.adopt) {   // a draft made signed out, moved into the person's version at sign-in; then the draft is gone
          const d = draftOf(a.adopt), v = work(); v.edits.push(...structuredClone(d.edits).slice(0, MAX_VERSION_EDITS - v.edits.length)); versions.save(v); dropDraft(d.id);
          return send(res, 200, { ...versionOut(v, o, req), nokkel: v.own, adopted: d.edits.length });
        }
        if (a.copy || a.fresh) {   // «Ny kopi»: a second alternative from this one; «Nytt forslag»: one from the before. It becomes the one worked on
          const from = a.copy ? ownVersion(String(a.copy), req) : null, n = versions.list({ owner: me, viewer: me }).length + 1;
          const v = versions.create(me, `Mitt etter ${n}`, from ? structuredClone(from.edits) : []);
          for (const x of versions.list({ owner: me, viewer: me })) if (x.work && x.id !== v.id) { delete x.work; versions.save(x); }
          v.work = true; versions.save(v);
          return send(res, 200, { ...versionOut(v, o, req), nokkel: v.own });
        }
        const v = ownVersion(String(a.share), req);   // «Del»: anyone with the link sees it, signed out too
        if (v.sharing === "privat") { v.sharing = "lenke"; versions.save(v); }
        return send(res, 200, versionOut(v, o, req));
      }
      if (me && versions && !a.version && !a.draft && !a.undo) a.version = work().id;
      const tool = TOOLS.find(t => t.name === (a.undo ? "undo_change" : "try_change"));
      const args = a.undo ? { draft: String(a.version || a.draft || ""), n: +a.undo } : { edits: Array.isArray(a.edits) ? a.edits.slice(0, 50) : [], include_screenshot: false, ...(a.version ? { version: String(a.version) } : a.draft ? { draft: String(a.draft) } : {}) };
      if (!a.undo && !args.edits.length) throw toolErr("Ingen endring.");
      if (!a.undo && args.edits.some(e => !["demolish", "restore", "volume", "reshape", "wing"].includes(e?.kind))) throw toolErr("Fra siden: riv, nye bygg og byggenes navn og opplysninger.");   // the rest goes through Anton
      const out = await tool.run(args, req), mine = out.version && versions.get(out.version);
      if (mine && mine.owner === me) out.nokkel = mine.own;
      if (out.rejected?.length) return send(res, 422, { error: out.rejected.map(r => r.error).join(" "), ...out });
      return send(res, 200, out);
    } catch (e) { return send(res, e.tool ? 400 : 500, { error: e.tool ? e.message : "Noe gikk galt." }); }
  }
  /* GET /api/ifc?utkast=<id> | ?versjon=<id>&nokkel=: the model as IFC without the wings the after tears down
     (ifcfilter.mjs); the before's file is read once, each answer kept until the draft or version changes */
  let base = null; const ifcs = new Map();
  function handleIfc(req, res) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const q = new URL(req.url, "http://x").searchParams, vid = q.get("versjon"), did = q.get("utkast");
    let edits, tag, name;
    try {
      if (vid) { const v = versions?.get(vid); if (!v || !versions.visible(v, userOf(req), q.get("nokkel"))) throw toolErr("Versjonen finnes ikke."); edits = v.edits; tag = `${v.id}@${v.updated}`; name = v.title; }
      else if (did) { const d = draftOf(did); edits = d.edits; tag = `${d.id}#${d.edits.length}:${JSON.stringify(d.edits).length}`; name = "utkast"; }
      else throw toolErr("Hvilket utkast eller hvilken versjon?");
    } catch (e) { return send(res, 404, { error: e.tool ? e.message : "Finnes ikke." }); }
    let body = ifcs.get(tag);
    if (!body) {
      const m = applyEdits(site, floors, edits), left = new Set(m.site.buildings.map(b => b.wing).filter(Boolean));
      const gone = (site.wings || []).filter(w => !left.has(w.id) && site.buildings.some(b => b.wing === w.id)).map(w => w.name);
      base ??= parseIfc(readFileSync(new URL("./public/data/sykehus.ifc", import.meta.url), "utf8"));
      body = Buffer.from(withoutBuildings(base, gone).text, "utf8");
      if (ifcs.size > 20) ifcs.delete(ifcs.keys().next().value); ifcs.set(tag, body);
    }
    const file = `gamle-drammen-sykehus-${String(name).toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "versjon"}.ifc`;
    res.writeHead(200, { ...SECURITY, "content-type": "application/x-step", "content-disposition": `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`, "cache-control": "no-store" });
    return res.end(body);
  }
  return { handleMcp, handleDraft, handleVersion, handleVersions, handleChange, handleIfc, TOOLS };
}
