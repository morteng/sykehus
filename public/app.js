/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try.
   The layout is Fab's (the Anton-first redlines, 2026-10-25): the view, the storey strip at its left edge, the view's
   tools over it, Anton's pill at the bottom, and the panel on the right with «Bygget», «Anton», «Forslag» and
   «Forslag», «Bygg» and «Anton» (panel.js). */
import { createViewer } from "./viewer.js";
import { freeName } from "./saved.js";
import { applyEdits } from "./edits.js";
import { createMal, plantAt } from "./mal.js";
import { searchPlants } from "./plants.js";
import { SWATCHES, SIZES, OPS, OP_ICON, ERASER, CHIPS, cards, silhouette, heightText } from "./ute.js";
import { nearWays } from "./paint-edit.js";
import { tearAtOnce } from "./optimistic.js";
import { createKeys } from "./keys.js?v=20261026za";
import { SUN_DEFAULT, sunIn, sunDay, sunFromDay, sunDate } from "./renderkit/sunpick.js";
import { sunLabel } from "./gjengi-no.js";
import { ghostIds } from "./livetries.js";
import { nextTree, treeTitle } from "./treemode.js";
import { createSelection, SURFACE_NO, groundName, roadName } from "./valg.js?v=20261026s";
import { ROAD_ID } from "./roads.js";
import { GROUND_ID } from "./landscape.js";
import { createPicker, windowTest } from "./renderkit/select.js";
import { createBuild, bodyOf, cornersOf } from "./renderkit/build.js";
import { createShape } from "./renderkit/shape.js";
import { baseOf, groundText, lotText } from "./design.js";
import { PLANTS } from "./plants.js";
import { createPanel } from "./panel.js";
import { levels } from "./kit/levels.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys are the
   wings' own (site.json wings[].levels): one name, a kote in each wing that has it. */
const [site0, { floors: floors0 }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
/* ?utkast=<id>: changes tried through the connector (mcp.mjs try_change), laid over the data and shown as not saved */
/* ?versjon=<id>: a saved version of the after (versions.mjs), someone's own, public to look at */
const qs = new URLSearchParams(location.search);
let versionId = qs.get("versjon"), nokkel = qs.get("nokkel"), draftId = qs.get("utkast"), draft = null;   // a «Riv» on the model itself starts a draft in place (U3542)
if (!versionId && /^v.{8}$/.test(draftId || "")) { versionId = draftId; draftId = null; }   // ?utkast=v…: a version's id, as an older link sent it (21:05Z)
const fetchDraft = async () => { try { const r = await fetch(versionId ? `api/versjon/${encodeURIComponent(versionId)}${nokkel ? `?nokkel=${encodeURIComponent(nokkel)}` : ""}` : `api/utkast/${encodeURIComponent(draftId)}`); return r.ok ? await r.json() : { missing: true }; } catch { return { missing: true }; } };
/* everything is kept as it is made (U3555, Morten 20:18Z «everything should be autosaved, only sharing is manual»):
   signed in, the person's work is one private version (the server's «work»), opened here unless the address names
   another or asks for the before (?for); signed out, the draft is on the server a day and its id in this browser,
   and signing in moves it into the person's version */
const KEPT = "sykehus-utkast", me = await fetch("api/meg").then(r => r.json()).catch(() => ({}));
let kept = null; try { kept = localStorage.getItem(KEPT); } catch { }
const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.ok ? r.json() : null).catch(() => null);
if (me.person && kept) {
  const j = await post("api/endring", { adopt: kept });
  try { localStorage.removeItem(KEPT); } catch { }
  if (j?.version && (!versionId && !qs.has("for") || draftId === kept)) { versionId = j.version; nokkel = null; draftId = null; }
}
if (!versionId && !draftId && !qs.has("for")) {
  if (me.person) { const w = (await fetch("api/versjoner").then(r => r.json()).catch(() => ({}))).versions?.find(v => v.mine && v.work); if (w) versionId = w.version; }
  else if (kept) draftId = kept;
}
if (versionId || draftId) draft = await fetchDraft();
if (draft?.missing && draftId === kept) { try { localStorage.removeItem(KEPT); } catch { } }
if (draft && !draft.missing && !qs.has(versionId ? "versjon" : "utkast")) {   // the work opened by itself: its own address, to come back to
  const u = new URL(location.href); u.searchParams.delete("nokkel"); u.searchParams.set(versionId ? "versjon" : "utkast", versionId || draftId); history.replaceState(null, "", u.href);
}
const mine = () => !!versionId && !!draft?.version && !!me.person && draft.owner === me.person;
const ownDraft = () => !versionId && !!draftId && draftId === kept;   // a draft this browser made; another's came by its link
/* the drawn sections, by hand from the sheets (data/sections.json) */
const thumbs = await fetch("data/ark/index.json").then(r => r.ok ? r.json() : {}).catch(() => ({}));   // small pictures of the sheets (tools/thumbs.py)
const drawnSections0 = await fetch("data/sections.json").then(r => r.ok ? r.json() : { sections: [] }).then(j => j.sections).catch(() => []);
/* the page's model is the after (site, floors); the viewer's is the after without its demolitions, which it hides
   (viewer.setGone), so a «Riv» or an «Angre» changes the scene in place: the camera, the terrain, the streets and the
   other wings stay as they are (Morten 2026-10-25 21:15). The page's objects are refilled, never replaced, so what
   holds them (the selection, the card over the pick) sees the change. */
const TEARS = e => e.kind === "demolish" || e.kind === "restore";
/* what the page changes in place: torn down (setGone), new buildings (setAdded), a wing's facts and name (relabel) */
const LIVE = e => TEARS(e) || ["volume", "reshape", "wing", "balconies", "surface", "path", "trees", "fell", "ground", "paint", "terrain", "note", "level", "room"].includes(e.kind);   // balconies are added parts; surfaces and paths setLandscape; trees setTrees; level setLevels; room setRooms
const modelOf = edits => applyEdits(site0, floors0, edits || []);
const { site, floors } = modelOf(draft?.edits);
const shown = modelOf(draft?.edits?.filter(e => !LIVE(e)));   // its own copy: the page's is refilled under it
function refill(to, from) {
  if (Array.isArray(to)) { to.splice(0, to.length, ...from); return; }
  for (const k of Object.keys(to)) if (!(k in from)) delete to[k];
  for (const [k, v] of Object.entries(from)) if (Array.isArray(to[k]) && Array.isArray(v)) to[k].splice(0, to[k].length, ...v); else to[k] = v;
}
const wings = site.wings || [];
const drawnSections = drawnSections0.filter(d => !d.wing || wings.some(w => w.id === d.wing));   // a torn-down wing's drawn sections go with it
const $ = id => document.getElementById(id);
const kote = v => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",");
const num = v => Math.round(v).toLocaleString("nb-NO");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* the panel; a version or a draft opens on «Forslag», where it is told what it is; else the tab last open, Anton first */
const panel = createPanel({ start: draft ? "changes" : null, onChange: t => dispatchEvent(new CustomEvent("sykehus:panel", { detail: t })) });
const toCard = () => panel.show("selected", { quiet: true });   // a tap on the model or the strip shows its card, the sheet stays where it is

const TREES = "sykehus-trær", treeStore = { get() { try { return localStorage.getItem(TREES); } catch { return null; } }, set(v) { try { localStorage.setItem(TREES, v); } catch { } } };   // the choice is kept per browser (U3676)
const viewer = createViewer({
  treeMode: treeStore.get(),
  container: $("view"), site: shown.site, floors: shown.floors,
  walkKeys: () => { try { return !series; } catch { return true; } },   // a shot series has the arrow keys (U3605)
  onPick: (id, how) => {
    if (placing) { const at = viewer.hit(how.x, how.y); if (at) placing(at, how); }   // «Nytt bygg»: where on the ground; a pick is the picker's (renderkit select.js, below)
  },
  onView: v => {
    $("north").querySelector("svg").style.transform = `rotate(${-v.north * 180 / Math.PI}deg)`;
    $("scale").style.display = v.mPerPx ? "block" : "none";
    if (v.mPerPx) {
      /* a bar of at least 110 px, in round metres (5, 10, 20, 25, 50 ...) */
      const m = [5, 10, 20, 25, 50, 100, 200, 500].find(n => n / v.mPerPx >= 110) || 500;
      $("scale").querySelector(".ticks").style.width = (m / v.mPerPx).toFixed(0) + "px"; $("scaleEnd").textContent = m + " m";
    }
  },
});
/* the after's live part over the viewer's model: what is torn down hidden, the new buildings drawn, the names as edited */
function paint(s = site, f = floors) {
  showingBefore = s !== site;
  viewer.setTerrain(s.terrain?.z); viewer.setGone((s.demolished || []).map(d => d.id)); viewer.setAdded(s.added || []); viewer.setGrading(s.grading || [], false); viewer.setLandscape(s.landscape || []); viewer.setTrees(s.trees || []); viewer.setLevels(s.wings || []); viewer.setRooms(f);
  viewer.relabel(new Map(s.buildings.filter(b => b.own && b.name).map(b => [b.id, b.name.replace(/ \(.*\)$/, "")])));
  streetsOn?.setRemoved((s.roads_removed || []).map(r => r.id));   // the road sections the after takes away (U3543)
  if (!showingBefore) dispatchEvent(new CustomEvent("sykehus:painted"));   // the build tools take the new building's new shapes
}
/* U3527: the before painted in place for a shot's «før», the after again for its «etter» or anything else */
let showingBefore = false;
const paintEra = era => { if (era === "før") { if (!showingBefore) paint(site0, floors0); } else if (showingBefore) paint(); };
let streetsOn = null;   // the streets around, once they are drawn (streets.js)
let placing = null;   // a tap on the ground goes here instead of picking (set by «Nytt bygg» and «Flytt»)
paint();
/* the model is up: the first load's «Laster» goes (pm 21:20Z: a grey map and an empty panel for some seconds, no sign) */
requestAnimationFrame(() => { $("loading")?.remove(); $("sideWait")?.remove(); });
try { const p = JSON.parse(sessionStorage.getItem("sykehus-pose") || "null"); sessionStorage.removeItem("sykehus-pose"); if (p) viewer.pose(p); } catch { }   // Anton's redraw comes back to where it was
/* what is picked in the model, to talk to Anton about (valg.js); the chips are in the pill (anton.js) */
const valg = createSelection({ site, floors, viewer, onChange: items => { dispatchEvent(new CustomEvent("sykehus:valg", { detail: items })); dimStrip(); } });
/* a high summer sun reads the forms best (21 June at 14); the date and the hour are chosen with the sun button, by a view
   (v.sunM, v.sunD, v.sunH: a saved view keeps its light) or by Anton's show_building sun (U3651, renderkit sunpick.js) */
let sun = { ...SUN_DEFAULT }, gjengiCtl = null;   // gjengiCtl: the picture card's hand (gjengi.js), set when it has loaded
function setSunTo(s) { sun = { ...s }; viewer.setSun(sunDate(sun)); $("sunText").textContent = sunLabel(sun); $("sunDay").value = sunDay(sun); $("sunHour").value = sun.sunH; $("sunBtn").title = `Sola: ${sunLabel(sun)}`; }
setSunTo(sun);
$("sunBtn").onclick = () => { const on = $("sunPop").hidden; $("sunPop").hidden = !on; $("sunBtn").setAttribute("aria-expanded", String(on)); };
/* the trees: full, simple, off (U3676); the choice is kept in this browser */
{ const b = $("mtree"), put = m => { b.dataset.mode = m; b.title = treeTitle(m); b.setAttribute("aria-label", treeTitle(m)); }; put(viewer.treeMode());
  b.onclick = () => { const m = nextTree(b.dataset.mode); viewer.treeMode(m); put(m); treeStore.set(m); }; }
$("sunDay").oninput = $("sunHour").oninput = () => setSunTo(sunFromDay(+$("sunDay").value, +$("sunHour").value));
$("sunReset").onclick = () => setSunTo(SUN_DEFAULT);
document.addEventListener("pointerdown", e => { if (!$("sunPop").hidden && !e.target.closest("#sunPop, #sunBtn")) { $("sunPop").hidden = true; $("sunBtn").setAttribute("aria-expanded", "false"); } });

/* the storey strip (the kit's g-levels): the whole site, then every storey some wing has, top first as on a
   section; a dot where a storey is drawn, dimmed (still a tap) where the wing picked has none */
