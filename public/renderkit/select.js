/* Selection as in Fusion 360, one copy for every app (U3569, Morten 2026-10-25 22:30Z via pm: «we should consider the
   selection systems we have in fab, they are modeled on fusion360 and ok»). Origin: Fab's 3D view, atomstack
   hurricane/server/web/view3d.js at hp/fab-0.1.279 (L16, U3476: the filter, choose, windowPick, cross, the window, the
   «Select other» menu, the double click a level up), here without Fab's faces, edges and awareness: what a point or a
   window takes is the app's (under, windowKeys), the rules and the gestures are this file's.

   The rules:
   - a hover (a mouse, no button down) pre-highlights what a click would take (onHover)
   - a click takes what is under the pointer, in place of what was picked; Shift, Ctrl or Cmd adds it, or takes it
     away when all of it is in already
   - a click on nothing clears (without a modifier), and so does Esc
   - Shift and a drag draws a window: left to right takes what lies wholly inside (a solid border), right to left what
     it crosses (dashed); Ctrl or Cmd with it adds. A plain drag is the app's own (it orbits or pans).
   - a right click that does not drag opens «Select other», what lies under the pointer, nearest first (other); with acts
     it also offers «Vis bare denne» (isolate), «Skjul» (hide) and «Vis alt» (show all), labels and the doing the app's (U3882)
   - a double click goes a level up (up)
   - the filter (levels) says what a click takes; it is kept in localStorage under store
   under(e, level) → keys: [] is nothing (a click clears), null is not the picker's (the selection stays)

   No three.js: the app hands in its hit tests and its projection. */

/* the next selection: keys in place of sel, or with add toggled (all in already: they come out; else they go in) */
export function choose(sel, keys, add) {
  if (!add) return [...new Set(keys)];
  const have = new Set(sel);
  return keys.length && keys.every(k => have.has(k)) ? sel.filter(k => !keys.includes(k)) : [...new Set([...sel, ...keys])];
}
/* a screen segment s → t meets the rectangle r { x0, y0, x1, y1 } (Liang–Barsky) */
export function cross(s, t, r) {
  let a = 0, b = 1; const dx = t.x - s.x, dy = t.y - s.y;
  for (const [p, q] of [[-dx, s.x - r.x0], [dx, r.x1 - s.x], [-dy, s.y - r.y0], [dy, r.y1 - s.y]]) {
    if (!p) { if (q < 0) return false; continue; }
    const u = q / p; if (p < 0) a = Math.max(a, u); else b = Math.min(b, u); if (a > b) return false;
  }
  return true;
}
/* does a window take an outline: segs is flat [x, y, z, x, y, z, …], two points a segment, in the app's world;
   project(x, y, z) → { x, y } in the window's pixels (or null: behind the camera). inside: all of it in the window;
   else any of it in or crossing it */
export function windowTest(segs, r, inside, project) {
  let any = false, all = true, n = 0;
  for (let i = 0; i + 5 < segs.length; i += 6) {
    const s = project(segs[i], segs[i + 1], segs[i + 2]), t = project(segs[i + 3], segs[i + 4], segs[i + 5]);
    if (!s || !t) { all = false; continue; }
    n++;
    const inA = s.x >= r.x0 && s.x <= r.x1 && s.y >= r.y0 && s.y <= r.y1, inB = t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
    all = all && inA && inB; any = any || inA || inB || cross(s, t, r);
    if (!inside && any) return true;
  }
  return inside ? all && n > 0 : any;
}

const MOVE = 6;   // px a press may move and still be a click

