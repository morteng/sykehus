// Sykehustomta as an MCP server (Model Context Protocol), so Claude and other chat apps can use it: the documents, the
// floors and rooms, and the building in 3D inside the chat (an MCP App). No dependencies: JSON-RPC over Streamable
// HTTP (JSON answers only). The JSON-RPC handling follows hagekart's mcp.mjs (2026-10-24): looking and trying (drafts)
// are open to everyone; keeping a version (versions.mjs) needs a login (auth.mjs: gulden.no in front, a personal
// token, or OAuth for claude.ai), and a tool that keeps one answers 401 with the sign-in challenge without it.
//
//   POST /mcp     JSON-RPC: initialize, tools/list, tools/call, resources/read ...
import { randomBytes, createHash } from "node:crypto";
import { SCOPE } from "./auth.mjs";
import { wingOf, checkEdit, applyEdits } from "./public/edits.js";
import { MAX_EDITS as MAX_VERSION_EDITS, SHARING } from "./versions.mjs";
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIfc, withoutBuildings } from "./ifcfilter.mjs";
import { withAdded } from "./ifcadd.mjs";   // U3556: what the after builds, written into its IFC
import { picture, aimAt, VIEWS } from "./public/renderkit/look.js";   // renderkit (U3559)
import { planShots, streetsAround } from "./shots.mjs";   // U3527: a few good shots of a version
import { groundAt } from "./public/renderkit/fit.js";
import { fitOf, surfaceFit, groundText, padFit, lotText, windowBays, facadesOf, balconyFaces } from "./public/design.js";
import { gradingText, basinText } from "./public/grading.js";
import { dirDeg as dirOf, dirWord, SIDE_KEYS, SIDE_WORD, norm360 } from "./public/renderkit/dirs.js";   // one copy (DRY 5)
import { prepare, slim, withMeshes, handleBim, importFile, listParts } from "./bim.mjs";
import { libraries } from "./fetchimport.mjs";   // U3571 S4: models from open libraries, fetched for a signed-in person   // U3570: constructions a script builds, in the worker
import { VIEW_SPEC, addView, renameView, removeView, findView, checkViews } from "./public/saved.js";

/* MCP 2026-07-28 (stateless: each request names its version in _meta, server/discover instead of the handshake),
   and the older revisions' initialize for clients that still send it. MCP Apps 2026-01-26 (io.modelcontextprotocol/ui). */
const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const M = k => `io.modelcontextprotocol/${k}`;
const SERVER_INFO = { name: "sykehus", title: "Sykehustomta", version: "0.2.0" };
const INSTRUCTIONS = "Sykehustomta is the old Drammen sykehus (Dronninggata 28, 3019 Drammen, gnr. 114 bnr. 272) for an architect working on reusing the existing buildings. "
  + "The hospital is described as its wings (about_site, about_wing): each with years, storeys and their kote per wing (storeys), drawn floor plans with rooms and areas (floor_plan), and windows from the drawn facades (openings). "
  + "about_site also lists the named streets and places around the site (streets: Welhavens gate, Dronninggata …), the names show_building's from_place stands in. "
  + "A store of about 200 documents (building-case drawings, sections, facades, the 2026 area plan and its reports, heritage records) is searchable (search_documents, read_document). show_building shows the hospital in 3D or plan in the chat. "
  + "Changes go through try_change; the shared model, the before, is never changed. Every tool that reads or changes the after takes one target: a version id (v and 8 more) or a draft id (8); leave it out for the version the person has open on the website (signed in, their «Mitt etter»): that is nearly always right. "
  + "The person keeps camera views by name on a version (U3562): show_building with save_as keeps the view it shows under that name (when they say «husk denne», «lagre visningen»), saved_view goes to one; show_draft lists them. "
  + "The person can also build: try_change takes edits of these kinds: demolish and restore (whole buildings or alle), volume (a new building: box, gable, triangle, lean_to, pyramid, terraces; on a roof with on), reshape (move, turn, resize or re-fact one), wing and balconies, surface (a lawn, paving, a pool or pond with surface water), path, trees and fell, part (a ready-made BIM part: a pool basin, stair, railing, balcony or a greenhouse of 3–8 sides or a geodesic dome; list_parts says what each takes: USE A PART FIRST for these, before free geometry), and only where no part fits, construction: a Python script with IfcOpenShell that builds a structure as BIM (a glass greenhouse, a pavilion, a frame: members, plates, slab, door), run in a sandboxed worker and kept as its own IfcBuilding with named parameters that the person can change later; its script contract is in the construction kind's description. "
  + "look shows the model from any side, after the changes; show_draft lists the changes and the after. "
  + "Tell the person only what a tool result shows: a change is made only when it is in the result's added and the result names the version it went into; when it is rejected or refused, say so and what you do next. "
  + "The user is an architect: speak in drawing terms (plan, snitt, kote, BRA), in Norwegian unless they write otherwise, and cite drawings and documents by title with their link. "
  + "Say how each fact is known: read off a drawing, worked out (beregnet), assumed (antatt) or measured from the laser; areas measured between drawn walls are rough (about 15 %).";

const err = (code, message) => Object.assign(new Error(message), { code });
const toolErr = message => Object.assign(new Error(message), { tool: true });
/* the store's search text is folded so "rontgen" finds "røntgen" (tools/ingest.py fold) */
const fold = s => String(s).toLowerCase().replace(/æ/g, "ae").replace(/[øö]/g, "o").replace(/[åä]/g, "a").replace(/é/g, "e").replace(/ü/g, "u");
/* a direction as a model writes it (pm 21:41Z: «NØ» was refused): renderkit dirs.js reads it, any case, Norwegian or
   English, short or whole, or degrees */
const dirDeg = d => dirOf(d) ?? (() => { throw toolErr(`Unknown direction "${d}". Use N, NØ, Ø, SØ, S, SV, V, NV or degrees.`); })();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = v => Math.round(v * 10) / 10;