const order = n => parseInt(n) || 0;
let storeys = [...new Set([...wings.flatMap(w => (w.levels || []).map(l => l.name)), ...floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
const koteOf = n => { const ks = wings.map(w => (w.levels || []).find(l => l.name === n)?.kote).filter(k => k != null); return ks.length ? Math.min(...ks) : null; };
const stripItems = (wing = null) => storeys.slice().reverse().map(n => ({ id: n, label: String(order(n) || n), title: koteOf(n) != null ? `${n} · ${kote(koteOf(n))}` : n,
  drawn: floors.some(f => f.name === n), dim: !!wing && !(wing.levels || []).some(l => l.name === n) }));
const strip = levels($("levels"), { items: stripItems(), all: { label: "Hele anlegget", title: "Hele anlegget" }, value: null, onPick: id => pickStorey(id ?? null), labelOf: i => i.id, name: "Etasjer", cap: "etasje" });
function dimStrip() { const w = valg.items.find(i => i.kind === "wing"); strip.setItems(stripItems(w ? wings.find(x => x.id === w.id) : null)); }
let storeyOn = null;
function pickStorey(name) {
  storeyOn = name;
  if (name === null) viewer.home(); else viewer.setStorey(name);
  strip.set(name); pressMode(); showStorey(name);
}
/* how a kote is known: read off a drawing, worked out, or assumed */
const how = l => l.how && l.how !== "tegning" ? ` · ${esc(l.how)}` : "";
/* the card in «Bygget»: Fab's card shell (cardshell.css), a heading with its acts, then its rows */
const ASK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z"/></svg>`, SHUT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const rows = rs => `<div class="oc-info">${rs.map(([k, v]) => `<div class="oc-info-r"><span class="oc-info-k">${k}</span><span class="oc-info-v">${v}</span></div>`).join("")}</div>`;
let cardOf = null;   // what the card is about, as a selection item («Spør Anton om dette»)
function card(title, sub, body, about) {
  const el = $("info"); cardOf = about;
  el.innerHTML = `<div class="oc-h"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div><span class="oc-acts"><button type="button" class="ask-anton" data-ask title="Spør Anton om dette" aria-label="Spør Anton om dette">${ASK}</button><button type="button" data-shut title="Lukk (Esc)" aria-label="Lukk">${SHUT}</button></span></div><div class="sel-acts" id="selActs"></div>${body}`;
  el.hidden = false; document.querySelector("#p-selected .sel-empty").hidden = true;
  el.querySelector("[data-shut]").onclick = shut;
  el.querySelector("[data-ask]").onclick = () => { if (cardOf) valg.add(cardOf); dispatchEvent(new CustomEvent("sykehus:ask")); };
  panel.peek(`<span class="pk"><b>${title}</b>${sub ? " · " + sub : ""}</span><button type="button" class="sm" id="peekMore">Mer</button>`);
  $("peekMore").onclick = () => panel.reveal("selected");
  toCard(); dispatchEvent(new CustomEvent("sykehus:card"));   // the pick's acts go into #selActs (float.js)
}
function shut() { $("info").hidden = true; $("info").innerHTML = ""; cardOf = null; document.querySelector("#p-selected .sel-empty").hidden = false; panel.peek(""); }
/* the chosen storey: its kote in each wing that has it, and the drawings of it with their rooms */
function showStorey(name) {
  if (!name) { shut(); return; }
  const rs = wings.map(w => [w, (w.levels || []).find(l => l.name === name)]).filter(r => r[1]).sort((a, b) => b[1].kote - a[1].kote);
  const drawn = floors.filter(f => f.name === name), rooms = drawn.flatMap(f => f.rooms || []), sum = rooms.reduce((a, r) => a + (r.area_m2 || 0), 0), withArea = rooms.filter(r => r.area_m2).length, calc = rooms.filter(r => !r.area_m2 && r.area_calc);
  const sub = `Snitt 1,2 m over gulvet${withArea ? ` · ${withArea} rom tegnet, ${num(sum)} m²` : rooms.length ? ` · ${rooms.length} rom navngitt` : ""}`;
  card(esc(name), sub, `<h3>Kote i hver fløy</h3>${rows(rs.map(([w, l]) => [esc(w.name), kote(l.kote) + how(l)]))}
    ${calc.length ? `<p class="note">${calc.length} rom til, ca. ${num(Math.round(calc.reduce((a, r) => a + r.area_calc, 0)))} m² målt mellom veggene.</p>` : ""}
    <p class="src">Skravert gulv: ingen plantegning av etasjen der.${drawn.length
      ? `<br>${drawn.length === 1 ? "Plantegning" : "Plantegninger"}:</p><ul class="src">${drawn.map(f => `<li title="${esc(f.source)}">${esc(plainSource(f))}</li>`).join("")}</ul>` : "<br>Ingen plantegning av denne etasjen i arkivet.</p>"}`,
    { kind: "storey", id: name, label: name });
}
/* a floor's source as the card says it: the drawing, and for a traced one how it was read; the whole note (with the
   tools that read it) stays in the data and shows on hover */
function plainSource(f) {
  if (!f.id.startsWith("spor-")) return f.source;
  const sheet = f.source.split(", sporet")[0];
  return `${sheet}. ${/vektor/.test(f.source) ? "Vegger og rom lest fra vektortegningen" : "Vegger og rom lest maskinelt fra skannet"}, ikke kontrollert.`;
}
function setMode(m) {
  viewer.setMode(m); pressMode();
}
function pressMode() { const m = viewer.view().mode, eye = viewer.view().eye; $("m3d").setAttribute("aria-pressed", String(m === "3d" && !eye)); $("meye").setAttribute("aria-pressed", String(!!eye)); $("mplan").setAttribute("aria-pressed", String(m === "plan")); $("print").hidden = m === "3d"; document.body.classList.toggle("plan", m !== "3d"); }
/* the plan or the section as a sheet to print: the picture with its names, a title block with what it is, a scale
   bar and the scale it prints at on A4 across, north, and the drawings it is made from */
async function printSheet() {
  const v = viewer.view(), el = $("view"), W = el.clientWidth, H = el.clientHeight, PX = 96 / 25.4;   // css px a millimetre
  /* the largest picture that fits the page, made a little smaller so it prints at a whole scale (1:200, 1:500 ...) */
  const kMax = Math.min(277 * PX / W, 160 * PX / H), natural = 1000 * v.mPerPx * PX / kMax;
  const scale = [50, 100, 200, 250, 500, 1000, 2000, 5000].find(n => n >= natural * 0.999) || Math.ceil(natural / 1000) * 1000;
  const mmPerM = 1000 / scale, k = mmPerM * PX * v.mPerPx;   // printed mm a metre, and the picture's scale on paper
  const m = [5, 10, 20, 25, 50, 100].find(n => n * mmPerM >= 30) || 100;
  const wing = v.section && wings.find(w => w.id === v.section.wing);
  const what = v.mode === "section" && v.section.kind === "fasade" ? `${wing?.name || "Bygget"}, fasade mot ${SIDE[side]}` : v.mode === "section" ? `${v.section.kind === "lengde" ? "Lengdesnitt" : "Tverrsnitt"} gjennom ${wing?.name || "bygget"}${sheet ? ", der tegningen snitter" : ", midt i fløyen"}` : `${v.storey ? v.storey + ", snitt 1,2 m over gulv" : "Situasjonsplan"} · rutenett 10 m (UTM 33)`;
  const src = v.mode === "section" && v.section.kind === "fasade" ? ((site.facades || []).filter(f => f.building === v.section.wing && f.name.endsWith(SIDE[side])).flatMap(f => f.src).map(esc).join(" · ") || "Fasaden etter foto og laser, vinduene ikke fra tegning.")
    : v.mode === "section" ? (sheet ? `Tegnet snitt: ${esc(sheet.title)} (${sheet.year}), ${esc(sheet.note)}. Plassert omtrentlig.` : "Snitt i modellen; yttervegger 0,35 m antatt, innervegger fra plantegningene der de finnes.")
    : floors.filter(f => f.name === v.storey).map(f => esc(f.source)).join(" · ") || "Bygningsomriss fra OpenStreetMap og Kartverkets laser.";
  const pic = new Image(); pic.src = viewer.snapshot(); await pic.decode();
  const names = viewer.labels.cloneNode(true);
  $("sheet").innerHTML = `<div class="pic" style="width:${(W * k).toFixed(1)}px;height:${(H * k).toFixed(1)}px"><div style="width:${W}px;height:${H}px;transform:scale(${k.toFixed(4)});transform-origin:0 0"></div></div>
    <div class="block"><div style="flex:1"><h1>Gamle Drammen sykehus</h1><p>Dronninggata 28, gnr. 114 bnr. 272 · ${esc(what)}</p><p>Målestokk 1:${scale} på A4 liggende (skriv ut i 100 %) · utskrevet ${new Date().toLocaleDateString("nb-NO")} fra sykehus.gulden.no</p></div>
      <div style="width:${(m * mmPerM).toFixed(1)}mm"><div class="bar"><i></i><i></i><i></i><i></i></div><div class="nums"><span>0</span><span>${m} m</span></div></div>
      ${v.mode === "plan" ? `<svg viewBox="-20 -20 40 40" style="width:12mm;height:12mm"><path d="M0 -8 L7 17 L0 12 L-7 17 Z"/><text x="0" y="-10" text-anchor="middle" font-size="11" font-weight="700">N</text></svg>` : ""}</div>
    <div class="src">Tegnet fra arkivets tegninger, ikke målt på stedet. ${src}</div>`;
  const inner = $("sheet").querySelector(".pic > div"); pic.style.cssText = "position:absolute;inset:0;width:100%;height:100%"; inner.append(pic, names);
  print();
}
$("print").onclick = () => printSheet();
/* a section through a wing, across or along it, looked at square on with the wing's floor heights beside it; the
   card is in the panel now, so the drawing is framed right of the storey strip */
const LOOK = { N: [0, 1], Ø: [1, 0], S: [0, -1], V: [-1, 0] };   // the way a drawn section looks
let sheet = null, side = null;   // the drawn section shown, if the cut is one; the side a facade is seen from
const SIDE = { N: "nord", Ø: "øst", S: "sør", V: "vest" };
const FREE = () => panel.phone ? 0 : 100;   // the strip's width: the drawing is framed beside it
/* a wing's facade, looked at square on from that side: what stands in front of it is taken away */
function facade(b, k) {
  sheet = null; side = k; const from = LOOK[k];
  viewer.setSection(b.wing, "fasade", FREE(), null, [-from[0], -from[1]]); pressMode();
  storeyOn = null; strip.set(null); showInfo(b);
}
function section(b, kind, drawn = null) {
  sheet = drawn; side = null;
  viewer.setSection(b.wing, kind, FREE(), drawn?.through || null, LOOK[drawn?.looking] || null); pressMode();
  storeyOn = null; strip.set(null); showInfo(b);
}
/* the names over the picture: off until this viewer turns them on with «Navn» or N (U3541, Morten 2026-10-25 19:26Z),
   remembered in this browser; only a choice is kept, under a new key, since the old one held «på» for everyone */
let names = false; try { names = localStorage.getItem("sykehus-navn-valgt") === "på"; } catch { }
function setNames(on, keep = true) { names = on; viewer.setNames(on); $("names").setAttribute("aria-pressed", String(on)); if (keep) try { localStorage.setItem("sykehus-navn-valgt", on ? "på" : "av"); } catch { } }
setNames(names, false); $("names").onclick = () => setNames(!names);
$("m3d").onclick = () => { setMode("3d"); viewer.eye(false); pressMode(); }; $("mplan").onclick = () => setMode("plan");
/* U3605: in «Gateplan» the keys are said once each time one goes there (not on a phone, which has no keys) */
const EYE_KEYS = "Gateplan: dra for å se deg rundt · W A S D eller piltastene for å gå · Shift går fortere · rull for å gå nærmere";
const eyeSay = () => { if (!matchMedia("(pointer: coarse)").matches) toast(EYE_KEYS); };
$("meye").onclick = () => { setMode("3d"); viewer.eye(true); pressMode(); eyeSay(); };
/* U3606: the person by the zoom: dragged onto the model, a ring shows where it lands, and a drop stands there in
   «Gateplan»; a press without a drag (a finger, the keyboard) waits for a tap on the spot */
{
  const peg = $("peg"), say = r => toast(r.why);
  const go = r => { if (!r.ok) return say(r); viewer.standAt(r.at, r.along); pressMode(); eyeSay(); };
  let drag = null;
  peg.addEventListener("pointerdown", e => {
    if (e.button) return; e.preventDefault(); peg.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false, ghost: null, last: null };
  });
  peg.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.moved) { drag.moved = true; drag.ghost = Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "svg"), {}); drag.ghost.setAttribute("viewBox", "0 0 24 24"); drag.ghost.setAttribute("class", "peg-ghost"); drag.ghost.innerHTML = peg.querySelector("svg").innerHTML; document.body.append(drag.ghost); }
    drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("#view");
    drag.last = over ? viewer.standable(e.clientX, e.clientY) : null; viewer.ringAt(drag.last);
  });
  const end = e => {
    if (!drag) return; const d = drag; drag = null; d.ghost?.remove(); viewer.ringAt(null);
    if (!d.moved) return arm();
    if (e.type === "pointerup" && d.last) go(d.last);
  };
  peg.addEventListener("pointerup", end); peg.addEventListener("pointercancel", end);
  peg.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); arm(); } });
  function arm() {
    if (placing) { placing = null; peg.setAttribute("aria-pressed", "false"); $("toast")?.remove(); return; }
    peg.setAttribute("aria-pressed", "true");
    placing = (at, how) => { placing = null; peg.setAttribute("aria-pressed", "false"); $("toast")?.remove(); go(viewer.standable(how.x, how.y)); };
    toast("Trykk der du vil stå i gateplan.", { label: "Avbryt", run: () => { placing = null; peg.setAttribute("aria-pressed", "false"); $("toast")?.remove(); } });
  }
}
$("zin").onclick = () => viewer.zoom(1 / 1.5); $("zout").onclick = () => viewer.zoom(1.5); $("zhome").onclick = () => viewer.reset();
/* the keys: + and − zoom, 0 the view as it opened (⌂), ↑ ↓ (or Page Up / Down) a storey up or down the strip, Home the whole site, Esc puts the
   card and the picks away */
addEventListener("keydown", e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.target.closest?.(".g-levels")) return;
  if (e.key === "n" || e.key === "N") setNames(!names);
  else if (e.key === "+" || e.key === "=") viewer.zoom(1 / 1.5);
  else if (e.key === "-" || e.key === "−") viewer.zoom(1.5);
  else if (e.key === "0") viewer.reset();
  else if (e.key === "Escape") { if (!pickActs?.escape()) { shut(); valg.clear(); } }   // the card beside the pick folds first, the pick kept
  else if (e.key === "Home") pickStorey(null);
  else if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) {
    const ladder = [null, ...storeys], i = ladder.indexOf(storeyOn), j = Math.max(0, Math.min(ladder.length - 1, i + (/Up$/.test(e.key) ? 1 : -1)));
    if (j !== i) pickStorey(ladder[j]);
  } else return;
  e.preventDefault();
});
/* Backspace or Delete on the pick, Cmd/Ctrl-Z, and the redo (U3649, keys.js): the same acts as the card's «Riv» and the toast's «Angre» */
const keys = createKeys({
  edits: () => draft && !draft.missing && (mine() || ownDraft()) ? draft.edits : null,
  undo: (n, expect) => busy || !quickBack(expect) ? undo(n, expect) : tearAtOnce({ ...hiding(), targets: [expect.building], back: true, send: async () => await undo(n, expect) || null }),
  put: e => busy || !quickBack(e) ? edit([e], "Fikk ikke gjort igjen", true).then(r => !!r) : tearAtOnce({ ...hiding(), targets: [e.building], send: () => edit([e], "Fikk ikke gjort igjen", true) }).then(r => !!r),
  say: text => toast(text), name: describe, riv: () => !!pickActs?.riv(),
});
addEventListener("keydown", e => { if (!e.target.closest?.(".g-levels")) keys.key(e); });
/* the first visit: how to move about, once; gone at the first touch or after a while */
const TAP = matchMedia("(pointer: coarse)").matches ? "trykk" : "klikk";   // a finger presses, a mouse clicks
/* -2: shown once more when Shift and a drag stopped panning (U3569) */
let seen = false; try { seen = !!localStorage.getItem("sykehus-tips-2"); localStorage.setItem("sykehus-tips-2", "1"); } catch {}
if (!seen) {
  const tip = Object.assign(document.createElement("div"), { id: "tip", textContent: TAP === "trykk"
    ? "Dra for å snu · to fingre for å flytte og zoome · trykk på et bygg" : "Dra for å snu · høyre knapp eller to fingre for å flytte · + − for å zoome · klikk et bygg · Shift og dra velger flere" });
  $("stage").append(tip);
  const gone = () => { tip.classList.add("gone"); setTimeout(() => tip.remove(), 700); removeEventListener("pointerdown", gone); };
  addEventListener("pointerdown", gone); setTimeout(gone, 9000);
}

/* a building: for a wing of the hospital, what the documents say about it (site.json wings), then its size and
   heights from the laser */
