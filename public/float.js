/* The acts for what is picked (U3554, Morten 2026-10-25 20:07Z: «the delete building button should float over a
   selected building like the building name does … only needed metadata, only needed tools»): the name, two or three
   facts, and the acts that fit it, «Riv», «Endre», «Spør Anton», «Etasjer»; a new building (U3556) also «Flytt» and
   «Snu»; several picked make one set with their count and the acts they share. «Endre» opens its facts in place.
   What is torn down leaves nothing on the model (Morten 20:12Z); it is undone in «Forslag».

   One copy, two places (U3568, Morten 22:27Z: «the floating popus … are very large, cover the selected building.
   they should perhaps be hideable while still keeping selection? only appear when right pane controls … are not
   available?»):
   - the panel open: the acts sit in «Bygget»'s card (#selActs, app.js card()), and nothing floats;
   - the panel folded: a small card beside the pick, never over it, that folds to a chip (its «–», or Esc) with the
     pick kept; the chip opens it again. Below 900 px it sits in the bottom stack, over the sheet (Fab's .bstack). */
import { SURFACE_NO, groundName } from "./valg.js?v=20261025f";
import { groundAt } from "./renderkit/fit.js";
const SURFACES = ["grass", "meadow", "planting", "gravel", "paving", "asphalt", "water"], PATHS = ["gravel", "paving", "asphalt", "wood"];   // landscape.js's
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = v => Math.round(v).toLocaleString("nb-NO");
/* a construction's parameters by the names Anton is told to use (mcp.mjs construction), in the page's words */
const PARAM = { base: "Side ved foten, m", length: "Lengde, m", width: "Bredde, m", height: "Høyde, m", module: "Modul, m", profile: "Profil, m", top: "Topp, m", storeys: "Etasjer", pitch: "Takvinkel, °", span: "Spenn, m" };
const FOLD = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>`;

export function createFloat({ viewer, site, valg, panel, stage, bstack, onRiv, onStoreys, onSave, onMove, onTurn }) {
  const wings = site.wings || [], phone = matchMedia("(max-width: 899px)");
  const el = Object.assign(document.createElement("div"), { id: "float", className: "fl", hidden: true });
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Det valgte bygget");
  el.addEventListener("pointerdown", e => e.stopPropagation());   // a tap on the card is not a tap on the model behind it
  /* box: the picks' corners on the site [[east, north, kote], …], to stay beside; editing: the key of the pick whose
     «Endre» is open; folded: the card is a chip (kept across picks until it is opened again) */
  let box = null, size = null, editing = null, folded = false;
  const inPane = () => !phone.matches && panel.open();

  /* the few facts: built (the first year), storeys, footprint */
  function facts(w, bs) {
    const built = w?.built ? String(w.built).split(/[;,]/)[0].trim() : null;
    const st = w?.levels?.length ? `${w.levels.length} etasjer` : (/^\d+(–\d+)? etasjer/.exec(w?.storeys || "") || [])[0];
    return [w?.use, built, st, `${num(bs.reduce((a, b) => a + (b.area_m2 || 0), 0))} m² grunnflate`].filter(Boolean);
  }
  const newFacts = a => [a.use, a.built, a.storeys ? `${a.storeys} etasjer` : null, `${num(a.footprint_m2)} m² grunnflate`].filter(Boolean);
  const corners = bs => bs.flatMap(b => b.ring.flatMap(p => [[p[0], p[1], b.base], [p[0], p[1], b.top ?? b.base + 10]]));
  const cornersNew = a => {
    const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) || 1, n = [-(a.to[1] - a.from[1]) / L * a.width / 2, (a.to[0] - a.from[0]) / L * a.width / 2];
    return [a.from, a.to].flatMap(p => [1, -1].flatMap(s => [[p[0] + s * n[0], p[1] + s * n[1], a.base_kote], [p[0] + s * n[0], p[1] + s * n[1], a.top_kote]]));
  };
  const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
  /* a surface or a path (U3569): what it is laid with, how big */
  const groundFacts = g => g.kind === "trees" ? [`${g.count} ${g.count === 1 ? "tre" : "trær"}`, `${m1(g.height)} m høye`, `${m1(g.crown)} m krone`] : [g.name ? SURFACE_NO[g.surface] : null, g.kind === "path" ? `${m1(g.length_m)} × ${m1(g.width)} m` : `${num(g.area_m2)} m²`, g.plants?.length ? `${g.plants.length} arter` : null].filter(Boolean);
  function groundForm(host, i, g) {
    if (g.kind === "trees") {   // a planting: how tall, how wide the crown
      host.innerHTML = `<form class="fl-form" autocomplete="off"><div class="fl-h"><b>Endre ${esc(groundName(g))}</b></div>
        <div class="fl-two"><label>Høyde, m<input name="height" value="${m1(g.height)}" inputmode="decimal"></label><label>Krone, m<input name="crown" value="${m1(g.crown)}" inputmode="decimal"></label></div>
        <div class="fl-acts"><button type="submit" class="riv">Ferdig</button><button type="button" data-x>Avbryt</button></div></form>`;
      const fm = host.querySelector("form");
      fm.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(fm)); for (const k of ["height", "crown"]) if (v[k]) v[k] = v[k].replace(",", "."); editing = null; render(); onSave(i, v); };
      host.querySelector("[data-x]").onclick = () => { editing = null; render(); };
      fm.querySelector("input").focus(); return;
    }
    const opts = (g.kind === "path" ? PATHS : SURFACES).map(k => `<option value="${k}"${k === g.surface ? " selected" : ""}>${esc(SURFACE_NO[k] || k)}</option>`).join("");
    host.innerHTML = `<form class="fl-form" autocomplete="off"><div class="fl-h"><b>Endre ${esc(groundName(g))}</b></div>
      <label>Navn<input name="name" value="${esc(g.name ?? "")}" maxlength="80" placeholder="${esc(groundName({ ...g, name: null }))}"></label>
      <div class="fl-two"><label>${g.kind === "path" ? "Dekke" : "Materiale"}<select name="surface">${opts}</select></label>${g.kind === "path" ? `<label>Bredde, m<input name="width" value="${m1(g.width)}" inputmode="decimal"></label>` : `<label>Areal<input value="${num(g.area_m2)} m²" disabled></label>`}</div>
      <div class="fl-acts"><button type="submit" class="riv">Ferdig</button><button type="button" data-x>Avbryt</button></div></form>`;
    const fm = host.querySelector("form");
    fm.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(fm)); if (v.width) v.width = v.width.replace(",", "."); editing = null; render(); onSave(i, v); };
    host.querySelector("[data-x]").onclick = () => { editing = null; render(); };
    fm.querySelector("input").focus();
  }

  /* «Endre»: the facts that may be set from the page, and for a new building its length and width */
  function form(host, i, w, a) {
    const f = (k, label, v, extra = "") => `<label>${label}<input name="${k}" value="${esc(v ?? "")}" ${extra}></label>`;
    const L = a ? Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) : 0;
    /* a construction (U3570): its size is its script's parameters, which «Endre» shows in place of length, width and storeys */
    const bim = a?.shape === "bim" && a.bim?.params, bimKeys = bim ? Object.keys(a.bim.params).filter(k => k !== "ground" && typeof a.bim.params[k] === "number") : [];
    host.innerHTML = `<form class="fl-form" autocomplete="off"><div class="fl-h"><b>Endre ${esc(a ? a.name : w.name)}</b></div>
      ${f("name", "Navn", a ? a.name : w.name, 'maxlength="80" required')}${f("use", "Bruk", a ? a.use : w.use, 'maxlength="80" placeholder="f.eks. boliger"')}
      <div class="fl-two">${bim ? "" : a ? f("storeys", "Etasjer", a.storeys, 'inputmode="numeric" pattern="[0-9]*" maxlength="2"') : f("storeys", "Etasjer", w.storeys, 'maxlength="80"')}${f("built", "Bygget", a ? a.built : w.built, 'maxlength="40"')}</div>
      ${bim ? `<div class="fl-two">${bimKeys.map(k => f(`p_${k}`, PARAM[k] || k.replace(/_/g, " "), String(a.bim.params[k]).replace(".", ","), 'inputmode="decimal"')).join("")}</div>` : ""}
      ${a ? `${bim ? "" : `<div class="fl-two">${f("length", "Lengde, m", m1(L), 'inputmode="decimal"')}${f("width", "Bredde, m", m1(a.width), 'inputmode="decimal"')}</div>`}
      <div class="fl-three">${f("angle", "Retning, °", String(Math.round(((90 - Math.atan2(a.to[1] - a.from[1], a.to[0] - a.from[0]) * 180 / Math.PI) % 360 + 360) % 360)), 'inputmode="numeric" title="Lengderetningen, som på et kompass: 0 nord, 90 øst"')}${f("east", "Øst, m", m1((a.from[0] + a.to[0]) / 2), 'inputmode="decimal" title="Midten, meter øst for tomtas origo"')}${f("north", "Nord, m", m1((a.from[1] + a.to[1]) / 2), 'inputmode="decimal" title="Midten, meter nord for tomtas origo"')}</div>` : ""}
      ${a && !a.bim?.plan && !a.on ? `<label>Trinnfri inngang<select name="entrance"><option value="">Ingen valgt</option>${[["N", "mot nord"], ["Ø", "mot øst"], ["S", "mot sør"], ["V", "mot vest"]].map(([k, t]) => `<option value="${k}"${a.entrance === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
      ${f("note", "Merknad", a ? a.note : w.note, 'maxlength="600"')}
      <div class="fl-acts"><button type="submit" class="riv">Ferdig</button><button type="button" data-x>Avbryt</button></div></form>`;
    const fm = host.querySelector("form");
    fm.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(fm)); for (const k of ["length", "width", "angle", "east", "north", ...bimKeys.map(k => `p_${k}`)]) if (v[k]) v[k] = v[k].replace(",", "."); editing = null; render(); onSave(i, v); };
    host.querySelector("[data-x]").onclick = () => { editing = null; render(); };
    fm.querySelector("input").focus();
  }

  /* the acts (and the name and facts, on the card) into host */
  function fill(host, groups, card) {
    const all = groups.flatMap(g => g.bs), news = groups.filter(g => g.a);
    const key = groups.length === 1 ? valg.key(groups[0].i) : null;
    if (key && editing === key) { if (groups[0].gr) groundForm(host, groups[0].i, groups[0].gr); else form(host, groups[0].i, groups[0].w, groups[0].a); return; }
    const head = (b, sub) => card ? `<div class="fl-h"><span class="fl-t"><b>${b}</b><button type="button" class="fl-fold" data-fold title="Skjul kortet (Esc); bygget er fortsatt valgt" aria-label="Skjul kortet">${FOLD}</button></span><span>${sub}</span></div>` : "";
    if (groups.length === 1 && groups[0].gr) {
      const { i, gr } = groups[0];
      host.innerHTML = `${head(esc(groundName(gr)), groundFacts(gr).map(esc).join(" · "))}
        <div class="fl-acts"><button type="button" data-ed>Endre</button><button type="button" data-riv>Riv</button><button type="button" data-ask>Spør Anton</button></div>`;
      host.querySelector("[data-riv]").onclick = () => onRiv([gr.id], groundName(gr).toLowerCase(), true);
      host.querySelector("[data-ed]").onclick = () => { editing = valg.key(i); render(); };
    } else if (groups.length === 1 && groups[0].a) {
      const { i, a } = groups[0];
      host.innerHTML = `${head(esc(a.name), newFacts(a).map(esc).join(" · "))}
        <div class="fl-acts"><button type="button" data-ed>Endre</button><button type="button" data-mv>Flytt</button><button type="button" data-tu title="Snu bygget en kvart runde">Snu</button><button type="button" data-riv>Riv</button><button type="button" data-ask>Spør Anton</button></div>`;
      host.querySelector("[data-riv]").onclick = () => onRiv([a.id], a.name);
      host.querySelector("[data-mv]").onclick = () => onMove(a);
      host.querySelector("[data-tu]").onclick = () => onTurn(a);
      host.querySelector("[data-ed]").onclick = () => { editing = valg.key(i); render(); };
    } else if (groups.length === 1) {
      const { i, w, bs } = groups[0], name = w ? w.name : i.label;
      host.innerHTML = `${head(esc(name), facts(w, bs).map(esc).join(" · "))}
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv ${w ? "fløyen" : "bygningen"}</button>${w ? `<button type="button" data-ed>Endre</button>` : ""}<button type="button" data-ask>Spør Anton</button>${w?.levels?.length && card ? `<button type="button" data-et>Etasjer</button>` : ""}</div>`;
      host.querySelector("[data-riv]").onclick = () => onRiv([w ? w.id : bs[0].id], w ? w.name : "bygningen");
      host.querySelector("[data-et]")?.addEventListener("click", () => onStoreys(bs[0]));
      host.querySelector("[data-ed]")?.addEventListener("click", () => { editing = valg.key(i); render(); });
    } else {
      const n = groups.length, what = groups.every(g => g.w) ? "fløyer" : groups.every(g => g.gr) ? "flater" : groups.some(g => g.gr) ? "valgt" : "bygg";
      host.innerHTML = `${head(what === "valgt" ? `${n} valgt` : `${n} ${what} valgt`, `${num(all.reduce((a, b) => a + (b.area_m2 || 0), 0) + news.reduce((s, g) => s + g.a.footprint_m2, 0) + groups.reduce((s, g) => s + (g.gr?.area_m2 || 0), 0))} m²`)}
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv alle ${n}</button><button type="button" data-ask>Spør Anton</button></div>`;
      host.querySelector("[data-riv]").onclick = () => onRiv(groups.map(g => g.gr ? g.gr.id : g.a ? g.a.id : g.w ? g.w.id : g.bs[0].id), `${n} ${what === "valgt" ? "ting" : what}`);
    }
    host.querySelector("[data-ask]")?.addEventListener("click", () => { if (!document.body.classList.contains("talk-on")) panel.reveal("chat"); dispatchEvent(new CustomEvent("sykehus:ask")); });
    host.querySelector("[data-fold]")?.addEventListener("click", () => setFolded(true));
  }
  /* the chip: the name and a «+» to open the card again */
  function chip(groups) {
    const name = groups.length > 1 ? `${groups.length} valgt` : groups[0].gr ? groundName(groups[0].gr) : groups[0].a ? groups[0].a.name : groups[0].w ? groups[0].w.name : groups[0].i.label;
    el.innerHTML = `<button type="button" class="fl-chip" data-open title="Vis kortet" aria-expanded="false"><span>${esc(name)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>`;
    el.querySelector("[data-open]").onclick = () => setFolded(false);
  }
  function setFolded(on) { folded = on; render(); if (!on) el.querySelector("button")?.focus(); }

  function render() {
    const slot = document.getElementById("selActs");
    const picked = valg.items.filter(i => i.kind === "wing" || i.kind === "building" || i.kind === "new" || i.kind === "ground");
    const v = viewer.view();
    const groups = picked.map(i => i.kind === "ground" ? { i, gr: (site.landscape || []).find(x => x.id === i.id) || (site.plantings || []).find(x => x.id === i.id), bs: [] } : i.kind === "new" ? { i, a: (site.added || []).find(x => x.id === i.id), bs: [] }
      : i.kind === "wing" ? { i, w: wings.find(x => x.id === i.id), bs: site.buildings.filter(b => b.wing === i.id) } : { i, w: null, bs: site.buildings.filter(b => b.id === i.id) }).filter(g => g.bs.length || g.a || g.gr);
    if (!groups.length || v.mode === "section" || v.storey && !v.only) { el.hidden = true; box = null; editing = null; if (slot) slot.innerHTML = ""; return; }
    const key = groups.length === 1 ? valg.key(groups[0].i) : null;
    if (editing && editing !== key) editing = null;
    if (inPane()) { el.hidden = true; box = null; if (slot) fill(slot, groups, false); return; }
    if (slot) slot.innerHTML = "";
    box = [...corners(groups.flatMap(g => g.bs)), ...groups.filter(g => g.a).flatMap(g => cornersNew(g.a)), ...groups.filter(g => g.gr?.ring).flatMap(g => g.gr.ring.map(p => [p[0], p[1], groundAt(site, p)])),
      ...groups.filter(g => g.gr?.kind === "trees").flatMap(g => (site.trees || []).filter(t => t[6] === g.gr.id).flatMap(t => [[t[0] - t[3], t[1], groundAt(site, t)], [t[0] + t[3], t[1], groundAt(site, t) + t[2]]]))];
    el.classList.toggle("folded", folded && !editing);
    if (folded && !editing) chip(groups); else fill(el, groups, true);
    el.hidden = false; size = null; dock(); place();
  }

  /* where it stands: beside the pick's box on the screen (right, left, above, below, the first with room), never over
     it, inside the view, clear of the storey rail and the pill */
  function place() {
    if (el.hidden || !box || phone.matches) return;
    const W = stage.clientWidth, H = stage.clientHeight, pts = box.map(p => viewer.project(p.slice(0, 2), p[2])).filter(p => p[2]);
    if (!pts.length) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "";
    size ??= [el.offsetWidth, el.offsetHeight];
    const [w, h] = size, G = 16, L0 = 100, T0 = 8;
    const sb = stage.getBoundingClientRect(), pb = bstack.getBoundingClientRect(), pill = pb.height ? [pb.left - sb.left, pb.top - sb.top, pb.right - sb.left, pb.bottom - sb.top] : null;
    const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, clampX = x => Math.max(L0, Math.min(W - w - 8, x)), clampY = y => Math.max(T0, Math.min(H - h - 8, y));
    const hit = (l, t, r) => r && l < r[2] && l + w > r[0] && t < r[3] && t + h > r[1];
    const over = (l, t) => Math.max(0, Math.min(l + w, x1) - Math.max(l, x0)) * Math.max(0, Math.min(t + h, y1) - Math.max(t, y0));
    const tries = [[x1 + G, clampY(cy - h / 2)], [x0 - G - w, clampY(cy - h / 2)], [clampX(cx - w / 2), y0 - G - h], [clampX(cx - w / 2), y1 + G]]
      .map(([l, t]) => [clampX(l), clampY(t)]);
    /* the first that covers none of the pick and none of the pill; else the one covering the least of the pick */
    const best = tries.find(([l, t]) => !over(l, t) && !hit(l, t, pill)) || tries.filter(([l, t]) => !hit(l, t, pill)).sort((a, b) => over(...a) - over(...b))[0] || tries[0];
    el.style.transform = `translate(${best[0].toFixed(0)}px, ${best[1].toFixed(0)}px)`;
  }
  function dock() {
    if (phone.matches) { if (el.parentNode !== bstack) bstack.prepend(el); el.style.transform = ""; el.classList.add("docked"); }
    else { if (el.parentNode !== stage) stage.append(el); el.classList.remove("docked"); }
  }
  /* Esc: the open card folds to its chip, the pick kept; true when it did */
  function escape() { if (el.hidden || folded || editing) return false; setFolded(true); return true; }

  viewer.follow(place);
  addEventListener("sykehus:valg", render);
  addEventListener("sykehus:card", render);   // «Bygget»'s card drawn again: its #selActs is new
  phone.addEventListener("change", () => { dock(); size = null; render(); });
  addEventListener("sykehus:panel", () => { render(); viewer.redraw(); });
  return { render, escape };
}
