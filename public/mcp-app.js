/* Sykehustomta as an MCP App: the hospital in 3D or in plan inside a chat. After hagekart's public/mcp-app.js
   (2026-10-24): the same talk with the chat app and the picture sent back; the model here is this site's viewer.

   The chat app (Claude, ChatGPT ...) shows this page in a sandboxed frame when a model calls show_building
   (mcp.mjs). The page loads site.json and floors.json from our origin (its <base>), and with a draft its tried
   changes (api/utkast/<id>), builds the model with viewer.js and draws it on the viewer's own graphics card.
   The tool's view says which storey to cut, which wing to ring, plan or 3D, and where the camera stands; the
   person can turn the model and change storey. A small picture of the view goes back to the chat
   (ui/update-model-context) so the model sees what the person sees.

   Protocol: MCP Apps 2026-01-26 (io.modelcontextprotocol/ui, the stable revision as of 2026-10-25), JSON-RPC over
   postMessage to the parent: ui/initialize, then ui/notifications/tool-input (while the model calls) and
   ui/notifications/tool-result with {structuredContent: {view}}. */
import { createViewer } from "./viewer.js";
import { applyEdits } from "./edits.js";

const $ = id => document.getElementById(id);

/* ---------- talking to the chat app ---------- */
let nextId = 1; const pending = new Map();
const post = msg => parent.postMessage({ jsonrpc: "2.0", ...msg }, "*");
const ask = (method, params, ms = 4000) => new Promise(ok => { const id = nextId++; pending.set(id, ok); post({ id, method, params }); setTimeout(() => { if (pending.delete(id)) ok(null); }, ms); });
addEventListener("message", e => {
  const m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id != null && !m.method) { pending.get(m.id)?.(m.error ? null : m.result); pending.delete(m.id); return; }
  if (m.method === "ui/notifications/tool-result") show(m.params?.structuredContent);
  else if (m.method === "ui/notifications/tool-input") { if (!viewer) $("msg").textContent = "Claude ber om en visning av bygget …"; }
  else if (m.method === "ui/notifications/tool-cancelled") { if (!viewer) $("msg").textContent = "Visningen ble avbrutt."; }
  else if (m.method === "ping" && m.id != null) post({ id: m.id, result: {} });
  else if (m.method === "ui/notifications/host-context-changed") theme(m.params);
  else if (m.method === "ui/resource-teardown" && m.id != null) post({ id: m.id, result: {} });
});
function theme(ctx) { if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme; }

/* ---------- the page ---------- */
document.body.innerHTML = `
<style>
:root{--bg:#fbf9f4;--ink:#23211e;--muted:#6c675f;--line:#d8d2c6;--panel:#fff;--on:#23211e}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1b1a18;--ink:#ece8df;--muted:#a59f94;--line:#3a3732;--panel:#24221f;--on:#ece8df}}
:root[data-theme=dark]{--bg:#1b1a18;--ink:#ece8df;--muted:#a59f94;--line:#3a3732;--panel:#24221f;--on:#ece8df}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 -apple-system,"Helvetica Neue",Arial,sans-serif}
#stage{position:relative;height:460px;background:#dfe8ee}#v3{position:absolute;inset:0}
#note{position:absolute;left:8px;top:8px;pointer-events:none;font-size:12.5px;background:rgba(255,255,255,.9);color:#23211e;padding:5px 10px;border-radius:999px;max-width:calc(100% - 16px)}
#bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 12px;background:var(--panel);border-top:1px solid var(--line)}
.chip{font:inherit;font-size:13px;min-width:34px;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:none;color:var(--ink);cursor:pointer}
.chip[aria-pressed=true]{background:var(--on);border-color:var(--on);color:var(--bg)}
.sep{width:1px;align-self:stretch;background:var(--line);margin:0 4px}
#cap{color:var(--muted);font-size:12.5px;padding:0 12px 10px;background:var(--panel)}
#msg{padding:24px;color:var(--muted)}
</style>
<div id="msg">Laster bygget …</div>
<div id="main" hidden>
  <div id="stage"><div id="v3"></div><div id="note"></div></div>
  <div id="bar"><span id="storeys" style="display:contents"></span><span class="sep"></span><button class="chip" id="m3d">3D</button><button class="chip" id="mplan">Plan</button><button class="chip" id="look">La Claude se dette</button></div>
  <div id="cap"></div>
</div>`;

let viewer = null, data = null, loaded = null, view = {};
const order = n => parseInt(n) || 0;
async function load(draft) {
  const key = draft || "";
  if (loaded?.key === key) return loaded;
  const [site, { floors }] = await Promise.all([fetch("data/site.json").then(r => r.json()), fetch("data/floors.json").then(r => r.ok ? r.json() : { floors: [] })]);
  let d = null; if (draft) { try { const r = await fetch(`api/utkast/${encodeURIComponent(draft)}`); if (r.ok) d = await r.json(); } catch { /* shown without */ } }
  const m = d?.edits ? applyEdits(site, floors, d.edits) : { site, floors };
  return loaded = { key, ...m, draft: d };
}

