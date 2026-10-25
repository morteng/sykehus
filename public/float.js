/* The card over what is picked (U3554, Morten 2026-10-25 20:07Z: «the delete building button should float over a
   selected building like the building name does … only needed metadata, only needed tools»). It rides over the
   picked wing's roof as the names do (viewer.follow, placed in the same frame): the name, two or three facts, and the
   acts that fit it, «Riv», «Spør Anton», «Etasjer»; several wings picked make one card with their count and the acts
   they share. A tap elsewhere puts it away (the pick is cleared). The panel's «Bygget» keeps the whole card.
   What is torn down leaves nothing on the model (Morten 20:12Z); it is undone in «Forslag».
   Below 900 px the card does not ride: it sits in the bottom stack, over the sheet (Fab's .bstack). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = v => Math.round(v).toLocaleString("nb-NO");
const mid = ring => { const r = ring.slice(0, -1); return r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]); };

export function createFloat({ viewer, site, valg, panel, stage, bstack, onRiv, onStoreys }) {
  const wings = site.wings || [], phone = matchMedia("(max-width: 899px)");
  const el = Object.assign(document.createElement("div"), { id: "float", className: "fl", hidden: true });
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Det valgte bygget");
  el.addEventListener("pointerdown", e => e.stopPropagation());   // a tap on the card is not a tap on the model behind it
  let at = null, size = null;   // the site point the card rides over: [east, north, kote]

  /* the few facts: built (the first year), storeys, footprint */
  function facts(w, bs) {
    const built = w?.built ? String(w.built).split(/[;,]/)[0].trim() : null;
    const st = w?.levels?.length ? `${w.levels.length} etasjer` : (/^\d+(–\d+)? etasjer/.exec(w?.storeys || "") || [])[0];
    return [built, st, `${num(bs.reduce((a, b) => a + (b.area_m2 || 0), 0))} m² grunnflate`].filter(Boolean);
  }
  const over = bs => { const b = bs.slice().sort((a, c) => (c.area_m2 || 0) - (a.area_m2 || 0))[0]; return [...mid(b.ring), Math.max(...bs.map(x => x.top ?? x.base + 10)) + 2]; };

  function render() {
    const picked = valg.items.filter(i => i.kind === "wing" || i.kind === "building");
    const v = viewer.view();
    if (!picked.length || v.mode === "section" || v.storey && !v.only) { el.hidden = true; at = null; return; }
    const groups = picked.map(i => i.kind === "wing" ? { i, w: wings.find(x => x.id === i.id), bs: site.buildings.filter(b => b.wing === i.id) } : { i, w: null, bs: site.buildings.filter(b => b.id === i.id) }).filter(g => g.bs.length);
    if (!groups.length) { el.hidden = true; at = null; return; }
    const all = groups.flatMap(g => g.bs);
    at = over(all);
    if (groups.length === 1) {
      const { i, w, bs } = groups[0], name = w ? w.name : i.label;
      el.innerHTML = `<div class="fl-h"><b>${esc(name)}</b><span>${facts(w, bs).map(esc).join(" · ")}</span></div>
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv ${w ? "fløyen" : "bygningen"}</button><button type="button" data-ask>Spør Anton</button>${w?.levels?.length ? `<button type="button" data-et>Etasjer</button>` : ""}</div>`;
      el.querySelector("[data-riv]").onclick = () => onRiv([w ? w.id : bs[0].id], w ? w.name : "bygningen");
      el.querySelector("[data-et]")?.addEventListener("click", () => onStoreys(bs[0]));
    } else {
      const n = groups.length, what = groups.every(g => g.w) ? "fløyer" : "bygg";
      el.innerHTML = `<div class="fl-h"><b>${n} ${what} valgt</b><span>${num(all.reduce((a, b) => a + (b.area_m2 || 0), 0))} m² grunnflate</span></div>
        <div class="fl-acts"><button type="button" class="riv" data-riv>Riv alle ${n}</button><button type="button" data-ask>Spør Anton</button></div>`;
      el.querySelector("[data-riv]").onclick = () => onRiv(groups.map(g => g.w ? g.w.id : g.bs[0].id), `${n} bygg`);
    }
    el.querySelector("[data-ask]").onclick = () => { if (!document.body.classList.contains("talk-on")) panel.reveal("chat"); dispatchEvent(new CustomEvent("sykehus:ask")); };
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
    const left = Math.max(8, Math.min(W - size[0] - 8, x - size[0] / 2));
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
