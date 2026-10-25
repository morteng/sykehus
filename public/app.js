/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try. */
import { createViewer } from "./viewer.js";
import { applyEdits } from "./edits.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys are the
   wings' own (site.json wings[].levels): one name, a kote in each wing that has it. */
const [site0, { floors: floors0 }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
/* ?utkast=<id>: changes tried through the connector (mcp.mjs try_change), laid over the data and shown as not saved */
/* ?versjon=<id>: a saved version of the after (versions.mjs), someone's own, public to look at */
const qs = new URLSearchParams(location.search), draftId = qs.get("utkast"), versionId = qs.get("versjon");
let draft = null;
if (versionId || draftId) { try { const r = await fetch(versionId ? `api/versjon/${encodeURIComponent(versionId)}` : `api/utkast/${encodeURIComponent(draftId)}`); draft = r.ok ? await r.json() : { missing: true }; } catch { draft = { missing: true }; } }
/* the drawn sections, by hand from the sheets (data/sections.json) */
const thumbs = await fetch("data/ark/index.json").then(r => r.ok ? r.json() : {}).catch(() => ({}));   // small pictures of the sheets (tools/thumbs.py)
const drawnSections = await fetch("data/sections.json").then(r => r.ok ? r.json() : { sections: [] }).then(j => j.sections).catch(() => []);
const { site, floors } = draft?.edits ? applyEdits(site0, floors0, draft.edits) : { site: site0, floors: floors0 };
const wings = site.wings || [];
const $ = id => document.getElementById(id);
const kote = v => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",");
const num = v => Math.round(v).toLocaleString("nb-NO");

