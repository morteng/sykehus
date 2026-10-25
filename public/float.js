/* The card over what is picked (U3554, Morten 2026-10-25 20:07Z: «the delete building button should float over a
   selected building like the building name does … only needed metadata, only needed tools»). It rides over the
   picked wing's roof as the names do (viewer.follow, placed in the same frame): the name, two or three facts, and the
   acts that fit it, «Riv», «Endre», «Spør Anton», «Etasjer»; a new building (U3556) also «Flytt» and «Snu»; several
   picked make one card with their count and the acts they share. «Endre» opens its facts in the card itself. A tap elsewhere puts it away (the pick is cleared). The panel's «Bygget» keeps the whole card.
   What is torn down leaves nothing on the model (Morten 20:12Z); it is undone in «Forslag».
   Below 900 px the card does not ride: it sits in the bottom stack, over the sheet (Fab's .bstack). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = v => Math.round(v).toLocaleString("nb-NO");
const mid = ring => { const r = ring.slice(0, -1); return r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]); };

export function createFloat({ viewer, site, valg, panel, stage, bstack, onRiv, onStoreys, onSave, onMove, onTurn }) {
  const wings = site.wings || [], phone = matchMedia("(max-width: 899px)");
  const el = Object.assign(document.createElement("div"), { id: "float", className: "fl", hidden: true });
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Det valgte bygget");
  el.addEventListener("pointerdown", e => e.stopPropagation());   // a tap on the card is not a tap on the model behind it
  let at = null, size = null, editing = null;   // at: the site point the card rides over, [east, north, kote]; editing: the key of the pick whose «Endre» is open

  /* the few facts: built (the first year), storeys, footprint */
  function facts(w, bs) {
    const built = w?.built ? String(w.built).split(/[;,]/)[0].trim() : null;
    const st = w?.levels?.length ? `${w.levels.length} etasjer` : (/^\d+(–\d+)? etasjer/.exec(w?.storeys || "") || [])[0];
    return [w?.use, built, st, `${num(bs.reduce((a, b) => a + (b.area_m2 || 0), 0))} m² grunnflate`].filter(Boolean);
  }
  const newFacts = a => [a.use, a.built, a.storeys ? `${a.storeys} etasjer` : null, `${num(a.footprint_m2)} m² grunnflate`].filter(Boolean);
  const over = bs => { const b = bs.slice().sort((a, c) => (c.area_m2 || 0) - (a.area_m2 || 0))[0]; return [...mid(b.ring), Math.max(...bs.map(x => x.top ?? x.base + 10)) + 2]; };
  const overNew = a => [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2, a.top_kote + 2];
  const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");

  /* «Endre»: the facts that may be set from the page, and for a new building its length and width */
  function form(i, w, a) {
    const f = (k, label, v, extra = "") => `<label>${label}<input name="${k}" value="${esc(v ?? "")}" ${extra}></label>`;
    const L = a ? Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) : 0;
    el.innerHTML = `<form class="fl-form" autocomplete="off"><div class="fl-h"><b>Endre ${esc(a ? a.name : w.name)}</b></div>
      ${f("name", "Navn", a ? a.name : w.name, 'maxlength="80" required')}${f("use", "Bruk", a ? a.use : w.use, 'maxlength="80" placeholder="f.eks. boliger"')}
      <div class="fl-two">${a ? f("storeys", "Etasjer", a.storeys, 'inputmode="numeric" pattern="[0-9]*" maxlength="2"') : f("storeys", "Etasjer", w.storeys, 'maxlength="80"')}${f("built", "Bygget", a ? a.built : w.built, 'maxlength="40"')}</div>
      ${a ? `<div class="fl-two">${f("length", "Lengde, m", m1(L), 'inputmode="decimal"')}${f("width", "Bredde, m", m1(a.width), 'inputmode="decimal"')}</div>` : ""}
      ${f("note", "Merknad", a ? a.note : w.note, 'maxlength="600"')}
      <div class="fl-acts"><button type="submit" class="riv">Ferdig</button><button type="button" data-x>Avbryt</button></div></form>`;
    const fm = el.querySelector("form");
    fm.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(fm)); for (const k of ["length", "width"]) if (v[k]) v[k] = v[k].replace(",", "."); editing = null; render(); onSave(i, v); };
    el.querySelector("[data-x]").onclick = () => { editing = null; render(); };
    fm.querySelector("input").focus();
  }

  function render() {
    const picked = valg.items.filter(i => i.kind === "wing" || i.kind === "building" || i.kind === "new");
    const v = viewer.view();
    if (!picked.length || v.mode === "section" || v.storey && !v.only) { el.hidden = true; at = null; editing = null; return; }
    const groups = picked.map(i => i.kind === "new" ? { i, a: (site.added || []).find(x => x.id === i.id), bs: [] }
      : i.kind === "wing" ? { i, w: wings.find(x => x.id === i.id), bs: site.buildings.filter(b => b.wing === i.id) } : { i, w: null, bs: site.buildings.filter(b => b.id === i.id) }).filter(g => g.bs.length || g.a);
    if (!groups.length) { el.hidden = true; at = null; editing = null; return; }
    const all = groups.flatMap(g => g.bs), news = groups.filter(g => g.a);
    at = all.length ? over(all) : overNew(news[0].a);
    const key = groups.length === 1 ? valg.key(groups[0].i) : null;
    if (editing && editing !== key) editing = null;
    if (key && editing === key) form(groups[0].i, groups[0].w, groups[0].a);
    else if (groups.length === 1 && groups[0].a) {
      const { i, a } = groups[0];
      el.innerHTML = `<div class="fl-h"><b>${esc(a.name)}</b><span>${newFacts(a).map(esc).join(" · ")}</span></div>
        <div class="fl-acts"><button type="button" data-ed>Endre</button><button type="button" data-mv>Flytt</button><button type="button" data-tu title="Snu bygget en kvart runde">Snu</button><button type="button" data-riv>Riv</button><button type="button" data-ask>Spør Anton</button></div>`;
      el.querySelector("[data-riv]").onclick = () => onRiv([a.id], a.name);
      el.querySelector("[data-mv]").onclick = () => onMove(a);
      el.querySelector("[data-tu]").onclick = () => onTurn(a);
      el.querySelector("[data-ed]").onclick = () => { editing = valg.key(i); render(); };
    } else if (groups.length === 1) {
      const { i, w, bs } = groups[0], name = w ? w.name : i.label;
      el.innerHTML = `<div class="fl-h"><b>${esc(name)}</b><span>${facts(w, bs).map(esc).join(" · ")}</span></div>
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv ${w ? "fløyen" : "bygningen"}</button>${w ? `<button type="button" data-ed>Endre</button>` : ""}<button type="button" data-ask>Spør Anton</button>${w?.levels?.length ? `<button type="button" data-et>Etasjer</button>` : ""}</div>`;
      el.querySelector("[data-riv]").onclick = () => onRiv([w ? w.id : bs[0].id], w ? w.name : "bygningen");
      el.querySelector("[data-et]")?.addEventListener("click", () => onStoreys(bs[0]));
      el.querySelector("[data-ed]")?.addEventListener("click", () => { editing = valg.key(i); render(); });
    } else {
      const n = groups.length, what = groups.every(g => g.w) ? "fløyer" : "bygg";
      el.innerHTML = `<div class="fl-h"><b>${n} ${what} valgt</b><span>${num(all.reduce((a, b) => a + (b.area_m2 || 0), 0) + news.reduce((s, g) => s + g.a.footprint_m2, 0))} m² grunnflate</span></div>
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv alle ${n}</button><button type="button" data-ask>Spør Anton</button></div>`;
      el.querySelector("[data-riv]").onclick = () => onRiv(groups.map(g => g.a ? g.a.id : g.w ? g.w.id : g.bs[0].id), `${n} bygg`);
    }
    el.querySelector("[data-ask]")?.addEventListener("click", () => { if (!document.body.classList.contains("talk-on")) panel.reveal("chat"); dispatchEvent(new CustomEvent("sykehus:ask")); });
    el.hidden = false; size = null; dock(); place();
  }

  /* where it rides: over the point, the card's foot 34 px above it (clear of the name), kept inside the view */
  function place() {
    if (el.hidden || !at || phone.matches) return;
    const [x, y, front] = viewer.project(at.slice(0, 2), at[2]), W = stage.clientWidth, H = stage.clientHeight;
    size ??= [el.offsetWidth, el.offsetHeight];
    if (!front) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "";
    let top = y - size[1] - 34; if (top < 60) top = Math.min(H - size[1] - 8, y + 24);
    const L0 = W > size[0] + 120 ? 100 : 8;   // right of the storey rail, as the tools are, where there is room
    const left = Math.max(L0, Math.min(W - size[0] - 8, x - size[0] / 2));
    /* never under the pill (U3565, Morten 22:08Z: «endre nytt bygg modal is under anton pill»): where they would
       share columns, the card's foot stays 12 px over the pill's top, «Ferdig» in sight */
    const sb = stage.getBoundingClientRect(), pb = bstack.getBoundingClientRect();
    if (pb.height && left < pb.right - sb.left && left + size[0] > pb.left - sb.left) top = Math.min(top, pb.top - sb.top - 12 - size[1]);
    top = Math.max(8, top);
    el.style.transform = `translate(${left.toFixed(0)}px, ${top.toFixed(0)}px)`;
  }
  function dock() {
    if (phone.matches) { if (el.parentNode !== bstack) bstack.prepend(el); el.style.transform = ""; el.classList.add("docked"); }
    else { if (el.parentNode !== stage) stage.append(el); el.classList.remove("docked"); }
  }

  viewer.follow(place);
  addEventListener("sykehus:valg", render);
  phone.addEventListener("change", () => { dock(); size = null; place(); });
  addEventListener("sykehus:panel", () => viewer.redraw());
  return { render };
}
