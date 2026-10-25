/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try.
   The layout is Fab's (the Anton-first redlines, 2026-10-25): the view, the storey strip at its left edge, the view's
   tools over it, Anton's pill at the bottom, and the panel on the right with «Bygget», «Anton», «Forslag» and
   «Ønsker» (panel.js). */
import { createViewer } from "./viewer.js";
import { applyEdits } from "./edits.js";
import { createSelection } from "./valg.js?v=20261025d";
import { createPanel } from "./panel.js";
import { levels } from "./kit/levels.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys are the
   wings' own (site.json wings[].levels): one name, a kote in each wing that has it. */
const [site0, { floors: floors0 }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
/* ?utkast=<id>: changes tried through the connector (mcp.mjs try_change), laid over the data and shown as not saved */
/* ?versjon=<id>: a saved version of the after (versions.mjs), someone's own, public to look at */
const qs = new URLSearchParams(location.search);
let versionId = qs.get("versjon"), nokkel = qs.get("nokkel"), draftId = qs.get("utkast"), draft = null;   // a «Riv» on the model itself starts a draft in place (U3542)
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
const LIVE = e => TEARS(e) || e.kind === "volume" || e.kind === "reshape" || e.kind === "wing";
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

const viewer = createViewer({
  container: $("view"), site: shown.site, floors: shown.floors,
  onPick: (id, how) => {
    if (placing) { const at = viewer.hit(how.x, how.y); if (at) placing(at); return; }   // «Nytt bygg» or «Flytt»: where on the ground
    valg.pick(id, how); const a = (site.added || []).find(x => x.id === id);
    if (a) showNew(a); else showInfo(site.buildings.find(b => b.id === id));
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
function paint() {
  viewer.setGone((site.demolished || []).map(d => d.id)); viewer.setAdded(site.added || []);
  viewer.relabel(new Map(site.buildings.filter(b => b.own && b.name).map(b => [b.id, b.name.replace(/ \(.*\)$/, "")])));
}
let placing = null;   // a tap on the ground goes here instead of picking (set by «Nytt bygg» and «Flytt»)
paint();
try { const p = JSON.parse(sessionStorage.getItem("sykehus-pose") || "null"); sessionStorage.removeItem("sykehus-pose"); if (p) viewer.pose(p); } catch { }   // Anton's redraw comes back to where it was
/* what is picked in the model, to talk to Anton about (valg.js); the chips are in the pill (anton.js) */
const valg = createSelection({ site, floors, viewer, onChange: items => { dispatchEvent(new CustomEvent("sykehus:valg", { detail: items })); dimStrip(); } });
/* a high summer sun reads the forms best; choosing the date and hour comes later */
viewer.setSun(new Date(new Date().getFullYear(), 5, 21, 14));

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
  el.innerHTML = `<div class="oc-h"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div><span class="oc-acts"><button type="button" class="ask-anton" data-ask title="Spør Anton om dette" aria-label="Spør Anton om dette">${ASK}</button><button type="button" data-shut title="Lukk (Esc)" aria-label="Lukk">${SHUT}</button></span></div>${body}`;
  el.hidden = false; document.querySelector("#p-selected .sel-empty").hidden = true;
  el.querySelector("[data-shut]").onclick = shut;
  el.querySelector("[data-ask]").onclick = () => { if (cardOf) valg.add(cardOf); dispatchEvent(new CustomEvent("sykehus:ask")); };
  panel.peek(`<span class="pk"><b>${title}</b>${sub ? " · " + sub : ""}</span><button type="button" class="sm" id="peekMore">Mer</button>`);
  $("peekMore").onclick = () => panel.reveal("selected");
  toCard();
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
function pressMode() { const m = viewer.view().mode; $("m3d").setAttribute("aria-pressed", String(m === "3d")); $("mplan").setAttribute("aria-pressed", String(m === "plan")); $("print").hidden = m === "3d"; document.body.classList.toggle("plan", m !== "3d"); }
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
$("m3d").onclick = () => setMode("3d"); $("mplan").onclick = () => setMode("plan");
$("zin").onclick = () => viewer.zoom(1 / 1.5); $("zout").onclick = () => viewer.zoom(1.5);
/* the keys: + and − zoom, ↑ ↓ (or Page Up / Down) a storey up or down the strip, Home the whole site, Esc puts the
   card and the picks away */
addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.target.closest?.(".g-levels")) return;
  if (e.key === "n" || e.key === "N") setNames(!names);
  else if (e.key === "+" || e.key === "=") viewer.zoom(1 / 1.5);
  else if (e.key === "-" || e.key === "−") viewer.zoom(1.5);
  else if (e.key === "Escape") { shut(); valg.clear(); }
  else if (e.key === "Home") pickStorey(null);
  else if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) {
    const ladder = [null, ...storeys], i = ladder.indexOf(storeyOn), j = Math.max(0, Math.min(ladder.length - 1, i + (/Up$/.test(e.key) ? 1 : -1)));
    if (j !== i) pickStorey(ladder[j]);
  } else return;
  e.preventDefault();
});
/* the first visit: how to move about, once; gone at the first touch or after a while */
const TAP = matchMedia("(pointer: coarse)").matches ? "trykk" : "klikk";   // a finger presses, a mouse clicks
let seen = false; try { seen = !!localStorage.getItem("sykehus-tips"); localStorage.setItem("sykehus-tips", "1"); } catch {}
if (!seen) {
  const tip = Object.assign(document.createElement("div"), { id: "tip", textContent: TAP === "trykk"
    ? "Dra for å snu · to fingre for å flytte og zoome · trykk på et bygg" : "Dra for å snu · høyre knapp eller to fingre for å flytte · + − for å zoome · klikk et bygg" });
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

/* «Forslag»: the version or draft shown, as the tab's top row, then the versions to see */
function drawDraft() {
  if (!draft) return;
  const n = draft.edits?.length, ch = `${n} ${n === 1 ? "endring" : "endringer"}`;
  $("draftRow").innerHTML = `<div class="draftrow">${draft.missing ? (versionId ? "<b>Versjonen finnes ikke, eller er privat.</b> Du ser modellen slik den er." : "<b>Utkastet finnes ikke lenger</b> (utkast varer et døgn). Du ser modellen slik den er.")
    : mine() ? `<b>${esc(draft.title)}</b> · lagret · ${ch} · ${{ privat: "bare du ser den", lenke: "delt med lenke", offentlig: "offentlig" }[draft.sharing] || ""}. <a href="./?for">Se før</a><span class="acts"><button type="button" class="sm" data-del>Del</button><button type="button" class="sm" data-kopi title="Et nytt alternativ, fra dette">Ny kopi</button></span>`
    : draft.version ? `<b>${esc(draft.title)}</b> · ${{ privat: "privat ", lenke: "delt " }[draft.sharing] || ""}versjon av ${esc(draft.owner)}, ${ch}, sist endret ${new Date(draft.updated).toLocaleDateString("nb-NO")}. <a href="./?for">Se før</a>`
    : ownDraft() ? `<b>Utkast</b> · lagret på denne maskinen et døgn · ${ch}. ${me.person ? "" : "Logg inn for å beholde det. "}<a href="./?for">Se før</a><span class="acts"><button type="button" class="sm" data-del>Del</button></span>`
    : `<b>Utkast</b> delt med lenke · ${ch}. Det du endrer her, blir ditt eget. <a href="./?for">Se før</a>`}${draft.edits?.length ? `<ol class="changes">${draft.edits.map((e, i) => `<li><span>${esc(describe(e))}</span>${(draft.version ? !mine() : !ownDraft()) ? "" : `<button type="button" class="sm" data-undo="${i + 1}" title="Ta denne endringen ut igjen">Angre</button>`}</li>`).join("")}</ol>` : ""}</div>`;
  for (const b of $("draftRow").querySelectorAll("[data-undo]")) b.onclick = () => undo(+b.dataset.undo);
  $("draftRow").querySelector("[data-del]")?.addEventListener("click", share);
  $("draftRow").querySelector("[data-kopi]")?.addEventListener("click", async () => { const j = await change({ copy: versionId }); if (j.error) return toast(`Fikk ikke kopiert: ${j.error}`); await show(j); toast("Ny kopi. Endringene her går inn i den."); });
}
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
  const why = e.why ? ` (${e.why})` : "";
  if (e.kind === "level") return `${w}, ${e.storey}: kote ${kote(e.kote)}${why}`;
  if (e.kind === "wing") return `${w}, ${{ name: "navn", built: "bygget", storeys: "etasjer", construction: "konstruksjon", facade: "fasade", note: "merknad" }[e.field] || e.field}: ${e.value}${why}`;
  if (e.kind === "room") return `${e.storey}, ${e.room}: ${Object.entries(e.set).map(([k, v]) => `${{ name: "navn", use: "bruk", area_m2: "areal" }[k] || k} ${k === "area_m2" ? v + " m²" : v}`).join(", ")}${why}`;
  if (e.kind === "demolish") return `Rives: ${e.building === "alle" ? "alle sykehusbyggene" : (wings.find(x => x.id === e.building)?.name || draft?.edits?.findLast(x => x.id === e.building && (x.kind === "volume" || x.kind === "reshape") && x.name)?.name || e.building)}${why}`;
  if (e.kind === "restore") return `Beholdes: ${wings.find(x => x.id === e.building)?.name || e.building}${why}`;
  if (e.kind === "balconies") return `Balkonger på ${w} mot ${{ N: "nord", Ø: "øst", S: "sør", V: "vest" }[e.side]}, ${String(e.depth).replace(".", ",")} m dype${e.bay ? `, ${String(e.bay).replace(".", ",")} m brede` : ""}${why}`;
  if (e.kind === "reshape") {
    const was = draft?.edits?.find(x => x.kind === "volume" && x.id === e.id)?.name || "nytt bygg", what = [];
    if (e.name) what.push(`navn «${e.name}»`); if (e.use) what.push(`bruk ${e.use}`); if (e.storeys) what.push(`${e.storeys} etasjer`); if (e.built) what.push(`bygget ${e.built}`); if (e.note) what.push("merknad");
    if (e.from) what.push("flyttet eller nye mål"); if (e.width) what.push(`${String(e.width).replace(".", ",")} m bredt`); if (e.height) what.push(`${String(e.height).replace(".", ",")} m høyt`);
    return `${was}: ${what.join(", ")}${why}`;
  }
  if (e.kind === "volume") return `${e.name}: ${{ box: "kasse", gable: "saltak", triangle: "trekant (A-form)", lean_to: "pulttak" }[e.shape]}, ${String(e.width).replace(".", ",")} × ${String(Math.round(Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) * 10) / 10).replace(".", ",")} m, ${String(e.height).replace(".", ",")} m høy, ${{ glass: "glass", concrete: "betong", steel: "stål", wood: "tre", brick: "tegl" }[e.material]}${why}`;
  const SURF = { grass: "plen", meadow: "eng", planting: "beplantning", gravel: "grus", paving: "belegningsstein", asphalt: "asfalt", water: "vann", wood: "tre" };
  if (e.kind === "surface") return `${e.name ? e.name + ": " : ""}${SURF[e.surface]}${e.plants?.length ? ` (${e.plants.join(", ")})` : ""}${why}`;
  if (e.kind === "path") return `${e.name || "Sti"}: ${SURF[e.surface]}, ${String(e.width).replace(".", ",")} m bred${why}`;
  if (e.kind === "trees") return `Planter ${e.points ? e.points.length : "en rekke"} ${e.species}${why}`;
  if (e.kind === "fell") return `Feller trærne i et område${why}`;
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
  return r?.ok ? j : { error: j.error || "Det gikk ikke." };
}
/* the draft or version after a change, in place: its edits fetched, the model laid anew over the same objects, the
   viewer told what is gone, the strip, «Forslag» and the IFC link redrawn, the address changed without a reload */