const viewer = createViewer({
  container: $("view"), site, floors,
  onPick: id => showInfo(site.buildings.find(b => b.id === id)),
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
/* a high summer sun reads the forms best; choosing the date and hour comes later */
viewer.setSun(new Date(new Date().getFullYear(), 5, 21, 14));

/* the ladder: the whole site, then every storey some wing has, lowest first ("5" for 5. etasje, as on a section) */
const order = n => parseInt(n) || 0;
const storeys = [...new Set([...wings.flatMap(w => (w.levels || []).map(l => l.name)), ...floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
const floorBtns = [{ id: null, label: "Hele anlegget" }, ...storeys.map(n => ({ id: n, label: String(order(n) || n), title: n }))].map(f => {
  const b = document.createElement("button"); b.textContent = f.label; if (f.title) { b.title = f.title; b.setAttribute("aria-label", f.title); b.style.minWidth = "46px"; b.style.padding = "0 8px"; }
  b.setAttribute("aria-pressed", String(f.id === null)); b.onclick = () => pickStorey(f.id); $("floors").append(b); return [f.id, b];
});
if (storeys.length) floorBtns[0][1].after(Object.assign(document.createElement("span"), { className: "lbl", textContent: "Etasje" }));
function pickStorey(name) {
  if (name === null) viewer.home(); else viewer.setStorey(name);
  for (const [k, b] of floorBtns) b.setAttribute("aria-pressed", String(k === name));
  pressMode(); showStorey(name);
}
/* how a kote is known: read off a drawing, worked out, or assumed */
const how = l => l.how && l.how !== "tegning" ? ` <small style="color:var(--soft)">${esc(l.how)}</small>` : "";
/* the chosen storey: its kote in each wing that has it, and the drawings of it with their rooms */
function showStorey(name) {
  const el = $("info");
  if (!name) { el.style.display = "none"; return; }
  const rows = wings.map(w => [w, (w.levels || []).find(l => l.name === name)]).filter(r => r[1]).sort((a, b) => a[1].kote - b[1].kote);
  const drawn = floors.filter(f => f.name === name), rooms = drawn.flatMap(f => f.rooms || []), sum = rooms.reduce((a, r) => a + (r.area_m2 || 0), 0), withArea = rooms.filter(r => r.area_m2).length, calc = rooms.filter(r => !r.area_m2 && r.area_calc);
  el.innerHTML = `${CLOSE}<h2>${esc(name)}</h2><dl>${rows.map(([w, l]) => `<dt>${esc(w.name)}</dt><dd>kote ${kote(l.kote)}${how(l)}</dd>`).join("")}
    ${withArea ? `<dt>Rom</dt><dd>${withArea}, til sammen ${num(sum)} m²</dd>` : rooms.length ? `<dt>Rom</dt><dd>${rooms.length} navngitt, uten areal på tegningen</dd>` : ""}
    ${calc.length ? `<dt>Målt</dt><dd>${calc.length} rom til, ca. ${num(Math.round(calc.reduce((a, r) => a + r.area_calc, 0)))} m² mellom veggene</dd>` : ""}
    </dl><div class="src">Snitt 1,2 m over gulv. Skravert gulv: ingen plantegning av etasjen der.${drawn.length
      ? `<br>${drawn.length === 1 ? "Plantegning" : "Plantegninger"}:<ul>${drawn.map(f => `<li title="${esc(f.source)}">${esc(plainSource(f))}</li>`).join("")}</ul>` : "<br>Ingen plantegning av denne etasjen i arkivet."}</div>`;
  el.style.display = "block"; closable(el);
}
/* a floor's source as the card says it: the drawing, and for a traced one how it was read; the whole note (with the
   tools that read it) stays in the data and shows on hover */
function plainSource(f) {
  if (!f.id.startsWith("spor-")) return f.source;
  const sheet = f.source.split(", sporet")[0];
  return `${sheet}. ${/vektor/.test(f.source) ? "Vegger og rom lest fra vektortegningen" : "Vegger og rom lest maskinelt fra skannet"}, ikke kontrollert.`;
}
/* the card's ×, and Esc, put it away */
const CLOSE = `<button class="x" aria-label="Lukk" title="Lukk (Esc)">×</button>`;
function closable(el) { el.querySelector(".x").onclick = () => { el.style.display = "none"; }; }
function setMode(m) {
  viewer.setMode(m); pressMode();
}
function pressMode() { const m = viewer.view().mode; $("m3d").setAttribute("aria-pressed", String(m === "3d")); $("mplan").setAttribute("aria-pressed", String(m === "plan")); $("print").hidden = m === "3d"; }
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
/* a section through a wing, across or along it, looked at square on with the wing's floor heights beside it */
const LOOK = { N: [0, 1], Ø: [1, 0], S: [0, -1], V: [-1, 0] };   // the way a drawn section looks
let sheet = null, side = null;   // the drawn section shown, if the cut is one; the side a facade is seen from
const SIDE = { N: "nord", Ø: "øst", S: "sør", V: "vest" };
/* a wing's facade, looked at square on from that side: what stands in front of it is taken away */
function facade(b, k) {
  sheet = null; side = k; showInfo(b);
  const r = $("info").getBoundingClientRect(), wide = innerWidth > 900, from = LOOK[k];
  viewer.setSection(b.wing, "fasade", wide ? r.right + 10 : 0, null, [-from[0], -from[1]]); pressMode();
  for (const [kk, btn] of floorBtns) btn.setAttribute("aria-pressed", String(kk === null));
  showInfo(b);
}
function section(b, kind, drawn = null) {
  sheet = drawn; side = null; showInfo(b);   // the card first: with a sheet it grows, and the drawing is framed beside it
  const r = $("info").getBoundingClientRect(), wide = innerWidth > 900;   // on a phone the card is below or over; the drawing takes the screen
  viewer.setSection(b.wing, kind, wide ? r.right + 10 : 0, drawn?.through || null, LOOK[drawn?.looking] || null); pressMode();
  for (const [k, btn] of floorBtns) btn.setAttribute("aria-pressed", String(k === null));
  showInfo(b);
}
$("m3d").onclick = () => setMode("3d"); $("mplan").onclick = () => setMode("plan");
$("zin").onclick = () => viewer.zoom(1 / 1.5); $("zout").onclick = () => viewer.zoom(1.5);
/* the keys: + and − zoom, ↑ ↓ (or Page Up / Down) a storey up or down the ladder, Esc puts the card away */
addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === "+" || e.key === "=") viewer.zoom(1 / 1.5);
  else if (e.key === "-" || e.key === "−") viewer.zoom(1.5);
  else if (e.key === "Escape") $("info").style.display = "none";
  else if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) {
    const i = floorBtns.findIndex(([, b]) => b.getAttribute("aria-pressed") === "true"), j = Math.max(0, Math.min(floorBtns.length - 1, i + (/Up$/.test(e.key) ? 1 : -1)));
    if (j !== i) { pickStorey(floorBtns[j][0]); floorBtns[j][1].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  } else return;
  e.preventDefault();
});
/* the first visit: how to move about, once; gone at the first touch or after a while */
const TAP = matchMedia("(pointer: coarse)").matches ? "trykk" : "klikk";   // a finger presses, a mouse clicks
let seen = false; try { seen = !!localStorage.getItem("sykehus-tips"); localStorage.setItem("sykehus-tips", "1"); } catch {}
if (!seen) {
  const tip = Object.assign(document.createElement("div"), { id: "tip", className: "card", textContent: TAP === "trykk"
    ? "Dra for å snu · to fingre for å flytte og zoome · trykk på et bygg" : "Dra for å snu · høyre knapp eller to fingre for å flytte · + − for å zoome · klikk et bygg" });
  document.body.append(tip);
  const gone = () => { tip.classList.add("gone"); setTimeout(() => tip.remove(), 700); removeEventListener("pointerdown", gone); };
  addEventListener("pointerdown", gone); setTimeout(gone, 9000);
}

/* a building: for a wing of the hospital, what the documents say about it (site.json wings), then its size and
   heights from the laser */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function showInfo(b) {
  const el = $("info");
  if (!b) { el.style.display = "none"; return; }
  const h = b.top != null ? b.top - b.base : null, w = (site.wings || []).find(x => x.id === b.wing);
  const about = w ? [["Bygget", w.built], ["Etasjer", w.storeys], ["Konstruksjon", w.construction], ["Fasade", w.facade]].filter(r => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") : "";
  el.innerHTML = `${CLOSE}<h2>${w ? esc(w.name) : b.own ? "Bygning på tomta" : "Nabobygning"}</h2><dl>${about}
    <dt>Fotavtrykk</dt><dd>${num(b.area_m2)} m²</dd>
    ${h != null ? `<dt>Høyde</dt><dd>ca. ${h.toFixed(0)} m</dd><dt>Topp</dt><dd>kote ${kote(b.top)}</dd>` : ""}
    <dt>Terreng</dt><dd>kote ${kote(b.base)}</dd></dl>` +
    (w?.levels?.length ? storeyList(b, w) : "") +
    (w ? sectionRow(w) : "") +
    (w ? `<p style="margin:8px 0 0;font-size:13px;color:var(--soft);max-width:340px">${w.note ? esc(w.note) + ". " : ""}${w.sure ? "" : "Hvilken del dette er, er ikke sikkert ut fra dokumentene. "}Kilder: ${w.sources.map(docLink).join(" · ")}</p>${sheetStrip(w)}` : "");
  el.style.display = "block"; closable(el);
  for (const btn of el.querySelectorAll("[data-storey]")) btn.onclick = () => peel(b, w, btn.dataset.storey || null);
  for (const btn of el.querySelectorAll("[data-snitt]")) btn.onclick = () => section(b, btn.dataset.snitt);
  for (const btn of el.querySelectorAll("[data-fasade]")) btn.onclick = () => facade(b, btn.dataset.fasade);
  for (const btn of el.querySelectorAll("[data-tegnet]")) btn.onclick = () => { const d = drawnSections.find(x => x.id === btn.dataset.tegnet); section(b, d.kind, d); };
}
/* a wing's storeys, top first: choosing one takes the storeys above it off this building alone, so one looks into
   it at that floor; ▲ ▼ step one storey; "Hele bygget" puts it back */
function storeyList(b, w) {
  const v = viewer.view(), on = v.only === b.id ? v.storey : null, ls = w.levels.slice().sort((a, c) => c.kote - a.kote), i = ls.findIndex(l => l.name === on);
  const up = i > 0 ? ls[i - 1].name : on ? "" : null, down = i >= 0 ? ls[i + 1]?.name : ls[0].name;
  const s = "min-height:34px;font-size:15px;padding:0 10px";
  return `<div style="margin-top:10px;display:flex;gap:6px;align-items:center"><b style="font-size:15px;margin-right:auto">Etasjer</b>
      <button style="${s}" ${up == null ? "disabled" : `data-storey="${esc(up)}"`} aria-label="En etasje opp">▲</button>
      <button style="${s}" ${down == null ? "disabled" : `data-storey="${esc(down)}"`} aria-label="En etasje ned">▼</button>
      <button style="${s}" data-storey="" aria-pressed="${!on}">Hele bygget</button></div>
    <div style="margin-top:6px;max-height:34vh;overflow-y:auto;display:grid;gap:4px">${ls.map(l =>
      `<button style="${s};text-align:left;display:flex;justify-content:space-between;gap:12px" data-storey="${esc(l.name)}" aria-pressed="${l.name === on}"><span>${esc(l.name)}</span><span>${kote(l.kote)}${l.how && l.how !== "tegning" ? " · " + esc(l.how) : ""}</span></button>`).join("")}</div>`;
}
/* cut the wing across or along its middle, or where a drawn section does */
function sectionRow(w) {
  const v = viewer.view(), s = "min-height:34px;font-size:15px;padding:0 10px", on = k => v.mode === "section" && v.section.wing === w.id && v.section.kind === k && !sheet;
  return `<div style="margin-top:8px;display:flex;gap:6px"><b style="font-size:15px;margin-right:auto;align-self:center">Snitt</b>
      <button style="${s}" data-snitt="tverr" aria-pressed="${on("tverr")}">Tverrsnitt</button>
      <button style="${s}" data-snitt="lengde" aria-pressed="${on("lengde")}">Lengdesnitt</button></div>
    <div style="margin-top:6px;display:flex;gap:6px"><b style="font-size:15px;margin-right:auto;align-self:center">Fasade</b>${["N", "Ø", "S", "V"].map(k => {
      const drawn = (site.facades || []).some(f => f.building === w.id && f.name.endsWith(SIDE[k]));
      return `<button style="${s};min-width:44px" data-fasade="${k}" aria-pressed="${v.mode === "section" && v.section.wing === w.id && v.section.kind === "fasade" && side === k}" title="Fasaden mot ${SIDE[k]}${drawn ? ", vinduer fra tegning" : ""}">${k}${drawn ? "*" : ""}</button>`; }).join("")}</div>${v.mode === "section" && v.section.wing === w.id && v.section.kind !== "fasade" ? `<p style="margin:4px 0 0;font-size:13px;color:var(--soft);max-width:400px">Svart er det snittet går gjennom: yttervegger (0,35 m, antatt), dekker ved etasjene, tak, og innervegger der det finnes plantegning.</p>` : ""}${v.mode === "section" && v.section.wing === w.id && v.section.kind === "fasade" ? `<p style="margin:4px 0 0;font-size:13px;color:var(--soft);max-width:400px">Fasaden mot ${SIDE[side]}, sett rett på. ${(site.facades || []).some(f => f.building === w.id && f.name.endsWith(SIDE[side])) ? "Vinduene fra tegningen." : "Vinduene etter foto, ikke fra tegning."} (* = fasade med tegning)</p>` : ""}${drawnList(w, v, s)}`;
}
/* the wing's drawn sections: each cuts the model where the sheet does, with the sheet beside it */
function drawnList(w, v, s) {
  const ds = drawnSections.filter(d => d.wing === w.id); if (!ds.length) return "";
  const on = v.mode === "section" && sheet && sheet.wing === w.id ? sheet : null;
  return `<div style="margin-top:6px;display:grid;gap:4px"><b style="font-size:15px">Tegnede snitt</b>${ds.map(d =>
    `<button style="${s};text-align:left" data-tegnet="${esc(d.id)}" aria-pressed="${d === on}">${esc(d.title)} (${d.year})</button>`).join("")}</div>` +
    (on ? `<figure style="margin:8px 0 0;max-width:420px"><a href="${esc(on.image)}" target="_blank" rel="noopener" title="Åpne tegningen stor"><img src="${esc(on.image)}" alt="${esc(on.title)}" style="width:100%;border:1px solid #d8d2c6;background:#fff"></a>
      <figcaption style="font-size:13px;color:var(--soft)">${esc(on.levels)}. ${esc(on.note)}. ${on.sure ? "" : "Hvor snittet står i modellen er lest ut fra tegningen og omtrentlig. "}<a href="${esc(on.url)}" target="_blank" rel="noopener">Tegningen (PDF)</a></figcaption></figure>` : "");
}
function peel(b, w, name) {
  viewer.cutBuilding(b.id, name);
  for (const [k, btn] of floorBtns) btn.setAttribute("aria-pressed", String(k === null));
  pressMode(); showInfo(b);
}
/* a document as the cards name it: its title and year, the page, a link to it */
function docLink(d) { return d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}${d.page ? ", s. " + d.page : ""}</a>` : esc(d.title); }
/* the wing's drawings as small pictures; a click opens the drawing at its page */
function sheetStrip(w) {
  const ds = w.sources.map(d => ({ d, key: `${(d.url || "").split("/").pop().split(".")[0]}-p${d.page || 1}` })).filter(x => thumbs[x.key]);
  if (!ds.length) return "";
  return `<div style="margin-top:8px;display:flex;gap:6px;overflow-x:auto;max-width:420px;padding-bottom:4px">${ds.map(({ d, key }) =>
    `<a href="${esc(d.url)}#page=${d.page || 1}" target="_blank" rel="noopener" title="${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}" style="flex:none;text-decoration:none;color:var(--soft);font-size:11px;width:120px">
      <img src="${esc(thumbs[key])}" alt="${esc(d.title)}" loading="lazy" style="width:120px;height:85px;object-fit:contain;background:#fff;border:1px solid var(--line);display:block">
      <span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.title)}</span></a>`).join("")}</div>`;
}
/* "<docid>#p<n> note" references, as site.json levels carry them, resolved through the wings' sources where they are known */
function sourceLinks(refs = []) {
  const known = new Map((site.wings || []).flatMap(w => w.sources).filter(d => d.id).map(d => [d.id, d]));
  return refs.map(s => { const [ref] = s.split(" "), [id, p] = ref.split("#p"), d = known.get(id); return d ? docLink({ ...d, page: p ? +p : null }) : esc(s); }).join(" · ");
}

/* the draft's banner: what is tried, that it is not saved, and its notes */
if (draft) {
  const el = document.createElement("div"); el.id = "draft"; el.className = "card";
  const n = draft.edits?.length, ch = `${n} ${n === 1 ? "endring" : "endringer"}`;
  el.innerHTML = draft.missing ? (versionId ? "<b>Versjonen finnes ikke.</b> Du ser modellen slik den er." : "<b>Utkastet finnes ikke lenger</b> (utkast varer et døgn). Du ser modellen slik den er.")
    : draft.version ? `<b>${esc(draft.title)}</b> · versjon av ${esc(draft.owner)}, ${ch}, sist endret ${new Date(draft.updated).toLocaleDateString("nb-NO")}. <a href="./">Se før</a>`
    : `<b>Utkast, ikke lagret</b> · ${ch} prøvd via Claude. <a href="./">Se modellen uten</a>`
      + (draft.edits.length ? `<ul>${draft.edits.map(e => `<li>${esc(describe(e))}</li>`).join("")}</ul>` : "");
  document.body.appendChild(el);
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
  return `Notat${e.wing ? " på " + w : ""}${e.storey ? ", " + e.storey : ""}: ${e.text}`;
}

/* ?spor: the trace mode for scanned sheets (trace.js), for those who trace; the page is otherwise as always */
if (new URLSearchParams(location.search).has("spor")) import("./trace.js").then(m => m.startTrace({ viewer, site, container: $("view"), setMode }));