function showInfo(b) {
  if (!b) { shut(); return; }
  const h = b.top != null ? b.top - b.base : null, w = (site.wings || []).find(x => x.id === b.wing);
  const about = w ? [["Bygget", w.built], ["Etasjer", w.storeys], ["Konstruksjon", w.construction], ["Fasade", w.facade]].filter(r => r[1]).map(([k, v]) => [k, esc(v)]) : [];
  const body = rows([...about, ["Fotavtrykk", `${num(b.area_m2)} m²`], ...(h != null ? [["Høyde", `ca. ${h.toFixed(0)} m`], ["Topp", `kote ${kote(b.top)}`]] : []), ["Terreng", `kote ${kote(b.base)}`]]) +
    (w?.levels?.length ? storeyList(b, w) : "") +
    (w ? sectionRow(w) : "") +
    (w ? `${sheetStrip(w)}<p class="src">${w.note ? esc(w.note) + ". " : ""}${w.sure ? "" : "Hvilken del dette er, er ikke sikkert ut fra dokumentene. "}Kilder: ${w.sources.map(docLink).join(" · ")}</p>` : "");
  card(w ? esc(w.name) : b.own ? "Bygning på tomta" : "Nabobygning", w?.alias ? esc(w.alias) : "", body,
    w ? { kind: "wing", id: w.id, label: w.name } : { kind: "building", id: b.id, label: b.name || (b.own ? `Bygning ${b.id} på tomta` : `Nabobygning ${b.id}`) });
  const el = $("info");
  for (const btn of el.querySelectorAll("[data-storey]")) btn.onclick = () => peel(b, w, btn.dataset.storey || null);
  for (const btn of el.querySelectorAll("[data-snitt]")) btn.onclick = () => section(b, btn.dataset.snitt);
  for (const btn of el.querySelectorAll("[data-fasade]")) btn.onclick = () => facade(b, btn.dataset.fasade);
  for (const btn of el.querySelectorAll("[data-tegnet]")) btn.onclick = () => { const d = drawnSections.find(x => x.id === btn.dataset.tegnet); section(b, d.kind, d); };
}
/* a wing's storeys, top first: choosing one takes the storeys above it off this building alone, so one looks into
   it at that floor; "Hele bygget" puts it back */
