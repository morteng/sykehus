/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try. */
import { createViewer } from "./viewer.js";
import { applyEdits } from "./edits.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys are the
   wings' own (site.json wings[].levels): one name, a kote in each wing that has it. */
const [site0, { floors: floors0 }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
/* ?utkast=<id>: changes tried through the connector (mcp.mjs try_change), laid over the data and shown as not saved */
const draftId = new URLSearchParams(location.search).get("utkast");
let draft = null;
if (draftId) { try { const r = await fetch(`api/utkast/${encodeURIComponent(draftId)}`); draft = r.ok ? await r.json() : { missing: true }; } catch { draft = { missing: true }; } }
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
function pickStorey(name) {
  if (name === null) viewer.home(); else viewer.setStorey(name);
  for (const [k, b] of floorBtns) b.setAttribute("aria-pressed", String(k === name));
  hint(); showStorey(name);
}
/* how a kote is known: read off a drawing, worked out, or assumed */
const how = l => l.how && l.how !== "tegning" ? ` <small style="color:var(--soft)">${esc(l.how)}</small>` : "";
/* the chosen storey: its kote in each wing that has it, and the drawings of it with their rooms */
function showStorey(name) {
  const el = $("info");
  if (!name) { el.style.display = "none"; return; }
  const rows = wings.map(w => [w, (w.levels || []).find(l => l.name === name)]).filter(r => r[1]).sort((a, b) => a[1].kote - b[1].kote);
  const drawn = floors.filter(f => f.name === name), rooms = drawn.flatMap(f => f.rooms || []), sum = rooms.reduce((a, r) => a + (r.area_m2 || 0), 0), withArea = rooms.filter(r => r.area_m2).length, calc = rooms.filter(r => !r.area_m2 && r.area_calc);
  el.innerHTML = `<h2>${esc(name)}</h2><dl>${rows.map(([w, l]) => `<dt>${esc(w.name)}</dt><dd>kote ${kote(l.kote)}${how(l)}</dd>`).join("")}
    ${withArea ? `<dt>Rom</dt><dd>${withArea}, til sammen ${num(sum)} m²</dd>` : rooms.length ? `<dt>Rom</dt><dd>${rooms.length} navngitt, uten areal på tegningen</dd>` : ""}
    ${calc.length ? `<dt>Målt</dt><dd>${calc.length} rom uten areal på tegningen, ca. ${num(Math.round(calc.reduce((a, r) => a + r.area_calc, 0)))} m² mellom veggene</dd>` : ""}
    </dl><p style="margin:8px 0 0;font-size:13px;color:var(--soft);max-width:340px">Bygningene er skåret 1,2 m over gulvet. ${drawn.length
      ? "Plantegning: " + drawn.map(f => esc(f.source)).join(" · ") : "Ingen plantegning av denne etasjen i arkivet."}</p>`;
  el.style.display = "block";
}
function setMode(m) {
  viewer.setMode(m); $("m3d").setAttribute("aria-pressed", String(m === "3d")); $("mplan").setAttribute("aria-pressed", String(m === "plan")); hint();
}
function hint() {
  const v = viewer.view(), f = floors.find(x => x.id === v.floor);
  $("hint").textContent = (v.storey ? `${v.storey}, snitt 1,2 m over gulv · ` : "") + (v.mode === "plan" ? "Dra eller to fingre for å flytte · knip eller + − for å zoome" : "Dra for å snu · to fingre for å flytte · knip eller + − for å zoome · klikk et bygg") + (f?.rooms?.length ? " · zoom inn for romnavn" : "");
}
$("m3d").onclick = () => setMode("3d"); $("mplan").onclick = () => setMode("plan");
$("zin").onclick = () => viewer.zoom(1 / 1.5); $("zout").onclick = () => viewer.zoom(1.5);

/* a building: for a wing of the hospital, what the documents say about it (site.json wings), then its size and
   heights from the laser */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function showInfo(b) {
  const el = $("info");
  if (!b) { el.style.display = "none"; return; }
  const h = b.top != null ? b.top - b.base : null, w = (site.wings || []).find(x => x.id === b.wing);
  const about = w ? [["Bygget", w.built], ["Etasjer", w.storeys], ["Konstruksjon", w.construction], ["Fasade", w.facade]].filter(r => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") : "";
  el.innerHTML = `<h2>${w ? esc(w.name) : b.own ? "Bygning på tomta" : "Nabobygning"}</h2><dl>${about}
    <dt>Fotavtrykk</dt><dd>${num(b.area_m2)} m²</dd>
    ${h != null ? `<dt>Høyde</dt><dd>ca. ${h.toFixed(0)} m</dd><dt>Topp</dt><dd>kote ${kote(b.top)}</dd>` : ""}
    <dt>Terreng</dt><dd>kote ${kote(b.base)}</dd></dl>` +
    (w?.levels?.length ? storeyList(b, w) : "") +
    (w ? `<p style="margin:8px 0 0;font-size:13px;color:var(--soft);max-width:340px">${w.note ? esc(w.note) + ". " : ""}${w.sure ? "" : "Hvilken del dette er, er ikke sikkert ut fra dokumentene. "}Kilder: ${w.sources.map(docLink).join(" · ")}</p>` : "");
  el.style.display = "block";
  for (const btn of el.querySelectorAll("[data-storey]")) btn.onclick = () => peel(b, w, btn.dataset.storey || null);
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
function peel(b, w, name) {
  viewer.cutBuilding(b.id, name);
  for (const [k, btn] of floorBtns) btn.setAttribute("aria-pressed", String(k === null));
  showInfo(b); hint();
}
/* a document as the cards name it: its title and year, the page, a link to it */
function docLink(d) { return d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}${d.page ? ", s. " + d.page : ""}</a>` : esc(d.title); }
/* "<docid>#p<n> note" references, as site.json levels carry them, resolved through the wings' sources where they are known */
function sourceLinks(refs = []) {
  const known = new Map((site.wings || []).flatMap(w => w.sources).filter(d => d.id).map(d => [d.id, d]));
  return refs.map(s => { const [ref] = s.split(" "), [id, p] = ref.split("#p"), d = known.get(id); return d ? docLink({ ...d, page: p ? +p : null }) : esc(s); }).join(" · ");
}

/* the draft's banner: what is tried, that it is not saved, and its notes */
if (draft) {
  const el = document.createElement("div"); el.id = "draft"; el.className = "card";
  el.innerHTML = draft.missing ? "<b>Utkastet finnes ikke lenger</b> (utkast varer et døgn). Du ser modellen slik den er."
    : `<b>Utkast, ikke lagret</b> · ${draft.edits.length} ${draft.edits.length === 1 ? "endring" : "endringer"} prøvd via Claude. <a href="./">Se modellen uten</a>`
      + (draft.edits.length ? `<ul>${draft.edits.map(e => `<li>${esc(describe(e))}</li>`).join("")}</ul>` : "");
  document.body.appendChild(el);
}
function describe(e) {
  const w = (site.wings || []).find(x => x.id === e.wing)?.name || e.wing;
  const why = e.why ? ` (${e.why})` : "";
  if (e.kind === "level") return `${w}, ${e.storey}: kote ${kote(e.kote)}${why}`;
  if (e.kind === "wing") return `${w}, ${{ name: "navn", built: "bygget", storeys: "etasjer", construction: "konstruksjon", facade: "fasade", note: "merknad" }[e.field] || e.field}: ${e.value}${why}`;
  if (e.kind === "room") return `${e.storey}, ${e.room}: ${Object.entries(e.set).map(([k, v]) => `${{ name: "navn", use: "bruk", area_m2: "areal" }[k] || k} ${k === "area_m2" ? v + " m²" : v}`).join(", ")}${why}`;
  return `Notat${e.wing ? " på " + w : ""}${e.storey ? ", " + e.storey : ""}: ${e.text}`;
}
