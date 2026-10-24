/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try. */
import { createViewer } from "./viewer.js";

/* floors.json is built locally from the drawings; without it the page shows the site alone. The storeys with no
   plan drawing (site.json levels, kote from a section) join the ladder: chosen, they cut the buildings there. */
const [site, { floors: drawn }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] }).catch(() => ({ floors: [] }))]);
const floors = [...drawn, ...(site.levels || []).filter(l => !drawn.some(f => Math.abs(f.kote - l.kote) < 0.3))
  .map(l => ({ id: "niva-" + l.id, name: l.name, kote: l.kote, height: l.height, wing: l.wing, walls: [], rooms: [], noplan: true, note: l.note, src: l.src }))];
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

/* floor buttons: the whole site, then each floor that has a drawing, lowest first */
const floorBtns = [{ id: null, label: "Hele anlegget" }, ...floors.slice().sort((a, b) => a.kote - b.kote).map(f => ({ id: f.id, label: f.name, sub: kote(f.kote) }))].map(f => {
  const b = document.createElement("button"); b.innerHTML = f.label + (f.sub ? `<small>${f.sub}</small>` : "");
  b.setAttribute("aria-pressed", String(f.id === null)); b.onclick = () => pickFloor(f.id); $("floors").append(b); return [f.id, b];
});
function pickFloor(id) {
  if (id === null) viewer.home(); else viewer.setFloor(id);
  for (const [k, b] of floorBtns) b.setAttribute("aria-pressed", String(k === id));
  hint(); showFloor(floors.find(f => f.id === id));
}
/* the chosen floor: its level, storey height, the rooms the drawing stamps and their sum, and the drawing itself */
function showFloor(f) {
  const el = $("info");
  if (!f) { el.style.display = "none"; return; }
  const rooms = f.rooms || [], sum = rooms.reduce((a, r) => a + (r.area_m2 || 0), 0), withArea = rooms.filter(r => r.area_m2).length;
  el.innerHTML = `<h2>${f.name} · ${f.wing}</h2><dl>
    <dt>Gulv</dt><dd>kote ${kote(f.kote)}</dd>
    <dt>Etasjehøyde</dt><dd>${f.height.toFixed(2).replace(".", ",")} m</dd>
    ${withArea ? `<dt>Rom</dt><dd>${withArea}, til sammen ${num(sum)} m²</dd>` : rooms.length ? `<dt>Rom</dt><dd>${rooms.length} navngitt, uten areal på tegningen</dd>` : ""}
    </dl><p style="margin:8px 0 0;font-size:13px;color:var(--soft);max-width:320px">${f.noplan
      ? `${f.note ? esc(f.note[0].toUpperCase() + f.note.slice(1)) + ". " : ""}Ingen plantegning av denne etasjen i arkivet: bygningene er skåret 1,2 m over gulvet. Kote fra ${sourceLinks(f.src)}.`
      : f.source}</p>`;
  el.style.display = "block";
}
function setMode(m) {
  viewer.setMode(m); $("m3d").setAttribute("aria-pressed", String(m === "3d")); $("mplan").setAttribute("aria-pressed", String(m === "plan")); hint();
}
function hint() {
  const v = viewer.view(), f = floors.find(x => x.id === v.floor);
  $("hint").textContent = (f ? `${f.name} ${kote(f.kote)}, snitt 1,2 m over gulv · ` : "") + (v.mode === "plan" ? "Dra eller to fingre for å flytte · knip eller + − for å zoome" : "Dra for å snu · to fingre for å flytte · knip eller + − for å zoome · klikk et bygg") + (f?.rooms?.length ? " · zoom inn for romnavn" : "");
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
    (w ? `<p style="margin:8px 0 0;font-size:13px;color:var(--soft);max-width:340px">${w.note ? esc(w.note) + ". " : ""}${w.sure ? "" : "Hvilken del dette er, er ikke sikkert ut fra dokumentene. "}Kilder: ${w.sources.map(docLink).join(" · ")}</p>` : "");
  el.style.display = "block";
}
/* a document as the cards name it: its title and year, the page, a link to it */
function docLink(d) { return d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}${d.year ? " (" + esc(d.year) + ")" : ""}${d.page ? ", s. " + d.page : ""}</a>` : esc(d.title); }
/* "<docid>#p<n> note" references, as site.json levels carry them, resolved through the wings' sources where they are known */
function sourceLinks(refs = []) {
  const known = new Map((site.wings || []).flatMap(w => w.sources).filter(d => d.id).map(d => [d.id, d]));
  return refs.map(s => { const [ref] = s.split(" "), [id, p] = ref.split("#p"), d = known.get(id); return d ? docLink({ ...d, page: p ? +p : null }) : esc(s); }).join(" · ");
}