export function createPicker({ el, host = el.parentElement, fine = e => e.pointerType !== "touch", orbit = null, levels = null, level = null, store = null,
  under, windowKeys = () => [], other = null, acts = null, onAct = () => {}, anyHidden = () => false, up = null, onChange = () => {}, onHover = () => {}, esc = true, doc = globalThis.document }) {
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } }, put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
  let lvl = (store && levels?.some(l => l[0] === get(store)) ? get(store) : level) ?? levels?.[0]?.[0] ?? null;
  let sel = [], hov = [], down = null, win = null, menu = null, pointers = 0, off = false;
  const same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  function set(keys, l = lvl, how = "set") { const next = [...new Set(keys)]; if (l !== lvl) setLevel(l, true); if (same(next, sel)) return; sel = next; onChange(sel.slice(), lvl, how); }
  function hover(keys) { keys = keys || []; if (same(keys, hov)) return; hov = keys; onHover(hov.slice()); }

  /* the filter: one button a level (Fab's seg2) */
  let filter = null;
  if (levels?.length > 1 && doc) {
    filter = doc.createElement("div"); filter.className = "seg2 rk-pick-by"; filter.setAttribute("role", "group"); filter.setAttribute("aria-label", "Et klikk velger");
    for (const [v, w] of levels) { const b = doc.createElement("button"); b.type = "button"; b.textContent = w; b.dataset.v = v; b.setAttribute("aria-pressed", String(v === lvl)); filter.append(b); }
    filter.onclick = e => { const b = e.target.closest("button"); if (b) setLevel(b.dataset.v); };
  }
  function setLevel(v, quiet = false) {
    if (!levels?.some(l => l[0] === v) || v === lvl) return; lvl = v; if (store) put(store, v);
    for (const b of filter?.querySelectorAll("button") || []) b.setAttribute("aria-pressed", String(b.dataset.v === v));
    hover([]); if (!quiet) onChange(sel.slice(), lvl, "level");
  }

  /* the window's rectangle */
  const box = doc?.createElement("div");
  // Stacking: the window rectangle sits on the canvas layer (--z-canvas); the pick-other menu one step above (--z-sticky); both stay below the dock (--z-dock).
  if (box) { box.className = "rk-pick-win"; box.hidden = true; box.style.cssText = "position:absolute;pointer-events:none;z-index:var(--z-canvas);border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)"; host?.append(box); }
  const rel = e => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };

  function onDown(e) {
    if (off) return;
    pointers++; closeMenu();
    down = pointers === 1 ? { x: e.clientX, y: e.clientY, button: e.button } : null;   // a second finger: a pinch, not a click
    if (e.button === 0 && e.shiftKey && fine(e)) { win = { x: e.clientX, y: e.clientY }; if (orbit) orbit.enabled = false; e.stopImmediatePropagation(); }
  }
  function onMove(e) {
    if (off) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > MOVE) down.moved = true;
    if (win && (e.buttons & 1)) {
      win.to = { x: e.clientX, y: e.clientY };
      const hb = (host || el).getBoundingClientRect(), x0 = Math.min(win.x, e.clientX), y0 = Math.min(win.y, e.clientY);
      if (!box) return;
      box.hidden = Math.hypot(e.clientX - win.x, e.clientY - win.y) <= MOVE;
      Object.assign(box.style, { left: `${x0 - hb.left}px`, top: `${y0 - hb.top}px`, width: `${Math.abs(e.clientX - win.x)}px`, height: `${Math.abs(e.clientY - win.y)}px`, borderStyle: e.clientX >= win.x ? "solid" : "dashed" });
      return;
    }
    if (fine(e) && !e.buttons && e.target === el) hover(under(e, lvl) || []);
  }
  function onUp(e) {
    if (off) return;
    pointers = Math.max(0, pointers - 1);
    if (win) {
      const w = win; win = null; if (orbit) orbit.enabled = true; if (box) box.hidden = true;
      /* a Shift press that did not drag is a Shift click */
      if (e.type === "pointerup" && (!w.to || Math.hypot(w.to.x - w.x, w.to.y - w.y) <= MOVE)) { if (down && !down.moved) onClickUp(e); else down = null; return; }
      down = null; if (e.type !== "pointerup") return;
      const b = el.getBoundingClientRect(), r = { x0: Math.min(w.x, w.to.x) - b.left, x1: Math.max(w.x, w.to.x) - b.left, y0: Math.min(w.y, w.to.y) - b.top, y1: Math.max(w.y, w.to.y) - b.top };
      set(choose(sel, windowKeys(r, w.to.x >= w.x, lvl), e.ctrlKey || e.metaKey), lvl, "window"); return;
    }
    onClickUp(e);
  }
  function onClickUp(e) {
    const d = down; down = null;
    if (!d || d.moved || e.type !== "pointerup" || e.target !== el) return;
    if (d.button === 2) { if (other) openMenu(e); return; }
    if (d.button !== 0) return;
    click({ clientX: d.x, clientY: d.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, pointerType: e.pointerType });
  }
  /* a click at e: what is under it, in place of the selection or toggled with a modifier; nothing under it clears */
  function click(e) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey, keys = under(e, lvl);
    if (keys == null) return;   // the app has the click (a build tool placing): the selection stays
    if (!keys.length) { if (!add && sel.length) set([], lvl, "clear"); return; }
    set(choose(sel, keys, add), lvl, "click");
  }
  function onDbl(e) {
    if (off || !up) return;
    const keys = under(e, lvl); if (!keys?.length) return;
    const u = up(keys, lvl); if (u) set(choose(sel, u.keys, e.shiftKey || e.ctrlKey || e.metaKey), u.level ?? lvl, "up");
  }
  function onKey(e) {
    if (off || e.key !== "Escape" || e.defaultPrevented) return;
    if (menu) { closeMenu(); e.preventDefault(); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    if (sel.length) { set([], lvl, "esc"); }
  }

  /* «Select other»: what lies under the pointer, nearest first; each outlined on hover, a tap takes it */
  function closeMenu() { if (!menu) return; menu.remove(); menu = null; hover([]); }
  function openMenu(e) {
    const items = (other(e, lvl) || []).slice(0, 8); if (!items.length || !doc) return;
    const hb = (host || el).getBoundingClientRect(), p = rel(e);
    menu = doc.createElement("div"); menu.className = "pmenu rk-pick-other"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Velg en annen");
    menu.style.cssText = `position:absolute;z-index:var(--z-sticky);left:${Math.min(e.clientX - hb.left, hb.width - 220)}px;top:${e.clientY - hb.top}px`;
    for (const it of items) {
      const b = doc.createElement("button"); b.type = "button"; b.className = "pmi"; b.textContent = it.label; b.setAttribute("role", "menuitem");
      b.onpointerenter = () => hover(it.keys);
      b.onclick = () => { const k = it.keys; closeMenu(); set(k, lvl, "other"); };
      menu.append(b);
    }
    /* «Vis bare denne», «Skjul», «Vis alt» (U3882): acts = { isolate, hide, showAll } are the app's labels; the first two act
       on the nearest item, or on the whole selection when the nearest is in it; onAct(act, keys) is the app's (it holds what
       is hidden); «Vis alt» shows only while anyHidden() */
    if (acts) {
      const near = items[0].keys, keys = near.every(k => sel.includes(k)) ? sel.slice() : near.slice(), rows = [["isolate", keys], ["hide", keys], ["showAll", []]];
      const sep = doc.createElement("hr"); sep.className = "rk-pick-sep"; sep.setAttribute("role", "separator"); menu.append(sep);
      for (const [act, ks] of rows) {
        if (!acts[act] || (act === "showAll" && !anyHidden())) continue;
        const b = doc.createElement("button"); b.type = "button"; b.className = "pmi"; b.dataset.act = act; b.textContent = acts[act]; b.setAttribute("role", "menuitem");
        b.onclick = () => { closeMenu(); onAct(act, ks); };
        menu.append(b);
      }
    }
    (host || el).append(menu); menu.querySelector("button").focus(); void p;
  }
  const outside = e => { if (menu && !menu.contains(e.target)) closeMenu(); };
  const noMenu = e => { if (other) e.preventDefault(); };
  const leave = () => hover([]);

  el.addEventListener("pointerdown", onDown, true);   // before the app's orbit: a Shift press draws a window instead
  addEventListener("pointermove", onMove); addEventListener("pointerup", onUp); addEventListener("pointercancel", onUp);
  el.addEventListener("dblclick", onDbl); el.addEventListener("contextmenu", noMenu); el.addEventListener("pointerleave", leave);
  addEventListener("pointerdown", outside, true);
  if (esc) addEventListener("keydown", onKey);

  return {
    get keys() { return sel.slice(); }, get level() { return lvl; }, get hovering() { return hov.slice(); }, filter,
    set, clear: () => set([], lvl, "clear"), setLevel, click,
    /* while a build tool (build.js) holds the pointer the picker stands aside */
    pause(v = true) { off = v; if (v) { hover([]); down = null; } },
    destroy() {
      el.removeEventListener("pointerdown", onDown, true); removeEventListener("pointermove", onMove); removeEventListener("pointerup", onUp); removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", onDbl); el.removeEventListener("contextmenu", noMenu); el.removeEventListener("pointerleave", leave);
      removeEventListener("pointerdown", outside, true); removeEventListener("keydown", onKey); box?.remove(); closeMenu(); filter?.remove();
    },
  };
}
