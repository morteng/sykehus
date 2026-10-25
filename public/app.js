/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try.
   The layout is Fab's (the Anton-first redlines, 2026-10-25): the view, the storey strip at its left edge, the view's
   tools over it, Anton's pill at the bottom, and the panel on the right with «Bygget», «Anton», «Forslag» and
   «Ønsker» (panel.js). */
import { createViewer } from "./viewer.js";
import { applyEdits } from "./edits.js";
import { createSelection } from "./valg.js";
import { createPanel } from "./panel.js";
import { levels } from "./kit/levels.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys are the
   wings' own (site.json wings[].levels): one name, a kote in each wing that has it. */
const [site0, { floors: floors0 }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
/* ?utkast=<id>: changes tried through the connector (mcp.mjs try_change), laid over the data and shown as not saved */
/* ?versjon=<id>: a saved version of the after (versions.mjs), someone's own, public to look at */
const qs = new URLSearchParams(location.search), draftId = qs.get("utkast"), versionId = qs.get("versjon");
let draft = null;
if (versionId || draftId) { try { const r = await fetch(versionId ? `api/versjon/${encodeURIComponent(versionId)}${qs.get("nokkel") ? `?nokkel=${encodeURIComponent(qs.get("nokkel"))}` : ""}` : `api/utkast/${encodeURIComponent(draftId)}`); draft = r.ok ? await r.json() : { missing: true }; } catch { draft = { missing: true }; } }
/* the drawn sections, by hand from the sheets (data/sections.json) */
const thumbs = await fetch("data/ark/index.json").then(r => r.ok ? r.json() : {}).catch(() => ({}));   // small pictures of the sheets (tools/thumbs.py)
const drawnSections = await fetch("data/sections.json").then(r => r.ok ? r.json() : { sections: [] }).then(j => j.sections).catch(() => []);
const { site, floors } = draft?.edits ? applyEdits(site0, floors0, draft.edits) : { site: site0, floors: floors0 };
const wings = site.wings || [];
const $ = id => document.getElementById(id);
const kote = v => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",");
const num = v => Math.round(v).toLocaleString("nb-NO");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* the panel; a version or a draft opens on «Forslag», where it is told what it is; else the tab last open, Anton first */
const panel = createPanel({ start: draft ? "changes" : null, onChange: t => dispatchEvent(new CustomEvent("sykehus:panel", { detail: t })) });
const toCard = () => panel.show("selected", { quiet: true });   // a tap on the model or the strip shows its card, the sheet stays where it is

