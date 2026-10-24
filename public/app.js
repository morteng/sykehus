/* The web page: the site in 3D or in plan, one floor at a time. Everything here is open to look at and try. */
import { createViewer } from "./viewer.js";

const [site, { floors }] = await Promise.all(["data/site.json", "data/floors.json"].map(u => fetch(u).then(r => r.json())));
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
  hint();
}
function setMode(m) {
  viewer.setMode(m); $("m3d").setAttribute("aria-pressed", String(m === "3d")); $("mplan").setAttribute("aria-pressed", String(m === "plan")); hint();
}
function hint() {
  const v = viewer.view(), f = floors.find(x => x.id === v.floor);
  $("hint").textContent = (f ? `${f.name} ${kote(f.kote)}, snitt 1,2 m over gulv · ` : "") + (v.mode === "plan" ? "Dra for å flytte · rull for å zoome" : "Dra for å snu · rull for å zoome · klikk et bygg");
}
$("m3d").onclick = () => setMode("3d"); $("mplan").onclick = () => setMode("plan");

function showInfo(b) {
  const el = $("info");
  if (!b) { el.style.display = "none"; return; }
  const h = b.top != null ? b.top - b.base : null;
  el.innerHTML = `<h2>${b.own ? "Bygning på tomta" : "Nabobygning"}</h2><dl>
    <dt>Fotavtrykk</dt><dd>${num(b.area_m2)} m²</dd>
    ${h != null ? `<dt>Høyde</dt><dd>ca. ${h.toFixed(0)} m</dd><dt>Topp</dt><dd>kote ${kote(b.top)}</dd>` : ""}
    <dt>Terreng</dt><dd>kote ${kote(b.base)}</dd></dl>`;
  el.style.display = "block";
}