export function createMcp({ site, floors, sections = [], docs, docUrl, SECURITY, readJson, versions = null, auth = null, wishes = null, pages, ways = null, places = null }) {
  /* who is asking (auth.mjs): a login name, or null; looking and trying need none */
  const userOf = req => auth?.userOf(req) ?? null;
  const libs = libraries();
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
    return { ...out, drawn_storeys: [...new Set(drawn.map(f => f.name))], facades: (site.facades || []).filter(f => f.building === w.id).map(f => ({ id: f.id, name: f.name, openings: f.openings.length, source: f.src })), window_bays: windowBays(site, w.id), facade_bearings: facadesOf(site, w.id),
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
  let notify = null;   // U3635: notify(person, event, data) tells their page of a plan Anton showed; the plans are kept on disk (a reload shows them again)
  const SK = join(process.env.SYKEHUS_VERSIONS_DIR || tmpdir(), "skisser"), SK_KEEP = 3 * 86400e3;
  const sketchSave = (sid, meta, png) => { mkdirSync(SK, { recursive: true }); writeFileSync(join(SK, sid + ".png"), png); writeFileSync(join(SK, sid + ".json"), JSON.stringify(meta));
    for (const f of readdirSync(SK)) { try { const p = join(SK, f); if (Date.now() - statSync(p).mtimeMs > SK_KEEP) unlinkSync(p); } catch {} } };
  const sketchMeta = sid => { try { return /^[A-Za-z0-9_-]{8}$/.test(sid) ? JSON.parse(readFileSync(join(SK, sid + ".json"), "utf8")) : null; } catch { return null; } };
  const sketchesOf = person => { try { return readdirSync(SK).filter(f => f.endsWith(".json")).map(f => sketchMeta(f.slice(0, -5))).filter(m => m?.person === person && Date.now() - Date.parse(m.at) < SK_KEEP).sort((a, b) => a.at < b.at ? -1 : 1).slice(-6).map(({ person: _p, ...m }) => m); } catch { return []; } };
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
  /* the saved camera views (U3562) of a version or a draft: read by who may see it, changed by its owner (a draft by
     anyone with its id, as its changes are); renderkit's views.js checks them, its errors are the tool's */
  const viewsOf = (id, req) => checkViews((/^v.{8}$/.test(String(id)) ? versionOf(id, req) : draftOf(id)).views, VIEW_SPEC);
  const changeViews = (id, req, f) => {
    const v = /^v.{8}$/.test(String(id)) ? ownVersion(id, req) : null, o = v || draftOf(id);
    try { o.views = f(checkViews(o.views, VIEW_SPEC)); } catch (e) { throw toolErr(e.message); }
    if (v) versions.save(v); else { o.t = Date.now(); keepDraft(o); }
    return o.views;
  };
  const viewsOut = l => l.map(w => ({ id: w.id, name: w.name, by: w.by }));
  /* U3527: a series of shots of the version or draft id (shots.mjs), saved as its views in place of the last series */
  const makeShots = async (id, req) => {
    const m = model(id, req), shots = planShots(m.site, site, places ? await places(3000) : []);
    const l = changeViews(id, req, l => { let out = l.filter(v => !v.state?.series); for (const sh of shots) out = addView(out, { name: sh.name, state: sh.state, by: "anton" }, VIEW_SPEC); return out; });
    return { shots, views: l };
  };
  /* where a person stands to see what: at a named street or place (the point of it nearest), or toward a direction, the
     eye 1,7 m over the ground there (the page's eye camera); the centre what they look at */
  const eyeView = async (m, what, a) => {
    const aim = (what && aimAt(m.site, what)) || { name: "tomta", target: [...site.lot.ring.reduce((t, p) => [t[0] + p[0] / site.lot.ring.length, t[1] + p[1] / site.lot.ring.length], [0, 0]), 15] };
    const c = aim.target, v = { mode: "3d", cam: "eye", x: Math.round(c[0] * 10) / 10, y: Math.round(c[1] * 10) / 10, kote: Math.round(c[2] * 10) / 10 };
    let at = null, said = "";
    if (a.from_place) {
      const low = String(a.from_place).toLowerCase().replace(/^fra\s+/, "").trim(), all = places ? await places(3000) : [];
      const p = all.find(x => x.name.toLowerCase() === low) || all.find(x => x.name.toLowerCase().includes(low));
      if (!p) throw toolErr(`Fant ikke «${a.from_place}» blant gatene og stedene rundt tomta${all.length ? `: ${all.map(x => x.name).join(", ")}` : ""}.`);
      at = p.pts.reduce((b, q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < Math.hypot(b[0] - c[0], b[1] - c[1]) ? q : b);
      said = `fra ${p.name}`;
    }
    const deg = at ? ((Math.atan2(at[0] - c[0], at[1] - c[1]) * 180 / Math.PI) + 360) % 360 : a.from_direction != null ? dirDeg(a.from_direction) : 180;
    const d = at ? Math.hypot(at[0] - c[0], at[1] - c[1]) : a.distance_m ?? 70;
    Object.assign(v, { yaw: Math.round((Math.PI - deg * Math.PI / 180) * 1000) / 1000, pitch: 0.1, dist: Math.round(clamp(d, 30, 1200) * 10) / 10 });
    return { view: v, said: `${aim.name} i øyehøyde (1,7 m over bakken) ${said || `fra ${Math.round(d)} m`}`.trim() };
  };
  const model = (id, req) => id ? applyEdits(site, floors, editsOf(id, req)) : { site, floors, notes: [], changed: [] };

  // ---------- the picture ----------
  const APP_URI = "ui://sykehus/bygget";
  const viewOf = (a, req) => {
    const v = {};
    if (a.storey) { const n = storeyName(a.storey); if (!floors.some(f => f.name === n) && !wingsAll().some(w => (w.levels || []).some(l => l.name === n))) throw toolErr(`No storey "${a.storey}".`); v.storey = n; }
    /* the wing under other names a model sends (pm 21:32Z: deepseek asked for the facade twice with no wing) */
    const wn = a.wing ?? a.building ?? a.name ?? a.focus;
    if (wn) { const w = wingOrErr(wn); v.wing = w.id; v.building = piecesOf(w.id)[0]?.id; }
    /* a facade or a section with no wing named: the wing picked on the person's page, else the largest standing in
       the after, and the result says which (a refusal the model repeats is a dead end) */
    if (!v.wing && !a.drawn_section && ["fasade", "tverrsnitt", "lengdesnitt"].includes(a.mode)) {
      const s = model(a.draft, req).site, stand = new Set(s.buildings.map(b => b.wing).filter(Boolean)), who = userOf(req);
      const picked = who && pages?.picked?.get(who), byB = picked && site.buildings.find(b => b.id === picked)?.wing;
      const area = id => s.buildings.filter(b => b.wing === id).reduce((t, b) => t + (b.area_m2 || 0), 0);
      const id = [picked, byB].find(x => x && stand.has(x)) || [...stand].sort((x, y) => area(y) - area(x))[0];
      if (id) { const w = wingOrErr(id); v.wing = w.id; v.building = piecesOf(w.id)[0]?.id; v.guessed = w.name; }
    }
    if (a.mode === "plan" || a.mode === "3d") v.mode = a.mode;
    if (a.drawn_section) {
      const d = sections.find(x => x.id === a.drawn_section); if (!d) throw toolErr(`No drawn section "${a.drawn_section}". Drawn sections: ${sections.map(x => x.id).join(", ")} (about_wing lists them).`);
      const w = wingOrErr(d.wing); Object.assign(v, { wing: w.id, building: piecesOf(w.id)[0]?.id, mode: "section", section: d.kind, drawn: d.id }); delete v.storey; return v;
    }
    if (a.mode === "fasade") {
      if (!v.wing) throw toolErr(`Fasaden trenger wing: hvilken fløys fasade. Fløyene: ${wingsAll().map(w => `${w.name} (${w.id})`).join(", ")}. For eksempel {mode: "fasade", wing: "Sentralblokka", from_direction: "S"} for fasaden mot sør på Sentralblokka.`);
      const deg = a.from_direction != null ? dirDeg(a.from_direction) : 0, side = SIDE_KEYS[Math.round(norm360(deg) / 90) % 4];
      Object.assign(v, { mode: "section", section: "fasade", side }); delete v.storey; delete v.yaw; return v;
    }
    if (a.mode === "tverrsnitt" || a.mode === "lengdesnitt") {
      if (!v.wing) throw toolErr(`Snittet trenger wing: hvilken fløy det går gjennom. Fløyene: ${wingsAll().map(w => `${w.name} (${w.id})`).join(", ")}. For eksempel {mode: "${a.mode}", wing: "Sentralblokka"}.`);
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
  /* U3617: how a surface's corners go (renderkit paths2d.js ringOf) */
  const RADIUS = { type: "number", minimum: 0, maximum: 50, description: "m: each corner rounded with an arc of this radius (held to what the sides leave)" };
  const SMOOTH = { type: "boolean", description: "true: a soft closed curve through the points instead of corners" };
  /* one schema per kind (the toolkit audit: a call is checked against its own kind's fields before it is sent) */
  const PT = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[east_m, north_m] from the site origin" };
  const WHY = { type: "string", description: "Where it comes from: a drawing and page, a measurement, the person's wish, the architect's judgement" };
  const K = (kind, about, props, required = []) => ({ type: "object", description: about, properties: { kind: { const: kind }, ...props, why: WHY }, required: ["kind", ...required], additionalProperties: false });
  const FACTS = { storeys: { type: "integer", minimum: 1, maximum: 30, description: "Storeys; the height then defaults to 3.2 m each" }, use: { type: "string" }, built: { type: "string" }, note: { type: "string" },
    entrance: { type: ["string", "null"], enum: ["N", "Ø", "S", "V", "", null], description: "The side its step-free entrance faces (TEK17 § 8-6): the ground there is made level with the floor, then a ramp 1:20 to the terrain; its length is in the result (ground.entrance). \"\" or null takes it away" } };
  const SHAPE = { type: "string", enum: ["box", "gable", "triangle", "lean_to", "pyramid", "terraces"], description: "box; gable (walls wall_height high and a ridge along from -> to); triangle (an A frame: two slopes from the ridge to the ground, NOT a pyramid); lean_to (one slope); pyramid (four sloping faces to one point over the middle); terraces (steps one on another, each step_depth narrower, flush at the back on high_side: stepped terraces, not balconies)" };
  const EDIT = { description: "One change; its kind picks its fields. Site positions are metres east and north of the site origin; about_wing gives a wing's footprint and kote.", anyOf: [
    K("level", "A storey's floor kote in a wing", { wing: WING, storey: STOREY, kote: { type: "number" } }, ["wing", "storey", "kote"]),
    K("wing", "A fact on a wing's card", { wing: WING, field: { type: "string", enum: ["name", "built", "storeys", "use", "construction", "facade", "note"] }, value: { type: "string" } }, ["wing", "field", "value"]),
    K("room", "A room's name, use or area", { storey: STOREY, room: { type: "string", description: "Its code or name" }, at: { ...PT, description: "Its stamp's place [east_m, north_m] from floor_plan: for a room with no code, or one of several with the same name" }, set: { type: "object", properties: { name: { type: "string" }, use: { type: "string" }, area_m2: { type: "number" } }, additionalProperties: false } }, ["storey", "set"]),
    K("note", "A note on the model", { text: { type: "string" }, wing: WING, storey: STOREY, at: PT }, ["text"]),
    K("demolish", "Tear down: a wing, a building id, a new building's id, a surface's, path's or planting's id (flate-1, sti-2, tre-1: takes it away), planed ground's id (terreng-1: the ground goes back as it was), a road section's id around the site (vei-osm-…, vei-nvdb-…, as a selection from the page gives it: takes it away), or \"alle\" for every hospital building (then restore the ones to keep)", { building: { type: "string" }, name: { type: "string", description: "A road section's name, as the selection gives it (vei-… only)" } }, ["building"]),
    K("restore", "Put back what a demolish took", { building: { type: "string" }, name: { type: "string", description: "A road section's name (vei-… only)" } }, ["building"]),
    K("balconies", "A NEW request for balconies (one facade or a whole one) comes out as the balcony part in the IFC: each an assembly of slab and railing with its material, property sets (Pset_SlabCommon, Pset_RailingCommon) and quantities (Qto_SlabBaseQuantities: area, volume), one type a size and the balconies its occurrences; for one balcony of a given size use part balcony. Balconies on a wing's facades facing side (within 45°), or on the one facade face names. Nearly every wing of the hospital stands turned about 30° (Sentralblokka's faces point 30°, 120°, 210°, 300°), so it has two faces near any side: then side alone is refused with both named; ask the person which, or use face (about_wing's facades). The result says each facade used (facade_say: which way it faces, how long, how many per storey): say it. Balconies on a facade that has some from an earlier change replace those (replaced says which): to change them, send the new ones; with windows, about_wing's window_bays gives each facade's window count", { wing: WING, side: { type: "string", enum: ["N", "Ø", "S", "V"] }, face: { type: "number", minimum: 0, maximum: 360, description: "The facade by the way it faces, degrees from north (120 = east-south-east), as about_wing's facade_bearings gives them; side may then be left out" }, from_storey: STOREY, to_storey: STOREY, depth: { type: "number", minimum: 0.8, maximum: 4, description: "m out, default 1.8" }, windows: { type: "boolean", description: "One balcony per window («én per vindu», «per vindusakse»): each centred on a window bay of the facade as it is drawn (every 2.5 m along the wall; about_wing window_bays counts them per side). The result says how many window bays" }, bay: { type: "number", description: "m wide each (with windows: default the window's width + 0.6 m, at most 2.4), else along the whole wall" }, gap: { type: "number", description: "m between bays, default 0.6" }, railing: { type: "string", enum: ["glass", "steel", "concrete"] } }, ["wing"]),
    K("volume", "A new building or structure over its middle or ridge line from -> to", { name: { type: "string" }, shape: SHAPE, from: PT, to: PT, width: { type: "number", minimum: 1, maximum: 120, description: "m across the line" }, height: { type: "number", minimum: 1, maximum: 80, description: "m from its foot to the top" },
      wall_height: { type: "number", description: "gable, lean_to: the low eaves" }, high_side: { type: "string", enum: ["left", "right"], description: "lean_to: the high side; terraces: the back, where the steps are flush (walking from -> to)" },
      steps: { type: "integer", minimum: 2, maximum: 10, description: "terraces: how many (default 3)" }, step_depth: { type: "number", minimum: 0.5, maximum: 20, description: "terraces: m each step is narrower than the one under it (default 3)" },
      on: { type: "string", description: "A wing (id or name) whose roof it stands on: its foot is that roof's kote under its middle (a roof garden, a greenhouse on a roof)" },
      base_kote: { type: "number", description: "Its foot's kote; default the lowest ground under it (leave out with on)" }, material: { type: "string", enum: ["glass", "concrete", "steel", "wood", "brick"], description: "glass = a greenhouse" },
      id: { type: "string", description: "Optional, to name it later: any short name. The server makes it a valid free id (n and 4-12 letters/digits), so it may come back changed: use the id in the result's added" }, ...FACTS }, ["from", "to", "width"]),
    K("construction", "A construction built by a Python script you write (U3570): a glass pyramid, a pavilion, a frame, a greenhouse with its members, glass, slab and door, as BIM. The script runs in a worker: Python 3.12, IfcOpenShell 0.8 (ifcopenshell.api, ifcopenshell.geom), numpy; no FreeCAD, no network, only its own folder, 300 s. It must: read its parameters, P = {**defaults, **json.load(open('params.json'))} (the server adds ground, the kote under its middle: put its foot at z = P['ground']; float() a number before it goes into an IfcCartesianPoint, which refuses an int); build IFC4 in metres (ifcopenshell.api.run('unit.assign_unit', f, length={'is_metric': True, 'raw': 'METERS'}): with no arguments it sets millimetres, and raw IfcCartesianPoints are then read as mm; call the API as ifcopenshell.api.run('root.create_entity', f, ...), or import each submodule you use, ifcopenshell.api.root) with IfcProject > IfcSite > IfcBuilding (named as it) > IfcBuildingStorey containing every element (IfcMember, IfcPlate, IfcSlab, IfcDoor, IfcColumn, IfcBeam ..., each with a Body representation in metres), centred on (0, 0) on plan with its length along x; put the named parameters in a property set on the IfcBuilding; write model.ifc; print one JSON line of what it counted. from -> to place its middle and turn its x axis (their length does not matter: its size is the script's). The result says what it made (bim.classes, bim.box, the printed line) or the error with its line: check it against what was asked and fix the script once if it is wrong. Later changes: reshape with id and params (the script runs again), or from/to to move and turn it.", { name: { type: "string" }, from: PT, to: PT, script: { type: "string", description: "The whole Python script" },
      params: { type: "object", additionalProperties: { type: "number" }, description: "Its named parameters, e.g. {base: 30, top: 28, module: 3, profile: 0.1}; numbers only" }, material: { type: "string", enum: ["glass", "concrete", "steel", "wood", "brick"], description: "For the card; default glass when it has glass" },
      id: { type: "string", description: "Optional, to name it later (it may come back changed: use the id in added)" }, ...FACTS }, ["name", "from", "to", "script"]),
    K("part", "A ready-made BIM part the worker builds itself (U3620): use a part FIRST for what it covers, before you write geometry or a script: a swimming pool basin (pool_basin), a stair (stair), a railing (railing), a balcony with slab, glass railing and door (balcony), a greenhouse of 3–8 sides or a geodesic dome (greenhouse). list_parts tells each one's settings with defaults and limits and the IFC it makes; every one carries property sets, quantities (m², m³, weight) and the app's materials, so the person can use it in a drawing or an estimate. Its length runs from -> to (its middle on their middle, its x along them: a balcony's door side is the wall), its foot on the ground. Settings you leave out take their defaults; ask the person only for what they did not say. The result says what it made (worker.printed: the counts, areas and weights): report those figures. Change it later with reshape (id and params), or move and turn it with from/to. A word or a size no part has (a shape it cannot make) is not a reason to bend a part: then, and only then, write a construction.", { part: { type: "string", description: "Which part: pool_basin, stair, railing, balcony or greenhouse (list_parts has the settings of each)" }, name: { type: "string" }, from: PT, to: PT,
      params: { type: "object", additionalProperties: { type: ["number", "string", "boolean"] }, description: "Its settings as list_parts names them, e.g. {sides: 3, radius: 3.5} for a triangular greenhouse 6 m on a side (radius = the corner's distance from the middle: side / 1.732 for three); the others take their defaults" }, material: { type: "string", enum: ["glass", "concrete", "steel", "wood", "brick"], description: "For the card; default from what it made" },
      id: { type: "string", description: "Optional, to name it later (it may come back changed: use the id in added)" }, ...FACTS }, ["part", "from", "to"]),
    K("import", "A file brought in (U3571): an IFC, STEP, glTF, OBJ or STL, or a DXF or DWG plan (laid flat over the ground), a person uploaded on the page («Hent fil») or that /api/import read (made an IFC by the worker), by its sha (file). It stands like a construction: its box's middle on from -> to, its x along it, its foot on the ground; its size and units are the file's. Say its licence as the source states it («ukjent» if it says none); never use a file whose source forbids it or needs an account.", { file: { type: "string", description: "The sha /api/import gave" }, name: { type: "string" }, from: PT, to: PT,
      source: { type: "string", description: "Where it came from: the manufacturer's page" }, licence: { type: "string", description: "Its licence as the source states it" }, material: { type: "string", enum: ["glass", "concrete", "steel", "wood", "brick"] },
      id: { type: "string" }, ...FACTS }, ["file", "from", "to", "licence"]),
    K("reshape", "Change a new building (rename, re-fact, move or resize it), or a surface, path or planting by its id (flate-1, sti-2 from show_draft's after.ground, tre-1 from after.plantings): its name, surface, ring (its corner points), radius or smooth (how its corners go: change one alone to round a square pool's corners or make a lawn's edge a curve); a pool's depth, coping and kote; a path's line and width; a planting's height and crown; or planed ground by its id (terreng-1 from after.grading): its kote, fall, edge, slope, ring", { id: { type: "string", description: "Its id, from show_draft's after.built, after.ground or fit" }, name: { type: "string" }, from: PT, to: PT, width: { type: "number" }, height: { type: "number" },
      surface: { type: "string", description: "a surface's or path's material, as surface and path take" }, crown: { type: "number", description: "a planting: m wide" }, ring: POINTS, line: POINTS, radius: RADIUS, smooth: SMOOTH, plants: { type: "array", items: { type: "string" }, maxItems: 30 },
      params: { type: "object", additionalProperties: { type: ["number", "string", "boolean"] }, description: "A construction's or part's parameters to change (the others stay); its script or part runs again" },
      pool: { type: "boolean" }, depth: { type: "number", description: "water: m deep" }, coping: { type: "number", description: "pool: the edge's width" }, kote: { type: "number", description: "water or planed ground (terreng-…): the level" },
      fall: { type: "number", description: "planed ground: 1:fall" }, fall_toward: { type: "string", enum: ["N", "Ø", "S", "V"] }, edge: { type: "string", enum: ["batter", "wall"] }, slope: { type: "number" }, ...FACTS }, ["id"]),
    K("surface", "A surface on the ground: a lawn, a bed, a square, and water. Water lies flat at its own level. A swimming pool (svømmebasseng, basseng) is water with pool: true: a basin dug depth deep under a level coping, with a level edge round it and the slope beyond dug or filled to meet it, so it sits right on sloping ground too; the result (after.ground: level, basin) gives its kote and the m³ dug out and filled. Without pool it is a pond (dam), at the lowest ground on its edge. Its corners: sharp as given, radius rounds each with an arc (a pool with rounded corners, a kidney-shaped bed), smooth runs a soft curve through the points (a natural pond, a lawn's curved edge); ring stays the points, so a later reshape can change one setting", { ring: POINTS, radius: RADIUS, smooth: SMOOTH, surface: { type: "string", enum: ["grass", "meadow", "planting", "gravel", "paving", "asphalt", "water"] }, name: { type: "string" }, plants: { type: "array", items: { type: "string" }, maxItems: 30, description: "hagekart ids or Latin names, for a bed" },
      pool: { type: "boolean", description: "water: a swimming pool (a dug basin with a coping), not a pond" }, depth: { type: "number", minimum: 0.2, maximum: 4, description: "water: m deep (pool default 1.4, pond 0.6)" }, coping: { type: "number", minimum: 0, maximum: 1.5, description: "pool: the edge's width in m (default 0.3)" }, kote: { type: "number", description: "water: the pool's edge, or the pond's water, as a kote; leave out for the level that balances the earth" } }, ["ring", "surface"]),
    K("ground", "Earthworks, as a builder moves earth: make the ground inside ring level (a flat terrace, a yard, a level lawn, a place for a playground or a car park on a slope) or set it to a gentle fall, digging out where it is high and filling where it is low; outside it the ground meets it in a slope (1:2), or with edge wall a retaining wall holds it. Use it whenever the person wants something flat on sloping ground, a terrace, a level area, or the ground dug out or built up. The result (after.grading) gives its kote and the m³ dug out and filled (say: and quote them). A pool needs no ground edit: a water surface with pool true levels its own edge. Its id terreng-1, …: reshape changes kote, fall or edge; demolish puts the ground back", {
      ring: POINTS, kote: { type: "number", description: "The level, as a kote (m above sea). Leave out: the level where what is dug out fills the rest (no earth driven away or brought in)" },
      fall: { type: "number", minimum: 2, maximum: 500, description: "A fall of 1:fall from its middle (e.g. 50 for 2 %, so water runs off); leave out for flat" }, fall_toward: { type: "string", enum: ["N", "Ø", "S", "V"], description: "Which way it falls (default S)" },
      edge: { type: "string", enum: ["batter", "wall"], description: "batter (default): a sloping bank to the ground around; wall: a retaining wall at the edge, the ground outside as it is" }, slope: { type: "number", minimum: 1, maximum: 10, description: "The bank's run per rise, default 2 (1:2)" }, name: { type: "string" } }, ["ring"]),
    K("path", "A path", { line: POINTS, width: { type: "number", description: "m, default 2" }, surface: { type: "string", enum: ["gravel", "paving", "asphalt", "wood"] }, name: { type: "string" } }, ["line"]),
    K("trees", "Trees planted (hagekart's species; check_species first: banned species are refused)", { species: { type: "string" }, points: POINTS, line: POINTS, spacing: { type: "number", description: "m along line, default 8" }, height: { type: "number" }, crown: { type: "number", description: "m wide" } }, ["species"]),
    K("fell", "Take down today's trees inside a ring", { ring: POINTS }, ["ring"]),
  ] };
  /* what a draft builds and takes away, without the geometry: for the agent to report back */
  const afterOf = m => (m.site.demolished || m.site.added || m.site.landscape || m.site.roads_removed || m.site.grading) ? { demolished: (m.site.demolished || []).map(d => ({ name: d.name, footprint_m2: d.footprint_m2, gross_volume_m3: d.gross_volume_m3 })),
    demolished_gross_volume_m3: (m.site.demolished || []).reduce((a, d) => a + (d.gross_volume_m3 || 0), 0),
    built: (m.site.added || []).map(({ parts, ...a }) => slim(a)),
    ...(m.site.roads_removed ? { roads_removed: m.site.roads_removed.map(r => r.name || "en veistrekning") } : {}),
    ...(m.site.grading ? { grading: m.site.grading.map(({ ring, plane, ...g }) => ({ ...g, say: gradingText({ ring, ...g }) })) } : {}),
    ...(m.site.landscape ? { ground: m.site.landscape.map(({ ring, line, ...g }) => g.basin ? { ...g, say: basinText(g) } : g), planted: m.site.planted, plantings: (m.site.plantings || []).map(({ why, ...g }) => g), trees_felled: m.site.felled } : {}) } : null;
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
    const miss = k.required.filter(f => e[f] == null || e[f] === ""), extra = Object.keys(e).filter(f => !(f in k.properties) && !(f === "bim" && (e.kind === "volume" || e.kind === "reshape")));   // bim: a construction as kept (bim.mjs prepare makes it again)
    if (miss.length) return `${e.kind} mangler ${miss.join(", ")} (${e.kind} tar ${Object.keys(k.properties).filter(f => f !== "kind").join(", ")})`;
    if (extra.length) return `${e.kind} tar ikke ${extra.join(", ")} (${e.kind} tar ${Object.keys(k.properties).filter(f => f !== "kind").join(", ")})`;
    return null;
  }
  const VIEW_NAME = { type: "string", enum: Object.keys(VIEWS), description: "isometrisk (from the south-west, from above; default), plan (straight down, north up), N / Ø / S / V (from that side, low), NØ / SØ / SV / NV (from that corner, higher)" };
  /* a picture of a model (render.mjs) and what it shows, in words */
  const hospital = (() => { const ps = site.buildings.filter(b => b.own).flatMap(b => b.ring); return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length, 25]; })();
  async function look(s, a = {}) {
    if (a.saved) {   // a saved view, as the page shows it (U3527): its camera, its «før» on the before
      const st = a.saved.state, png = await picture(withMeshes(st.era === "før" ? site : s), { ...viewOpts(st, s), width: a.width || 1024, height: a.height || 640 });
      return { png, text: `Bildet: den lagrede visningen «${a.saved.name}»${st.caption ? ` (${st.caption.replace(/\.$/, "")})` : ""}${st.cam === "eye" ? "; i øyehøyde, men med smalere linse enn siden" : ""}. Nordpilen øverst til høyre.` };
    }
    s = withMeshes(s);   // a construction's triangles, from what the worker made
    const name = VIEWS[a.view_name] ? a.view_name : "isometrisk", v = { ...VIEWS[name] }, f = a.focus ? aimAt(s, a.focus) : null;
    if (a.focus && !f) throw toolErr(`Fant ikke «${a.focus}» å se på: en fløy, en bygnings id eller et nytt bygg (id eller navn).`);
    if (a.from_direction != null) { v.from = dirDeg(a.from_direction); if (v.plan) delete v.plan; v.tilt ??= 30; }
    if (a.tilt_deg != null && !v.plan) v.tilt = a.tilt_deg;
    const dist = a.distance_m ?? (f ? Math.max(50, f.size * 2.6) : v.plan ? 220 : 330);
    /* a new building's pad (U3566), as the picture shows it: what is dug out and filled, and at which side */
    const fa = a.focus && (s.added || []).find(x => x.id === a.focus || x.name === a.focus), pad = fa?.ground || fa?.lot ? `${fa.name}: ${fa.ground ? groundText(fa.ground) : ""}${lotText(fa.lot) ? ` ${lotText(fa.lot)}` : ""}`.trim() : "";
    const png = await picture(s, { ...v, target: f ? f.target : hospital, dist, focus: f ? f.ids : [], width: a.width || 1024, height: a.height || 640 });
    const deg = v.from ?? 0, side = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    return { png, text: `Bildet: ${v.plan ? "plan, rett ovenfra, nord opp" : `sett fra ${side}, ${Math.round(v.tilt)}° over bakken`}, ${Math.round(dist)} m unna${f ? `, ${f.name} i oransje` : ""}. Nordpilen øverst til høyre.${pad ? " " + pad : ""}` };
  }
  /* a saved view (the page's camera, saved.js) as the server's picture takes it (U3527): the orbit's yaw, pitch and
     dist; the person's eye as a camera 1,7 m over the ground there looking at the centre (the picture's narrower lens);
     the plan straight down. Its «før» is drawn on the before */
  const viewOpts = (st, s) => {
    const k = st.kote ?? (st.h != null ? st.h + Math.min(...s.terrain.z.filter(v => v != null)) : groundAt(s, [st.x ?? 0, st.y ?? 0]) + 6), target = [st.x ?? 0, st.y ?? 0, k];
    if (st.mode === "plan") return { plan: true, target, dist: st.dist ?? 220 };
    const from = ((((Math.PI - (st.yaw ?? 0)) * 180 / Math.PI) % 360) + 360) % 360, d = st.dist ?? 300;
    if (st.cam === "eye") {
      const at = [target[0] + Math.sin(from * Math.PI / 180) * d, target[1] + Math.cos(from * Math.PI / 180) * d], up = groundAt(s, at) + 1.7 - k;
      return { target, from, tilt: Math.atan2(up, d) * 180 / Math.PI, dist: Math.hypot(d, up) };
    }
    return { target, from, tilt: (st.pitch ?? 0.6) * 180 / Math.PI, dist: d };
  };
  const shotPicture = (m, st, size = { width: 640, height: 400 }) => picture(withMeshes(st.era === "før" ? site : m.site), { ...viewOpts(st, m.site), ...size });
  const TOOLS = [
    { name: "about_site", tgt: "read", title: "Tomta og fløyene", ro: true, schema: S({ target: TARGET, draft: OLD }),
      description: "The site and the hospital as its wings (Sentralblokka, Østfløy, Østre nordfløy, Midtfløy …): each wing's years, storeys, construction, facade, footprint and kote from ground to roof, how sure the identification is, the storeys that have a drawn plan, and where the facts come from; the named streets and places around it (OpenStreetMap), each with how far and on which side of the lot it is. Positions are metres east and north of the site origin (EPSG:25833), heights NN2000.",
      run: async (a, req) => { const m = model(a.draft, req), names = [...new Set(m.floors.map(f => f.name))];
        return { name: site.name, address: "Dronninggata 28, 3019 Drammen", gnr_bnr: "114/272", lot_area_m2: site.lot.area_m2, heights: "NN2000", origin_utm33: site.origin,
          wings: (m.site.wings || []).map(w => { const o = wingOut(w, false); return { id: o.id, name: o.name, sure: o.sure, built: o.built, storeys: o.storeys, footprint_m2: o.footprint_m2, ground_kote: o.ground_kote, top_kote: o.top_kote, levels_known: o.levels.length }; }),
          drawn_storeys: names.map(n => ({ storey: n, sheets: m.floors.filter(f => f.name === n).map(f => f.source) })),
          streets: streetsAround(places ? await places(3000) : [], site.lot.ring.reduce((a, p, i, r) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0])),
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
        if (!fs.length) throw toolErr(`Ingen fasadetegning av ${w.name} med vinduer ennå; tegnet er ${[...new Set((site.facades || []).map(f => f.building))].map(id => wingsAll().find(x => x.id === id)?.name || id).join(", ")}. For å se fasaden: look (from_direction mot siden) gir deg et bilde, show_building {mode: "fasade", wing: "${w.name}"} viser den for personen, med vinduene etter foto.`);
        const lv = (w.levels || []).slice().sort((x, y) => x.kote - y.kote), band = z => [...lv].reverse().find(l => l.kote <= z + 0.3)?.name || "under laveste etasje";
        return { wing: w.name, facades: fs.map(f => { const per = {}; for (const o of f.openings) { const k = band(o.z[0]); per[k] ||= {}; per[k][o.kind] = (per[k][o.kind] || 0) + 1; }
          return { id: f.id, name: f.name, wall_length_m: round1(Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1])), per_storey: per,
            openings: f.openings.map(o => ({ kind: o.kind, along_m: o.u.map(round1), sill_kote: round1(o.z[0]), head_kote: round1(o.z[1]), panes: o.panes.length })), sheet: f.src.map(docRef) }; }) }; } },
    /* documents: see below */
    { name: "try_change", tgt: "write", title: "Prøv en endring", writeIf: a => !!a.version, schema: S({ edits: { type: "array", items: EDIT, minItems: 1, maxItems: 50 }, target: { ...TARGET, description: TARGET.description + ". Signed out with none open: a new draft (a day, no login)" }, draft: OLD, version: OLD,
      include_screenshot: { type: "boolean", description: "A picture of the model after the change comes back (default true). false for the middle steps of a sequence; look at the last one" },
      view_name: VIEW_NAME }, ["edits"]),
      description: "Tries changes on the model: a storey's kote in a wing, a fact on a wing's card, a room's name, use or area, a note, and the after: demolish or restore buildings, balconies on a wing, a ready-made part (a greenhouse, stair, railing, balcony or pool basin: part, before any free geometry), a construction (a structure an IfcOpenShell script builds as BIM, in metres, its foot at params.ground: the contract is in the construction kind's description), and the ground (a pool or pond is kind surface with surface water; pool: true makes it a dug swimming pool with a level edge, its water flat): surfaces, paths, trees (hagekart's species) and felling, and earthworks (kind ground: level a terrace or a yard, dig into a slope or fill it up, with a slope or a retaining wall round it; the result says how many m³ are dug out and filled). Each is checked; those that pass go into the target. Leave target out: signed in, the changes go into the version the person has open on the website (their «Mitt etter») and their page redraws with them; signed out, into a draft that lasts a day. The result names where they went (version or draft), how many changes it now has and its link: report from that. The before, the shared model, is never changed. Say where each change comes from in why. " +
        "The result has a picture of the model after it (a plain massing drawing: new buildings in their material's colour, the newest picked out in orange, a north arrow top right) and fit: for each new building what its foot stands on (the ground, a roof, nothing = it floats, or buried), the ground under it, the wings it overlaps (m²) and the nearest gap; and for each new surface (a pool, a lawn, paving) what it covers, by m²: buildings, and the footpaths, pavements and roads there are today (from OSM and NVDB). A pool or a lawn over a path cuts the path: say so, and move it or lay a new path round it, unless that is what was asked. Look at both before you tell the person what you made: say what you see, and if it is wrong (it floats, cuts into a wing, stands on the wrong side, is not the shape asked for), fix it with another try_change (reshape, or demolish its id and build it again) before you answer. look gives other views.",
      run: async (a, req) => {
        let d, v = null;
        if (!a.version && !a.draft && versions && userOf(req)) a = { ...a, version: openOf(userOf(req)).id };
        if (a.version) { v = ownVersion(a.version, req); d = { edits: v.edits }; }
        else if (a.draft) d = draftOf(a.draft); else { if (drafts.size >= MAX_DRAFTS) for (const [k, x] of drafts) if (Date.now() - x.t > DRAFT_MS || drafts.size >= MAX_DRAFTS) dropDraft(k); d = { id: newId(), t: Date.now(), edits: [] }; drafts.set(d.id, d); }
        const ok = [], bad = [], ids = {}, max = v ? MAX_VERSION_EDITS : MAX_EDITS;
        /* a later change in the same call to a new building that got another id goes to the id it got */
        for (const [i, e0] of a.edits.entries()) { try { const e = e0?.kind !== "volume" && e0?.id != null && ids[e0.id] ? { ...e0, id: ids[e0.id] } : e0, f = fieldsOf(e); if (f) throw new Error(f); const m = applyEdits(site, floors, d.edits), pe = await prepare(e, m.site), { _ran, ...e1 } = pe, c = checkEdit(m.site, m.floors, e1); if (d.edits.length >= max) throw new Error(`At most ${max} changes`);
            /* one already there is not added again (21:23Z: Anton sent «demolish alle» and every restore with each try, 56 changes and no pool) */
            /* a new building that differs only in the id it was given is the same one sent again */
            const bare = x => JSON.stringify(x.kind === "volume" ? { ...x, id: undefined } : x);
            const same = d.edits.findIndex(x => bare(x) === bare(c)); if (same >= 0) throw new Error(`Finnes allerede som endring nr. ${same + 1}; den står, send bare det nye`);
            /* pm 11:35Z: balconies on a facade that has some already replace them (a second edit stacked 454 on 251) */
            let replaced = null;
            if (c.kind === "balconies") { const fc = new Set(balconyFaces(m.site, c));
              for (let k = d.edits.length - 1; k >= 0; k--) { const x = d.edits[k]; if (x.kind !== "balconies" || x.wing !== c.wing) continue;
                const both = balconyFaces(m.site, x).filter(b => fc.has(b)); if (!both.length) continue;
                d.edits.splice(k, 1); replaced = `Erstattet de eldre balkongene på fasaden mot ${both.map(b => `${b}°`).join(" og ")} (endring nr. ${k + 1}); bare de nye står.`; }
            }
            d.edits.push(c); ok.push(_ran ? { ...slim(c), worker: { printed: _ran.result, triangles: _ran.triangles, buildings: _ran.buildings, storeys: _ran.storeys, foot_kote: _ran.foot_kote, top_kote: _ran.top_kote, ...(_ran.warning ? { warning: _ran.warning } : {}) } } : slim(c)); if (replaced) ok[ok.length - 1] = { ...ok[ok.length - 1], replaced }; if (c.kind === "volume" && e.id != null && c.id !== String(e.id)) ids[e.id] = c.id; } catch (x) { bad.push({ index: i, error: x.message }); } }
        const m = applyEdits(site, floors, d.edits), after = afterOf(m);
        /* a surface's fit over what stands and the ways there are (finding 6: the pool laid over a footpath) */
        /* and the slopes of a new building's pad onto those ways (U3566 d) */
        const wayRings = ways && ((m.site.landscape || []).some(l => l.kind === "surface") || (m.site.added || []).some(a => a.ground?.reach_m)) ? (await ways()).filter(w => !(m.site.roads_removed || []).some(r => r.id === w.id)) : [];   // a removed road section is no way (U3543)
        const fit = [...fitOf(m.site), ...((m.site.landscape || []).some(l => l.kind === "surface") ? surfaceFit(m.site, wayRings) : []), ...padFit(m.site, wayRings)];
        /* an id that was not free or not of the form: the one each got (pm 23:31Z) */
        const named = Object.keys(ids).length ? { ids, ids_note: "The id asked for was taken or not of the form (n and 4-12 letters/digits); each new building got the id shown. Use that one." } : {};
        let out;
        if (v) { if (ok.length) versions.save(v); out = { ...versionOut(v, originOf(req), req), added: ok, rejected: bad, ...named, ...(after ? { after } : {}), ...(fit.length ? { fit } : {}), saved: true }; }
        else { d.t = Date.now(); keepDraft(d);
          out = { draft: d.id, link: draftUrl(originOf(req), d.id), added: ok, rejected: bad, ...named, changes_in_draft: d.edits.length, ...(after ? { after } : {}), ...(fit.length ? { fit } : {}), saved: false,
            note: "Ikke lagret: utkastet varer et døgn. Lagre det som en egen versjon med new_version (from: utkastet), som krever innlogging." }; }
        if (a.include_screenshot === false || !ok.length) return out;
        /* the picture of what it made (the FreeCAD MCP's pattern): aimed at the last new or changed building, else the whole site */
        const last = ok.findLast(e => e.kind === "volume" || e.kind === "reshape"), id = last && (last.id ?? m.site.added?.findLast(x => x.kind === "volume" && x.name === last.name)?.id);
        try { const { png, text } = await look(m.site, { view_name: a.view_name, focus: id && m.site.added?.some(x => x.id === id) ? id : null });
          return { _result: { content: [{ type: "text", text: JSON.stringify(out) }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text }], structuredContent: out } };
        } catch (e) { console.error("look (try_change's picture):", e.message, "| edits:", argsLine({ edits: a.edits }), "| added:", (m.site.added || []).map(x => x.kind).join(",")); return out; } } },
    { name: "propose_sketch", tgt: "read", title: "Vis en skisse først", ro: true, schema: S({ title: { type: "string", maxLength: 100, description: "What the change is, in the person's words (a short title)" },
        edits: { type: "array", minItems: 1, maxItems: 12, items: { type: "object" }, description: "The same edits you would send to try_change for it, as you would send them: nothing is saved by this call" },
        numbers: { type: "array", maxItems: 8, items: { type: "object", properties: { label: { type: "string", maxLength: 30 }, value: { type: "string", maxLength: 40 } }, required: ["label", "value"], additionalProperties: false }, description: "The key numbers the person must see: count, size, facing, e.g. {label: «Antall», value: «454»}, {label: «Mot», value: «120°»}" },
        focus: { type: "string", description: "A wing, building id or new building id to centre the plan on; default the first thing the edits add or change" }, distance_m: { type: "number", minimum: 30, maximum: 1200, description: "How wide the plan shows, default fitted to what is built" } }, ["title", "edits"]),
      description: "Shows the person a quick plan (north up, with its scale bar) of a proposed change BEFORE you build it, with its key numbers, one «Bygg det» button, and tools for them to draw pen strokes, drop pins with notes and write feedback on it (U3635). Use it for a LARGE or UNCLEAR ask: a whole facade of balconies, a new building or a greenhouse in a place not named, earthworks, several changes at once, or when the person left a choice open. Do NOT use it for a small clear edit (rename, one balcony of a given size and place, move a building, one tree): send those straight to try_change. Nothing is saved: the edits are only drawn. After it, say in one short line what you propose and wait: when the person presses «Bygg det» a message «Bygg det: <title>» comes: then send the same edits to try_change. Feedback comes as a message with a picture and the marks: strokes and pins as [east, north] in site metres from the site origin; change the proposal by it and show a new sketch if it changed much. Needs the login.",
      run: async (a, req) => {
        const who = userOf(req); if (!who) throw toolErr("Skissen vises til en som er logget inn.");
        const open = versions ? versions.get(pages?.open.get(who)) : null, id = open?.owner === who ? open.id : null, base = id ? editsOf(id, req) : [], ok = [], bad = [];
        let cur = applyEdits(site, floors, base);
        for (const [i, e0] of a.edits.entries()) { try { const f = fieldsOf(e0); if (f) throw new Error(f); const pe = await prepare(e0, cur.site), { _ran, ...e1 } = pe, c = checkEdit(cur.site, cur.floors, e1); ok.push(c); cur = applyEdits(site, floors, [...base, ...ok]); } catch (e) { bad.push({ n: i + 1, kind: e0?.kind, error: String(e.message || e).slice(0, 300) }); } }
        if (!ok.length) throw toolErr(`Ingen av endringene kunne tegnes: ${bad.map(b => `nr. ${b.n} (${b.kind}): ${b.error}`).join("; ")}`);
        const s = withMeshes(cur.site), before = new Set((site.added || []).concat(applyEdits(site, floors, base).site.added || []).map(x => x.id));
        const made = (s.added || []).find(x => !before.has(x.id)), want = a.focus || made?.id || ok.map(e => e.wing || e.id).find(Boolean), f = want ? aimAt(s, want) : null;
        const W = 1024, H = 640, fresh = (s.added || []).filter(x => !before.has(x.id)), picked = fresh.length ? fresh.map(x => x.id) : f ? f.ids : [];
        /* the plan is fitted to what is new (its points, with a margin), so the proposal is big in the picture; else to the focus */
        const pts = fresh.flatMap(x => [...(x.parts || []).flatMap(p => p.axis || []), ...(x.ring || []), ...(x.from ? [x.from, x.to] : [])]).filter(q => Array.isArray(q) && q.length >= 2 && q.every(Number.isFinite));
        const lo = pts.length ? [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1]))] : null, hi = pts.length ? [Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))] : null;
        const span = lo ? Math.max((hi[0] - lo[0]) / 1.6, hi[1] - lo[1], 12) * 1.3 : 0, tan = Math.tan(19 * Math.PI / 180);
        const dist = a.distance_m ?? (lo ? Math.max(30, span / (2 * tan)) : f ? Math.max(50, f.size * 2.6) : 220), target = lo ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, f?.target?.[2] ?? 25] : f ? f.target : hospital, k = (H / 2) / (dist * tan);
        const png = await picture(s, { plan: true, accent: true, target, dist, focus: picked, width: W, height: H });
        /* the legend: what is new, in the plan's strong orange (balconies by their count, the rest by name) */
        const legend = "Nytt: " + (fresh.length ? fresh.slice(0, 4).map(x => x.kind === "balconies" && x.count ? `${x.count} balkonger mot ${(x.facades || []).map(y => y.bearing + "°").join(" og ") || "fasaden"}` : x.name).join("; ") : ok.slice(0, 3).map(e => e.name || e.kind).join("; ")) + ".";
        const sid = newId();
        const numbers = (a.numbers || []).slice(0, 8).map(n => ({ label: String(n.label).slice(0, 30), value: String(n.value).slice(0, 40) }));
        const ev = { type: "sketch", id: sid, title: String(a.title).slice(0, 100), legend, numbers, url: `api/skisse/${sid}.png`, frame: { centre: [target[0], target[1]], k }, size: [W, H], at: new Date().toISOString() };
        sketchSave(sid, { ...ev, person: who }, png); notify?.(who, "sketch", ev);
        return { _result: { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: `Skissen «${a.title}» er vist for personen i samtalen, med «Bygg det». Ingenting er lagret.${bad.length ? ` Ikke tegnet: ${bad.map(b => `nr. ${b.n} (${b.error})`).join("; ")}.` : ""} Si i én kort linje hva du foreslår og vent: «Bygg det: ${a.title}» betyr at du sender de samme endringene til try_change.` }], structuredContent: { shown: true, sketch: sid, drawn: ok.length, not_drawn: bad } } };
      } },
    { name: "show_draft", tgt: "read", title: "Se et utkast eller en versjon", ro: true, schema: S({ target: TARGET, draft: OLD }),
      description: "The changes in a draft or a saved version, in order, numbered, with what the after demolishes and builds, and the link that shows it on the website.",
      run: async (a, req) => { const isV = /^v.{8}$/.test(String(a.draft)), edits = editsOf(a.draft, req), after = afterOf(applyEdits(site, floors, edits)), o = originOf(req);
        return { ...(isV ? versionOut(versionOf(a.draft, req), o, req) : { draft: String(a.draft), link: draftUrl(o, a.draft) }), changes: edits.map((e, i) => ({ n: i + 1, ...e })), ...(after ? { after } : {}), saved: isV, saved_views: viewsOut(viewsOf(a.draft, req)) }; } },
    { name: "make_shots", tgt: "draft", title: "Lag en bildeserie", writeIf: a => /^v.{8}$/.test(String(a.draft)), schema: S({ target: TARGET, draft: OLD, pictures: { type: "boolean", description: "Leave out (true): each shot comes back as a small picture for you to look at" } }),
      description: "Puts together 4–6 good shots of the version or draft that also explain it (U3527): the whole from the air, each new building at eye level from the nearest named street, a torn-down wing before and after from the same place, and the plan, each with a caption. They are saved as its views (in place of the last series), and the page plays them as «Bildeserie» under Visninger, with Før/Etter on the pairs. For «lag noen gode bilder», «sett sammen en presentasjon», «vis forslaget for noen». Say what each shot shows.",
      run: async (a, req) => {
        const { shots } = await makeShots(a.draft, req), o = originOf(req), isV = /^v.{8}$/.test(String(a.draft)), m = model(a.draft, req);
        const out = { draft: String(a.draft), shots: shots.map(s => ({ name: s.name, caption: s.state.caption, camera: s.state.cam === "eye" ? "øyehøyde" : s.state.mode })), link: `${o}/${isV ? `?versjon=${a.draft}` : `?utkast=${a.draft}`}`,
          note: "On the page: Visninger › Bildeserie plays them, one tap a shot; «Skriv ut» prints them, one A4 page each. Below, each shot as you see it (a narrower lens than the page's at eye level): say what each shows, and if one shows the wrong thing or nothing, say so and offer another (show_building save_as, or look saved_view to look again)." };
        if (a.pictures === false) return out;
        /* Anton looks at each shot before it says what they show (U3527): small pictures, one after another */
        const content = [{ type: "text", text: JSON.stringify(out) }];
        for (const s of shots) {
          try { const png = await shotPicture(m, s.state); content.push({ type: "text", text: `${s.name}: ${s.state.caption}` }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }); }
          catch (e) { content.push({ type: "text", text: `${s.name}: fikk ikke tegnet bildet (${e.message}).` }); }
        }
        return { _result: { content, structuredContent: out } };
      } },
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
    { name: "list_parts", title: "Ferdige deler", ro: true, schema: S({}),
      description: "The ready-made BIM parts the worker builds (U3620): each one's name, what it is, its settings with default and limits, and the IFC it makes (property sets, quantities, materials). Look here FIRST when the person asks for a swimming pool basin, a stair, a railing, a balcony or a greenhouse (a polygon of 3–8 sides, or a geodesic dome): place one with try_change kind part, before you write any geometry or script.",
      run: async () => { const ps = await listParts(); return { parts: Object.entries(ps).map(([id, v]) => ({ part: id, name: v.no, what: v.say, engine: v.engine, makes: v.classes, settings: v.params })), use: "try_change kind part: part, from, to, params (the settings you want; the others take their defaults)" }; } },
    { name: "find_models", title: "Finn modeller i åpne bibliotek", ro: true, schema: S({ query: { type: "string", description: "What to look for, in English mostly (greenhouse, window, bench, tree, chair): the libraries are in English" } }, ["query"]),
      description: "Searches open libraries for a model to bring in (U3571): Poly Haven (furniture, props, plants; CC0; glTF) and the FreeCAD parts library (architectural and other parts; CC-BY-3.0, which asks that its author be named; STEP). Each hit has its licence: say it to the person before you use one. link_only lists the libraries that need an account or forbid a program downloading (BIMobject, NBS, bimstore, 3D Warehouse, Sketchfab …): give the person those links to look and download themselves (then «Hent fil» on the page), never fetch from them. Needs the login.",
      run: async (a, req) => { if (!userOf(req)) throw toolErr("Å lete i bibliotekene krever innlogging."); return libs.find(a.query); } },
    { name: "fetch_model", title: "Hent en modell", write: true, schema: S({ url: { type: "string", description: "A url from find_models (polyhaven:<id>, or a raw.githubusercontent.com / github.com release / Wikimedia address)" },
      licence: { type: "string", description: "Its licence as its page states it; the libraries' own are filled in" }, unit: { type: "string", enum: ["m", "cm", "mm", "in", "ft"], description: "Only for OBJ or STL, or a DXF that says none" } }, ["url"]),
      description: "Fetches a model and reads it in as an upload is (IFC, STEP, glTF, OBJ, STL, DXF, DWG; at most 100 MB, 60 s), only from the open sources find_models gives: any other address is refused with a link for the person to open themselves. Say its licence before you place it. Then place it with try_change kind import (file, from, to; licence and source are kept from here). Needs the login.",
      run: async (a, req) => {
        const who = userOf(req); if (!who) throw toolErr("Å hente en modell krever innlogging.");
        let got; try { got = await libs.get(String(a.url || "")); }
        catch (e) { if (e.link) throw toolErr(`${e.message} Gi personen lenken i stedet: ${e.link.name} (${e.link.why}), ${e.link.search("")}`); throw e; }
        const licence = got.licence || (a.licence ? String(a.licence).slice(0, 120) : ""); if (!licence) throw toolErr("Si lisensen fra kildens side (licence), eller «ukjent».");
        const r = await importFile(got.bytes, { filename: got.filename, unit: a.unit, by: who, fetched_from: got.url, licence });
        return { ...r, licence, source: got.url, next: "Say the licence to the person, then place it: try_change with {kind: 'import', file, from, to}." }; } },
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
        saved_view: { type: "string", description: "A saved view by its name or id (show_draft's saved_views, or a shot make_shots made): the picture from its camera, its «før» on the before; the other view fields are not needed" },
        draft: DRAFT, width: { type: "integer", minimum: 320, maximum: 1280 }, height: { type: "integer", minimum: 240, maximum: 960 } }),
      description: "A picture of the model for you to look at: the terrain, the lot line (red dashes), the buildings as massing (the hospital light, neighbours grey), new buildings in their material's colour (glass pale green), trees as cones, a north arrow top right; plan has a 50 m scale bar bottom left. With target: that version or draft; without, the version the person has open. Use it to check your own work from the side that shows it best, e.g. S for something built on the south side, plan for where it stands. The person does not see this picture; to show them, use show_building.",
      run: async (a, req) => {
        const who = userOf(req), open = who && versions ? versions.get(pages?.open.get(who)) : null, id = a.draft || (open?.owner === who ? open.id : null), m = model(id, req);
        if (a.saved_view) { if (!id) throw toolErr("Ingen lagrede visninger: ingen versjon eller utkast er åpen."); try { a = { ...a, saved: findView(viewsOf(id, req), a.saved_view) }; } catch (e) { throw toolErr(e.message); } }
        let png, text; try { ({ png, text } = await look(m.site, a)); }
        catch (e) { if (e.tool) throw e; console.error("look:", e.message, "|", argsLine(a), "| added:", (m.site.added || []).map(x => x.kind).join(",")); throw toolErr(`Fikk ikke tegnet bildet (${e.message}). Prøv en annen visning, eller si fra til Morten.`); }
        return { _result: { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: text + (id ? ` Modellen: ${id}.` : " Modellen slik den står i dag.") }] } }; } },
    { name: "show_building", tgt: "read", title: "Vis bygget", ro: true, ui: true, schema: S({
        storey: { ...STOREY, description: STOREY.description + ". Cuts every wing 1.2 m above that floor, as a plan is cut; leave out for the whole site" },
        wing: { ...WING, description: "Look at this wing and ring it in yellow. Needed for fasade, tverrsnitt and lengdesnitt: the wing named, e.g. «fasaden mot sør på Sentralblokka» is {mode: \"fasade\", wing: \"Sentralblokka\", from_direction: \"S\"}" },
        mode: { type: "string", enum: ["3d", "plan", "tverrsnitt", "lengdesnitt", "fasade"], description: "3d: tilted view (default). plan: straight down, north up, with scale bar. fasade: the wing's facade seen square on from from_direction (N, Ø, S or V; needs wing), what stands in front taken away; windows from the drawings where a facade sheet exists (openings), else from photos. tverrsnitt / lengdesnitt: a section across or along the wing (needs wing) through its middle, looked at square on, with what the cut goes through filled black and the wing's storeys and kote on the right" },
        from_direction: { type: ["string", "number"], description: "Where the camera stands: N, NØ, Ø, SØ, S, SV, V, NV or degrees (3d)" },
        tilt_deg: { type: "number", minimum: 5, maximum: 85, description: "Camera angle above the ground (3d): about 60-75 for fugleperspektiv (a bird's-eye view), 10-20 for a view from the street" },
        distance_m: { type: "number", minimum: 30, maximum: 1200 },
        drawn_section: { type: "string", description: "A drawn section's id from about_wing (drawn_sections): the model cut where that sheet cuts, the sheet shown beside it" },
        eye_level: { type: "boolean", description: "As a person standing on the ground sees it: the eye 1.7 m over the terrain, a wider lens, looking at the wing or new building (wing). For «fra gata», «i øyehøyde», «slik en fotgjenger ser det». Takes from_direction and distance_m, or from_place" },
        picture: { type: "boolean", description: "true: the picture of this view comes back to you as well, to see what the person sees (at eye level, from a place, or a saved view; look cannot stand at eye level)" },
        from_place: { type: "string", description: "Stand in this street or place by its name (OpenStreetMap: e.g. Welhavens gate, Dronninggata, Konggata, Tybrings gate, Bragernes gravlund; about_site's streets lists them all), at its point nearest to what is looked at, at eye level. For «fra Dronninggata»" },
        save_as: { type: "string", maxLength: 60, description: "Keep this view under this name on the version (the person's own, or a draft), e.g. «Fra Bragernes»; the same name again moves it. For «husk denne visningen» / «lagre visningen»" },
        saved_view: { type: "string", description: "Go to a saved view, by its name or id (show_draft lists saved_views); the other view fields are not needed" }, target: TARGET, draft: OLD }),
      description: "Shows the hospital in 3D inside the chat: terrain, lot, the wings with their drawn facades and the operating module, and with a storey chosen every wing cut 1.2 m above that floor with the drawn walls and rooms (names and m² when zoomed in). Plan mode looks straight down like a drawing, with a scale bar; tverrsnitt and lengdesnitt cut one wing through its middle like a drawn section (outer walls are an assumed 0.35 m; inner walls only where a floor plan is drawn). With target: that version or draft; without, the version the person has open. The person can turn, zoom and change storey. You do not see this view: never describe what it shows from it, unless you asked for its picture (picture: true). To see the model yourself, use picture: true or look. Needs a chat app that shows MCP Apps, or the website open (the pill on sykehus.gulden.no moves the person's page); otherwise give the link.",
      run: async (a, req) => { const who = userOf(req), on = a.draft || (who && pages?.open.get(who)) || (who && versions && openFor(req)?.id) || null;
        /* a saved view (U3562) is a view as this tool makes one: its camera, mode, storey and wing */
        let view, kept = null, eyeSaid = "";
        if (a.saved_view) { if (!on) throw toolErr("Ingen lagrede visninger: ingen versjon eller utkast er åpen."); try { kept = findView(viewsOf(on, req), a.saved_view); } catch (e) { throw toolErr(e.message); } view = { ...viewOf({ draft: a.draft }, req), ...kept.state }; }
        else if (a.eye_level || a.from_place) {
          /* a new building is looked at by its name or id too (aimAt), which viewOf's wing does not know */
          const m = model(on, req), isWing = a.wing && wingOf(site, a.wing);
          const { wing: _w, ...rest } = a, e = await eyeView(m, a.wing, a); view = { ...viewOf(isWing ? a : rest, req), ...e.view }; eyeSaid = e.said;
        } else view = viewOf(a, req);
        if (a.save_as != null && !a.saved_view) {
          if (!on) throw toolErr("Å lagre en visning trenger et forslag: gjør en endring først (try_change), eller åpne en versjon.");
          const { draft: _d, key: _k, guessed: _g, ...state } = view; if (!state.mode) state.mode = "3d";
          const l = changeViews(on, req, l => addView(l, { name: a.save_as, state, by: "anton" }, VIEW_SPEC)); kept = l.find(x => x.name.toLowerCase() === String(a.save_as).replace(/\s+/g, " ").trim().toLowerCase()) || l.at(-1);
        }
        const w = view.wing && wingOf(site, view.wing);
        /* through the pill: the person's open pages go to this view (assistant.mjs pages.show), else say they did not */
        /* a version's id names a version, not a draft (21:05Z: the page went to ?utkast=v…, a draft that is not there) */
        const { draft: dv, guessed, ...rest } = view, isV = /^v.{8}$/.test(String(dv ?? ""));
        const moved = who && pages ? pages.show(who, { ...rest, ...(dv && !isV ? { draft: dv } : { version: isV ? dv : pages.open.get(who) || null }) }) : null;
        /* the picture for Anton too (pm 05:36Z: «Jeg ser ikke selve bildet» after a view from Welhavens gate): where the view has its own camera */
        let png = null;
        if (a.picture && view.x != null && view.y != null && view.mode !== "section") try { png = await shotPicture(model(on, req), view); } catch (e) { console.warn("show_building picture:", e.message); }
        const seen = !!png;
        const deg = a.from_direction != null ? dirDeg(a.from_direction) : null;
        const cam = view.mode === "section" || view.mode === "plan" ? "" : [deg != null ? `sett fra ${dirWord(deg)}` : "", a.tilt_deg != null ? `${Math.round(clamp(+a.tilt_deg, 5, 85))}° over bakken${a.tilt_deg >= 50 ? " (fugleperspektiv)" : ""}` : "", a.distance_m != null ? `${Math.round(clamp(+a.distance_m, 30, 1200))} m unna` : ""].filter(Boolean).join(", ");
        const said = kept ? (a.saved_view ? `Den lagrede visningen «${kept.name}». ` : `Lagret som «${kept.name}» i ${/^v.{8}$/.test(on) ? `versjonen ${on}` : `utkastet ${on}`}; personen finner den under Visninger. `) : "";
        const text = `${said}${guessed ? `Viser ${guessed}; si fra om du mente en annen fløy (wing). ` : ""}Sykehustomta: ${view.storey ? `${view.storey}, snitt 1,2 m over gulv` : "hele anlegget"}${w ? `, ${w.name}` : ""}, ${view.mode === "plan" ? "plan" : view.section === "fasade" ? `fasaden mot ${SIDE_WORD[view.side]}, sett rett på` : view.mode === "section" ? (view.section === "lengde" ? "lengdesnitt" : "tverrsnitt") : eyeSaid ? `3D, ${eyeSaid}` : `3D${cam ? ` ${cam}` : ""}`}${view.draft ? `, utkast ${view.draft}` : ""}${seen ? ". The picture above is what you see of it (massing; the person's view also has the drawn facades)" : `. You have not seen this view (${view.cam === "eye" || kept ? "picture: true to see it" : "use look for a picture"})`}. On the web: ${originOf(req)}/${view.draft ? (isV ? `?versjon=${view.draft}` : `?utkast=${view.draft}`) : ""}${moved === true ? " The person's open page on the website has moved to this view." : moved === false ? " The person has no page of the website open, so nothing moved there; say so, and give the link." : ""}`;
        return { _result: { content: [...(png ? [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] : []), { type: "text", text }], structuredContent: { app: "sykehus", view, ...(kept ? { saved_view: { id: kept.id, name: kept.name } } : {}) } } }; } },
  ];
  /* the writes one at a time, from Anton and from the page alike, and each one a line in the log (pm 23:31Z: two
     changes left voy_p_Vm2 and nothing said how): «endring <version|draft> <kinds|undo n> <before>→<after> <who>» */
  let writes = Promise.resolve();
  for (const t of TOOLS.filter(t => t.name === "try_change" || t.name === "undo_change")) {
    const run = t.run;
    t.run = (a, req) => {
      const p = writes.then(async () => {
        const out = await run(a, req), s = out?._result?.structuredContent ?? out;
        const n = s.changes_in_draft ?? (typeof s.changes === "number" ? s.changes : null);
        const what = t.name === "undo_change" ? `undo ${a.n}` : (s.added || []).map(e => e.kind).join(",") || "ingen";
        const before = n == null ? "?" : t.name === "undo_change" ? n + 1 : n - (s.added || []).length;
        console.log(`endring ${s.version || s.draft || a.version || a.draft || "?"} ${what} ${before}→${n ?? "?"} ${userOf(req) || "ute"}${s.rejected?.length ? ` (${s.rejected.length} avvist)` : ""}`);
        return out;
      });
      writes = p.catch(() => {});
      return p;
    };
  }
  const short = x => typeof x === "string" ? JSON.stringify(x.length > 24 ? x.slice(0, 24) + "…" : x) : typeof x === "number" || typeof x === "boolean" || x == null ? String(x)
    : Array.isArray(x) ? `[${x.length}]` : `{${Object.keys(x).slice(0, 12).join(",")}}`;
  const argsLine = a => !a || typeof a !== "object" ? short(a) : Object.entries(a).slice(0, 16).map(([k, v]) =>
    k === "edits" && Array.isArray(v) ? `edits=[${v.slice(0, 8).map(e => e && typeof e === "object" ? `${e.kind}{${Object.keys(e).filter(k => k !== "kind").join(",")}}` : short(e)).join(" ")}]`
    : k === "edit" && v && typeof v === "object" ? `${v.kind}{${Object.entries(v).filter(([k]) => !["kind", "why", "note", "value", "name"].includes(k)).map(([k, x]) => `${k}=${short(x)}`).join(",")}}`
    : ["why", "note", "text", "title", "value"].includes(k) ? `${k}=…` : `${k}=${short(v)}`).join(" ");
  const BY = Object.fromEntries(TOOLS.map(t => [t.name, t]));
  /* what each tool's structuredContent holds (outputSchema, 2025-06-18+): the keys it has, none of them required, so a
     result with more or fewer still fits; look has none (its answer is a picture and words) */
  const O = (props, d) => ({ type: "object", ...(d ? { description: d } : {}), properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === "string" ? { type: v } : v])), additionalProperties: true });
  const TARGET_OUT = { draft: "string", version: "string", link: "string" };
  const OUTPUT = {
    about_site: O({ name: "string", address: "string", gnr_bnr: "string", lot_area_m2: "number", heights: "string", origin_utm33: "array", wings: "array", streets: "array", drawn_storeys: "array", bim: "string", sources: "array", documents: "number", notes: "array", ...TARGET_OUT }),
    about_wing: O({ id: "string", name: "string", aliases: "array", sure: "boolean", built: { type: ["string", "null"] }, storeys: { type: ["string", "number", "null"] }, footprint_m2: "number", ground_kote: "number", top_kote: "number", levels: "array", drawn_storeys: "array", facades: "array", facade_bearings: { type: "array", description: "Each facade: the way it faces (bearing, degrees from north) and its length; balconies take one as face" }, window_bays: { type: "array", description: "Per facade (face: the bearing it faces, the number balconies' face takes; length_m): how many window bays it has by the rule the model draws them with (bays), and the bay (m): for balconies one per window on that face" }, drawn_sections: "array", sources: "array", draft_changes: "array", notes: "array", ...TARGET_OUT }),
    storeys: O({ storeys: "array" }),
    floor_plan: O({ storey: "string", sheets: "array", per_wing: "object", rooms: "array" }),
    openings: O({ wing: "string", facades: "array" }),
    show_draft: O({ changes: "array", after: "object", saved: "boolean", saved_views: "array", ...TARGET_OUT }),
    list_versions: O({ versions: "array", you: { type: ["string", "null"] } }),
    search_documents: O({ query: "string", documents: "array", more: "number" }),
    read_document: O({ id: { type: ["string", "number"] }, title: "string", pages: "array", next_page: { type: ["number", "null"] } }),
    list_documents: O({ documents: "array" }),
    try_change: O({ added: { type: "array", description: "The changes that went in, as checked" }, rejected: { type: "array", description: "{index, error} for each refused" }, ids: { type: "object", description: "An asked id that was taken: the id each got" },
      changes_in_draft: "number", after: "object", fit: "array", saved: "boolean", note: "string", ...TARGET_OUT }, "What went in and what was refused, and where"),
    show_building: O({ app: "string", view: "object", saved_view: "object" }),
    make_shots: O({ shots: { type: "array", description: "{name, caption, camera} in the order shown" }, note: "string", ...TARGET_OUT }),
  };
  /* the Gulden mark (gulden-ai's, Morten 00:35Z), served from here */
  const ICONS = o => [{ src: `${o}/icons/icon-192.png`, mimeType: "image/png", sizes: ["192x192"] }, { src: `${o}/icons/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }];
  const serverInfo = o => ({ ...SERVER_INFO, icons: ICONS(o), websiteUrl: o });
  /* destructive: what takes a change out; idempotent: the reads, and what sets a value to the same again */
  const DESTRUCTIVE = new Set(["undo_change"]), IDEMPOTENT = new Set(["set_sharing", "rename_version"]);
  const toolList = (o = "") => TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.schema, ...(OUTPUT[t.name] ? { outputSchema: OUTPUT[t.name] } : {}), ...(o ? { icons: ICONS(o) } : {}),
    annotations: { title: t.title, readOnlyHint: !!t.ro, destructiveHint: !t.ro && DESTRUCTIVE.has(t.name), idempotentHint: !!t.ro || IDEMPOTENT.has(t.name), openWorldHint: false },
    ...(t.write ? { securitySchemes: [{ type: "oauth2", scopes: [SCOPE] }] } : t.writeIf ? { securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [SCOPE] }] } : {}),
    ...(t.ui ? { _meta: { ui: { resourceUri: APP_URI, visibility: ["model", "app"] } } } : {}) }));

  // ---------- JSON-RPC ----------
  /* 2026-07-28 CacheableResult: lists and the app change only with a deploy, but deploys come often, so a minute (pm
     21:55Z: gulden-ai kept show_building without save_as after a deploy); the version names the tool list, so a client
     that compares serverInfo sees a new one at once */
  const CACHE = { ttlMs: 60e3, cacheScope: "public" };
  SERVER_INFO.version = `0.2.0+${createHash("sha256").update(JSON.stringify(toolList())).digest("hex").slice(0, 10)}`;
  async function rpc(req, msg) {
    const { method, params = {} } = msg;
    const caps = { tools: { listChanged: false }, resources: {}, extensions: { [M("ui")]: { mimeTypes: ["text/html;profile=mcp-app"] } } };
    /* 2026-07-28: the version comes with every request; a version we do not speak is an error, none means an older client */
    const asked = params._meta?.[M("protocolVersion")];
    if (asked && !VERSIONS.includes(asked)) throw Object.assign(err(-32022, `Unsupported protocol version ${asked}`), { data: { supported: VERSIONS } });
    switch (method) {
      case "initialize": return { protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1], capabilities: caps, serverInfo: serverInfo(originOf(req)), instructions: INSTRUCTIONS };
      case "server/discover": return { supportedVersions: VERSIONS, capabilities: caps, serverInfo: serverInfo(originOf(req)), instructions: INSTRUCTIONS };
      case "ping": return {};
      case "tools/list": return { tools: toolList(originOf(req)), ...CACHE };
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
        /* a refused call in the log, by its argument names and short values (pm 21:32Z: which key did the model send
           the wing under?); an edit by its kind and field names, no text the person wrote */
        const refused = (why, args = params.arguments) => console.error("refused", params.name, argsLine(args), "→", String(why).slice(0, 120));
        let a; try { a = resolveTarget(t, params.arguments || {}, req); } catch (e) { if (e.tool) { refused(e.message); return { content: [{ type: "text", text: e.message }], isError: true }; } throw e; }
        /* a tool that keeps a version, with no one logged in: the sign-in challenge, so a chat app asks the person to connect */
        if (!who && (t.write || (t.writeIf && t.writeIf(a)))) throw Object.assign(err(401, "Sign-in needed"), { auth: true });
        try {
          auth?.count(req, who); bump("open", 3000, 3600e3);
          const out = await t.run(a, req);
          for (const r of out?.rejected || []) refused(r.error, { edit: a.edits?.[r.index] });
          if (out?._result) return out._result;
          return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
        } catch (e) {
          if (e.tool) { refused(e.message); return { content: [{ type: "text", text: e.message }], isError: true }; }
          throw e;
        }
      }
      default:
        if (method?.startsWith("notifications/")) return undefined;
        throw err(-32601, `Method not found: ${method}`);
    }
  }
  /* GET /mcp/server-card: the Server Card (SEP-2127, Final, extension ext-server-card), at the place it reserves,
     <streamable-http-url>/server-card; who the server is and where to connect, no tools (those are listed live) */
  function handleCard(req, res) {
    const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "access-control-allow-headers": "Content-Type, If-None-Match", "access-control-expose-headers": "ETag" };
    if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, { ...CORS, allow: "GET" }).end();
    const o = originOf(req), body = JSON.stringify({ $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
      name: "no.gulden/sykehus", title: SERVER_INFO.title, version: SERVER_INFO.version,
      description: "The old Drammen hospital: its wings, drawings and documents, and an after designed on them",
      websiteUrl: o, repository: { url: "https://github.com/morteng/sykehus", source: "github" }, icons: ICONS(o),
      remotes: [{ type: "streamable-http", url: `${o}/mcp`, supportedProtocolVersions: VERSIONS }] });
    const tag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    if (req.headers["if-none-match"] === tag) return res.writeHead(304, { ...CORS, etag: tag }).end();
    res.writeHead(200, { ...SECURITY, ...CORS, "content-type": "application/mcp-server-card+json", "cache-control": "public, max-age=3600", etag: tag }).end(req.method === "HEAD" ? undefined : body);
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
          ? { resultType: "complete", ...result, _meta: { ...(result._meta || {}), [M("serverInfo")]: serverInfo(originOf(req)) } } : result });
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
  /* what GET /api/utkast and /api/versjon answer, also sent with a change (U3649), so the page need not ask again */
  const draftBody = d => ({ draft: d.id, edits: d.edits, views: checkViews(d.views, VIEW_SPEC), saved: false });
  const versionBody = v => ({ version: v.id, title: v.title, owner: v.owner, sharing: v.sharing, updated: v.updated, edits: v.edits, views: checkViews(v.views, VIEW_SPEC), saved: true });
  function handleDraft(req, res, id) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const open = { "access-control-allow-origin": "*" };   // the chat app reads it from the host's frame
    try { return send(res, 200, draftBody(draftOf(id)), open); }
    catch { return send(res, 404, { error: "Utkastet finnes ikke (de varer et døgn)." }, open); }
  }
  /* GET /api/versjon/<id>: a saved version for the page's ?versjon=<id>; GET /api/versjoner: all of them, newest first */
  function handleVersion(req, res, id) {
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
    const open = { "access-control-allow-origin": "*" }, v0 = versions?.get(id), key = new URL(req.url, "http://x").searchParams.get("nokkel");
    const v = v0 && versions.visible(v0, userOf(req), key) ? v0 : null;
    return v ? send(res, 200, versionBody(v), open) : send(res, 404, { error: "Versjonen finnes ikke." }, open);
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
      /* the saved views (U3562): {view: "add", name, state} | {view: "rename", id, name} | {view: "remove", id}, on the
         version or draft named, or the person's work */
      if (a.view) {
        const id = String(a.version || a.draft || (me && versions ? work().id : "")); if (!id) throw toolErr("Hvilket forslag?");
        const l = changeViews(id, req, l => a.view === "add" ? addView(l, { name: a.name, state: a.state, by: "person" }, VIEW_SPEC) : a.view === "rename" ? renameView(l, a.id, a.name)
          : a.view === "remove" ? removeView(l, a.id) : (() => { throw new Error("view er add, rename eller remove"); })());
        return send(res, 200, { views: l, ...(a.view === "add" ? { saved: l.find(w => w.name.toLowerCase() === String(a.name || "").replace(/\s+/g, " ").trim().toLowerCase())?.id ?? l.at(-1).id } : {}) });
      }
      if (a.shots) {   // «Lag bildeserie» (U3527): the series made on the open version or this draft
        const id = String(a.version || a.draft || (me && versions ? work().id : "")); if (!id) throw toolErr("Hvilket forslag?");
        if (/^v.{8}$/.test(id)) ownVersion(id, req);
        const { views } = await makeShots(id, req); return send(res, 200, { views });
      }
      if (a.adopt || a.copy || a.fresh || a.rename || a.share || a.unshare) {
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
          /* named after its source, «Ny fasade (kopi)», or «Nytt forslag» (Morten 21:19Z: «Min etter 3 is not a good title»); renamed in the card */
          const from = a.copy ? ownVersion(String(a.copy), req) : null, taken = new Set(versions.list({ owner: me, viewer: me }).map(x => x.title));
          const stem = from ? `${from.title.replace(/ \(kopi( \d+)?\)$/, "")} (kopi` : "Nytt forslag", name = k => from ? `${stem}${k > 1 ? ` ${k}` : ""})` : `${stem}${k > 1 ? ` ${k}` : ""}`;
          let k = 1; while (taken.has(name(k))) k++;
          const v = versions.create(me, name(k).slice(0, 120), from ? structuredClone(from.edits) : []);
          for (const x of versions.list({ owner: me, viewer: me })) if (x.work && x.id !== v.id) { delete x.work; versions.save(x); }
          v.work = true; versions.save(v);
          return send(res, 200, { ...versionOut(v, o, req), nokkel: v.own });
        }
        if (a.unshare) {   // «Gjør privat»: «Del» taken back; the link no longer shows it
          const v = ownVersion(String(a.unshare), req); if (v.sharing !== "privat") { v.sharing = "privat"; versions.save(v); }
          return send(res, 200, versionOut(v, o, req));
        }
        const v = ownVersion(String(a.share), req);   // «Del»: anyone with the link sees it, signed out too
        if (v.sharing === "privat") { v.sharing = "lenke"; versions.save(v); }
        return send(res, 200, versionOut(v, o, req));
      }
      if (me && versions && !a.version && !a.draft && !a.undo) a.version = work().id;
      /* an undo from the page says which change it means; when that is not the change at that number now, nothing is
         taken out (a second tab, or Anton, changed it since the page was drawn) */
      if (a.undo && a.expect !== undefined) {
        const id = String(a.version || a.draft || ""), es = editsOf(id, req), at = es[+a.undo - 1];
        if (JSON.stringify(at) !== JSON.stringify(a.expect)) return send(res, 409, { stale: true, error: `forslaget er endret et annet sted siden siden ble tegnet${at ? `; nr. ${+a.undo} er nå en annen endring` : ""}. Siden er oppdatert; se over og prøv igjen.` });
      }
      const tool = TOOLS.find(t => t.name === (a.undo ? "undo_change" : "try_change"));
      const args = a.undo ? { draft: String(a.version || a.draft || ""), n: +a.undo } : { edits: Array.isArray(a.edits) ? a.edits.slice(0, 50) : [], include_screenshot: false, ...(a.version ? { version: String(a.version) } : a.draft ? { draft: String(a.draft) } : {}) };
      if (!a.undo && !args.edits.length) throw toolErr("Ingen endring.");
      if (!a.undo && args.edits.some(e => !["demolish", "restore", "volume", "reshape", "wing", "import"].includes(e?.kind))) throw toolErr("Fra siden: riv, nye bygg og byggenes navn og opplysninger.");   // the rest goes through Anton
      const out = await tool.run(args, req), mine = out.version && versions.get(out.version);
      if (mine && mine.owner === me) out.nokkel = mine.own;
      if (out.rejected?.length) return send(res, 422, { error: out.rejected.map(r => r.error).join(" "), ...out });
      const shown = mine ? versionBody(mine) : out.draft ? (() => { try { return draftBody(draftOf(String(out.draft))); } catch { return null; } })() : null;
      return send(res, 200, shown ? { ...out, shown } : out);
    } catch (e) { return send(res, e.tool ? 400 : 500, { error: e.tool ? e.message : "Noe gikk galt." }); }
  }
  /* GET /api/ifc?utkast=<id> | ?versjon=<id>&nokkel=: the model as IFC without the wings the after tears down
     (ifcfilter.mjs), with what it builds and the wings it renames (ifcadd.mjs); the before's file is read once, each answer kept until the draft or version changes */
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
      body = Buffer.from(withAdded(withoutBuildings(base, gone).text, base, m.site, site).text, "utf8");
      if (ifcs.size > 20) ifcs.delete(ifcs.keys().next().value); ifcs.set(tag, body);
    }
    const file = `gamle-drammen-sykehus-${String(name).toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "versjon"}.ifc`;
    res.writeHead(200, { ...SECURITY, "content-type": "application/x-step", "content-disposition": `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`, "cache-control": "no-store" });
    return res.end(body);
  }
  return { handleMcp, handleCard, handleDraft, handleVersion, handleVersions, handleChange, handleIfc, handleBim: (req, res, rest) => handleBim(req, res, rest, SECURITY), TOOLS,
    setNotifier: f => { notify = f; },
    /* GET /api/skisse/<id>.png: a plan Anton showed this person */
    handleSketch: (req, res, rest, person) => { const m = /^([A-Za-z0-9_-]{8})\.png$/.exec(rest), k = m && sketchMeta(m[1]);
      if (!k || !person || k.person !== person) { res.writeHead(404, { ...SECURITY, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Finnes ikke." })); }
      res.writeHead(200, { ...SECURITY, "content-type": "image/png", "cache-control": "private, max-age=3600" }); res.end(readFileSync(join(SK, m[1] + ".png"))); },
    /* GET /api/skisser: the plans shown to this person lately, oldest first, for the page to show again after a reload */
    handleSketches: (req, res, person) => { res.writeHead(person ? 200 : 401, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(person ? { sketches: sketchesOf(person) } : { error: "signed_out" })); } };
}
