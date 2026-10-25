/* Trace mode (PLAN §5, M4): a scanned sheet laid on the site as a picture, placed by two points, and its walls drawn
   over it as rectangles that snap to the sheet's own axes; room stamps with name and m². What is traced is kept in
   the sheet's own coordinates (PDF points, y down) with the control points beside them, so a later, better
   placement moves everything with it. "Last ned" gives the trace as a file; tools/trace-import.mjs puts it into
   floors.json. Opened with ?spor on the page. Nothing here saves to the site: saving comes with a login.

   A trace file: { id, storey, kote, height, wing, building, how, doc, page, title, size: [w, h] (pt),
                   cp: [[sx, sy, x, y], ...] (sheet pt to site m), walls: [[[sx, sy], ...], ...], rooms: [{ name, area_m2, at: [sx, sy] }] } */
import * as THREE from "./vendor/three.module.js";

/* sheet points (y down) to site metres by a similarity fitted to the control points (least squares in complex numbers) */
export function fitOf(cp) {
  const W = cp.map(c => [c[0], -c[1]]), Z = cp.map(c => [c[2], c[3]]), n = cp.length;
  const wm = W.reduce((a, w) => [a[0] + w[0] / n, a[1] + w[1] / n], [0, 0]), zm = Z.reduce((a, z) => [a[0] + z[0] / n, a[1] + z[1] / n], [0, 0]);
  let re = 0, im = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const w = [W[i][0] - wm[0], W[i][1] - wm[1]], z = [Z[i][0] - zm[0], Z[i][1] - zm[1]];
    re += z[0] * w[0] + z[1] * w[1]; im += z[1] * w[0] - z[0] * w[1]; d += w[0] * w[0] + w[1] * w[1];
  }
  const a = [re / d, im / d], b = [zm[0] - (a[0] * wm[0] - a[1] * wm[1]), zm[1] - (a[0] * wm[1] + a[1] * wm[0])];
  const to = ([sx, sy]) => { const w = [sx, -sy]; return [a[0] * w[0] - a[1] * w[1] + b[0], a[0] * w[1] + a[1] * w[0] + b[1]]; };
  const k = a[0] * a[0] + a[1] * a[1];
  const from = ([x, y]) => { const z = [x - b[0], y - b[1]], w = [(a[0] * z[0] + a[1] * z[1]) / k, (a[0] * z[1] - a[1] * z[0]) / k]; return [w[0], -w[1]]; };
  return { to, from, scale: Math.sqrt(k), angle: Math.atan2(a[1], a[0]) };
}