const viewer = createViewer({
  container: $("view"), site, floors,
  onPick: (id, how) => { valg.pick(id, how); showInfo(site.buildings.find(b => b.id === id)); },
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
/* what is picked in the model, to talk to Anton about (valg.js); the chips are in the pill (anton.js) */
const valg = createSelection({ site, floors, viewer, onChange: items => { dispatchEvent(new CustomEvent("sykehus:valg", { detail: items })); dimStrip(); } });
/* a high summer sun reads the forms best; choosing the date and hour comes later */
viewer.setSun(new Date(new Date().getFullYear(), 5, 21, 14));

/* the storey strip (the kit's g-levels): the whole site, then every storey some wing has, top first as on a
   section; a dot where a storey is drawn, dimmed (still a tap) where the wing picked has none */
const order = n => parseInt(n) || 0;
const storeys = [...new Set([...wings.flatMap(w => (w.levels || []).map(l => l.name)), ...floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
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
/* the names over the picture: on unless this viewer took them away (remembered in this browser) */
let names = true; try { names = localStorage.getItem("sykehus-navn") !== "av"; } catch { }
function setNames(on) { names = on; viewer.setNames(on); $("names").setAttribute("aria-pressed", String(on)); try { localStorage.setItem("sykehus-navn", on ? "på" : "av"); } catch { } }
setNames(names); $("names").onclick = () => setNames(!names);
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
if (draft) {
  const n = draft.edits?.length, ch = `${n} ${n === 1 ? "endring" : "endringer"}`;
  $("draftRow").innerHTML = `<div class="draftrow">${draft.missing ? (versionId ? "<b>Versjonen finnes ikke, eller er privat.</b> Du ser modellen slik den er." : "<b>Utkastet finnes ikke lenger</b> (utkast varer et døgn). Du ser modellen slik den er.")
    : draft.version ? `<b>${esc(draft.title)}</b> · ${{ privat: "privat ", lenke: "delt " }[draft.sharing] || ""}versjon av ${esc(draft.owner)}, ${ch}, sist endret ${new Date(draft.updated).toLocaleDateString("nb-NO")}. <a href="./">Se før</a>`
    : `<b>Utkast, ikke lagret</b> · ${ch} prøvd via Claude. <a href="./">Se modellen uten</a>`
      + (draft.edits.length ? `<ul>${draft.edits.map(e => `<li>${esc(describe(e))}</li>`).join("")}</ul>` : "")}</div>`;
}
function describe(e) {
  const w = (site.wings || []).find(x => x.id === e.wing)?.name || e.wing;
  const why = e.why ? ` (${e.why})` : "";
  if (e.kind === "level") return `${w}, ${e.storey}: kote ${kote(e.kote)}${why}`;
  if (e.kind === "wing") return `${w}, ${{ name: "navn", built: "bygget", storeys: "etasjer", construction: "konstruksjon", facade: "fasade", note: "merknad" }[e.field] || e.field}: ${e.value}${why}`;
  if (e.kind === "room") return `${e.storey}, ${e.room}: ${Object.entries(e.set).map(([k, v]) => `${{ name: "navn", use: "bruk", area_m2: "areal" }[k] || k} ${k === "area_m2" ? v + " m²" : v}`).join(", ")}${why}`;
  if (e.kind === "demolish") return `Rives: ${e.building === "alle" ? "alle sykehusbyggene" : (wings.find(x => x.id === e.building)?.name || e.building)}${why}`;
  if (e.kind === "restore") return `Beholdes: ${wings.find(x => x.id === e.building)?.name || e.building}${why}`;
  if (e.kind === "balconies") return `Balkonger på ${w} mot ${{ N: "nord", Ø: "øst", S: "sør", V: "vest" }[e.side]}, ${String(e.depth).replace(".", ",")} m dype${e.bay ? `, ${String(e.bay).replace(".", ",")} m brede` : ""}${why}`;
  if (e.kind === "volume") return `${e.name}: ${{ box: "kasse", gable: "saltak", triangle: "trekant (A-form)", lean_to: "pulttak" }[e.shape]}, ${String(e.width).replace(".", ",")} × ${String(Math.round(Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) * 10) / 10).replace(".", ",")} m, ${String(e.height).replace(".", ",")} m høy, ${{ glass: "glass", concrete: "betong", steel: "stål", wood: "tre", brick: "tegl" }[e.material]}${why}`;
  const SURF = { grass: "plen", meadow: "eng", planting: "beplantning", gravel: "grus", paving: "belegningsstein", asphalt: "asfalt", water: "vann", wood: "tre" };
  if (e.kind === "surface") return `${e.name ? e.name + ": " : ""}${SURF[e.surface]}${e.plants?.length ? ` (${e.plants.join(", ")})` : ""}${why}`;
  if (e.kind === "path") return `${e.name || "Sti"}: ${SURF[e.surface]}, ${String(e.width).replace(".", ",")} m bred${why}`;
  if (e.kind === "trees") return `Planter ${e.points ? e.points.length : "en rekke"} ${e.species}${why}`;
  if (e.kind === "fell") return `Feller trærne i et område${why}`;
  return `Notat${e.wing ? " på " + w : ""}${e.storey ? ", " + e.storey : ""}: ${e.text}`;
}
/* the versions: the public ones, and your own with how they are shared; Anton's saves call it again */
const VIS = { privat: "privat", lenke: "bare de med lenken", offentlig: "offentlig" };
function listVersions() {
  fetch("api/versjoner").then(r => r.ok ? r.json() : { versions: [] }).then(({ versions = [] }) => {
    if (!versions.length) return;
    $("verList").innerHTML = versions.map(v => `<li><a href="?versjon=${encodeURIComponent(v.version)}${v.nokkel ? `&nokkel=${encodeURIComponent(v.nokkel)}` : ""}"${v.version === versionId ? ' aria-current="page"' : ""}><span><span class="t">${esc(v.title)}</span><small>${v.mine ? "din" : esc(v.owner)} · ${v.changes} ${v.changes === 1 ? "endring" : "endringer"} · ${new Date(v.updated).toLocaleDateString("nb-NO")}</small></span>${v.mine ? `<span class="vis">${VIS[v.sharing] || esc(v.sharing)}</span>` : ""}</a></li>`).join("");
  }).catch(() => {});
}
listVersions(); addEventListener("sykehus:versjoner", listVersions);

/* ?spor: the trace mode for scanned sheets (trace.js), for those who trace; the page is otherwise as always */
/* signing in, and Anton for the signed in (anton.js) */
import("./anton.js").then(m => m.start({ viewer, versionId, panel, valg, pickStorey })).catch(e => console.error("anton:", e));
/* the streets around, as hagekart draws them, after the model shows (streets.js) */
requestAnimationFrame(() => import("./streets.js").then(m => m.addStreets({ viewer, site })).catch(e => console.warn("gater:", e)));

if (new URLSearchParams(location.search).has("spor")) import("./trace.js").then(m => m.startTrace({ viewer, site, container: $("view"), setMode }));
