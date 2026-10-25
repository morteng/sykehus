/* The right panel (the Anton-first layout, the designer's redlines §2.3 and §6): four tabs in Fab's dock, the «›» that
   folds it away on a wide screen, and on a narrow one (under 900 px, an iPad standing) a bottom sheet with three
   heights. The behaviour is Fab's (atomstack hurricane/server/web/editor.js at c7759f3: showTab, #side-fold, setSnap,
   the #grab drag), here without Fab's design state; the rules are Fab's laser.css as-is.

   onChange(tab) runs after each change of tab, fold or sheet height, so the pill can go where the chat is. */
const $ = id => document.getElementById(id);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };

export function createPanel({ start = null, onChange = () => {} } = {}) {
  const side = $("right"), phone = matchMedia("(max-width: 899px)"), SNAPS = ["peek", "half", "full"];
  let tab = null, prev = null, snap = "peek";
  const tabs = () => [...document.querySelectorAll("#dock [data-tab]")].filter(b => !b.hidden);
  function badge(t, n) {
    const b = $(`b-${t}`); if (b) { b.hidden = !n || (t === tab && open()); b.textContent = String(n || ""); }
    if (t === "chat") { const f = $("b-fold"); f.hidden = !n; f.textContent = String(n || ""); }
  }
  /* the panel shows: not folded on a wide screen, above its peek on a narrow one */
  const open = () => phone.matches ? snap !== "peek" : !document.body.classList.contains("side-off");
  function show(t, { quiet = false } = {}) {
    if (!tabs().some(b => b.dataset.tab === t)) t = tabs()[0]?.dataset.tab;
    tab = t; if (t !== "selected") store.set("sykehus-fane", t);   // a reload never opens an empty «Bygget»
    for (const b of tabs()) b.setAttribute("aria-selected", String(b.dataset.tab === t));
    for (const p of document.querySelectorAll(".tabp")) p.hidden = p.dataset.tab !== t;
    side.dataset.tab = t; badge(t, 0);
    if (phone.matches && !quiet) { if (t === prev && snap !== "peek") setSnap("peek"); else if (snap === "peek" && prev !== null) setSnap("half"); }
    prev = t; onChange(t);
  }
  /* to a tab and make sure it can be seen: unfolds the panel, lifts the sheet */
  function reveal(t) {
    if (!phone.matches && document.body.classList.contains("side-off")) fold(false);
    if (phone.matches && snap === "peek") setSnap("half");
    show(t, { quiet: true });
  }
  for (const b of document.querySelectorAll("#dock [data-tab]")) b.onclick = () => show(b.dataset.tab);
  function fold(off = !document.body.classList.contains("side-off")) {
    document.body.classList.toggle("side-off", off); $("side-fold").setAttribute("aria-expanded", String(!off));
    $("side-fold").firstChild.textContent = off ? "‹" : "›"; $("side-fold").title = off ? "Vis panelet" : "Legg bort panelet";
    store.set("sykehus-panel", off ? "av" : "på"); onChange(tab);
  }
  $("side-fold").onclick = () => fold();
  if (store.get("sykehus-panel") === "av") fold(true);
  function setSnap(v) {
    snap = v; side.dataset.snap = v;
    document.body.classList.toggle("sheet-open", v !== "peek"); document.body.classList.toggle("sheet-full", v === "full");
    $("grab").setAttribute("aria-label", `Panelets høyde: ${{ peek: "nede", half: "halvt oppe", full: "helt oppe" }[v]}`); onChange(tab);
  }
  /* the full sheet stops under the app bar */
  const hdr = () => document.body.style.setProperty("--hdr", `${document.querySelector("header.top").getBoundingClientRect().height}px`);
  new ResizeObserver(hdr).observe(document.querySelector("header.top"));
  function onPhone() { document.body.classList.toggle("m", phone.matches); if (phone.matches) setSnap(snap); else onChange(tab); hdr(); }
  phone.addEventListener("change", onPhone); onPhone();
  $("grab").onclick = () => setSnap(SNAPS[(SNAPS.indexOf(snap) + 1) % 3]);
  { // dragging the handle: follow the finger, then settle on the nearest height
    let y0 = null, h0 = 0;
    $("grab").addEventListener("pointerdown", e => { if (!phone.matches) return; y0 = e.clientY; h0 = side.getBoundingClientRect().height; $("grab").setPointerCapture(e.pointerId); });
    $("grab").addEventListener("pointermove", e => { if (y0 === null || Math.abs(e.clientY - y0) < 6) return; side.style.height = `${Math.max(60, h0 + y0 - e.clientY)}px`; });
    $("grab").addEventListener("pointerup", e => {
      if (y0 === null) return; const moved = Math.abs(e.clientY - y0) >= 6; y0 = null;
      if (!moved) return;
      const h = side.getBoundingClientRect().height, vh = innerHeight; side.style.height = "";
      const best = [["peek", 96], ["half", vh * 0.52], ["full", vh * 0.88]].sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
      setTimeout(() => setSnap(best));
      $("grab").addEventListener("click", ev => ev.stopImmediatePropagation(), { once: true, capture: true });
    });
  }
  const t0 = start ?? store.get("sykehus-fane") ?? "chat";
  show(t0, { quiet: true });
  return { show, reveal, badge, open, fold, get tab() { return tab; }, get phone() { return phone.matches; }, peek(html) { $("peekhead").innerHTML = html; } };
}