export async function startTrace({ viewer, site, container, setMode }) {
  const { sheets } = await fetch("data/skann/index.json").then(r => r.json());
  const ui = document.createElement("div"); ui.className = "card"; ui.id = "trace";
  ui.style.cssText = "top:14px;right:92px;padding:10px 14px;width:310px;font-size:15px;max-height:calc(100vh - 140px);overflow-y:auto;z-index:5";
  document.body.append(ui);
  let t = null, fit = null, sheetMesh = null, wallMesh = null, tool = "flytt", thick = 0.25, pending = null, placing = null, drag = null;
  const marks = document.createElement("div"); marks.style.cssText = "position:absolute;inset:0;pointer-events:none;font-size:12px"; container.append(marks);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const B = (id, label, on) => `<button data-t="${id}" aria-pressed="${!!on}" style="min-height:38px;font-size:15px;padding:0 10px">${label}</button>`;

  function render() {
    const s = t && sheets.find(x => x.doc === t.doc && x.page === t.page);
    ui.innerHTML = `<b style="font-size:17px">Spor en skannet tegning</b>
      <p style="margin:4px 0 8px;color:var(--soft);font-size:13px">Tegningen legges på tomta; tegn veggene oppå den. Ingenting lagres på nettstedet: last ned sporet og send det.</p>
      <select id="tsheet" style="width:100%;font:inherit;font-size:15px;min-height:38px"><option value="">Velg tegning …</option>${sheets.map(x => `<option value="${x.id}" ${s?.id === x.id ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>
      <label style="display:block;margin-top:6px;font-size:13px;color:var(--soft)">… eller åpne et spor: <input id="tfile" type="file" accept=".json,application/json"></label>` +
      (t ? `<div style="margin-top:10px;display:grid;gap:6px">
        <div><b>Plassering</b> <span style="font-size:13px;color:var(--soft)">${t.cp.length >= 2 ? `${t.cp.length} punkter, 1 pt = ${(fit.scale * 100).toFixed(2)} cm, ca. 1:${Math.round(fit.scale / (25.4 / 72 / 1000))}` : t.cp.length ? "1 punkt; legg til ett til for vinkel og målestokk" : (t.machine ? "maskinelt tilpasset omrisset; kontroller, eller legg til to punkter" : "omtrentlig: legg til to punkter")}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${B("plasser", placing ? (placing.s ? "Klikk der punktet er på tomta" : "Klikk et punkt på tegningen") : "Legg til punkt", placing)}${B("nullstill", "Fjern punktene")}</div>
        <label style="font-size:13px">Synlighet <input id="top" type="range" min="0.1" max="1" step="0.05" value="${sheetMesh?.material.opacity ?? 0.6}"></label>
        <div><b>Tegn</b></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${B("flytt", "Flytt kartet", tool === "flytt")}${B("vegg", "Vegg", tool === "vegg")}${B("rom", "Rom", tool === "rom")}${B("slett", "Slett", tool === "slett")}${B("angre", "Angre")}</div>
        <label style="font-size:13px">Veggtykkelse <select id="tthick" style="font:inherit;font-size:14px">${[0.1, 0.15, 0.2, 0.25, 0.35, 0.5].map(v => `<option ${v === thick ? "selected" : ""}>${v}</option>`).join("")}</select> m</label>
        <div style="font-size:13px;color:var(--soft)">${t.walls.length} vegger · ${t.rooms.length} rom · ${esc(t.storey)} kote ${t.kote.toFixed(2).replace(".", ",")}${t.how ? " (" + esc(t.how) + ")" : ""}</div>
        <div style="display:flex;gap:6px">${B("lagre", "Last ned sporet")}${B("lukk", "Lukk")}</div></div>` : "");
    ui.querySelector("#tsheet").onchange = e => { const x = sheets.find(v => v.id === e.target.value); if (x) open(blank(x)); };
    ui.querySelector("#tfile").onchange = async e => { const f = e.target.files[0]; if (f) open(JSON.parse(await f.text())); };
    for (const b of ui.querySelectorAll("[data-t]")) b.onclick = () => act(b.dataset.t);
    const op = ui.querySelector("#top"); if (op) op.oninput = () => { sheetMesh.material.opacity = +op.value; viewer.redraw(); };
    const th = ui.querySelector("#tthick"); if (th) th.onchange = () => { thick = +th.value; };
  }
  /* a new trace of a sheet, laid where tools/tracefit.py put it, or else roughly where its building stands at the sheet's scale */
  function blank(x) {
    const rings = site.buildings.filter(b => x.wing ? b.wing === x.wing : b.id === x.building).flatMap(b => b.ring);
    const c = rings.length ? [rings.reduce((a, p) => a + p[0], 0) / rings.length, rings.reduce((a, p) => a + p[1], 0) / rings.length] : [0, 0];
    const m = x.scale * 25.4 / 72 / 1000, [w, h] = x.size;   // metres a sheet point
    return { id: x.id, storey: x.storey, kote: x.kote, height: x.height, how: x.how, wing: x.wing || null, building: x.building || null, doc: x.doc, page: x.page, title: x.title, size: x.size,
      machine: !!x.placed, guess: x.placed || [[w / 2, h / 2, c[0], c[1]], [w / 2 + 100, h / 2, c[0] + 100 * m, c[1]]], cp: [], walls: [], rooms: [] };
  }
  /* the placement: the control points once there are two; with one, the guess moved onto it; with none, the guess */
  function fitFor(t) {
    if (t.cp.length >= 2) return fitOf(t.cp);
    const g = fitOf(t.guess); if (!t.cp.length) return g;
    const c = t.cp[0], at = g.to([c[0], c[1]]), d = [c[2] - at[0], c[3] - at[1]];
    return fitOf(t.guess.map(q => [q[0], q[1], q[2] + d[0], q[3] + d[1]]));
  }
  function open(trace) {
    t = trace; t.walls ||= []; t.rooms ||= []; t.cp ||= [];
    if (!t.guess) { const x = sheets.find(v => v.doc === t.doc && v.page === t.page); t.guess = t.cp.length >= 2 ? t.cp.slice(0, 2) : blank(x).guess; }
    const x = sheets.find(v => v.doc === t.doc && v.page === t.page);
    if (sheetMesh) { viewer.remove(sheetMesh); sheetMesh.geometry.dispose(); }
    sheetMesh = null;
    if (x) new THREE.TextureLoader().load(x.image, tex => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      sheetMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthTest: false, side: THREE.DoubleSide }));
      sheetMesh.renderOrder = 20; sheetMesh.frustumCulled = false; viewer.add(sheetMesh); place(); });
    viewer.setStorey(t.storey); setMode("plan"); place(); render();
    const c = fitFor(t).to([t.size[0] / 2, t.size[1] / 2]); viewer.pose({ x: c[0], y: c[1], dist: 160 });
  }
  /* the sheet and the walls where the control points put them */
  function place() {
    if (!t) return; fit = fitFor(t);
    const z = t.kote + 0.2, [w, h] = t.size;
    if (sheetMesh) {
      const q = [[0, 0], [w, 0], [w, h], [0, h]].map(p => viewer.world(fit.to(p), z));
      sheetMesh.geometry.dispose(); const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3].flatMap(i => [q[i].x, q[i].y, q[i].z]), 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3].flatMap(i => [[0, 1], [1, 1], [1, 0], [0, 0]][i]), 2));
      sheetMesh.geometry = g;
    }
    if (wallMesh) { viewer.remove(wallMesh); wallMesh.geometry.dispose(); }
    const pos = [];
    for (const r of t.walls) { const q = r.slice(0, 4).map(p => viewer.world(fit.to(p), z + 0.1)); for (const i of [0, 1, 2, 0, 2, 3]) pos.push(q[i].x, q[i].y, q[i].z); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    wallMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xc0182e, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    wallMesh.renderOrder = 21; wallMesh.frustumCulled = false; viewer.add(wallMesh);
  }
  /* a wall from a to b (sheet points), straightened onto the sheet's axes when within 8°, as a rectangle thick metres */
  function wallOf(a, b) {
    let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy); if (L < 1e-6) return null;
    const ang = Math.atan2(dy, dx), snap = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - snap) < 8 * Math.PI / 180) { dx = Math.cos(snap) * L; dy = Math.sin(snap) * L; }
    const half = thick / fit.scale / 2, nx = -dy / L * half, ny = dx / L * half, e = [a[0] + dx, a[1] + dy];
    const r = [[a[0] + nx, a[1] + ny], [e[0] + nx, e[1] + ny], [e[0] - nx, e[1] - ny], [a[0] - nx, a[1] - ny]];
    return [...r, r[0]].map(p => p.map(v => Math.round(v * 100) / 100));
  }
  const sheetAt = e => { const g = viewer.groundAt(e.clientX, e.clientY, t.kote); return g && fit.from(g); };
  const inside = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [c, d] = r[j]; if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) o = !o; } return o; };

  function act(k) {
    if (k === "plasser") { placing = placing ? null : {}; tool = "plasser"; }
    else if (k === "nullstill") { t.cp = []; place(); }
    else if (k === "angre") { const last = t.last?.pop(); if (last === "rom") t.rooms.pop(); else if (last === "vegg") t.walls.pop(); place(); }
    else if (k === "lagre") {
      const { last, ...out } = t, a = document.createElement("a");
      if (out.cp.length < 2) out.cp = [[0, 0], [t.size[0], t.size[1]]].map(q => [...q, ...fit.to(q).map(v => +v.toFixed(3))]), out.placement = t.machine ? "maskinelt tilpasset bygningsomrisset" : "omtrentlig";
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" })); a.download = `spor-${t.id}.json`; a.click();
    }
    else if (k === "lukk") { if (sheetMesh) viewer.remove(sheetMesh); if (wallMesh) viewer.remove(wallMesh); marks.remove(); ui.remove(); container.removeEventListener("pointerdown", down, true); return; }
    else { tool = k; placing = null; }
    render(); viewer.redraw();
  }
  /* the trace takes the pointer while a tool is chosen; "Flytt kartet" gives it back to the map */
  function down(e) {
    if (!t || tool === "flytt" || e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation(); e.preventDefault();
    const p = sheetAt(e); if (!p) return;
    if (tool === "plasser") {
      if (!placing.s) placing.s = p;
      else {
        const g = viewer.groundAt(e.clientX, e.clientY, t.kote);
        t.cp.push([+placing.s[0].toFixed(2), +placing.s[1].toFixed(2), +g[0].toFixed(3), +g[1].toFixed(3)]);
        placing = {}; place();
      }
    }
    else if (tool === "vegg") { drag = { a: p }; container.addEventListener("pointerup", upWall, { once: true, capture: true }); }
    else if (tool === "rom") roomForm(p, e);
    else if (tool === "slett") {
      const i = t.walls.findIndex(r => inside(p, r)); if (i >= 0) t.walls.splice(i, 1);
      else { const j = t.rooms.findIndex(r => Math.hypot(r.at[0] - p[0], r.at[1] - p[1]) < 4 / fit.scale); if (j >= 0) t.rooms.splice(j, 1); }
      place();
    }
    render(); viewer.redraw();
  }
  function upWall(e) {
    e.stopPropagation(); const b = sheetAt(e); if (!drag || !b) return;
    const r = wallOf(drag.a, b); drag = null; if (!r) return;
    t.walls.push(r); (t.last ||= []).push("vegg"); place(); render();
  }
  function roomForm(p, e) {
    const f = document.createElement("form"); f.className = "card";
    f.style.cssText = `left:${e.clientX + 8}px;top:${e.clientY + 8}px;padding:8px;display:grid;gap:6px;z-index:6;font-size:14px`;
    f.innerHTML = `<input name="n" placeholder="Romnavn" required style="font:inherit"><input name="a" placeholder="m² (som på tegningen)" inputmode="decimal" style="font:inherit"><div style="display:flex;gap:6px"><button>Legg til</button><button type="button">Avbryt</button></div>`;
    document.body.append(f); f.n.focus();
    f.querySelector("button[type=button]").onclick = () => f.remove();
    f.onsubmit = ev => { ev.preventDefault(); const a = parseFloat(String(f.a.value).replace(",", "."));
      t.rooms.push({ name: f.n.value.trim(), area_m2: Number.isFinite(a) ? a : null, at: p.map(v => Math.round(v * 100) / 100) }); (t.last ||= []).push("rom"); f.remove(); render(); viewer.redraw(); };
  }
  container.addEventListener("pointerdown", down, true);
  /* the room stamps and control points, kept over the picture */
  (function loop() {
    if (!ui.isConnected) return;
    if (t && fit) marks.innerHTML = t.rooms.map(r => { const [x, y] = viewer.project(fit.to(r.at), t.kote); return `<div style="position:absolute;transform:translate(${x.toFixed(0)}px,${y.toFixed(0)}px);color:#c0182e;font-weight:600">● ${esc(r.name)}${r.area_m2 ? " " + r.area_m2 + " m²" : ""}</div>`; }).join("") +
      (t.cp.map(c => { const [x, y] = viewer.project([c[2], c[3]], t.kote); return `<div style="position:absolute;transform:translate(${(x - 7).toFixed(0)}px,${(y - 7).toFixed(0)}px);width:14px;height:14px;border:2px solid #0a5bd8;border-radius:50%"></div>`; }).join(""));
    requestAnimationFrame(loop);
  })();
  render();
}