function storeyList(b, w) {
  const v = viewer.view(), on = v.only === b.id ? v.storey : null, ls = w.levels.slice().sort((a, c) => c.kote - a.kote);
  return `<div class="oc-row"><b>Etasjer i fløyen</b><button type="button" data-storey="" aria-pressed="${!on}">Hele bygget</button></div>
    <div class="oc-info">${ls.map(l => `<button type="button" class="oc-info-r" data-storey="${esc(l.name)}" aria-pressed="${l.name === on}"><span class="oc-info-k">${esc(l.name)}</span><span class="oc-info-v">${kote(l.kote)}${how(l)}</span></button>`).join("")}</div>`;
}
/* cut the wing across or along its middle, or where a drawn section does */
function sectionRow(w) {
  const v = viewer.view(), on = k => v.mode === "section" && v.section.wing === w.id && v.section.kind === k && !sheet;
  const isFacade = v.mode === "section" && v.section.wing === w.id && v.section.kind === "fasade";
  return `<div class="oc-row"><b>Snitt</b><button type="button" data-snitt="tverr" aria-pressed="${on("tverr")}">Tverrsnitt</button><button type="button" data-snitt="lengde" aria-pressed="${on("lengde")}">Lengdesnitt</button></div>
    <div class="oc-row"><b>Fasade</b>${["N", "Ø", "S", "V"].map(k => {
      const drawn = (site.facades || []).some(f => f.building === w.id && f.name.endsWith(SIDE[k]));
      return `<button type="button" style="min-width:var(--tap)" data-fasade="${k}" aria-pressed="${isFacade && side === k}" title="Fasaden mot ${SIDE[k]}${drawn ? ", vinduer fra tegning" : ""}">${k}${drawn ? "*" : ""}</button>`; }).join("")}</div>
    ${v.mode === "section" && v.section.wing === w.id && !isFacade ? `<p class="note">Svart er det snittet går gjennom: yttervegger (0,35 m, antatt), dekker ved etasjene, tak, og innervegger der det finnes plantegning.</p>` : ""}
    ${isFacade ? `<p class="note">Fasaden mot ${SIDE[side]}, sett rett på. ${(site.facades || []).some(f => f.building === w.id && f.name.endsWith(SIDE[side])) ? "Vinduene fra tegningen." : "Vinduene etter foto, ikke fra tegning."} (* = fasade med tegning)</p>` : ""}${drawnList(w, v)}`;
}
/* the wing's drawn sections: each cuts the model where the sheet does, with the sheet beside it */
function drawnList(w, v) {
  const ds = drawnSections.filter(d => d.wing === w.id); if (!ds.length) return "";
  const on = v.mode === "section" && sheet && sheet.wing === w.id ? sheet : null;
  return `<h3>Tegnede snitt</h3><div class="oc-info">${ds.map(d =>
    `<button type="button" class="oc-info-r" data-tegnet="${esc(d.id)}" aria-pressed="${d === on}"><span class="oc-info-k">${esc(d.title)}</span><span class="oc-info-v">${d.year}</span></button>`).join("")}</div>` +
    (on ? `<figure><a href="${esc(on.image)}" target="_blank" rel="noopener" title="Åpne tegningen stor"><img src="${esc(on.image)}" alt="${esc(on.title)}"></a>
      <figcaption>${esc(on.levels)}. ${esc(on.note)}. ${on.sure ? "" : "Hvor snittet står i modellen er lest ut fra tegningen og omtrentlig. "}<a href="${esc(on.url)}" target="_blank" rel="noopener">Tegningen (PDF)</a></figcaption></figure>` : "");
}
function peel(b, w, name) {
  viewer.cutBuilding(b.id, name);
  storeyOn = null; strip.set(null);
  pressMode(); showInfo(b);
}
/* a document as the cards name it: its title and year, the page, a link to it */
function docLink(d) { return d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}${d.page ? ", s. " + d.page : ""}</a>` : esc(d.title); }
/* the wing's drawings as small pictures, two across; a tap opens the drawing at its page */
function sheetStrip(w) {
  const ds = w.sources.map(d => ({ d, key: `${(d.url || "").split("/").pop().split(".")[0]}-p${d.page || 1}` })).filter(x => thumbs[x.key]);
  if (!ds.length) return "";
  return `<h3>Kilder</h3><div class="thumbs">${ds.map(({ d, key }) =>
    `<a href="${esc(d.url)}#page=${d.page || 1}" target="_blank" rel="noopener" title="${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}"><img src="${esc(thumbs[key])}" alt="" loading="lazy">${esc(d.title)}${d.year ? ", " + esc(d.year) : ""}</a>`).join("")}</div>`;
}

/* «Forslag»: the version or draft shown, as the tab's top card (Morten 20:46Z «polish needed»): its title, edited in
   place when it is one's own, one status line, «Del» first, «Nytt forslag» from the before, «Ny kopi» of this one;
   then the changes, one line each by the building's plain name, grouped by kind with a count and folded past five,
   each with a small ↺ to take it out; one «Angre siste» over them */
const SHARED = { privat: "bare du ser den", lenke: "delt med lenke", offentlig: "offentlig" };
const IC = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>',
  riv: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16"/><path d="M6 20v-8l4-3v11"/><path d="M14 20v-5"/><path d="M13 5l6 6M19 5l-6 6"/></svg>',
  keep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10l8-6 8 6v10z"/><path d="M9 14l2 2 4-4"/></svg>',
  ny: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10l8-6 8 6v10z"/><path d="M12 11v6M9 14h6"/></svg>',
  ed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  ute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20v-6"/><path d="M12 3l5 8H7z"/><path d="M12 8l6 8H6z"/></svg>',
  vei: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3L5 21M16 3l3 18"/><path d="M12 5v3M12 11v3M12 17v2"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12l-4 4H5z"/><path d="M8 9h8M8 13h5"/></svg>',
  bin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
};
const GROUPS = [
  { k: "vei", name: "Veier fjernet", of: e => e.kind === "demolish" && ROAD_ID.test(e.building), tip: "Legg veistykket tilbake" },
  { k: "riv", name: "Revet", of: e => e.kind === "demolish", tip: "Sett opp igjen" },
  { k: "keep", name: "Beholdt", of: e => e.kind === "restore", tip: "Ta ut igjen" },
  { k: "ny", name: "Nye bygg", of: e => e.kind === "volume", tip: "Ta bort igjen" },
  { k: "ed", name: "Endret", of: e => ["reshape", "wing", "level", "room", "balconies"].includes(e.kind), tip: "Ta endringen ut igjen" },
  { k: "ute", name: "Uteområdet", of: e => ["surface", "path", "trees", "fell", "ground", "paint", "terrain"].includes(e.kind), tip: "Ta det ut igjen" },
  { k: "note", name: "Notater", of: () => true, tip: "Ta notatet ut igjen" },
];
/* the reasons that say nothing a reader needs: the page's own, and Anton's when it only says the person asked (pm 26.10) */
const PAGE_WHY = /^((revet|endret|satt opp|fjernet) på siden|(personens|brukerens|eierens) (ønske|forespørsel)|på (personens )?(ønske|forespørsel)|etter ønske)\.?$/i;
const clock = t => t ? new Date(t).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" }) : "";
function drawDraft() {
  drawWhere();
  if (!draft) { $("draftRow").innerHTML = ""; return; }
  const n = draft.edits?.length || 0, ch = `${n} ${n === 1 ? "endring" : "endringer"}`, may = draft.version ? mine() : ownDraft();
  if (draft.missing) { $("draftRow").innerHTML = `<div class="draftrow dr"><b>${versionId ? "Versjonen finnes ikke, eller er privat." : "Utkastet finnes ikke lenger"}</b><span class="dr-s">${versionId ? "" : "Utkast varer et døgn. "}Du ser modellen slik den er.</span></div>`; return; }
  const title = mine() ? `<input class="dr-t" id="drTitle" value="${esc(draft.title)}" maxlength="120" aria-label="Navnet på forslaget" title="Trykk for å gi det et annet navn">`
    : `<b class="dr-t">${esc(draft.version ? draft.title : "Utkast")}</b>`;
  const status = mine() ? `lagret ${clock(draft.updated)} · ${SHARED[draft.sharing] || ""}`
    : draft.version ? `${esc(draft.owner)} sitt · ${SHARED[draft.sharing] || ""} · sist endret ${new Date(draft.updated).toLocaleDateString("nb-NO")}`
    : ownDraft() ? `lagret på denne maskinen et døgn${me.person ? "" : " · logg inn for å beholde det"}` : "delt med lenke · det du endrer her, blir ditt eget";
  const acts = may ? `<button type="button" class="dr-p" data-del>Del</button>${mine() && draft.sharing === "lenke" ? `<button type="button" data-priv title="Lenken virker ikke lenger; bare du ser forslaget">Gjør privat</button>` : ""}${me.person ? `<button type="button" data-ny title="Et nytt, tomt forslag fra før">Nytt forslag</button>${mine() ? `<button type="button" data-kopi title="Et nytt alternativ, fra dette">Ny kopi</button>` : ""}` : `<button type="button" data-ny title="Et nytt, tomt forslag fra før">Nytt forslag</button>`}` : "";
  /* the groups, each row its edit's number (1-based, as undo takes it), the newest last */
  const rowsOf = GROUPS.map(g => ({ g, rows: [] }));
  (draft.edits || []).forEach((e, i) => rowsOf.find(x => x.g.of(e)).rows.push([e, i + 1]));
  const list = rowsOf.filter(x => x.rows.length).map(({ g, rows: rs }) => `<details class="dr-g"${rs.length > 5 ? "" : " open"}><summary><span class="dr-ic">${IC[g.k]}</span>${g.name} · ${rs.length}</summary><ul>${rs.map(([e, k]) =>
    `<li title="${esc(describe(e))}"><span>${esc(short(e))}</span>${may ? `<button type="button" class="dr-x" data-undo="${k}" title="${g.tip}" aria-label="${g.tip}: ${esc(short(e))}">${IC.back}</button>` : ""}</li>`).join("")}</ul></details>`).join("");
  $("draftRow").innerHTML = `<div class="draftrow dr"><div class="dr-h">${title}<span class="dr-s">${status}</span></div>
    <div class="dr-acts">${acts}${mine() ? `<button type="button" class="icon" data-vdel-open title="Slett forslaget" aria-label="Slett forslaget">${IC.bin}</button>` : ""}<a href="./?for">Se før</a></div>
    ${n ? `<div class="dr-top"><span>${ch}</span>${may ? `<button type="button" data-last title="Angre siste: ta ut «${esc(short(draft.edits[n - 1]))}»">${IC.undo}<span>Ta ut «${esc(short(draft.edits[n - 1]))}»</span></button>` : ""}</div>${list}` : `<p class="dr-s">Ingen endringer ennå. Trykk på et bygg, eller spør Anton.</p>`}</div>`;
  const R = $("draftRow");
  for (const b of R.querySelectorAll("[data-undo]")) b.onclick = () => undo(+b.dataset.undo);
  R.querySelector("[data-last]")?.addEventListener("click", () => undo(n));
  R.querySelector("[data-del]")?.addEventListener("click", share);
  R.querySelector("[data-priv]")?.addEventListener("click", async () => {   // «Del» undone: the link stops working
    const j = await change({ unshare: versionId }); if (j.error) return toast(`Fikk ikke gjort det privat: ${j.error}`);
    draft.sharing = j.sharing; drawDraft(); toast("Forslaget er privat igjen. Lenken virker ikke lenger.", { label: "Angre", run: share });
  });
  R.querySelector("[data-kopi]")?.addEventListener("click", async () => { const j = await change({ copy: versionId }); if (j.error) return toast(`Fikk ikke kopiert: ${j.error}`); await show(j); nameIt(); toast(`Ny kopi: «${j.title}». Gi den et navn, eller jobb videre: endringene går inn i den.`); });
  R.querySelector("[data-ny]")?.addEventListener("click", fresh);
  R.querySelector("[data-vdel-open]")?.addEventListener("click", () => askDelete([{ version: versionId, title: draft.title }]));
  const t = $("drTitle");
  if (t) {
    t.onkeydown = e => { if (e.key === "Enter") t.blur(); if (e.key === "Escape") { t.value = draft.title; t.blur(); } };
    t.onchange = async () => {
      const v = t.value.trim(); if (!v || v === draft.title) { t.value = draft.title; return; }
      const j = await change({ rename: versionId, title: v }); if (j.error) { t.value = draft.title; return toast(`Fikk ikke gitt det nytt navn: ${j.error}`); }
      draft.title = j.title; draft.updated = j.updated; drawWhere(); listVersions();
    };
  }
}
/* a new copy or proposal: its title ready to be typed over, in the card */
const nameIt = () => { const t = $("drTitle"); if (t && t.offsetParent) { t.focus(); t.select(); } };
/* «Nytt forslag» (U3667): the dialog (nytt-forslag.js). Signed in, it makes the version (a new empty one from the before, or a copy of
   one's own, named as typed), opens it, goes to Anton and hands over the first turn; signed out, it opens «Logg inn» first */
let nyttForslag = null;
function fresh() {
  nyttForslag ||= import("./nytt-forslag.js?v=20261027c").then(({ startNew }) => startNew({
    signedIn: () => !!me.person, login: () => { toast("Logg inn for å begynne et forslag."); $("meBtn")?.click(); },
    mine: async () => (await fetch("api/versjoner").then(r => r.json()).catch(() => ({}))).versions?.filter(v => v.mine) || [],
    create: async o => { const j = await change({ fresh: !o.copy, ...o }); if (j.error) return `Fikk ikke laget et nytt forslag: ${j.error}`; await show(j); return null; },
    say: text => { $("tab-chat")?.click(); document.dispatchEvent(new CustomEvent("sykehus:anton-say", { detail: { text } })); },
  }));
  nyttForslag.then(n => n.open());
}
$("mnp").onclick = fresh;
/* the name of a building in a change, plainly: a wing's name, a new building's, else what it is; never its id */
const KIND = { hospital: "sykehusbygg", apartments: "boligblokk", house: "bolig", semidetached_house: "tomannsbolig", garage: "garasje", garages: "garasjer", civic: "offentlig bygg", kindergarten: "barnehage", university: "skolebygg", office: "kontorbygg", warehouse: "lager", shed: "bod", service: "teknisk bygg", roof: "tak" };
function nameOf(id) {
  if (id === "alle") return "Alle sykehusbyggene";
  const low = String(id).toLowerCase(), w = (site0.wings || []).find(x => x.id === id || x.name.toLowerCase() === low); if (w) return w.name;   // Anton names wings too
  const a = draft?.edits?.findLast(x => x.id === id && (x.kind === "volume" || x.kind === "reshape") && x.name); if (a) return a.name;
  if (ROAD_ID.test(id)) { const e = draft?.edits?.findLast(x => x.building === id && x.name); return e ? e.name : "Et veistykke"; }   // a road section (U3543)
  if (/^terreng-\d+$/.test(id)) return (site.grading || []).find(x => x.id === id)?.name || "Planert flate";   // U3616
  if (/^(flate|sti|tre)-\d+$/.test(id)) { const g = [...(site.landscape || []), ...(site.plantings || [])].find(x => x.id === id); return g ? groundName(g) : id.startsWith("sti") ? "En sti" : id.startsWith("tre") ? "Trær" : "En flate"; }   // a surface or a path (U3569)
  const b = site0.buildings.find(x => x.id === id); if (!b) return String(id);
  if (b.wing) return (site0.wings || []).find(x => x.id === b.wing)?.name || "Bygning på tomta";
  return b.own ? "Bygning på tomta" : `Nabobygg${KIND[b.type] ? ` (${KIND[b.type]})` : ""}`;
}
/* one line in the list: what the group heading does not already say */
function short(e) {
  const why = e.why && !PAGE_WHY.test(e.why) ? ` (${e.why})` : "";
  if (e.kind === "demolish" || e.kind === "restore") return nameOf(e.building) + why;
  if (e.kind === "volume") return e.name + why;
  return describe({ ...e, why: null }) + why;
}
/* the label over the view, top left (Morten 20:47Z «current version, metadata top left when viewing one?»): the open
   version's title and one line; a tap opens «Forslag» */
function drawWhere() {
  const el = $("where"); if (!el) return;
  const before = !draft || draft.missing, n = draft?.edits?.length || 0, ch = `${n} ${n === 1 ? "endring" : "endringer"}`;
  el.innerHTML = before ? `<b>Før</b><span>slik det står i dag</span>`
    : `<b>${esc(draft.version ? draft.title : "Utkast")}</b><span>${mine() ? `din · ${ch} · lagret ${clock(draft.updated)}`
      : draft.version ? `${esc(draft.owner)} · ${draft.sharing === "lenke" ? "delt med lenke" : SHARED[draft.sharing] || ""} · ${ch}`
      : ownDraft() ? `utkast · ${ch} · på denne maskinen` : `delt med lenke · ${ch}`}</span>`;
  el.title = before ? "Modellen slik den er. Trykk for forslagene." : "Trykk for å se endringene";
  el.hidden = false;
}
$("where").onclick = () => panel.reveal("changes");
/* «Visninger», the saved camera views of the open version (U3562, Morten 21:18Z «let the system remember custom
   viewpoints / camera shots and user easily move between them»): a tap glides there; its owner saves the view as it
   is now under a name, renames and removes; Anton saves one with show_building save_as. renderkit's views.js keeps the
   list on the server (saved.js) */
const canSave = () => mine() || (ownDraft() && !!draft && !draft.missing);
function viewNow() {
  const p = viewer.pose(), v = viewer.view(), s = { x: p.x, y: p.y, h: p.h, yaw: p.yaw, pitch: p.pitch, dist: p.dist, mode: v.mode, ...(v.eye ? { cam: "eye" } : {}), ...(names ? { names: true } : {}) };
  if (v.mode !== "section" && storeyOn) s.storey = storeyOn;
  if (sun.sunM !== SUN_DEFAULT.sunM || sun.sunD !== SUN_DEFAULT.sunD || sun.sunH !== SUN_DEFAULT.sunH) Object.assign(s, sun);   // the light a saved view keeps
  if (v.mode === "section" && v.section) Object.assign(s, { wing: v.section.wing, section: v.section.kind, building: site.buildings.find(b => b.wing === v.section.wing)?.id,
    ...(v.section.kind === "fasade" && side ? { side } : {}), ...(sheet ? { drawn: sheet.id } : {}) });
  return s;
}
function drawViews() {
  const list = draft && !draft.missing ? draft.views || [] : [], edit = canSave(), box = $("views");
  box.hidden = !edit && !list.length; if (box.hidden) return viewsOpen(false);
  $("viewsBtn").querySelector("span").textContent = list.length ? `Visninger (${list.length})` : "Visninger";
  $("viewsList").innerHTML = list.length ? list.map(w => `<li data-id="${esc(w.id)}"><button type="button" class="go" title="Gå til visningen">${esc(w.name)}${w.by === "anton" ? ` <small>Anton</small>` : ""}</button>${edit
    ? `<button type="button" class="ic" data-ren title="Gi nytt navn" aria-label="Gi «${esc(w.name)}» nytt navn">✎</button><button type="button" class="ic" data-del title="Ta bort" aria-label="Ta bort «${esc(w.name)}»">×</button>` : ""}</li>`).join("")
    : `<li class="none">Ingen lagrede visninger ennå.</li>`;
  $("viewSave").hidden = !edit;
  $("viewsSeries").hidden = !list.length && !edit; $("seriesPlay").hidden = !list.length; $("seriesPrint").hidden = !list.length; $("seriesMake").hidden = !edit;
  $("seriesPlay").textContent = list.some(w => w.state?.series) ? "Vis bildeserie" : "Vis visningene etter hverandre";
  if (edit && !$("viewName").value) $("viewName").placeholder = freeName(list);
}
function viewsOpen(on) { $("viewsPop").hidden = !on; $("viewsBtn").setAttribute("aria-expanded", String(on)); if (on) drawViews(); }
async function viewsDo(body) {
  const j = await change({ ...where(), ...body }); if (!j || j.error) { toast(`Fikk ikke lagret visningen${j?.error ? `: ${j.error}` : "."}`); return null; }
  draft.views = j.views; drawViews(); return j;
}
$("viewsBtn").onclick = () => viewsOpen($("viewsPop").hidden);
$("viewsList").onclick = async e => {
  const li = e.target.closest("li[data-id]"); if (!li) return; const w = (draft.views || []).find(x => x.id === li.dataset.id); if (!w) return;
  if (e.target.closest(".go")) { if (series) shotEnd(); showView({ ...w.state, glide: 900 }); }
  else if (e.target.closest("[data-del]")) { if (await viewsDo({ view: "remove", id: w.id })) toast(`«${w.name}» er tatt bort.`, { label: "Angre", run: () => viewsDo({ view: "add", name: w.name, state: w.state }) }); }
  else if (e.target.closest("[data-ren]")) {   // the name becomes a field in place; Enter keeps it, Esc leaves it
    const go = li.querySelector(".go"), f = Object.assign(document.createElement("input"), { value: w.name, maxLength: 60, className: "ren" }); f.setAttribute("aria-label", "Nytt navn");
    go.replaceWith(f); f.focus(); f.select(); let done = false;
    const end = async keep => { if (done) return; done = true; if (keep && f.value.trim() && f.value.trim() !== w.name) await viewsDo({ view: "rename", id: w.id, name: f.value }); else drawViews(); };
    f.onkeydown = k => { if (k.key === "Enter") { k.preventDefault(); end(true); } else if (k.key === "Escape") { k.stopPropagation(); end(false); } }; f.onblur = () => end(true);
  }
};
$("viewSave").onsubmit = async e => {
  e.preventDefault(); const name = $("viewName").value.trim() || $("viewName").placeholder;
  const j = await viewsDo({ view: "add", name, state: viewNow() }); if (j) { $("viewName").value = ""; drawViews(); toast(`Visningen er lagret som «${(j.views.find(w => w.id === j.saved) || {}).name || name}».`); }
};
/* «Bildeserie» (U3527): the series of shots Anton put together (make_shots, or «Lag bildeserie» here), or every saved
   view when there is none, one at a time with its caption; a pair's «før» is the before painted in place, and the one
   button there turns it to «etter» and back. A move of one's own leaves the caption up; ×, Esc or another view ends it */
let series = null;
const seriesOf = () => { const l = draft && !draft.missing ? draft.views || [] : [], s = l.filter(w => w.state?.series); return s.length ? s : l; };
function shotShow(i) {
  const l = seriesOf(); if (!l.length) return shotEnd();
  series = { i: (i + l.length) % l.length, n: l.length }; const w = l[series.i], st = w.state || {};
  showView({ ...st, glide: 1100 });
  $("shotTitle").textContent = `${series.i + 1}/${l.length} · ${w.name.replace(/^\d+ /, "")}`; $("shotCap").textContent = st.caption || "";
  const e = $("shotEra"); e.hidden = !st.era; if (st.era) { e.textContent = st.era === "før" ? "Vis etter" : "Vis før"; e.dataset.era = st.era; }
  $("shot").hidden = false; document.body.classList.add("shooting");
}
function shotEnd() { series = null; $("shot").hidden = true; document.body.classList.remove("shooting"); paintEra(null); }
$("shotPrev").onclick = () => shotShow(series.i - 1); $("shotNext").onclick = () => shotShow(series.i + 1); $("shotEnd").onclick = shotEnd;
$("shotEra").onclick = () => { const e = $("shotEra"), to = e.dataset.era === "før" ? "etter" : "før"; paintEra(to); e.dataset.era = to; e.textContent = to === "før" ? "Vis etter" : "Vis før"; };
$("seriesPlay").onclick = () => { viewsOpen(false); shotShow(0); };
/* the series on paper (U3527): each shot on its own A4 page across, the picture with its names over it, its number,
   name and caption, and where it is from; the view the person had is put back after */
const frames = n => new Promise(ok => { let c = 0; const f = () => (++c >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function printSeries() {
  const l = seriesOf(); if (!l.length) return;
  const el = $("view"), W = el.clientWidth, H = el.clientHeight, PX = 96 / 25.4, k = Math.min(277 * PX / W, 162 * PX / H), back = viewNow(), was = series?.i;
  const title = draft?.version ? draft.title : "Utkast", pages = [];
  for (const [i, w] of l.entries()) {
    showView({ ...w.state, glide: 1 }); await frames(3);
    const pic = new Image(); pic.src = viewer.snapshot(); await pic.decode(); await frames(1);
    pages.push({ w, i, pic, names: viewer.labels.cloneNode(true) });
  }
  $("sheet").innerHTML = pages.map(({ w, i }) => `<section class="spage"><div class="pic" style="width:${(W * k).toFixed(1)}px;height:${(H * k).toFixed(1)}px"><div style="width:${W}px;height:${H}px;transform:scale(${k.toFixed(4)});transform-origin:0 0"></div></div>
    <div class="block"><div style="flex:1"><h1>${esc(`${i + 1}/${l.length} · ${w.name.replace(/^\d+ /, "")}`)}</h1><p>${esc(w.state?.caption || "")}</p><p>Gamle Drammen sykehus, Dronninggata 28 · ${esc(title)} · ${w.state?.era === "før" ? "slik det står i dag" : "forslaget"} · utskrevet ${new Date().toLocaleDateString("nb-NO")} fra sykehus.gulden.no</p></div></div>
    <div class="src">Tegnet fra arkivets tegninger, OpenStreetMap og Kartverkets laser; ikke målt på stedet. ${w.state?.cam === "eye" ? "Øyehøyde 1,7 m over terrenget." : w.state?.mode === "plan" ? "Plan, nord opp, uten målestokk." : "Perspektiv, uten målestokk."}</div></section>`).join("");
  $("sheet").querySelectorAll(".pic > div").forEach((d, j) => { const { pic, names } = pages[j]; pic.style.cssText = "position:absolute;inset:0;width:100%;height:100%"; d.append(pic, names); });
  print();
  if (was != null) shotShow(was); else { paintEra(null); showView({ ...back, glide: 1 }); }
}
$("seriesPrint").onclick = () => { viewsOpen(false); printSeries(); };
$("seriesMake").onclick = async () => {
  const b = $("seriesMake"); b.disabled = true; b.textContent = "Setter sammen …";
  const j = await change({ ...where(), shots: true }); b.disabled = false; b.textContent = "Lag bildeserie";
  if (!j || j.error) return toast(`Fikk ikke laget bildeserien${j?.error ? `: ${j.error}` : "."}`);
  draft.views = j.views; drawViews(); viewsOpen(false); shotShow(0);
};
addEventListener("keydown", e => {
  if (!series || e.target.closest?.("input, textarea")) return;
  if (e.key === "ArrowRight") shotShow(series.i + 1); else if (e.key === "ArrowLeft") shotShow(series.i - 1); else if (e.key === "Escape") shotEnd();
});
addEventListener("keydown", e => { if (e.key === "Escape" && !$("viewsPop").hidden) viewsOpen(false); });
document.addEventListener("pointerdown", e => { if (!$("viewsPop").hidden && !e.target.closest("#views")) viewsOpen(false); });
drawViews();
drawDraft();
/* «Del», the one thing done by hand: a version is opened to those with its link, a draft's own link is given */
async function share() {
  let link;
  if (mine()) { const j = await change({ share: versionId }); if (j.error) return toast(`Fikk ikke delt: ${j.error}`); link = j.link; draft.sharing = j.sharing; drawDraft(); }
  else link = new URL(`./?utkast=${encodeURIComponent(draftId)}`, location.href).href;
  try { await navigator.clipboard.writeText(link); toast("Lenken er kopiert. Alle med den ser dette, også uten innlogging."); }
  catch { toast(`Lenken: ${link}`); }
}
function describe(e) {   // by the wings as they were, since a wing torn down is gone from site.wings
  const wings = site0.wings || [], w = wings.find(x => x.id === e.wing)?.name || e.wing;
  const why = e.why && !PAGE_WHY.test(e.why) ? ` (${e.why})` : "";
  if (e.kind === "level") return `${w}, ${e.storey}: kote ${kote(e.kote)}${why}`;
  if (e.kind === "wing") return `${w}, ${{ name: "navn", use: "bruk", built: "bygget", storeys: "etasjer", construction: "konstruksjon", facade: "fasade", note: "merknad" }[e.field] || e.field}: ${e.value}${why}`;
  if (e.kind === "room") return `${e.storey}, ${e.room}: ${Object.entries(e.set).map(([k, v]) => `${{ name: "navn", use: "bruk", area_m2: "areal" }[k] || k} ${k === "area_m2" ? v + " m²" : v}`).join(", ")}${why}`;
  if (e.kind === "demolish") return `Rives: ${nameOf(e.building)}${why}`;
  if (e.kind === "restore") return `Beholdes: ${nameOf(e.building)}${why}`;
  if (e.kind === "balconies") return `Balkonger på ${w} mot ${e.face != null ? `${e.face}°` : { N: "nord", Ø: "øst", S: "sør", V: "vest" }[e.side]}, ${String(e.depth).replace(".", ",")} m dype${e.windows ? ", én per vindu" : ""}${e.bay ? `, ${String(e.bay).replace(".", ",")} m brede` : ""}${why}`;
  if (e.kind === "reshape") {
    const was = /^(flate|sti|tre)-\d+$/.test(e.id) ? nameOf(e.id) : draft?.edits?.find(x => x.kind === "volume" && x.id === e.id)?.name || "nytt bygg", what = [];
    if (e.surface) what.push((SURFACE_NO[e.surface] || e.surface).toLowerCase()); if (e.ring || e.line) what.push("ny form");
    if (e.name) what.push(`navn «${e.name}»`); if (e.use) what.push(`bruk ${e.use}`); if (e.storeys) what.push(`${e.storeys} etasjer`); if (e.built) what.push(`bygget ${e.built}`); if (e.note) what.push("merknad");
    if (e.from) what.push("flyttet eller nye mål"); if (e.width) what.push(`${String(e.width).replace(".", ",")} m bredt`); if (e.height) what.push(`${String(e.height).replace(".", ",")} m høyt`);
    return `${was}: ${what.join(", ")}${why}`;
  }
  if (e.kind === "volume") return `${e.name}: ${{ box: "kasse", gable: "saltak", triangle: "trekant (A-form)", lean_to: "pulttak" }[e.shape]}, ${String(e.width).replace(".", ",")} × ${String(Math.round(Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) * 10) / 10).replace(".", ",")} m, ${String(e.height).replace(".", ",")} m høy, ${{ glass: "glass", concrete: "betong", steel: "stål", wood: "tre", brick: "tegl" }[e.material]}${why}`;
  const surf = k => (SURFACE_NO[k] || k).toLowerCase();   // valg.js's names, small
  if (e.kind === "surface") return `${e.name ? e.name + ": " : ""}${surf(e.surface)}${e.plants?.length ? ` (${e.plants.join(", ")})` : ""}${why}`;
  if (e.kind === "path") return `${e.name || "Sti"}: ${surf(e.surface)}, ${String(e.width).replace(".", ",")} m bred${why}`;
  if (e.kind === "trees") return `Planter ${e.points ? e.points.length : "en rekke"} ${e.species}${why}`;
  if (e.kind === "fell") return `Feller trærne i et område${why}`;
  if (e.kind === "paint") return `${e.mode === "erase" ? "Visker ut" : "Maler"} ${surf(e.surface).toLowerCase()}${why}`;
  if (e.kind === "terrain") return `${{ raise: "Hever terrenget", lower: "Senker terrenget", flatten: "Planerer terrenget", smooth: "Jevner terrenget", pond: "Graver en dam", terrace: "Lager en terrasse" }[e.op] || "Flytter jord"}${e.h != null ? ` ${String(e.h).replace(".", ",")} m` : ""}${why}`;
  if (e.kind === "ground") return `${e.name || "Terrenget"} planeres${e.kote != null ? ` på kote ${kote(e.kote)}` : ""}${e.fall ? `, fall 1:${e.fall}` : ""}${e.edge === "wall" ? ", med støttemur" : ""}${why}`;
  return `Notat${e.wing ? " på " + w : ""}${e.storey ? ", " + e.storey : ""}: ${e.text}`;
}
/* «Riv» (U3542, on the card over the pick since U3554, float.js): tear wings or buildings down as a change in the
   after, never in the data: into the draft shown, or the signed-in person's own version shown, else a new draft (a
   day, no login). The page then shows the draft from the same place, with «Angre» over the view; «Forslag» lists
   every change with its own «Angre». What is torn down leaves nothing on the model. */
/* where a change goes: one's own version shown, the draft shown, else one's own work (signed in, the server's; signed
   out, the draft this browser keeps, if it is still there), else a new draft */
const where = () => mine() ? { version: versionId } : ownDraft() && draft && !draft.missing ? { draft: draftId } : !me.person && kept ? { draft: kept } : {};
let busy = false;   // one change at a time
async function change(body) {
  const r = await fetch("api/endring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "Fikk ikke kontakt." };
  return r?.ok ? j : { error: j.error || "Det gikk ikke.", ...(j.stale ? { stale: true } : {}) };
}
/* the draft or version after a change, in place: its edits fetched, the model laid anew over the same objects, the
   viewer told what is gone, the strip, «Forslag» and the IFC link redrawn, the address changed without a reload */
async function show(j) {
  if (j.version) { versionId = j.version; nokkel = null; draftId = null; }
  else if (j.draft) { versionId = null; draftId = kept = j.draft; try { localStorage.setItem(KEPT, j.draft); } catch { } }
  const d = Array.isArray(j.shown?.edits) ? j.shown : await fetchDraft(); if (d.missing) return toast("Fikk ikke hentet utkastet.");
  draft = d; const m = modelOf(draft.edits);
  const goneNow = new Set((m.site.demolished || []).map(x => x.id));
  const newNow = new Set((m.site.added || []).map(a => a.id));
  const groundNow = new Set([...(m.site.landscape || []), ...(m.site.plantings || [])].map(g => g.id));
  const roadsGone = new Set((m.site.roads_removed || []).map(r => r.id));
  if (valg.items.some(i => i.kind === "road" ? roadsGone.has(i.id) : i.kind === "ground" ? !groundNow.has(i.id) : i.kind === "wing" ? site.buildings.some(b => b.wing === i.id && goneNow.has(b.id)) : i.kind === "new" ? !newNow.has(i.id) : goneNow.has(i.id))) { valg.clear(); shut(); }
  refill(site, m.site); refill(floors, m.floors);
  refill(drawnSections, drawnSections0.filter(x => !x.wing || wings.some(w => w.id === x.wing)));
  paint();
  storeys = [...new Set([...wings.flatMap(w => (w.levels || []).map(l => l.name)), ...floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
  if (storeyOn && !storeys.includes(storeyOn)) pickStorey(null); else if (storeyOn) showStorey(storeyOn);
  dimStrip(); drawDraft(); drawViews(); ifcLink(); dispatchEvent(new CustomEvent("sykehus:versjoner"));
  dispatchEvent(new CustomEvent("sykehus:valg", { detail: valg.items }));   // the card over the pick shows the new facts
  const open = cardOf && (cardOf.kind === "new" ? (site.added || []).find(a => a.id === cardOf.id) : null); if (open) showNew(open);
  const openG = cardOf?.kind === "ground" && [...(site.landscape || []), ...(site.plantings || [])].find(g => g.id === cardOf.id); if (openG) showGround(openG);
  const u = new URL(location.href); for (const k of ["utkast", "versjon", "nokkel", "for"]) u.searchParams.delete(k);
  if (versionId) u.searchParams.set("versjon", versionId); else u.searchParams.set("utkast", draftId);
  history.replaceState(null, "", u.href);
}
/* one change from the page, into where() (see there), shown in place; null when it did not go through (said in a toast) */
async function edit(mine_, failed, redoing = false) {
  if (busy) return null; busy = true;
  try {
    /* on someone else's draft or version, one's own starts from what is shown: its live part first (the rest of it,
       if any, is Anton's, and goes with «Ny kopi» or through him) */
    /* each new building with the id it has where it is shown (design.js numbers those sent with none, volum-1, -2 …), so
       the change made to it here still finds it in one's own (the server says when it had to give another) */
    let nv = 0; const shownId = e => e.kind === "volume" && e.id == null ? { ...e, id: `volum-${++nv}` } : (e.kind === "volume" && nv++, e);
    const from = draft && !draft.missing && !mine() && !ownDraft() ? draft.edits.map(shownId).filter(LIVE) : [];
    const edits = [...from, ...mine_];
    let j = await change({ ...where(), edits });
    if (j.error && !draftId && kept) { kept = null; j = await change({ edits }); }   // the kept draft is past its day
    if (j.error) { toast(`${failed}: ${j.error}`); return null; }
    if (!redoing) keys.clear();   // a new change ends the redo
    await show(j); return { n: draft.edits.length, k: mine_.length };
  } finally { busy = false; }
}
/* the viewer's own lists, as tearAtOnce takes them */
const hiding = () => ({ gone: () => (site.demolished || []).map(d => d.id), roads: () => (site.roads_removed || []).map(x => x.id), setGone: ids => viewer.setGone(ids), setRoads: ids => streetsOn?.setRemoved(ids) });
/* a demolish put back or taken out again (Cmd-Z, Shift-Cmd-Z), shown at once where the viewer has the thing: a building or a road */
const quickBack = e => e?.kind === "demolish" && typeof e.building === "string" && !GROUND_ID.test(e.building);
async function riv(targets, name, ground = false) {   // ground: a surface or a path, taken away (U3569)
  /* a target is an id, or { building, name } for a road section (U3543), whose name the server cannot look up */
  if (busy) return;
  const send = () => edit(targets.map(t => ({ kind: "demolish", ...(typeof t === "string" ? { building: t } : t), why: ground ? "fjernet på siden" : "revet på siden" })), ground ? "Fikk ikke fjernet" : "Fikk ikke revet");
  /* hidden at once (U3649, Morten 13:06Z: «it takes a long time from i press delete to object dissapears»); the viewer's
     gone list takes a surface or a path as it takes a building */
  const r = await tearAtOnce({ ...hiding(), targets, send, clear: () => { valg.clear(); shut(); } });
  if (!r) return;
  toast(`${name[0].toUpperCase() + name.slice(1)} er ${ground ? "fjernet" : "revet"} i ${versionId ? "versjonen" : "utkastet"}.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
}