async function show(payload) {
  view = payload?.view || {};
  try { data = await load(view.draft); } catch { $("msg").textContent = "Fikk ikke hentet bygget."; return; }
  $("msg").hidden = true; $("main").hidden = false;
  if (!viewer || viewer.key !== data.key) {
    $("v3").innerHTML = "";
    try { viewer = createViewer({ container: $("v3"), site: data.site, floors: data.floors, onPick: id => caption(id) }); viewer.key = data.key; }
    catch { $("main").hidden = true; $("msg").hidden = false; $("msg").textContent = "Denne visningen kan ikke tegne 3D her (WebGL mangler). Åpne bygget i nettleseren: sykehus.gulden.no"; return; }
    viewer.setSun(new Date(new Date().getFullYear(), 5, 21, 14));
    ladder();
  }
  viewer.setStorey(view.storey || null);
  if (view.mode === "section" && view.wing) { viewer.setMode("3d"); viewer.select(view.building); viewer.setSection(view.wing, view.section, 0); }
  else {
    viewer.setMode(view.mode === "plan" ? "plan" : "3d");
    if (view.building) { viewer.select(view.building); viewer.focus(view.building); }
  }
  const p = {}; if (view.yaw != null) p.yaw = view.yaw; if (view.pitch != null) p.pitch = view.pitch; if (view.dist != null) p.dist = view.dist;
  if (Object.keys(p).length && view.mode !== "section") viewer.pose(p);
  $("note").textContent = data.draft ? `Utkast, ikke lagret: ${data.draft.edits.length} endringer` : "";
  $("note").hidden = !data.draft;
  sync(); caption(view.building); height();
  setTimeout(() => tellModel(), 1500);
}
function ladder() {
  const names = [...new Set([...(data.site.wings || []).flatMap(w => (w.levels || []).map(l => l.name)), ...data.floors.map(f => f.name)])].sort((a, b) => order(a) - order(b));
  $("storeys").innerHTML = `<button class="chip" data-s="">Alt</button>` + names.map(n => `<button class="chip" data-s="${n}" title="${n}">${order(n) || n}</button>`).join("");
}
function sync() {
  const v = viewer.view();
  for (const b of document.querySelectorAll("[data-s]")) b.setAttribute("aria-pressed", String((v.storey || "") === b.dataset.s));
  $("m3d").setAttribute("aria-pressed", String(v.mode === "3d")); $("mplan").setAttribute("aria-pressed", String(v.mode === "plan"));
}
function caption(id) {
  const b = id && data.site.buildings.find(x => x.id === id), w = b && (data.site.wings || []).find(x => x.id === b.wing), v = viewer?.view();
  $("cap").textContent = w ? `${w.name}${w.built ? ", bygget " + w.built : ""}${w.storeys ? ", " + w.storeys : ""}`
    : v?.storey ? `${v.storey}, alle fløyer skåret 1,2 m over gulvet` : "Dra for å snu, knip eller rull for å zoome, trykk på en fløy for å se hva den er.";
}
/* ask the chat app for a height that fits, so the frame is not a thin strip */
function height() { post({ method: "ui/notifications/size-changed", params: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } }); }

/* ---------- a picture back to the model ---------- */
async function tellModel(manual) {
  if (!viewer) return;
  try {
    const url = viewer.snapshot(), im = new Image(); im.src = url; await im.decode();
    const w = Math.min(768, im.naturalWidth), cv = document.createElement("canvas"); cv.width = w; cv.height = Math.round(im.naturalHeight * w / im.naturalWidth);
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    const v = viewer.view(), pic = cv.toDataURL("image/jpeg", 0.8).split(",")[1];
    const text = `Bildet viser Sykehustomta slik personen ser den nå: ${v.storey ? v.storey + ", snitt 1,2 m over gulv" : "hele anlegget"}, ${v.mode === "plan" ? "plan, nord opp" : v.mode === "section" ? (v.section.kind === "lengde" ? "lengdesnitt" : "tverrsnitt") + " gjennom " + ((data.site.wings || []).find(w => w.id === v.section.wing)?.name || "bygget") + ", sett rett på, svart er det snittet går gjennom" : "3D"}${data.draft ? `, med utkastets ${data.draft.edits.length} endringer (ikke lagret)` : ""}.`;
    await ask("ui/update-model-context", { content: [{ type: "text", text }, { type: "image", data: pic, mimeType: "image/jpeg" }], structuredContent: { view: { storey: v.storey || null, mode: v.mode, section: v.section || null, draft: view.draft || null } } });
    if (manual) $("cap").textContent = "Bildet er sendt til chatten.";
  } catch { if (manual) $("cap").textContent = "Fikk ikke sendt bildet."; }
}

/* ---------- controls ---------- */
$("bar").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || !viewer) return;
  if (b.dataset.s != null) viewer.setStorey(b.dataset.s || null);
  else if (b.id === "m3d" || b.id === "mplan") viewer.setMode(b.id === "mplan" ? "plan" : "3d");
  else if (b.id === "look") return tellModel(true);
  sync(); caption(null);
});
new ResizeObserver(() => height()).observe(document.body);

/* ---------- start ---------- */
(async () => {
  const r = await ask("ui/initialize", { protocolVersion: "2026-01-26", clientInfo: { name: "Sykehustomta", version: "1.0.0" }, capabilities: {}, appCapabilities: {} }, 15000);
  theme(r?.hostContext);
  post({ method: "ui/notifications/initialized" });
})();