async function show(j) {
  if (j.version) { versionId = j.version; nokkel = null; draftId = null; }
  else if (j.draft) { versionId = null; draftId = kept = j.draft; try { localStorage.setItem(KEPT, j.draft); } catch { } }
  const d = await fetchDraft(); if (d.missing) return toast("Fikk ikke hentet utkastet.");
  draft = d; const m = modelOf(draft.edits);
  const goneNow = new Set((m.site.demolished || []).map(x => x.id));
  const newNow = new Set((m.site.added || []).map(a => a.id));
  if (valg.items.some(i => i.kind === "wing" ? site.buildings.some(b => b.wing === i.id && goneNow.has(b.id)) : i.kind === "new" ? !newNow.has(i.id) : goneNow.has(i.id))) { valg.clear(); shut(); }
  refill(site, m.site); refill(floors, m.floors);
  refill(drawnSections, drawnSections0.filter(x => !x.wing || wings.some(w => w.id === x.wing)));
  paint();
  storeys = [...new Set([...wings.flatMap(w => (w.levels || []).map(l => l.name)), ...floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
  if (storeyOn && !storeys.includes(storeyOn)) pickStorey(null); else if (storeyOn) showStorey(storeyOn);
  dimStrip(); drawDraft(); ifcLink(); dispatchEvent(new CustomEvent("sykehus:versjoner"));
  dispatchEvent(new CustomEvent("sykehus:valg", { detail: valg.items }));   // the card over the pick shows the new facts
  const open = cardOf && (cardOf.kind === "new" ? (site.added || []).find(a => a.id === cardOf.id) : null); if (open) showNew(open);
  const u = new URL(location.href); for (const k of ["utkast", "versjon", "nokkel", "for"]) u.searchParams.delete(k);
  if (versionId) u.searchParams.set("versjon", versionId); else u.searchParams.set("utkast", draftId);
  history.replaceState(null, "", u.href);
}
/* one change from the page, into where() (see there), shown in place; null when it did not go through (said in a toast) */
async function edit(mine_, failed) {
  if (busy) return null; busy = true;
  try {
    /* on someone else's draft or version, one's own starts from what is shown: its live part first (the rest of it,
       if any, is Anton's, and goes with «Ny kopi» or through him) */
    const from = draft && !draft.missing && !mine() && !ownDraft() ? draft.edits.filter(LIVE) : [];
    const edits = [...from, ...mine_];
    let j = await change({ ...where(), edits });
    if (j.error && !draftId && kept) { kept = null; j = await change({ edits }); }   // the kept draft is past its day
    if (j.error) { toast(`${failed}: ${j.error}`); return null; }
    await show(j); return { n: draft.edits.length, k: mine_.length };
  } finally { busy = false; }
}
async function riv(targets, name) {
  const r = await edit(targets.map(t => ({ kind: "demolish", building: t, why: "revet på siden" })), "Fikk ikke revet"); if (!r) return;
  toast(`${name[0].toUpperCase() + name.slice(1)} er revet i ${versionId ? "versjonen" : "utkastet"}.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
}

/* new buildings (U3556, Morten 20:18Z «also crud for buildings, names and such»): «Nytt bygg», then a tap on the
   ground: a box of three storeys, 30 × 12 m, its length across the screen; its card renames it, sets its facts,
   sizes it, turns it a quarter, «Flytt» moves it to the next tap; «Riv» takes it away. Each is one change, with Angre. */
const newId = () => "n" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const along = () => { const a = viewer.view().north || 0; return [Math.cos(a), Math.sin(a)]; };   // screen right, east and north
function aim(on, hint) {
  placing = on; $("mnew").setAttribute("aria-pressed", String(!!on && hint === "ny")); document.body.classList.toggle("placing", !!on);
  if (on) toast(hint === "ny" ? "Trykk på bakken der det nye bygget skal stå." : "Trykk der bygget skal stå.", { label: "Avbryt", run: () => { aim(null); $("toast")?.remove(); } });
}
$("mnew").onclick = () => placing ? (aim(null), $("toast")?.remove()) : aim(async ([x, y]) => {
  aim(null); const [dx, dy] = along(), L = 15, id = newId();
  const r = await edit([{ kind: "volume", id, name: "Nytt bygg", shape: "box", from: [x - dx * L, y - dy * L], to: [x + dx * L, y + dy * L], width: 12, storeys: 3, material: "concrete", why: "satt opp på siden" }], "Fikk ikke satt opp bygget");
  if (!r) return;
  valg.clear(); valg.add({ kind: "new", id, label: "Nytt bygg" }); const a = site.added.find(x => x.id === id); if (a) showNew(a);
  toast("Nytt bygg satt opp. Trykk «Endre» for navn, etasjer og mål.", { label: "Angre", run: () => undoLast(r.n, r.k) });
}, "ny");
async function reshape(id, set, what = "Endret") {
  const r = await edit([{ kind: "reshape", id, ...set, why: "endret på siden" }], "Fikk ikke endret"); if (!r) return;
  toast(`${what}.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
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
  if (item.kind === "new") {
    const a = site.added.find(x => x.id === item.id), set = {};
    for (const k of ["name", "use", "built", "note"]) if (v[k] != null && v[k] !== (a[k] ?? "")) set[k] = v[k];
    if (v.storeys && +v.storeys !== a.storeys) set.storeys = +v.storeys;
    const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    if (v.length && Math.abs(+v.length - L) > 0.05) { const c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], u = [(a.to[0] - a.from[0]) / L, (a.to[1] - a.from[1]) / L], h = +v.length / 2; set.from = [c[0] - u[0] * h, c[1] - u[1] * h]; set.to = [c[0] + u[0] * h, c[1] + u[1] * h]; }
    if (v.width && Math.abs(+v.width - a.width) > 0.05) set.width = +v.width;
    if (!Object.keys(set).length) return;
    for (const k of ["from", "to"]) if (set[k]) set[k] = set[k].map(q => Math.round(q * 100) / 100);
    return reshape(item.id, set, `${set.name || a.name} er endret`);
  }
  const w = wings.find(x => x.id === item.id), ed = [];
  for (const k of ["name", "use", "built", "storeys", "note"]) if (v[k] != null && v[k].trim() && v[k].trim() !== String(w[k] ?? "")) ed.push({ kind: "wing", wing: w.id, field: k, value: v[k].trim(), why: "endret på siden" });
  if (!ed.length) return;
  const r = await edit(ed, "Fikk ikke endret"); if (!r) return;
  toast(`${ed.find(e => e.field === "name")?.value || w.name} er endret.`, { label: "Angre", run: () => undoLast(r.n, r.k) });
}
/* a new building's card in «Bygget» */
function showNew(a) {
  const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
  card(esc(a.name), "Nytt bygg i forslaget", rows([...(a.use ? [["Bruk", esc(a.use)]] : []), ...(a.storeys ? [["Etasjer", String(a.storeys)]] : []), ...(a.built ? [["Bygget", esc(a.built)]] : []),
    ["Mål", `${m1(L)} × ${m1(a.width)} m`], ["Grunnflate", `${num(a.footprint_m2)} m²`], ["Høyde", `${m1(a.top_kote - a.base_kote)} m`], ["Topp", `kote ${kote(a.top_kote)}`], ["Terreng", `kote ${kote(a.base_kote)}`]]) +
    (a.note ? `<p class="note">${esc(a.note)}</p>` : "") + `<p class="src">Satt opp i forslaget; ikke i IFC-fila ennå.</p>`, { kind: "new", id: a.id, label: a.name });
}
async function undo(n) {
  if (busy) return; busy = true;
  try { const j = await change({ ...where(), undo: n }); if (j.error) return toast(`Fikk ikke angret: ${j.error}`); $("toast")?.remove(); await show(j); }
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
async function undoLast(n, k) { for (let i = 0; i < k - 1; i++) { const j = await change({ ...where(), undo: n - i }); if (j.error) return toast(`Fikk ikke angret: ${j.error}`); } undo(n - k + 1); }
/* the IFC with the after's demolitions taken out (the server's ifcfilter.mjs) */
function ifcLink() {
  if (!draft || draft.missing) return;
  const a = document.querySelector("header a.ab-ic[href*='ifc']"), q = versionId ? `versjon=${encodeURIComponent(versionId)}${nokkel ? `&nokkel=${encodeURIComponent(nokkel)}` : ""}` : `utkast=${encodeURIComponent(draftId)}`;
  a.href = `api/ifc?${q}`; a.removeAttribute("download");
  a.title = "Last ned modellen med endringene (IFC): det som er revet er tatt ut. Det som er bygget nytt er ikke med i fila ennå."; a.setAttribute("aria-label", "Last ned modellen med endringene");
}
ifcLink();

/* the versions: the public ones, and your own with how they are shared; Anton's saves call it again */
const VIS = { privat: "privat", lenke: "bare de med lenken", offentlig: "offentlig" };
function listVersions() {
  fetch("api/versjoner").then(r => r.ok ? r.json() : { versions: [] }).then(({ versions = [] }) => {
    if (!versions.length) return;
    $("verList").innerHTML = versions.map(v => `<li><a href="?versjon=${encodeURIComponent(v.version)}${v.nokkel ? `&nokkel=${encodeURIComponent(v.nokkel)}` : ""}"${v.version === versionId ? ' aria-current="page"' : ""}><span><span class="t">${esc(v.title)}</span><small>${v.mine ? "din" : esc(v.owner)} · ${v.changes} ${v.changes === 1 ? "endring" : "endringer"} · ${new Date(v.updated).toLocaleDateString("nb-NO")}</small></span>${v.mine ? `<span class="vis">${VIS[v.sharing] || esc(v.sharing)}</span>` : ""}</a></li>`).join("");
  }).catch(() => {});
}
listVersions(); addEventListener("sykehus:versjoner", listVersions);

/* the card over the pick (float.js) */
import("./float.js?v=20261025d").then(m => m.createFloat({ viewer, site, valg, panel, stage: $("stage"), bstack: $("bstack"),
  onRiv: riv, onSave: saveFacts, onMove: moveNew, onTurn: turnNew,
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
  if (fixed(d.edits) !== base) { try { sessionStorage.setItem("sykehus-pose", JSON.stringify(viewer.pose())); } catch { } return location.reload(); }
  await show(versionId ? { version: versionId } : { draft: draftId });
}
/* the view Anton's show_building chose (mcp.mjs viewOf): a storey, a wing, the plan or a section */
function showView(v) {
  const b = v.building && site.buildings.find(x => x.id === v.building);
  if (v.mode === "section" && b) { const d = v.drawn && drawnSections.find(x => x.id === v.drawn); return d ? section(b, d.kind, d) : section(b, v.section === "lengde" ? "lengde" : "tverr"); }
  if (v.mode === "plan" || v.mode === "3d") setMode(v.mode);
  if (v.storey) pickStorey(v.storey); else if (storeyOn) pickStorey(null);
  if (b) { valg.clear(); valg.pick(b.id, {}); showInfo(b); viewer.focus(b.id); }
}
import("./anton.js?v=20261025d").then(m => m.start({ viewer, version: () => versionId, refresh, showView, panel, valg, pickStorey })).catch(e => console.error("anton:", e));
/* the streets around, as hagekart draws them, after the model shows (streets.js) */
requestAnimationFrame(() => import("./streets.js?v=20261025b").then(m => m.addStreets({ viewer, site })).catch(e => console.warn("gater:", e)));

if (new URLSearchParams(location.search).has("spor")) import("./trace.js").then(m => m.startTrace({ viewer, site, container: $("view"), setMode }));