/* new buildings (U3556, Morten 20:18Z «also crud for buildings, names and such»): «Nytt bygg», then a tap on the
   ground: a box of three storeys, 30 × 12 m, its length across the screen; its card renames it, sets its facts,
   sizes it, turns it a quarter, «Flytt» moves it to the next tap; «Riv» takes it away. Each is one change, with Angre. */
const newId = () => "n" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const along = () => { const a = viewer.view().north || 0; return [Math.cos(a), Math.sin(a)]; };   // screen right, east and north
function aim(on, hint, text) {
  placing = on; $("mnew").setAttribute("aria-pressed", String(!!on && hint === "ny")); document.body.classList.toggle("placing", !!on);
  if (on) toast(text || (hint === "ny" ? "Trykk på bakken der det nye bygget skal stå." : "Trykk der bygget skal stå."), { label: "Avbryt", run: () => { aim(null); $("toast")?.remove(); } });
}
/* U3671: Anton asks for a place (ask_point, mcp.mjs): the plan, framed near its hint, one tap sets a pin, and the point goes back as the
   person's next message: plain words for the person, and the point (metres east and north on the site) to Anton out of view */
async function askPoint(q) {
  const { dropPin, clearPin, pinDialog } = await import("./pin.js?v=3"); clearPin(viewer);
  viewer.select(null); valg.clear(); shut(); if (placing) { aim(null); $("toast")?.remove(); }   // no building card stays open under the dialog
  setMode("plan"); if (storeyOn) pickStorey(null);
  const question = String(q.question || "Hvor?").trim();
  const dlg = pinDialog({ question, view: $("view"), stage: $("stage"), viewer, zoom: f => viewer.zoom(f),
    cancel: () => { placing = null; clearPin(viewer); },   // nothing is sent
    use: ([x, y, k]) => {
      placing = null;
      const near = site.buildings.map(b => [b, Math.min(...b.ring.map(p => Math.hypot(p[0] - x, p[1] - y)))]).sort((a, b) => a[1] - b[1])[0];
      const where = near && near[1] < 30 ? `, ${Math.round(near[1])} m fra ${nameOf(near[0].wing || near[0].id)}` : "";
      document.dispatchEvent(new CustomEvent("sykehus:anton-say", { detail: { text: `Her: nålen står på planen${where}.`, point: { x, y } } }));   // the figures go to Anton only (assistant.mjs)
      /* the pin is framed in the part the conversation does not cover: above it on a phone, left of the side panel on a desk */
      const phone = innerWidth <= 700, d = q.dist || 140, mpp = d * 0.72 / (innerHeight || 800), shift = phone ? { x, y: y - 0.25 * d * 0.72 } : { x: x + mpp * 180, y };
      setTimeout(() => { viewer.select(null); valg.clear(); shut(); viewer.look({ ...shift, dist: d }, 300); }, 200);
    } });
  placing = ([x, y, k]) => dlg.place([x, y, k ?? 0]);
  dlg.open();
  if (Number.isFinite(q.x) && Number.isFinite(q.y)) viewer.look({ x: q.x, y: q.y, dist: q.dist || 90, yaw: 0 }, 0);
}
$("mnew").onclick = () => placing ? (aim(null), $("toast")?.remove()) : aim(async ([x, y]) => {
  aim(null); const [dx, dy] = along(), L = 15, id = newId();
  const r = await edit([{ kind: "volume", id, name: "Nytt bygg", shape: "box", from: [x - dx * L, y - dy * L], to: [x + dx * L, y + dy * L], width: 12, storeys: 3, material: "concrete", why: "satt opp på siden" }], "Fikk ikke satt opp bygget");
  if (!r) return;
  valg.clear(); valg.add({ kind: "new", id, label: "Nytt bygg" }); const a = site.added.find(x => x.id === id); if (a) showNew(a);
  toast("Nytt bygg satt opp. Trykk «Endre» for navn, etasjer og mål.", { label: "Angre", run: () => undoLast(r.n, r.k) });
}, "ny");
/* «Mal» (U3655, Morten 13:53Z «painting lawns (with edge detection stuff) …»): the drag brush of hagekart, from renderkit, in
   mal.js: press and drag, a ghost of what the brush would paint, release to send one change (with Angre). «Terreng» moves
   earth under the same stroke (flatten, raise, lower, pond) and the toast says what was dug and filled. */
const malPop = $("malPop"); let malMode = "paint", malSp = null, mal = null;   // malSp: the species picked, or null
const malS = { surface: "grass", erase: false, r: 1.5, op: "flatten", h: 0.5, types: new Set() };
const malOpts = () => ({ mode: malMode, surface: malS.surface, erase: malS.erase, r: malS.r, op: malS.op, h: malS.h, species: malSp?.id, crown: malSp?.sp, gap: +$("malGap").value });
const pressed = (btn, on) => btn.setAttribute("aria-pressed", String(!!on));
/* the picker's parts, drawn once: swatches (renderkit's pictures), brush chips, terrain acts */
function malBuild() {
  $("malSwatches").replaceChildren(...SWATCHES.map(w => { const b = document.createElement("button"); b.type = "button"; b.dataset.id = w.id; b.title = w.no;
    b.innerHTML = `<img src="${w.img}" alt="" width="64" height="64" loading="lazy"><span>${w.no}</span>`; b.onclick = () => { malS.surface = w.id; malS.erase = false; malMark(); }; return b; }),
    (() => { const b = document.createElement("button"); b.type = "button"; b.dataset.id = "erase"; b.title = "Visk ut det du drar over";
      b.innerHTML = `<span class="ute-pic">${ERASER}</span><span>Visk ut</span>`; b.onclick = () => { malS.erase = true; malMark(); }; return b; })());
  $("malSizes").replaceChildren(...SIZES.map(z => { const b = document.createElement("button"); b.type = "button"; b.dataset.r = z.r; b.title = z.no; b.setAttribute("aria-label", `${z.no} pensel`);
    b.innerHTML = `<i style="width:${z.px}px;height:${z.px}px"></i>`; b.onclick = () => { malS.r = z.r; malMark(); }; return b; }));
  $("malOps").replaceChildren(...OPS.map(o => { const b = document.createElement("button"); b.type = "button"; b.dataset.op = o.op; b.innerHTML = `${OP_ICON[o.op]}<span>${o.no}</span>`; b.onclick = () => { malS.op = o.op; malMark(); }; return b; }));
  $("malTypes").replaceChildren(...CHIPS.map(c => { const b = document.createElement("button"); b.type = "button"; b.textContent = c; b.dataset.chip = c; b.onclick = () => { malS.types.has(c) ? malS.types.delete(c) : malS.types.add(c); malMark(); malFind(); }; return b; }));
  $("malHm").onclick = () => { malS.h = Math.max(0.1, Math.round((malS.h - 0.1) * 10) / 10); malMark(); };
  $("malHp").onclick = () => { malS.h = Math.min(10, Math.round((malS.h + 0.1) * 10) / 10); malMark(); };
  malMark();
}
function malMark() {   // what is picked, ringed
  for (const b of $("malSwatches").children) pressed(b, b.dataset.id === "erase" ? malS.erase : !malS.erase && b.dataset.id === malS.surface);
  for (const b of $("malSizes").children) pressed(b, +b.dataset.r === malS.r);
  for (const b of $("malOps").children) pressed(b, b.dataset.op === malS.op);
  for (const b of $("malTypes").children) pressed(b, malS.types.has(b.dataset.chip));
  $("malH").textContent = `${String(malS.h).replace(".", ",")} m`; $("malStep").hidden = !OPS.find(o => o.op === malS.op).h;
}
function malKind(mode) {
  malMode = mode;
  for (const [id, m] of [["malPaint", "paint"], ["malEarth", "terrain"], ["malPlant", "plant"]]) pressed($(id), m === mode);
  for (const el of malPop.querySelectorAll(".mal-paint")) el.hidden = mode !== "paint"; for (const el of malPop.querySelectorAll(".mal-earth")) el.hidden = mode !== "terrain";
  for (const el of malPop.querySelectorAll(".mal-plant")) el.hidden = mode !== "plant"; for (const el of malPop.querySelectorAll(".mal-brush")) el.hidden = mode === "plant";
  if (mode === "plant") malFind();
}
/* the plant cards: hagekart's list (plants.js, the same as Anton's), drawn by kind, the banned ones left out of the grid; typed, a banned one is explained */
function malFind() {
  const q = $("malSp").value.trim(), found = q ? searchPlants(q, 40).filter(p => !p.banned) : null, list = $("malSpList"), say = $("malSpSay");
  const banned = q ? searchPlants(q, 3).filter(p => p.banned) : [];
  say.hidden = !banned.length; say.textContent = banned.map(p => `${p.no}: ${p.why.toLowerCase().replace(/^forbudt/, "forbudt")}.`).join(" ");
  const show = cards(found ? PLANTS.filter(p => found.some(f => f.id === p.id)) : PLANTS, [...malS.types]);
  list.replaceChildren(...show.map(p => { const b = document.createElement("button"); b.type = "button"; b.title = `${p.no}${p.la ? ` (${p.la})` : ""}`; pressed(b, malSp?.id === p.id);
    b.innerHTML = `<span class="ute-pic">${silhouette(p)}</span><span>${esc(p.no)}</span><small>${esc(heightText(p))}</small>`; b.onclick = () => { malSp = p; malFind(); }; return b; }));
  if (!show.length && !banned.length) { const n = document.createElement("small"); n.textContent = "Ingen arter passer."; list.append(n); }
}
async function malSend(line, o) {
  const earth = o.mode === "terrain", plant = o.mode === "plant";
  if (plant && !o.species) { toast("Velg en art først."); return; }
  const rowIt = plantAt(line, o).length > 1, edit1 = plant
    ? { kind: "trees", species: o.species, ...(rowIt ? { line, spacing: o.gap } : { points: [line[0]] }), why: "plantet på siden" }
    : earth
    ? { kind: "terrain", op: o.op, shape: { t: "stroke", pts: line, r: o.r }, ...(o.op === "flatten" ? {} : { h: o.h }), why: "flyttet jord på siden" }
    : { kind: "paint", surface: o.surface, mode: o.erase ? "erase" : "add", line, r: o.r, around: nearWays(streetsOn?.wayRings?.() || [], { line, r: o.r }), why: "malt på siden" };
  const r = await edit([edit1], plant ? "Fikk ikke plantet" : earth ? "Fikk ikke flyttet jord" : o.erase ? "Fikk ikke visket ut" : "Fikk ikke malt");
  if (!r) return;
  const w = site.earthwork;
  toast(plant ? `${malSp?.no || "Treet"} er plantet i utkastet.` : earth ? `Terrenget er endret i utkastet${w ? `: graves ut ${String(w.cut_m3).replace(".", ",")} m³, fylles ${String(w.fill_m3).replace(".", ",")} m³ (om lag ${w.tippers} lass)` : ""}.` : o.erase ? "Visket ut i utkastet." : "Malt i utkastet. Penselen stoppet ved hus, vann og veier.", { label: "Angre", run: () => undoLast(r.n, r.k) });
}
function malOpen(on) {
  malPop.hidden = !on; $("mmal").setAttribute("aria-expanded", String(on)); $("mmal").setAttribute("aria-pressed", String(on));
  if (on && placing) { placing = null; document.body.classList.remove("placing"); }
  mal ||= createMal({ viewer, host: $("view"), site: () => site, ways: () => streetsOn?.wayRings?.() || [], opts: malOpts, send: malSend });
  mal.set(on);
}
$("mmal").onclick = () => malOpen(malPop.hidden);
$("malStop").onclick = () => malOpen(false);
$("malPaint").onclick = () => malKind("paint"); $("malEarth").onclick = () => malKind("terrain"); $("malPlant").onclick = () => malKind("plant"); $("malSp").oninput = malFind; malBuild();
malPop.onsubmit = ev => ev.preventDefault();
/* «Hent fil» (U3571): an IFC from a manufacturer (a greenhouse, a window), signed in; the server keeps it by its sha
   and the worker reads it (its own units, made metres), then a tap stands it there as a construction is: its box's
   middle at the tap, its length across the screen, its foot on the ground; its card says where it came from */
const impPop = $("impPop"), impSay = t => { $("impSay").hidden = !t; $("impSay").textContent = t || ""; };
const impOpen = on => { impPop.hidden = !on; $("mimp").setAttribute("aria-expanded", String(on)); $("mimp").setAttribute("aria-pressed", String(on)); if (on) { impSay(""); $("impFile").focus(); } };
$("mimp").onclick = () => {
  if (!me.person) return toast("Logg inn for å hente inn filer: de lagres i ditt forslag.");
  impOpen(impPop.hidden);
};
/* OBJ and STL say no unit: the person picks it before it goes */
const bare = f => /\.(obj|stl)$/i.test(f?.name || ""), plan = f => /\.(dxf|dwg)$/i.test(f?.name || "");
$("impFile").onchange = () => { const f = $("impFile").files?.[0]; $("impUnitL").hidden = !bare(f) && !plan(f); $("impUnitL").firstChild.textContent = plan(f) ? "Tegnet i (om fila ikke sier det)" : "Tegnet i (fila sier det ikke)"; };
impPop.onsubmit = async ev => {
  ev.preventDefault();
  const f = $("impFile").files?.[0], licence = $("impLic").value.trim(), source = $("impSrc").value.trim(), unit = $("impUnit").value;
  if (!f || !licence) return;
  if (bare(f) && !unit) return impSay("Velg enheten fila er tegnet i: den sier det ikke selv.");
  if (f.size > 100 * 1024 * 1024) return impSay("Fila er større enn 100 MB.");
  $("impGo").disabled = true; impSay(`Leser ${f.name} …`);
  let j;
  try { j = await fetch(`api/import?filename=${encodeURIComponent(f.name)}${(bare(f) || plan(f)) && unit ? `&unit=${unit}` : ""}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: f }).then(r => r.json()); }
  catch { j = { error: "Fikk ikke sendt fila." }; }
  finally { $("impGo").disabled = false; }
  if (j.error) { if (/enhet/.test(j.error)) $("impUnitL").hidden = false; return impSay(j.error); }
  impOpen(false);
  const [lx, ly, lz] = j.size_m || [10, 10, 5], m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
  aim(async ([x, y]) => {
    aim(null); $("toast")?.remove(); const [dx, dy] = along(), h = Math.max(0.5, lx / 2), id = newId(), name = f.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80);
    const r = await edit([{ kind: "import", id, name, file: j.file, licence, ...(source ? { source } : {}), from: [x - dx * h, y - dy * h], to: [x + dx * h, y + dy * h], why: "hentet inn på siden" }], "Fikk ikke satt den på tomta");
    if (!r) return;
    valg.clear(); valg.add({ kind: "new", id, label: name }); const a = site.added.find(q => q.id === id); if (a) showNew(a);
    toast(`${name} er satt på tomta.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
  });
  toast(`${f.name}: ${m1(lx)} × ${m1(ly)} m, ${m1(lz)} m høy${j.unit?.length && j.unit.length !== "metre" && j.unit.from !== "person" ? ` (fila er i ${{ millimetre: "millimeter", centimetre: "centimeter", decimetre: "desimeter", foot: "fot", inch: "tommer" }[j.unit.length] || j.unit.length}, gjort om)` : ""}. Trykk der den skal stå.`, { label: "Avbryt", run: () => { aim(null); $("toast")?.remove(); } });
};
/* by: how the build tools made it (renderkit build.js), in its why, so a change no one meant says where it came from */
const BY = { drag: "dratt", click: "med «Flytt»", keys: "med tastene", wheel: "med Shift og hjulet" };
async function reshape(id, set, what = "Endret", by = null) {
  const r = await edit([{ kind: "reshape", id, ...set, why: `endret på siden${BY[by] ? ` (${BY[by]})` : ""}` }], "Fikk ikke endret"); if (!r) return false;
  toast(`${what}.`, { label: "Angre", run: () => undoLast(r.n, r.k) }); return true;
}
function moveNew(a) {
  aim(([x, y]) => { aim(null); $("toast")?.remove(); const cx = (a.from[0] + a.to[0]) / 2, cy = (a.from[1] + a.to[1]) / 2, d = [x - cx, y - cy];
    reshape(a.id, { from: [a.from[0] + d[0], a.from[1] + d[1]], to: [a.to[0] + d[0], a.to[1] + d[1]] }, `${a.name} er flyttet`); });
}
function turnNew(a) {
  const cx = (a.from[0] + a.to[0]) / 2, cy = (a.from[1] + a.to[1]) / 2, h = [(a.to[0] - a.from[0]) / 2, (a.to[1] - a.from[1]) / 2];
  reshape(a.id, { from: [cx + h[1], cy - h[0]], to: [cx - h[1], cy + h[0]] }, `${a.name} er snudd`);
}
/* the card's «Endre»: the fields that changed, as one change each (a wing's facts) or one reshape (a new building) */
async function saveFacts(item, v) {
  if (item.kind === "ground") {   // a surface or a path: its name, what it is laid with, a path's width
    const g = (site.landscape || []).find(x => x.id === item.id) || (site.plantings || []).find(x => x.id === item.id); if (!g) return;
    const set = {};
    if (g.kind === "trees") {
      for (const k of ["height", "crown"]) if (v[k] && Number.isFinite(+v[k]) && Math.abs(+v[k] - g[k]) > 0.05) set[k] = +v[k];
      return Object.keys(set).length ? reshape(item.id, set, `${groundName(g)} er endret`) : undefined;
    }
    if (v.name != null && v.name.trim() !== (g.name ?? "")) set.name = v.name.trim();
    if (v.surface && v.surface !== g.surface) set.surface = v.surface;
    if (g.kind === "path" && v.width && Math.abs(+v.width - g.width) > 0.05) set.width = +v.width;
    if (!Object.keys(set).length) return;
    if (set.name === "") delete set.name;
    return reshape(item.id, set, `${set.name || groundName(g)} er endret`);
  }
  if (item.kind === "new") {
    const a = site.added.find(x => x.id === item.id), set = {};
    for (const k of ["name", "use", "built", "note"]) if (v[k] != null && v[k] !== (a[k] ?? "")) set[k] = v[k];
    if (v.storeys && +v.storeys !== a.storeys) set.storeys = +v.storeys;
    if (v.entrance != null && v.entrance !== (a.entrance ?? "")) set.entrance = v.entrance || null;
    /* length, direction (a compass's degrees) and middle: the same numbers the build tools show (U3569) */
    const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), c0 = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], ang0 = ((90 - Math.atan2(a.to[1] - a.from[1], a.to[0] - a.from[0]) * 180 / Math.PI) % 360 + 360) % 360;
    const nL = v.length && Math.abs(+v.length - L) > 0.05 ? +v.length : L, nA = v.angle !== "" && v.angle != null && Number.isFinite(+v.angle) && Math.abs(+v.angle - Math.round(ang0)) >= 1 ? +v.angle : ang0;
    const nC = [v.east !== "" && Number.isFinite(+v.east) && Math.abs(+v.east - c0[0]) > 0.05 ? +v.east : c0[0], v.north !== "" && Number.isFinite(+v.north) && Math.abs(+v.north - c0[1]) > 0.05 ? +v.north : c0[1]];
    if (nL !== L || nA !== ang0 || nC[0] !== c0[0] || nC[1] !== c0[1]) { const r = (90 - nA) * Math.PI / 180, u = [Math.cos(r), Math.sin(r)], h = nL / 2; set.from = [nC[0] - u[0] * h, nC[1] - u[1] * h]; set.to = [nC[0] + u[0] * h, nC[1] + u[1] * h]; }
    if (v.width && Math.abs(+v.width - a.width) > 0.05) set.width = +v.width;
    /* a construction's parameters (U3570): those changed go to its script again, in the same one change */
    if (a.shape === "bim") { const p = {}; for (const [k, x] of Object.entries(a.bim?.params || {})) { const n = v[`p_${k}`]; if (n != null && n !== "" && Number.isFinite(+n) && +n !== x) p[k] = +n; } if (Object.keys(p).length) set.params = p; }
    if (!Object.keys(set).length) return;
    for (const k of ["from", "to"]) if (set[k]) set[k] = set[k].map(q => Math.round(q * 100) / 100);
    /* the building goes there at once (pm 23:58Z: never back to where it was before it moves); back if refused */
    const undoPreview = build.item?.id === item.id && !set.params && (set.from || set.width || set.storeys) ? build.preview({ from: set.from || a.from, to: set.to || a.to, width: set.width ?? a.width, height: set.storeys ? set.storeys * 3.2 : a.top_kote - a.base_kote }) : null;
    const ok = await reshape(item.id, set, `${set.name || a.name} er endret`); if (!ok) undoPreview?.(); return ok;
  }
  const w = wings.find(x => x.id === item.id), ed = [];
  for (const k of ["name", "use", "built", "storeys", "note"]) if (v[k] != null && v[k].trim() && v[k].trim() !== String(w[k] ?? "")) ed.push({ kind: "wing", wing: w.id, field: k, value: v[k].trim(), why: "endret på siden" });
  if (!ed.length) return;
  const r = await edit(ed, "Fikk ikke endret"); if (!r) return;
  toast(`${ed.find(e => e.field === "name")?.value || w.name} er endret.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
}
/* a surface's or a path's card in «Bygget» (U3569): what it is, its size, its plants */
const PLANT_NO = new Map(PLANTS.map(p => [p.id, p.no]));
function showGround(g) {
  const plant = id => PLANT_NO.get(id) || id;
  if (g.kind === "trees") {   // a planting
    card(esc(groundName(g)), "Trær i forslaget", rows([["Art", `${esc(g.name || g.species)}${g.latin && g.latin !== g.name ? ` (<i>${esc(g.latin)}</i>)` : ""}`], ["Antall", String(g.count)],
      ["Høyde", `${String(g.height).replace(".", ",")} m`], ["Krone", `${String(g.crown).replace(".", ",")} m bred`]]) +
      (g.why ? `<p class="note">${esc(g.why)}</p>` : "") + `<p class="src">Plantet i forslaget; størrelsen fra hagekart der arten er kjent.</p>`, { kind: "ground", id: g.id, label: groundName(g) });
    return;
  }
  card(esc(groundName(g)), g.kind === "path" ? "Sti i forslaget" : g.surface === "water" ? "Vann i forslaget" : "Flate i forslaget", rows([
    [g.kind === "path" ? "Dekke" : "Materiale", esc(SURFACE_NO[g.surface] || g.surface)],
    ...(g.kind === "path" ? [["Lengde", `${String(g.length_m).replace(".", ",")} m`], ["Bredde", `${String(g.width).replace(".", ",")} m`]] : []),
    ["Areal", `${num(g.area_m2)} m²`], ...(g.plants?.length ? [["Planter", g.plants.map(p => esc(plant(p))).join(", ")]] : [])]) +
    (g.why ? `<p class="note">${esc(g.why)}</p>` : "") + `<p class="src">Lagt i forslaget; ikke i IFC-fila.</p>`, { kind: "ground", id: g.id, label: groundName(g) });
}
/* a road section's card in «Bygget» (U3543): what it is, its size here, where it comes from; «Fjern» is on the acts */
function showRoad(r) {
  const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
  card(esc(roadName(r)), "Vei rundt tomta", rows([["Slags", esc(r.what)], ...(r.width ? [["Bredde", `${m1(r.width)} m`]] : []), ...(r.length_m ? [["Lengde her", `${m1(r.length_m)} m`]] : [])]) +
    `<p class="src">${r.src === "nvdb" ? "Kjørebanen målt av Statens vegvesen (NVDB)" : "Fra OpenStreetMap"}, hentet hver dag. Fjernes den, blir den borte i forslaget også når gatene hentes på nytt.</p>`, { kind: "road", id: r.id, label: roadName(r) });
}
/* a new building's card in «Bygget» */
function showNew(a) {
  const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
  /* a plan brought in (U3571 S3: DXF, DWG): flat on the ground, its size and its layers, no height or digging */
  if (a.bim?.plan) return card(esc(a.name), "Tegning i forslaget", rows([["Mål", `${m1(L)} × ${m1(a.width)} m`], ["Lag", String(Object.values(a.bim.classes || {}).reduce((x, y) => x + y, 0))], ["Ligger på", `kote ${kote(a.base_kote)}`]]) +
    (a.note ? `<p class="note">${esc(a.note)}</p>` : "") + `<p class="src">Innhentet tegning «${esc(a.bim.filename || "plan.dxf")}», lagt flatt over bakken. Kilde: ${/^https?:\/\//.test(a.bim.source || "") ? `<a href="${esc(a.bim.source)}" target="_blank" rel="noopener noreferrer">${esc(a.bim.source.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</a>` : esc(a.bim.source || "ikke oppgitt")}. Lisens: ${esc(a.bim.licence || "ukjent")}.</p>`, { kind: "new", id: a.id, label: a.name });
  card(esc(a.name), a.bim?.file ? "Innhentet i forslaget" : "Nytt bygg i forslaget", rows([...(a.use ? [["Bruk", esc(a.use)]] : []), ...(a.storeys ? [["Etasjer", String(a.storeys)]] : []), ...(a.built ? [["Bygget", esc(a.built)]] : []),
    ["Mål", `${m1(L)} × ${m1(a.width)} m`], ["Grunnflate", `${num(a.footprint_m2)} m²`], ["Høyde", `${m1(a.top_kote - a.base_kote)} m`], ["Topp", `kote ${kote(a.top_kote)}`], ["Terreng", `kote ${kote(a.base_kote)}`],
    ...(a.ground ? [["Graving", `${num(a.ground.cut_m3)} m³ ut, ${num(a.ground.fill_m3)} m³ fylling`]] : [])]) +
    (a.ground ? `<p class="note">${esc(groundText(a.ground))}</p>` : "") +
    (lotText(a.lot) ? `<p class="note">${esc(lotText(a.lot))}</p>` : "") +
    (a.note ? `<p class="note">${esc(a.note)}</p>` : "") + (a.shape === "bim" && a.bim?.file
      /* a file brought in (U3571): where it came from and its licence, as said when it came; the file as it came */
      ? `<p class="src">Innhentet fil «${esc(a.bim.filename || "modell.ifc")}»${a.bim.format ? `, gjort om til IFC` : ""} (${a.bim.format ? `${Object.values(a.bim.classes || {}).reduce((x, y) => x + y, 0)} deler` : Object.entries(a.bim.classes || {}).map(([k, n]) => `${n} ${k.replace(/^Ifc/, "")}`).join(", ")}). Kilde: ${/^https?:\/\//.test(a.bim.source || "") ? `<a href="${esc(a.bim.source)}" target="_blank" rel="noopener noreferrer">${esc(a.bim.source.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</a>` : esc(a.bim.source || "ikke oppgitt")}. Lisens: ${esc(a.bim.licence || "ukjent")}.</p>`
      : a.shape === "bim" && a.bim?.sha
      /* a construction (U3570): Anton's script made it; its own IFC (an IfcBuilding with its storey and parts) */
      ? `<p class="src">Bygget av Antons skript (${Object.entries(a.bim.classes || {}).map(([k, n]) => `${n} ${k.replace(/^Ifc/, "")}`).join(", ")}).</p>`
      : `<p class="src">Satt opp i forslaget; med i IFC-fila som et eget bygg.</p>`), { kind: "new", id: a.id, label: a.name });
}
/* an undo names the change it takes out (expect), so a page that is behind (another tab, Anton) takes out nothing it
   did not show (pm 22:08Z: an undo in a second tab took out Morten's three newest changes); then the page is shown
   again as it is */
async function undo(n, expect = draft?.edits?.[n - 1]) {
  if (busy) return false; busy = true;
  try { const j = await change({ ...where(), undo: n, expect }); if (j.error) { toast(`Fikk ikke angret: ${j.error}`); if (j.stale) await refresh(); return false; } $("toast")?.remove(); await show(j); return true; }
  finally { busy = false; }
}
function toast(text, act) {
  $("toast")?.remove();
  const t = Object.assign(document.createElement("div"), { id: "toast", role: "status" }); t.innerHTML = `<span></span>`; t.firstChild.textContent = text;
  if (act) { const b = Object.assign(document.createElement("button"), { type: "button", textContent: act.label }); b.onclick = act.run; t.append(b); }
  const x = Object.assign(document.createElement("button"), { type: "button", className: "x", textContent: "×", title: "Lukk" }); x.setAttribute("aria-label", "Lukk"); x.onclick = () => t.remove(); t.append(x);
  $("stage").append(t); setTimeout(() => t.isConnected && t.classList.add("gone"), 15000); setTimeout(() => t.remove(), 15800);
}
/* «Angre» on the toast takes back every edit the one «Riv» made, the last first */
async function undoLast(n, k) { const was = draft.edits.slice(); for (let i = 0; i < k - 1; i++) { const j = await change({ ...where(), undo: n - i, expect: was[n - i - 1] }); if (j.error) { toast(`Fikk ikke angret: ${j.error}`); if (j.stale) await refresh(); return; } keys.taken(was[n - i - 1]); } if (await undo(n - k + 1, was[n - k])) keys.taken(was[n - k]); }
/* the IFC with the after's demolitions taken out (the server's ifcfilter.mjs) */
function ifcLink() {
  if (!draft || draft.missing) return;
  const a = document.querySelector("header a.ab-ic[href*='ifc']"), q = versionId ? `versjon=${encodeURIComponent(versionId)}${nokkel ? `&nokkel=${encodeURIComponent(nokkel)}` : ""}` : `utkast=${encodeURIComponent(draftId)}`;
  a.href = `api/ifc?${q}`; a.removeAttribute("download");
  a.title = "Last ned modellen med endringene (IFC): det som er revet er tatt ut, og det som er bygget nytt er med (terrenget som planeres er ikke)."; a.setAttribute("aria-label", "Last ned modellen med endringene");
}
ifcLink();

/* the versions: the public ones, and your own with how they are shared; Anton's saves call it again */
const VIS = { privat: "privat", lenke: "bare de med lenken", offentlig: "offentlig" };
let verRows = [], selecting = false; const picked = new Set();
function listVersions() {
  fetch("api/versjoner").then(r => r.ok ? r.json() : { versions: [] }).then(({ versions = [] }) => {
    versions = versions.filter(v => v.version !== versionId);   // the open one is the card above
    verRows = versions; for (const id of [...picked]) if (!versions.some(v => v.version === id && v.mine)) picked.delete(id);
    $("verBar").hidden = !versions.some(v => v.mine); if ($("verBar").hidden) selecting = false; drawBar();
    if (!versions.length) { $("verList").innerHTML = `<li class="sel-empty">Ingen forslag ennå.</li>`; return; }
    $("verList").innerHTML = versions.map(v => `<li>${selecting && v.mine ? `<input type="checkbox" class="vsel" data-id="${esc(v.version)}" aria-label="Velg «${esc(v.title)}»"${picked.has(v.version) ? " checked" : ""}>` : ""}<a href="?versjon=${encodeURIComponent(v.version)}${v.nokkel ? `&nokkel=${encodeURIComponent(v.nokkel)}` : ""}"${v.version === versionId ? ' aria-current="page"' : ""}><span><span class="t">${esc(v.title)}</span><small>${v.mine ? "din" : esc(v.owner)} · ${v.changes} ${v.changes === 1 ? "endring" : "endringer"} · ${new Date(v.updated).toLocaleDateString("nb-NO")}</small></span>${v.mine ? `<span class="vis">${VIS[v.sharing] || esc(v.sharing)}</span>` : ""}</a>${v.mine && !selecting ? `<button type="button" class="icon" data-vdel="${esc(v.version)}" title="Slett forslaget" aria-label="Slett forslaget: ${esc(v.title)}">${IC.bin}</button>` : ""}</li>`).join("");
  }).catch(() => {});
}
/* U3654: «Slett forslaget» and «Velg» + «Slett valgte (n)»: asked in the page first (no window.confirm), then one «Angre» for all */
const drawBar = () => { $("verSel").setAttribute("aria-pressed", String(selecting)); $("verSel").textContent = selecting ? "Ferdig" : "Velg"; $("verDelSel").hidden = !selecting; $("verDelSel").textContent = `Slett valgte (${picked.size})`; $("verDelSel").disabled = !picked.size; };
$("verSel").onclick = () => { selecting = !selecting; picked.clear(); closeAsk(); drawBar(); listVersions(); };
$("verList").addEventListener("change", e => { const c = e.target.closest("input.vsel"); if (!c) return; c.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); drawBar(); });
$("verList").addEventListener("click", e => { const b = e.target.closest("[data-vdel]"); if (b) askDelete([verRows.find(v => v.version === b.dataset.vdel)].filter(Boolean)); });
$("verDelSel").onclick = () => askDelete(verRows.filter(v => picked.has(v.version)));
let asking = [];
const closeAsk = () => { asking = []; $("verConfirm").hidden = true; };
function askDelete(rows) {
  if (!rows.length) return; asking = rows;
  $("verAsk").textContent = rows.length === 1 ? `Slette «${rows[0].title}»? Du kan angre i 30 dager.` : `Slette ${rows.length} forslag? Du kan angre i 30 dager.`;
  $("verConfirm").hidden = false; $("verNo").focus(); $("verConfirm").scrollIntoView?.({ block: "nearest" });
}
$("verNo").onclick = closeAsk;
$("verYes").onclick = async () => {
  const rows = asking; closeAsk(); if (!rows.length || busy) return; busy = true;
  try {
    const ids = rows.map(r => r.version), j = await change({ delete: ids }); if (j.error) return toast(`Fikk ikke slettet: ${j.error}`);
    const text = ids.length === 1 ? `«${rows[0].title}» er slettet.` : `${ids.length} forslag er slettet.`, was = versionId, wasOpen = ids.includes(was);
    selecting = false; picked.clear();
    if (wasOpen && !j.now_open) { try { sessionStorage.setItem(UNDO, JSON.stringify({ ids, text, reopen: was })); } catch { } location.href = "./?for"; return; }   // the open one is gone and no other is left: back to «Før»
    if (wasOpen) await show({ version: j.now_open.version }); else listVersions();
    toast(text, { label: "Angre", run: () => restoreVersions(ids, wasOpen ? was : null) });
  } finally { busy = false; }
};
async function restoreVersions(ids, reopen) {
  const j = await change({ undelete: ids }); if (j.error) return toast(`Fikk ikke hentet tilbake: ${j.error}`);
  if (reopen && j.restored.some(r => r.version === reopen)) { await show({ version: reopen }); } else listVersions();
  toast(ids.length === 1 ? "Forslaget er hentet tilbake." : `${ids.length} forslag er hentet tilbake.`);
}
const UNDO = "sykehus-slettet";   // the toast to show after the page went back to «Før»
try { const u = JSON.parse(sessionStorage.getItem(UNDO) || "null"); if (u) { sessionStorage.removeItem(UNDO); toast(u.text, { label: "Angre", run: () => restoreVersions(u.ids, u.reopen) }); } } catch { }
listVersions(); addEventListener("sykehus:versjoner", listVersions);

/* the card over the pick (float.js) */
let pickActs = null;
import("./float.js?v=20261026t").then(m => pickActs = m.createFloat({ viewer, site, valg, panel, stage: $("stage"), bstack: $("bstack"),
  onRiv: riv, onSave: saveFacts, onMove: a => { syncBuild(); build.move(); }, onTurn: turnNew,
  onStoreys: () => { panel.reveal("selected"); $("info").querySelector("[data-storey]")?.closest(".oc-row")?.scrollIntoView({ block: "start", behavior: "smooth" }); },
})).catch(e => console.error("float:", e));

/* ?spor: the trace mode for scanned sheets (trace.js), for those who trace; the page is otherwise as always */
/* signing in, and Anton for the signed in (anton.js) */
/* Anton saved the open version: its changes again, in place when the part the viewer was built with is the same
   (what Anton builds besides, balconies and the ground, needs the page again, from where it was) */
const fixed = edits => JSON.stringify((edits || []).filter(e => !LIVE(e)));
let base = fixed(draft?.edits);
async function refresh() {
  const d = await fetchDraft(); if (d.missing) return;
  keys.echo(d.edits);   // another tab or Anton changed it: what was taken back is not ours to put back (our own change's echo leaves it)
  if (fixed(d.edits) !== base) { try { sessionStorage.setItem("sykehus-pose", JSON.stringify(viewer.pose())); } catch { } return location.reload(); }
  await show(versionId ? { version: versionId } : { draft: draftId });
}
/* U3670: a try Anton makes while he works shows at once, in place: the new parts see-through, the camera eased to the newest, a free picture
   of it for the chat. A change that needs the page again (a non-LIVE kind) waits for the end of the turn, as before. */
let tryStart = null;
const tries = {
  async run() {
    const d = await fetchDraft(); if (d.missing || fixed(d.edits) !== base) return null;
    tryStart ??= new Set((site.added || []).map(a => a.id));
    await show({ ...(versionId ? { version: versionId } : { draft: draftId }), shown: d });
    const g = ghostIds(tryStart, (site.added || []).map(a => a.id)); viewer.ghost(g);
    const n = (site.added || []).find(x => x.id === g.at(-1));   // the newest part: the camera eases to it (focus knows the model's buildings only)
    if (n?.from && n?.to) viewer.look({ x: (n.from[0] + n.to[0]) / 2, y: (n.from[1] + n.to[1]) / 2, dist: Math.max(80, Math.hypot(n.to[0] - n.from[0], n.to[1] - n.from[1]) * 3 + (n.width || 0) * 2) }, 900);
    await new Promise(r => setTimeout(r, 1000));   // the camera's glide, then the picture
    return { thumb: viewer.thumb(), pose: viewer.pose() };
  },
  end() { tryStart = null; viewer.ghost(null); },   // the turn is over: the real edit stands, solid
  back(p) { viewer.look(p, 700); },
};
/* the view Anton's show_building chose (mcp.mjs viewOf): a storey, a wing, the plan or a section */
/* Anton's show_building through the pill, on this page in place (pm 21:20Z: «vis meg det fra fugleperspektiv» did
   not move the camera): a facade, a section, plan or 3D, a storey, a wing, and where the camera stands */
function showView(v) {
  if (v.ask_point) return askPoint(v.ask_point);   // Anton asked for a place (U3671)
  if (v.retake) return gjengiCtl?.proposal();   // Anton proposed new pictures from some photo spots: the Gjengi tab shows the card with the price (U3665)
  const b = v.building && site.buildings.find(x => x.id === v.building);
  if (v.mode === "section" && b) {
    if (v.section === "fasade") return facade(b, v.side || "S");
    const d = v.drawn && drawnSections.find(x => x.id === v.drawn); return d ? section(b, d.kind, d) : section(b, v.section === "lengde" ? "lengde" : "tverr");
  }
  const sv = sunIn(v); if (sv) setSunTo(sv);   // the view's own light, else the light stays
  gjengiCtl?.setChoice(v);   // Anton's camera, look and size for the picture (U3652)
  paintEra(v.era); if (v.names != null) setNames(!!v.names, false);
  if (v.mode === "plan" || v.mode === "3d") setMode(v.mode); else if (viewer.view().mode === "section") setMode("3d");
  if (v.storey) pickStorey(v.storey); else if (storeyOn) pickStorey(null);
  const cam = {}; for (const k of ["x", "y", "h", "yaw", "pitch", "dist"]) if (v[k] != null) cam[k] = v[k];
  if (v.kote != null && cam.h == null) cam.h = v.kote - viewer.base;   // the server says where in kote (shots.mjs)
  if (v.mode !== "plan") cam.eye = v.cam === "eye";
  if (cam.yaw != null) { const y0 = viewer.pose().yaw, T = 2 * Math.PI; cam.yaw = y0 + ((((cam.yaw - y0) % T) + T + Math.PI) % T - Math.PI); }   // turned the short way round
  if (b && cam.x == null) { valg.clear(); valg.pick(b.id, {}); showInfo(b); viewer.focus(b.id, cam); }
  else if (Object.keys(cam).length) viewer.look(cam, v.glide);
  pressMode();
}
/* back from «Logg inn» (login.js): said once */
try { if (sessionStorage.getItem("sykehus-innlogget")) { sessionStorage.removeItem("sykehus-innlogget"); toast("Du er logget inn."); } } catch { }
/* «Tilbakemelding» (U3660): the bar's button and the kit's dialog (feedback.js) */
import("./feedback.js").then(({ startFeedback }) => startFeedback({ button: $("mfb"), version: () => versionId || draftId || "", toast: t => toast(t), page: () => ({ tab: panel.tab, tabName: { selected: "Bygg", chat: "Anton", changes: "Forslag" }[panel.tab] }) })).catch(e => console.error("feedback:", e));
/* «Omvisning» (U3528, tour.js): «?» in the bar; once by itself on the first visit, when the model is up */
import("./tour.js?v=20261027b").then(({ createTour }) => {
  const sb = site.buildings.find(b => b.wing === "sentralblokka");
  const tour = createTour({
    home: () => { if (series) shotEnd(); setMode("3d"); viewer.eye(false); pressMode(); viewer.home(); },
    pick: () => { if (!sb) return; valg.clear(); valg.pick(sb.id, {}); showInfo(sb); panel.reveal("selected"); },
    unpick: () => valg.clear(), tab: t => panel.reveal(t), phone: () => panel.phone, signedIn: () => !!me.person,
  });
  $("tourBtn").onclick = () => tour.start();
  const meIn = () => window.sykehusMeReady ? Promise.resolve() : new Promise(ok => { addEventListener("sykehus:me", ok, { once: true }); setTimeout(ok, 8000); });   // anton.js puts the person's chip (or «Logg inn») in the bar a little after the page: the count is made when it is there (U3669)
  tour.ready().then(due => meIn().then(() => due)).then(due => { if (due) setTimeout(() => { if (!document.querySelector(".g-tour:not([hidden])")) tour.start(true); }, 1500); });
}).catch(e => console.error("tour:", e));
import("./anton.js?v=20261027u").then(m => m.start({ viewer, version: () => versionId, refresh, showView, panel, valg, pickStorey, tries })).catch(e => console.error("anton:", e));
/* «Gjengi» (U3526, gjengi.js): the view made a realistic picture, its price said first; kept in the open work */
import("./gjengi.js?v=20261027o").then(m => gjengiCtl = m.startGjengi({ panel, viewer, toast, sun: () => sun, setSun: setSunTo, sunLabel: s => sunLabel(s || sun), setMode: m => setMode(m),
  rings: () => site.buildings.filter(b => b.ring?.length).map(b => b.ring), changes: () => draft?.edits?.length ?? null,
  work: () => versionId ? { versjon: versionId, nokkel } : draftId && draft && !draft.missing ? { utkast: draftId } : {} })).catch(e => console.error("gjengi:", e));
/* the streets around, as hagekart draws them, after the model shows (streets.js) */
requestAnimationFrame(() => import("./streets.js?v=20261026r").then(m => m.addStreets({ viewer, site })).then(h => { streetsOn = h; h?.setRemoved(((showingBefore ? site0 : site).roads_removed || []).map(r => r.id)); }).catch(e => console.warn("gater:", e)));

if (new URLSearchParams(location.search).has("spor")) import("./trace.js").then(m => m.startTrace({ viewer, site, container: $("view"), setMode }));

/* the selection as in Fab, Fusion 360's (renderkit select.js, U3569, Morten 22:30Z «we should consider the selection
   systems we have in fab»): a hover lights what a click takes, a click takes it, Shift or Ctrl adds it or takes it
   away, a click on nothing clears, Shift and a drag is a window (left to right: what is inside; right to left: what
   it crosses). The picks are valg.js's items, by their keys. */
const K = viewer.kit();
let lastHit = null;
const idsOf = k => {
  const i = valg.items.find(x => valg.key(x) === k) || { kind: k.split(":")[0], id: k.split(":").slice(2).join(":") };
  if (i.kind === "wing") return site.buildings.filter(b => b.wing === i.id).map(b => b.id);
  if (i.kind === "facade") { const f = (site.facades || []).find(x => x.id === i.id); return f ? site.buildings.filter(b => b.wing === f.building).map(b => b.id) : []; }
  return i.kind === "building" || i.kind === "new" || i.kind === "ground" || i.kind === "road" ? [i.id] : [];
};
/* the card for what was picked: the thing clicked, if it is still picked, else the last one */
function cardFor(keys) {
  if (!keys.length) { shut(); return; }
  const hitKeys = lastHit ? valg.keysAt(lastHit) : [], i = valg.items.find(x => hitKeys.includes(valg.key(x))) || valg.items.at(-1);
  if (!i) return;
  const id = i.kind === "wing" ? site.buildings.find(b => b.wing === i.id)?.id : i.kind === "facade" ? lastHit?.id : i.id;
  const a = (site.added || []).find(x => x.id === id), g = (site.landscape || []).find(x => x.id === id) || (site.plantings || []).find(x => x.id === id), b = site.buildings.find(x => x.id === id);
  const rd = i.kind === "road" && viewer.roadOf(i.id);
  if (rd) showRoad(rd); else if (a) showNew(a); else if (g) showGround(g); else if (b) showInfo(b);
}
const picker = createPicker({ el: K.el, host: $("stage"), esc: false,
  under: e => { if (placing || build?.busy || shapeEd?.busy) return null; lastHit = viewer.hitAt(e.clientX, e.clientY); return valg.keysAt(lastHit, e.clientX, e.clientY); },
  windowKeys: (r, inside) => { lastHit = null; return valg.windowKeys(r, inside, viewer.project, windowTest); },
  onChange: (keys, l, how) => { if (how === "sync") return; valg.setKeys(keys); cardFor(keys); },
  onHover: keys => viewer.hover(keys.flatMap(idsOf)) });
addEventListener("sykehus:valg", () => picker.set(valg.items.map(valg.key), undefined, "sync"));

/* a new building picked gets the build tools (renderkit build.js, U3569, Morten 22:29Z «make it like in a good
   game»): drag it, its ring, an end, a side or its top; R, Q, E turn it, the arrows nudge it; each drag one change */
const buildingName = b => nameOf(b.id);
const build = createBuild({ THREE: K.THREE, el: K.el, host: $("stage"), scene: K.scene, camera: K.camera, P: K.P, ground: K.ground, lot: site.lot?.ring || null, storey: 3.2, redraw: K.redraw,
  others: id => { const gone = new Set((site.demolished || []).map(d => d.id));
    return [...site.buildings.filter(b => !gone.has(b.id) && b.ring?.length > 2).map(b => ({ id: b.id, name: buildingName(b), ring: b.ring })),
      ...(site.added || []).filter(a => a.kind === "volume" && a.id !== id && !gone.has(a.id)).map(a => ({ id: a.id, name: a.name, ring: cornersOf(bodyOf(a)) }))]; },
  onBusy: on => picker.pause(on),
  /* where its foot will stand there: design.js's rule, with the base_kote its own edit gave, if any */
  baseFor: body => { const a = (site.added || []).find(x => x.id === build.item?.id); if (!a) return build.item?.base ?? 0; const e0 = draft?.edits?.find(x => x.kind === "volume" && x.id === a.id); return baseOf(site, { ...a, ...body, base_kote: e0?.base_kote }); },
  onCommit: (id, body, how, by) => {
    const a = (site.added || []).find(x => x.id === id); if (!a) return;
    if (a.shape === "bim" && how !== "move" && how !== "ring") return false;   // its size is its parameters' («Endre»)
    const set = { from: body.from, to: body.to };
    if (Math.abs(body.width - a.width) > 0.01) set.width = body.width;
    if (how === "top") { if (a.storeys) set.storeys = Math.max(1, Math.round(body.height / 3.2)); else set.height = body.height; }
    return reshape(id, set, `${a.name} er ${{ move: "flyttet", ring: "snudd", end: "gjort lengre eller kortere", side: "gjort bredere eller smalere", top: "gjort høyere eller lavere" }[how] || "endret"}`, by);
  } });
/* a pool, a lawn or a path picked gets its points (renderkit shape.js; pm 00:31Z «the pool with corner and edge knobs
   and a turn ring, and paths by their points»): each drag one change, through reshape as the card's fields go */
const SHAPED = { point: "fikk et punkt flyttet", edge: "fikk en kant flyttet", add: "fikk et nytt punkt", remove: "mistet et punkt", move: "flyttet", ring: "snudd" };
const shapeEd = createShape({ THREE: K.THREE, el: K.el, host: $("stage"), scene: K.scene, camera: K.camera, P: K.P, ground: K.ground, redraw: K.redraw,
  onBusy: on => { picker.pause(on); viewer.bands(!on); },
  onCommit: (id, body, how, by) => { const g = (site.landscape || []).find(x => x.id === id); if (!g) return false; return reshape(id, body, `${groundName(g)} ${SHAPED[how] || "endret"}`, by); } });
function syncShape() {
  if (shapeEd.busy) return;
  const i = valg.items.length === 1 && valg.items[0].kind === "ground" ? valg.items[0] : null, g = i && (site.landscape || []).find(x => x.id === i.id);
  if (!g || !(g.ring || g.line) || viewer.view().mode === "section") { if (shapeEd.item) shapeEd.detach(); return; }
  shapeEd.attach(g.kind === "path" ? { id: g.id, line: g.line, width: g.width, mesh: K.groupOf(g.id) } : { id: g.id, ring: g.points || g.ring, mesh: K.groupOf(g.id) });
}
addEventListener("sykehus:valg", syncShape); addEventListener("sykehus:painted", syncShape);
viewer.follow(() => shapeEd.frame());
function syncBuild() {
  if (build.busy) return;
  const i = valg.items.length === 1 && valg.items[0].kind === "new" ? valg.items[0] : null, a = i && (site.added || []).find(x => x.id === i.id && x.kind === "volume");
  const g = a && K.groupOf(a.id);
  if (!a || !g || viewer.view().mode === "section") { if (build.item) build.detach(); return; }
  build.attach({ id: a.id, from: a.from, to: a.to, width: a.width, height: a.top_kote - a.base_kote, base: a.base_kote, group: g, fixed: a.shape === "bim" });
}
addEventListener("sykehus:valg", syncBuild); addEventListener("sykehus:painted", syncBuild);
viewer.follow(() => build.frame());
/* ?debug: the parts, for a test that watches the model frame by frame */
if (new URLSearchParams(location.search).has("debug")) window.sykehusDebug = { viewer, build, shapeEd, picker, valg, K, site };
