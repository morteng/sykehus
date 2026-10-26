/* The site in 3D: terrain, the lot, the buildings, the sun. Shared by the web page (app.js) and the chat app (mcp-app.js).

   Drawn from site.json (tools/site.mjs): metres east and north of an origin, heights above sea level. In three.js
   x is east, z is south (-north) and y is up, with y = 0 at the lowest terrain, so the numbers stay small.
   Buildings on the lot get their roofs from the laser surface (one quad per 2 m cell, corners shared, so a 14-storey
   block over a 4-storey wing reads as it stands), walls from their outline up to the roof next to each edge. Other
   buildings are plain boxes to their laser top. building:parts on an outline (cut) are left out of its roof: they
   are buildings of their own.

   Storeys are each wing's own (site.json wings[].levels), at its own kote: showing one cuts the buildings 1.2 m above
   its floor, as a plan is cut, all of them or one, with a floor plate there; where a drawing of that storey exists
   (floors.json, tools/floors.mjs) its walls stand from their kote.
   The plan view looks straight down, north up, without perspective, so a scale bar holds. */
import * as THREE from "./vendor/three.module.js";
import { sunPosition } from "./renderkit/sun.js";
import { ease } from "./renderkit/camera.js";
import { bimPlace } from "./design.js";
import { pickQuality, markStart, markDone, lowerNow } from "./quality.js";

const C = { ground: "#c9cdb8", lot: "#c8102e", wall: "#ece6da", roof: "#8b8f94", own: "#f4efe4", nb: "#d9d6cf", nbRoof: "#a7a6a2", pick: "#ffcf33", sky: "#dfe8ee", cutWall: "#55524d", plate: "#e8e2d4", flatRoof: "#9a9890", steel: "#8e9297" };

export function createViewer({ container, site, floors = [], lat = 59.749, lon = 10.198, onPick = () => {}, onView = () => {}, quality = pickQuality() }) {
  const Q = quality; markStart(Q);   // how much this device carries (quality.js); the mark comes off at the first picture
  /* its own T: setTerrain swaps in the after's grid (U3566, a building's pad), base stays the before's lowest */
  const T = { ...site.terrain }, base = Math.min(...T.z.filter(v => v != null));
  const at = (grid, x, y) => { const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res); if (c < 0 || r < 0 || c >= T.w || r >= T.h) return null; return grid[r * T.w + c]; };
  const ground = (x, y) => at(T.z, x, y) ?? base;
  const P = ([x, y], h) => new THREE.Vector3(x, h - base, -y);

  const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, preserveDrawingBuffer: true });
  /* no shader error check outside ?debug: reading each program's log makes the first frame wait on every compile */
  renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has("debug");
  renderer.setPixelRatio(Math.min(Q.dpr, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.localClippingEnabled = true;
  renderer.domElement.addEventListener("webglcontextlost", () => lowerNow(Q));
  container.appendChild(renderer.domElement); renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  const scene = new THREE.Scene(); scene.background = new THREE.Color(C.sky);
  const persp = new THREE.PerspectiveCamera(40, 1, 1, 4000), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  let camera = persp, mode = "3d";
  const sky = new THREE.HemisphereLight("#f3f6ff", "#8d8f80", 2.2); scene.add(sky);
  const sunL = new THREE.DirectionalLight("#fff6e8", 2.2); sunL.castShadow = true; sunL.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(sunL.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 1500 }); sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.6;
  scene.add(sunL, sunL.target);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide, ...o });

  /* ---------- terrain ---------- */
  let terrainGeo = null;
  /* the after's grid (design.js: the pads under new buildings), its heights written into the drawn terrain in place */
  function setTerrain(z) {
    if (!z || z === T.z || z.length !== T.z.length) return;
    T.z = z; const a = terrainGeo.attributes.position;
    for (let i = 0; i < z.length; i++) a.setY(i, (z[i] ?? base) - base - 0.05);
    a.needsUpdate = true; terrainGeo.computeVertexNormals(); terrainGeo.computeBoundingSphere(); dirty = true;
  }
  {
    const pos = [], idx = [];
    for (let r = 0; r < T.h; r++) for (let c = 0; c < T.w; c++) { const z = T.z[r * T.w + c] ?? base; pos.push(T.x0 + (c + 0.5) * T.res, z - base - 0.05, -(T.y1 - (r + 0.5) * T.res)); }
    for (let r = 0; r < T.h - 1; r++) for (let c = 0; c < T.w - 1; c++) { const a = r * T.w + c; idx.push(a, a + T.w, a + 1, a + 1, a + T.w, a + T.w + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    terrainGeo = g;
    /* grass (ambientCG Grass004, as in hagekart): one picture to 3 m, a little lighter than the photo so the plan reads */
    g.setAttribute("uv", new THREE.Float32BufferAttribute(pos.flatMap((v, i) => i % 3 === 0 ? [v / 3] : i % 3 === 2 ? [-v / 3] : []), 2));
    const gc = document.createElement("canvas"); gc.width = gc.height = 512; const gx = gc.getContext("2d"); gx.fillStyle = C.ground; gx.fillRect(0, 0, 512, 512);
    const grass = new THREE.CanvasTexture(gc); grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.colorSpace = THREE.SRGBColorSpace; grass.anisotropy = 8;
    const gi = new Image(); gi.onload = () => { gx.drawImage(gi, 0, 0, 512, 512); gx.globalCompositeOperation = "screen"; gx.fillStyle = "rgba(196,205,168,.62)"; gx.fillRect(0, 0, 512, 512); grass.needsUpdate = true; dirty = true; };
    gi.crossOrigin = "anonymous";   // in the chat app the page is on the host's origin: without it the canvas is tainted and the picture back fails
    gi.src = new URL("./tex-grass.jpg", import.meta.url).href;
    const m = new THREE.Mesh(g, mat("#ffffff", { map: grass })); m.receiveShadow = true; scene.add(m);
    const lot = site.lot.ring.map(p => P(p, ground(...p) + 0.25));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lot), new THREE.LineDashedMaterial({ color: C.lot, dashSize: 2, gapSize: 1.2 })).computeLineDistances());
  }
  /* the plan's 10 m grid on whole UTM tens (EPSG:25833), as on a drawing; drawn over everything, only in the plan */
  const grid = (() => {
    const [ox, oy] = site.origin || [0, 0], xs = site.lot.ring.map(p => p[0]), ys = site.lot.ring.map(p => p[1]), pos = [];
    const x0 = Math.floor((Math.min(...xs) - 150 + ox) / 10) * 10 - ox, x1 = Math.max(...xs) + 150, y0 = Math.floor((Math.min(...ys) - 150 + oy) / 10) * 10 - oy, y1 = Math.max(...ys) + 150;
    for (let x = x0; x <= x1; x += 10) pos.push(x, 300, -y0, x, 300, -y1);
    for (let y = y0; y <= y1; y += 10) pos.push(x0, 300, -y, x1, 300, -y);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5b6f86, transparent: true, opacity: 0.28, depthTest: false }));
    l.renderOrder = 10; l.visible = false; l.frustumCulled = false; scene.add(l); return l;
  })();

  /* ---------- buildings ---------- */
  const ringArea2 = r => r.reduce((a, q, i) => { const s = r[(i + 1) % r.length]; return a + q[0] * s[1] - s[0] * q[1]; }, 0);   // twice the signed area, > 0 anticlockwise
  /* a ring's box first, kept per ring: most points asked are far outside (pm 21:41Z: the page's main thread stood
     still seconds after a load; the floors asked every wall corner against every building) */
  const boxes = new WeakMap(), boxOf = r => { let b = boxes.get(r); if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of r) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } boxes.set(r, b); } return b; };
  const inRing = ([x, y], r) => { const bx = boxOf(r); if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) return false; let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
  const meshes = new Map(); let goneIds = new Set();   // goneIds: setGone
  function wallsTo(ring, b0, topAt, m) {
    const pos = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / T.res));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, p0 = [ax + (bx - ax) * t0, ay + (by - ay) * t0], p1 = [ax + (bx - ax) * t1, ay + (by - ay) * t1];
        const h = topAt([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], [(by - ay) / len, -(bx - ax) / len]);
        const a = P(p0, b0), b = P(p1, b0), c = P(p1, h), d = P(p0, h);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const w = new THREE.Mesh(g, m); w.castShadow = w.receiveShadow = true; return w;
  }
  /* facades as the photos of the hospital show them (tools/facades.py measured the colours):
     - the high-rise ("2 Fasadefoto", 2020): light concrete piers with a joint down the middle, and between them a
       recessed slot holding a pair of blue windows over a shadowed spandrel;
     - the low wings ("Fotoskisse fasade Forsyningsblokka", 2018): exposed-aggregate panels 1.25 m wide and a ribbon of
       dark brown windows with the blinds down. Its concrete is warm in the photo's low sun; here it is half way to
       the same lightness in grey, as it reads in daylight, and the high-rise's shadowed slot is grey where the scan
       turns it violet.
     One picture is a 2.5 m bay of a 3.5 m storey, drawn once and repeated, with a relief (normal) and a gloss
     (roughness) picture beside it, so the glass shines and the slots and joints catch the light. */
  const FACADE = {
    tower: { concrete: "#e4e2e5", reveal: "#a3a19e", frame: "#3a3d42", glass: "#4576a8" },
    low: { concrete: "#ece3d6", frame: "#3b352d", blind: "#827356", glass: "#4f5d66" },
  };
  /* a picture of a facade, Wm by Hm metres at ppm pixels a metre: box() paints a surface (metres from the left and
     the top), with its gloss and how deep it lies; pane() a pane of glass, glass() a pane in its frame; done() adds
     the grain and makes the relief from the depths */
  function painter(Wm, Hm, ppm, c, repeat = true) {
    const W = Math.round(Wm * ppm), H = Math.round(Hm * ppm), mx = W / Wm, my = H / Hm;
    const pic = document.createElement("canvas"), gl = document.createElement("canvas"); pic.width = gl.width = W; pic.height = gl.height = H;
    const g = pic.getContext("2d"), r = gl.getContext("2d"), depth = new Float32Array(W * H);     // depth: 0 at the face, 1 in a recess
    const box = (x0, y0, x1, y1, col, rough, d) => {
      const X0 = Math.max(0, Math.round(x0 * mx)), Y0 = Math.max(0, Math.round(y0 * my)), X1 = Math.min(W, Math.round(x1 * mx)), Y1 = Math.min(H, Math.round(y1 * my));
      if (X1 <= X0 || Y1 <= Y0) return;
      g.fillStyle = col; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
      if (rough != null) { r.fillStyle = `rgb(0,${rough},0)`; r.fillRect(X0, Y0, X1 - X0, Y1 - Y0); }
      if (d != null) for (let y = Y0; y < Y1; y++) depth.fill(d, y * W + X0, y * W + X1);
    };
    const pane = (x0, y0, x1, y1) => {   // the sky's light in its top, darker down
      const gr = g.createLinearGradient(0, y0 * my, 0, y1 * my); gr.addColorStop(0, new THREE.Color(c.glass).lerp(new THREE.Color("#dfe9f3"), 0.35).getStyle()); gr.addColorStop(1, c.glass);
      box(x0, y0, x1, y1, gr, 25, 0.75);
    };
    const glass = (x0, y0, x1, y1) => { box(x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06, c.frame, 150, 0.6); pane(x0, y0, x1, y1); };
    const done = amt => {
      /* the concrete's grain: small light and dark specks, more of them on the exposed aggregate */
      const img = g.getImageData(0, 0, W, H), px = img.data;
      let s = 1234567; const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
      for (let i = 0; i < W * H; i++) { if (depth[i] > 0.55) continue; const n = (rnd() - 0.5) * amt * (rnd() < 0.08 ? 2.2 : 1); px[i * 4] += n; px[i * 4 + 1] += n; px[i * 4 + 2] += n * 0.95; }
      g.putImageData(img, 0, 0);
      const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      if (!Q.relief) return { map: tex(pic, true), roughness: 0.9 };
      /* relief: the slope of the depth, as a tangent-space normal */
      const nc = document.createElement("canvas"); nc.width = W; nc.height = H; const nx = nc.getContext("2d"), ni = nx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const at = (i, j) => depth[((j + H) % H) * W + ((i + W) % W)], dx = (at(x + 1, y) - at(x - 1, y)) * 2, dy = (at(x, y - 1) - at(x, y + 1)) * 2, k = (y * W + x) * 4;
        const l = Math.hypot(dx, dy, 1); ni.data[k] = (dx / l * 0.5 + 0.5) * 255; ni.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; ni.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; ni.data[k + 3] = 255;
      }
      nx.putImageData(ni, 0, 0);
      return { map: tex(pic, true), roughnessMap: tex(gl), roughness: 1, normalMap: tex(nc), normalScale: new THREE.Vector2(1.2, 1.2), envMap, envMapIntensity: 0.7 };
    };
    return { box, pane, glass, done, g, mx, my };
  }
  function facade(kind) {
    const c = FACADE[kind], { box, glass, done, g, mx, my } = painter(2.5, 3.5, 102.4, c);
    box(0, 0, 2.5, 3.5, c.concrete, 235, 0);
    if (kind === "tower") {
      box(1.1, 0, 2.5, 3.5, c.reveal, 235, 1);                                       // the slot
      glass(1.22, 1.0, 1.78, 2.35); glass(1.9, 1.0, 2.43, 2.35);                     // the pair of windows
      box(0.55, 0, 0.565, 3.5, "rgba(60,58,62,.55)", null, 0.5);                     // the pier's joint
      box(0, 3.47, 1.1, 3.5, "rgba(60,58,62,.45)", null, 0.5);                       // the storey's joint
    } else {
      for (const x of [0, 1.25]) box(x, 0, x + 0.015, 3.5, "rgba(70,60,50,.55)", null, 0.5);   // panel joints
      box(0, 1.15, 2.5, 2.3, c.frame, 150, 0.6);                                     // the ribbon of windows
      for (const x of [0.06, 1.31]) {
        box(x, 1.21, x + 1.13, 2.24, c.blind, 120, 0.8);
        g.fillStyle = "rgba(0,0,0,.16)"; for (let y = 1.21 * my; y < 2.24 * my; y += 3) g.fillRect(x * mx, y, 1.13 * mx, 1);   // slats
      }
      box(0, 3.44, 2.5, 3.5, "rgba(0,0,0,.07)", null, null);                         // the sill's shadow line
    }
    return done(kind === "low" ? 26 : 16);
  }
  /* a facade the drawings show (tools/elevations.py): its own windows and doors, where the sheet has them, in a
     plastered wall from z0 to z1 (kote); the sheet gives no colours, so plaster and frames are kept quiet */
  FACADE.drawn = { concrete: "#e8e3d8", frame: "#4a463f", glass: "#4f5d66", door: "#6d675d" };
  function drawnFacade(f, z0, z1) {
    const L = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]), c = FACADE.drawn, y = z => z1 - z;
    const { box, pane, done } = painter(L, z1 - z0, Q.relief ? 28 : 14, c, false);
    box(0, 0, L, z1 - z0, c.concrete, 235, 0);
    for (const o of f.openings) {
      box(o.u[0], y(o.z[1]), o.u[1], y(o.z[0]), c.frame, 150, 0.6);                 // the frame, as drawn round the panes
      for (const [a, b, lo, hi] of o.panes) o.kind === "door" ? box(a, y(hi), b, y(lo), c.door, 160, 0.7) : pane(a, y(hi), b, y(lo));
      box(o.u[0] - 0.05, y(o.z[0]), o.u[1] + 0.05, y(o.z[0]) + 0.06, "rgba(0,0,0,.12)", null, null);   // the sill's shadow
    }
    return done(18);
  }
  /* a sky for the glass to mirror: light blue overhead, pale at the horizon, the ground's green-grey below */
  const envMap = Q.relief && (() => {
    const es = new THREE.Scene(), geo = new THREE.SphereGeometry(100, 32, 16), col = [];
    for (let i = 0; i < geo.attributes.position.count; i++) { const y = geo.attributes.position.getY(i) / 100; const c = y > 0 ? new THREE.Color("#eef2f4").lerp(new THREE.Color("#8fb4da"), Math.pow(y, 0.6)) : new THREE.Color("#9a9c8c"); col.push(c.r, c.g, c.b); }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    es.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(es, 0.02).texture; pm.dispose(); return t;
  })();
  /* the drawn facades painted after the first frame, one at a time when the page is idle (pm 21:41Z: painting every
     facade's windows, grain and relief held the load about a second at full speed); each wall shows plain plaster
     until its picture is ready */
  const later = []; let compiled = false;   // compiled: the first frame's shaders (below)
  const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 30));
  const paintNext = () => { const job = later.shift(); if (!job) return; try { job(); } catch (e) { console.warn("fasade:", e); } dirty = true; if (later.length) idle(paintNext); };
  const paintLater = job => { later.push(job); if (later.length === 1 && compiled) idle(paintNext); };
  const BAY = 2.5, STOREY = 3.5;
  const wallTex = { low: facade("low"), tower: facade("tower") };
  /* a building on the lot as blocks (tools/massing.py): flat roofs, and walls only where the roof steps down or the
     building ends, with the facade counted in bays and storeys from the base so the windows line up */
  /* a wall on the line of a drawn facade (within 1.6 m of it, so a stair tower standing out of it counts) wears
     that facade, stretched once along the line; the other walls the bays */
  function blocksMesh(b, tex) {
    const pos = [], uv = [], roof = [], b0 = b.base - 0.5, z1 = Math.max(b.top, ...(b.walls || []).map(w => w[5])) + 0.1;
    const faces = (site.facades || []).filter(f => f.building === (b.wing ?? b.id)).map(f => {
      const L = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]); return { f, L, d: [(f.to[0] - f.from[0]) / L, (f.to[1] - f.from[1]) / L], pos: [], uv: [] };
    });
    const onLine = (F, p) => { const dx = p[0] - F.f.from[0], dy = p[1] - F.f.from[1]; return [dx * F.d[0] + dy * F.d[1], Math.abs(dy * F.d[0] - dx * F.d[1])]; };
    for (const [ax, ay, bx, by, lo, top] of b.walls || []) {
      const bot = lo ?? b0, len = Math.hypot(bx - ax, by - ay), along = (ax * (bx - ax) + ay * (by - ay)) / len / BAY;   // bays counted along the wall's line, so the walls on one line share them
      const A = P([ax, ay], bot), B = P([bx, by], bot), Cc = P([bx, by], top), D = P([ax, ay], top);
      const F = faces.find(F => { const [ua, na] = onLine(F, [ax, ay]), [ub, nb] = onLine(F, [bx, by]); return Math.abs((bx - ax) * F.d[1] - (by - ay) * F.d[0]) / len < 0.05 && na < 1.6 && nb < 1.6 && Math.min(ua, ub) > -0.3 && Math.max(ua, ub) < F.L + 0.3; });
      const [P0, T0] = F ? [F.pos, F.uv] : [pos, uv];
      const [u0, u1, v0, v1] = F ? [onLine(F, [ax, ay])[0] / F.L, onLine(F, [bx, by])[0] / F.L, (bot - b0) / (z1 - b0), (top - b0) / (z1 - b0)] : [along, along + len / BAY, (bot - b.base) / STOREY, (top - b.base) / STOREY];
      P0.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z, A.x, A.y, A.z, Cc.x, Cc.y, Cc.z, D.x, D.y, D.z);
      T0.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
    for (const k of b.blocks) {
      const top = k.top, p = k.p;
      const q = p.map(pt => P(pt, top));
      roof.push(...[q[0], q[1], q[2], q[0], q[2], q[3]].flatMap(v => [v.x, v.y, v.z]));
    }
    const grp = new THREE.Group();
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); wg.computeVertexNormals();
    const walls = new THREE.Mesh(wg, mat("#ffffff", tex)); walls.castShadow = walls.receiveShadow = true; grp.add(walls);
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(roof, 3));
    rg.setAttribute("normal", new THREE.Float32BufferAttribute(roof.map((_, i) => i % 3 === 1 ? 1 : 0), 3));   // flat roofs face up
    const r = new THREE.Mesh(rg, mat(C.flatRoof)); r.castShadow = r.receiveShadow = true; grp.add(r);
    for (const F of faces) if (F.pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(F.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(F.uv, 2)); g.computeVertexNormals();
      const fm = mat(FACADE.drawn.concrete), m = new THREE.Mesh(g, fm); m.castShadow = m.receiveShadow = true; grp.add(m);
      paintLater(() => { const mm = m.material; Object.assign(mm, drawnFacade(F.f, b0, z1)); mm.color.set("#ffffff"); mm.needsUpdate = true; });   // m.material: the buildings' materials are cloned once made (below)
    }
    /* a volume held up on a frame (the operating module): its underside, the posts down to the ground, the braces */
    if (b.lift != null) {
      const s = b.blocks.flatMap(k => { const q = k.p.map(pt => P(pt, b.lift)); return [q[0], q[2], q[1], q[0], q[3], q[2]].flatMap(v => [v.x, v.y, v.z]); });
      const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(s, 3)); sg.setAttribute("normal", new THREE.Float32BufferAttribute(s.map((_, i) => i % 3 === 1 ? -1 : 0), 3));
      const steel = mat(C.steel), under = new THREE.Mesh(sg, mat(C.flatRoof)); under.castShadow = under.receiveShadow = true; grp.add(under);
      const bar = (p, q, w) => {   // a member of the frame from p to q, w thick
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, p.distanceTo(q), w), steel); m.position.copy(p).add(q).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()); m.castShadow = m.receiveShadow = true; grp.add(m);
      };
      for (const [x, y, w] of b.posts || []) bar(P([x, y], ground(x, y) - 0.2), P([x, y], b.lift), w);
      for (const [ax, ay, bx, by] of b.braces || []) { bar(P([ax, ay], ground(ax, ay)), P([bx, by], b.lift), 0.15); bar(P([bx, by], ground(bx, by)), P([ax, ay], b.lift), 0.15); }
    }
    return grp;
  }
  for (const b of site.buildings) {
    const grp = new THREE.Group(), b0 = b.base - 0.5, ring = b.ring;
    if (b.own && b.blocks?.length) grp.add(blocksMesh(b, b.top - b.base > 40 ? wallTex.tower : wallTex.low));
    else if (!b.own || b.top == null) {
      const top = b.top ?? b.base + (b.osmHeight || (b.levels || 2) * 3);
      grp.add(wallsTo(ring, b0, () => top, mat(b.own ? C.own : C.nb)));
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const lid = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(b.own ? C.roof : C.nbRoof)); lid.rotation.x = -Math.PI / 2; lid.position.y = top - base; lid.castShadow = lid.receiveShadow = true; grp.add(lid);
    } else {
      /* the roof: laser cells inside the outline and not under a part on it */
      const cells = new Map(), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), cut = b.cut || [];
      const c0 = Math.max(0, Math.floor((Math.min(...xs) - T.x0) / T.res)), c1 = Math.min(T.w - 1, Math.floor((Math.max(...xs) - T.x0) / T.res));
      const r0 = Math.max(0, Math.floor((T.y1 - Math.max(...ys)) / T.res)), r1 = Math.min(T.h - 1, Math.floor((T.y1 - Math.min(...ys)) / T.res));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const p = [T.x0 + (c + 0.5) * T.res, T.y1 - (r + 0.5) * T.res], z = T.surface[r * T.w + c];
        if (z == null || !inRing(p, ring) || cut.some(q => inRing(p, q))) continue;
        cells.set(r * T.w + c, Math.max(z, b.base + 2.2));
      }
      const roofAt = (p, nrm) => { for (const d of [1.2, 2.5, 4]) { const q = [p[0] - nrm[0] * d, p[1] - nrm[1] * d], c = Math.floor((q[0] - T.x0) / T.res), r = Math.floor((T.y1 - q[1]) / T.res), z = cells.get(r * T.w + c); if (z != null) return z; } return b.top; };
      if (cells.size) {
        grp.add(wallsTo(ring, b0, (p, nrm) => { const s = [1, -1].map(k => roofAt(p, [nrm[0] * k, nrm[1] * k])); return Math.min(...s.filter(v => v != null)) || b.top; }, mat(C.own)));
        const pos = [], corner = (k, dc, dr) => { const ks = [k, k + dc, k + dr * T.w, k + dc + dr * T.w].filter(q => cells.has(q)); return Math.max(...ks.map(q => cells.get(q))); };
        for (const [k, z] of cells) {
          const r = Math.floor(k / T.w), c = k % T.w, x0 = T.x0 + c * T.res, x1 = x0 + T.res, y0 = T.y1 - r * T.res, y1 = y0 - T.res;
          const h00 = corner(k, -1, -1), h10 = corner(k, 1, -1), h01 = corner(k, -1, 1), h11 = corner(k, 1, 1), flat = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11) > 2.5;
          const q = flat ? [z, z, z, z] : [h00, h10, h01, h11], v = [P([x0, y0], q[0]), P([x1, y0], q[1]), P([x0, y1], q[2]), P([x1, y1], q[3])];
          pos.push(...[v[0], v[2], v[1], v[1], v[2], v[3]].flatMap(p => [p.x, p.y, p.z]));
        }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
        const roof = new THREE.Mesh(g, mat(C.roof)); roof.castShadow = roof.receiveShadow = true; grp.add(roof);
      }
    }
    grp.userData.id = b.id; grp.traverse(o => { o.userData.id = b.id; }); scene.add(grp); meshes.set(b.id, grp);
  }
  /* ---------- the after: what a draft builds (design.js), each part a profile [across, kote] drawn along its axis,
     across to the left of the axis; glass seen through, as a greenhouse is ---------- */
  const ADDED = { glass: mat("#cfe6e2", { transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.1, depthWrite: false }), concrete: mat("#ddd8cc"),
    steel: mat(C.steel, { roughness: 0.5, metalness: 0.4 }), wood: mat("#b48a5a"), brick: mat("#a65b44") };
  /* drawn again in place when the after changes (setAdded, U3556): the old ones taken away and freed */
  const addedGroups = new Map();
  function setAdded(list) {
    for (const g of addedGroups.values()) { scene.remove(g); g.traverse(o => o.geometry?.dispose()); }
    addedGroups.clear();
    for (const a of list || []) drawAdded(a);
    if (selected && !meshes.has(selected) && !addedGroups.has(selected)) selected = null;
    dirty = true;
  }
  /* a construction's triangles by IFC class (U3570: what the worker made from its script, mesh.json), once per sha */
  const meshCache = new Map(), CLASS_MAT = { IfcMember: "steel", IfcAnnotation: "steel", IfcBeam: "steel", IfcColumn: "steel", IfcRailing: "steel", IfcPlate: "glass", IfcWindow: "glass", IfcCurtainWall: "glass", IfcSlab: "concrete", IfcWall: "concrete", IfcFooting: "concrete", IfcRoof: "concrete", IfcDoor: "wood", IfcCovering: "wood" };
  const meshOf = sha => { if (!meshCache.has(sha)) meshCache.set(sha, fetch(`api/bim/${sha}/mesh.json`).then(r => r.ok ? r.json() : null).catch(() => null)); return meshCache.get(sha); };
  function drawBim(a, grp) {
    /* till it comes: its box, faint, so it stands, is picked and has its handles */
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), a.height, a.width), ADDED.glass.clone());
    const c = P([(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], a.base_kote + a.height / 2); box.position.copy(c); box.rotation.y = Math.atan2(a.to[1] - a.from[1], a.to[0] - a.from[0]); grp.add(box);
    meshOf(a.bim.sha).then(m => {
      if (!m || addedGroups.get(a.id) !== grp) return;
      grp.remove(box); box.geometry.dispose();
      const at = bimPlace(a, a.base_kote);
      for (const p of m.parts) {
        const pos = new Float32Array(p.pos.length);
        for (let i = 0; i < p.pos.length; i += 3) { const q = at([p.pos[i], p.pos[i + 1], p.pos[i + 2]]), v = P(q, q[2]); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(p.idx); g.computeVertexNormals();
        const k = CLASS_MAT[p.cls] || "concrete", mesh = new THREE.Mesh(g, ADDED[k].clone()); mesh.material.side = THREE.DoubleSide;
        mesh.castShadow = k !== "glass"; mesh.receiveShadow = true; mesh.userData.id = a.id; grp.add(mesh);
      }
      dirty = true;
    });
  }
  function drawAdded(a) {
    const grp = new THREE.Group();
    if (a.shape === "bim" && a.bim) drawBim(a, grp);
    for (const p of a.shape === "bim" ? [] : a.parts) {
      if (p.tris) {   // a pyramid: its faces as they are (design.js)
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p.tris.flat().flatMap(q => { const v = P(q, q[2]); return [v.x, v.y, v.z]; }), 3)); g.computeVertexNormals();
        const m = (ADDED[p.mat] || ADDED.concrete).clone(); m.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(g, m); mesh.castShadow = p.mat !== "glass"; mesh.receiveShadow = true; grp.add(mesh);
        if (p.mat === "glass") grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: "#6f8f8a" })));
        continue;
      }
      const [[x0, y0], [x1, y1]] = p.axis, L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.01) continue;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(p.profile.map(([s, z]) => new THREE.Vector2(s, z - base))), { depth: L, bevelEnabled: false });
      /* the shape's x is across (to the left of the axis), y up, its depth along the axis: P maps east, north to x, -z */
      const d = new THREE.Vector3((x1 - x0) / L, 0, -(y1 - y0) / L), n = new THREE.Vector3(-(y1 - y0) / L, 0, -(x1 - x0) / L);
      const m4 = new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), d).setPosition(x0, 0, -y0);
      const mesh = new THREE.Mesh(g.applyMatrix4(m4), (ADDED[p.mat] || ADDED.concrete).clone());   // its own, to light up alone
      mesh.castShadow = p.mat !== "glass"; mesh.receiveShadow = true; grp.add(mesh);
      if (p.mat === "glass") grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: "#6f8f8a" })));
    }
    grp.userData.added = a.id; grp.userData.id = a.id; grp.traverse(o => { o.userData.id = a.id; }); scene.add(grp); addedGroups.set(a.id, grp);
  }
  for (const a of site.added || []) drawAdded(a);
  /* the after's ground (landscape.js): each surface and path laid on the terrain, its triangles cut down to the
     terrain's grid so it follows the slope, each later one a little higher than the one before (a bed in a lawn, a
     path across it) */
  const GROUND = { grass: "#a3c072", meadow: "#bcc47e", planting: "#6f8c4c", gravel: "#d3cab6", paving: "#bdb6aa", asphalt: "#66655f", water: "#7fa8c2", wood: "#a8825a" };
  const groundMat = Object.fromEntries(Object.entries(GROUND).map(([k, c]) => [k, mat(c, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...(k === "water" ? { roughness: 0.15, metalness: 0.1 } : {}) })]));
  /* drawn again in place when the after changes (setLandscape, 21:07Z «when i edit the whole page reloads»: a pool is a surface) */
  const groundMeshes = [];
  function setLandscape(list) {
    for (const m of groundMeshes.splice(0)) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    drawLandscape(list); if (rimFor) rimGround(true); dirty = true;
  }
  function drawLandscape(list) { for (const [n, g] of (list || []).entries()) {
    const ring = g.ring.slice(); if (ringArea2(ring) < 0) ring.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []), pos = [], lim = Math.max(1, T.res) * 1.4;
    const lift = 0.15 + 0.08 * n + (g.kind === "path" ? 0.08 : 0);
    const put = p => { const v = P(p, ground(...p) + lift); pos.push(v.x, v.y, v.z); };
    const split = (a, b, c, d) => {
      const e = [[a, b], [b, c], [c, a]].map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1])), m = Math.max(...e);
      if (m <= lim || d > 9) { put(a); put(b); put(c); return; }
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (m === e[0]) { const k = mid(a, b); split(a, k, c, d + 1); split(k, b, c, d + 1); }
      else if (m === e[1]) { const k = mid(b, c); split(a, b, k, d + 1); split(a, k, c, d + 1); }
      else { const k = mid(c, a); split(a, b, k, d + 1); split(k, b, c, d + 1); }
    };
    for (const [i, j, k] of tris) split(ring[i], ring[j], ring[k], 0);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    /* its own material, to light up alone when picked (U3569: a pool, a lawn or a path is picked like a building) */
    const m = new THREE.Mesh(geo, (groundMat[g.surface] || groundMat.grass).clone()); m.receiveShadow = true; m.userData.added = g.id; m.userData.id = g.id; m.userData.ring = ring; m.userData.lift = lift; scene.add(m); groundMeshes.push(m);
  } }
  drawLandscape(site.landscape);

  /* ---------- trees: where the laser found them (tools/trees.py), grown by EZ-Tree as in hagekart (renderkit/ez-tree.js, MIT;
     bark and leaf pictures CC0 / MIT, docs/tex-credits.txt). Three models are grown once, oak, aspen and pine, with
     fewer leaves and rounder branches than hagekart's (a few hundred trees here, not a garden's few; quality.js leaves), and every tree is one of them, scaled
     to its height and crown and turned. Anything that goes wrong leaves the site without trees. ---------- */
  const treeHash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  /* drawn again in place when the after plants or fells (setTrees): the models grown once, the instances anew */
  const treeMeshes = [];
  let grown = null, treeGen = 0;   // EZ-Tree's three models, grown on the first draw; which setTrees is the last
  let treeList = site.trees || [];   // the trees drawn last: the planted ones (a seventh item, their planting's id) are picked by their trunks
  function setTrees(list) {
    treeList = list || []; treeGen++; for (const m of treeMeshes.splice(0)) { scene.remove(m); m.dispose?.(); }
    drawTrees(list || []); ringTrees(treePicked, treeHov); dirty = true;
  }
  function drawTrees(trees) {
    if (!trees.length) return;
    if (!Q.ez) {
      /* on a slow device: a trunk and a crown of a few flat faces each, every tree in two draws */
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = trees.length;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6).translate(0, 0.5, 0), mat("#6b5a48"), n);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat("#7f9a5c", { flatShading: true, side: THREE.FrontSide }), n);
      trees.forEach(([x, y, h, r, form], i) => {
        const g0 = ground(x, y), cone = form === "cone", ch = cone ? h * 0.8 : Math.min(h * 0.7, r * 2.2);
        m4.compose(P([x, y], g0), q.identity(), new THREE.Vector3(1, h - ch * 0.6, 1)); trunk.setMatrixAt(i, m4);
        m4.compose(P([x, y], g0 + h - ch / 2), q.setFromAxisAngle(up, treeHash(y, x) * 6.28), new THREE.Vector3(cone ? r * 0.8 : r, ch / 2, cone ? r * 0.8 : r)); crown.setMatrixAt(i, m4);
      });
      for (const m of [trunk, crown]) { m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); treeMeshes.push(m); }
      return;
    }
    grown ??= growTrees();
    const gen = treeGen;   // a list drawn late, after a newer setTrees, is not added
    grown.then(models => {
      if (gen !== treeGen) return;
      const groups = { oak: [], aspen: [], pine: [] };
      for (const t of trees) groups[t[4] === "cone" ? "pine" : treeHash(t[0], t[1]) < 0.35 ? "aspen" : "oak"].push(t);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (const [kind, list] of Object.entries(groups)) {
        if (!list.length) continue;
        const { bg, lg, Ht, R, barkMat, leafMat, depthMat } = models[kind];
        const bm = new THREE.InstancedMesh(bg, barkMat, list.length), lm = new THREE.InstancedMesh(lg, leafMat, list.length); lm.customDepthMaterial = depthMat;
        list.forEach(([x, y, h, r], i) => {
          const sy = h / Ht, sxz = Math.min(1.4 * sy, Math.max(0.6 * sy, r / R));
          m4.compose(P([x, y], ground(x, y)), q.setFromAxisAngle(up, treeHash(y, x) * Math.PI * 2), new THREE.Vector3(sxz, sy, sxz));
          bm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
        });
        for (const m of [bm, lm]) { m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); treeMeshes.push(m); }
      }
      dirty = true;
    }).catch(e => console.warn("trees", e));
  }
  function growTrees() {
    const url = n => new URL(n, import.meta.url).href, load = n => new Promise(ok => new THREE.TextureLoader().load(url(n), ok, undefined, () => ok(null)));
    return Promise.all([import("./renderkit/ez-tree.js"), ...["ez-bark-oak.jpg", "ez-bark-birch.jpg", "ez-bark-pine.jpg", "ez-leaf-oak.png", "ez-leaf-aspen.png", "ez-leaf-pine.png"].map(n => load(`renderkit/${n}`))]).then(([EZ, ...tx]) => {
      for (const t of tx) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
      tx.slice(0, 3).forEach(t => { if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping; });
      const KIND = { oak: ["oak_medium", tx[0], tx[3]], aspen: ["aspen_medium", tx[1], tx[4]], pine: ["pine_medium", tx[2], tx[5]] }, models = {};
      for (const [kind, [preset, bark, leaf]] of Object.entries(KIND)) {
        const json = structuredClone(EZ.PRESETS[preset]); json.leaves.count = Math.max(4, Math.round(json.leaves.count * Q.leaves));
        for (const k in json.branch.segments) json.branch.segments[k] = Math.min(json.branch.segments[k], [5, 4, 3, 3][k]);       // rounder than needed from 30 m away:
        for (const k in json.branch.sections) json.branch.sections[k] = Math.max(1, Math.round(json.branch.sections[k] * 0.6));  // about 6 000 triangles a tree
        const tree = new EZ.Tree(); tree.loadFromJson(json);
        const bg = tree.branchesMesh.geometry, lg = tree.leavesMesh.geometry; bg.computeBoundingBox(); lg.computeBoundingBox();
        const Ht = Math.max(bg.boundingBox.max.y, lg.boundingBox.max.y), R = Math.max(-lg.boundingBox.min.x, lg.boundingBox.max.x, -lg.boundingBox.min.z, lg.boundingBox.max.z, 1);
        if (bark && json.bark?.textureScale) bark.repeat.set(json.bark.textureScale.x, 1 / json.bark.textureScale.y);
        models[kind] = { bg, lg, Ht, R, barkMat: new THREE.MeshStandardMaterial({ map: bark, color: json.bark?.tint ?? 0xffffff, roughness: 0.95 }),
          leafMat: new THREE.MeshStandardMaterial({ map: leaf, color: kind === "pine" ? "#c9d6c0" : "#d7e3c2", alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
          depthMat: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: 0.5 }) };
        tree.branchesMesh.material.dispose?.(); tree.leavesMesh.material.dispose?.();
      }
      return models;
    });
  }
  drawTrees(site.trees || []);

  /* ---------- storeys: each wing has its own (site.json wings[].levels, tools/wings.json), at its own kote. A
     building is cut 1.2 m above the floor of the storey chosen for it, as a plan is cut, with a floor plate there;
     the walls of a drawing of that storey (floors.json) stand in the buildings the drawing covers, and a building
     no drawing covers gets a hatched plate. ---------- */
  const wingOf = new Map((site.wings || []).map(w => [w.id, w]));
  const levelsOf = b => wingOf.get(b.wing)?.levels || [];
  /* a storey's kote where a wing has no kote for it: the middle of the wings that have one */
  const refKote = name => { const ks = (site.wings || []).flatMap(w => (w.levels || []).filter(l => l.name === name).map(l => l.kote)).sort((a, b) => a - b); return ks.length ? ks[ks.length >> 1] : floors.find(f => f.name === name)?.kote ?? null; };
  const own = site.buildings.filter(b => b.own), cuts = new Map(), plates = new Map(), pm = mat(C.plate);
  /* a building cut where no drawing of that storey stands: its plate hatched, as an unknown area on a drawing */
  const hatchTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    g.fillStyle = "#dcd8cf"; g.fillRect(0, 0, 64, 64); g.strokeStyle = "#9d978b"; g.lineWidth = 5;
    for (const o of [-64, 0, 64]) { g.beginPath(); g.moveTo(o, 64); g.lineTo(o + 64, 0); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.5, 0.5); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const pmNone = mat("#ffffff", { map: hatchTex });
  for (const b of own) {
    cuts.set(b.id, new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6));
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(b.ring.map(([x, y]) => new THREE.Vector2(x, y)))), pm);
    plate.rotation.x = -Math.PI / 2; plate.receiveShadow = true; plate.visible = false; scene.add(plate); plates.set(b.id, plate);
  }
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), floorGroups = new Map();
  for (const f of floors) {
    const grp = new THREE.Group(), wm = mat(C.cutWall, { clippingPlanes: [cut] });
    /* the walls made the first time the floor shows, not at load (pm 21:41Z: the load held the page still; every
       floor's walls were extruded though none shows until a storey is picked); what is torn down stays hidden */
    const fill = () => {
      if (grp.children.length || !f.walls.length) return;
      const rings = [...goneIds].map(id => site.buildings.find(b => b.id === id)?.ring).filter(Boolean);
      for (const r of f.walls) {
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y))), { depth: f.height, bevelEnabled: false });
        const w = new THREE.Mesh(g, wm); w.rotation.x = -Math.PI / 2; w.position.y = f.kote - base; w.castShadow = w.receiveShadow = true; w.userData.at = r[0];
        w.visible = !rings.some(q => inRing(r[0], q)); grp.add(w);
      }
    };
    /* the buildings it covers: those a tenth or more of its wall corners fall in */
    const pts = f.walls.flat(), covers = new Set(own.filter(b => pts.filter(p => inRing(p, b.ring)).length >= pts.length * 0.1).map(b => b.id));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    grp.userData = { fill, covers, centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
    grp.visible = false; scene.add(grp); floorGroups.set(f.id, grp);
  }
  /* cut one building at a kote (null: whole again) */
  function cutAt(b, kote) {
    const on = kote != null && kote > b.base && kote < (b.top ?? 0) && (b.lift == null || kote >= b.lift - 0.1);
    cuts.get(b.id).constant = on ? kote + 1.2 - base : 1e6;
    const p = plates.get(b.id); p.visible = on && !goneIds.has(b.id); if (on) p.position.y = kote - base - 0.02;
  }
  /* where a storey stands in a building: its wing's own kote, else where the wings that have it have it */
  const koteIn = (b, name) => levelsOf(b).find(l => l.name === name)?.kote ?? refKote(name);
  /* the rooms' stamps from the drawing, as on the sheet: name, and the area under it, left edge at the stamp.
     A stamp that would overlap one already placed gives way; larger rooms are placed first. */
  const tags = document.createElement("div"); tags.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;font:12px/1.15 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#23211e";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(tags);
  const tagsOf = f => (f.rooms || []).map(r => {
    const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;padding:1px 3px;border-radius:3px;background:#fbf9f4c4;text-shadow:0 0 2px #fffbf0";
    el.innerHTML = `<b style="font-weight:600">${r.name.replace(/</g, "&lt;")}</b>` + (r.area_m2 ? `<br>${r.area_m2.toLocaleString("nb-NO", { minimumFractionDigits: 1 })} m²`
      : r.area_calc ? `<br><span title="Målt mellom veggene på tegningen, ikke skrevet på den">ca. ${Math.round(r.area_calc)} m²</span>` : "");
    tags.appendChild(el); return { el, at: P(r.at, f.kote + 0.05), xy: r.at, area: r.area_m2 || r.area_calc || 0 };
  }).sort((a, b) => b.area - a.area);
  const stampKey = f => JSON.stringify((f.rooms || []).map(r => [r.name, r.area_m2, r.area_calc]));
  const roomTags = new Map(floors.map(f => { const l = tagsOf(f); l.key = stampKey(f); return [f.id, l]; }));
  /* a room renamed or its area set (an edit of kind room): its floor's stamps made again in place */
  function setRooms(fs) {
    for (const f of fs || []) { const was = roomTags.get(f.id); if (!was) continue; const now = stampKey(f);
      if (was.key === now) continue; for (const t of was) t.el.remove(); const list = tagsOf(f); list.key = now; roomTags.set(f.id, list); }
    dirty = true;
  }
  /* the wings' names over their roofs (site.json wings, tools/wings.py), while the whole site is shown */
  const wingTags = site.buildings.filter(b => b.own && b.name).map(b => {
    const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;font-size:14px;font-weight:600;padding:2px 7px;border-radius:6px;background:#fbf9f4e6;border:1px solid #d8d2c6";
    el.textContent = b.name.replace(/ \(.*\)$/, ""); tags.appendChild(el);
    const c = b.ring.slice(0, -1).reduce((a, p, _, r) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
    return { el, id: b.id, at: P(c, (b.top ?? b.base + 10) + 2), area: b.area_m2 || 0 };
  }).sort((a, b) => b.area - a.area);
  const v3 = new THREE.Vector3();
  let names = true;   // the wings' and rooms' names over the picture; the page can take them away (a section's kote stay)
  function placeTags() {
    if (!names) { for (const t of [...wingTags, ...[...roomTags.values()].flat()]) t.el.style.display = "none"; }
    const w = container.clientWidth, h = container.clientHeight, close = mode === "plan" ? view().mPerPx < 0.09 : O.dist < 150, placed = [];
    for (const t of wingTags) if (goneIds.has(t.id)) t.el.style.display = "none";
    for (const t of names ? wingTags : []) {
      if ((storey && !only) || mode === "section" || goneIds.has(t.id)) { t.el.style.display = "none"; continue; }
      v3.copy(t.at).project(camera);
      const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h;
      if (v3.z > 1 || x < -100 || y < -30 || x > w + 100 || y > h + 30) { t.el.style.display = "none"; continue; }
      t.el.style.display = "block"; t.size ??= [t.el.offsetWidth, t.el.offsetHeight];
      const box = [x - t.size[0] / 2 - 3, y - t.size[1] - 3, x + t.size[0] / 2 + 3, y + 3];
      if (placed.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) { t.el.style.display = "none"; continue; }
      const left = Math.max(4, Math.min(w - t.size[0] - 4, x - t.size[0] / 2));   // a name near the edge stays whole
      placed.push(box); t.el.style.transform = `translate(${left.toFixed(0)}px, ${(y - t.size[1]).toFixed(0)}px)`;
    }
    for (const t of secTags) {
      v3.copy(t.at).project(camera); const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h;
      t.el.style.display = y < 0 || y > h ? "none" : "block"; t.el.style.transform = `translate(${Math.min(x, w - t.el.offsetWidth - 4).toFixed(0)}px, ${(y - 16).toFixed(0)}px)`;
    }
    for (const [id, list] of names ? roomTags : []) for (const t of list) {
      if (!shownFloors.has(id) || !close || t.gone) { t.el.style.display = "none"; continue; }
      v3.copy(t.at).project(camera);
      const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h;
      if (v3.z > 1 || x < -100 || y < -30 || x > w + 10 || y > h + 30) { t.el.style.display = "none"; continue; }
      t.el.style.display = "block"; t.size ??= [t.el.offsetWidth, t.el.offsetHeight];
      const box = [x - 2, y - 14 - 2, x + t.size[0] + 2, y - 14 + t.size[1] + 2];
      if (placed.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) { t.el.style.display = "none"; continue; }
      placed.push(box); t.el.style.transform = `translate(${x.toFixed(0)}px, ${(y - 14).toFixed(0)}px)`;
    }
  }
  /* the storey shown: in every building (setStorey) or in one (cutBuilding); floor: the drawing whose rooms are named */
  let floor = null, storey = null, only = null; const shownFloors = new Set();   // every sheet of the storey shown names its rooms
  let shownIds = new Set();
  function show(name, ids) {
    storey = name; floor = null; shownIds = ids;
    let drawn = null; const covered = new Map(); shownFloors.clear();   // covered: building id, the kote its sheet stands at
    for (const f of floors) {
      const g = floorGroups.get(f.id), on = !!name && f.name === name && [...g.userData.covers].some(id => ids.has(id));
      if (on) g.userData.fill(); g.visible = on; if (on) { drawn ??= f; cut.constant = f.kote + 1.2 - base; shownFloors.add(f.id); for (const id of g.userData.covers) if (!covered.has(id)) covered.set(id, f.kote); }
    }
    /* a building is cut where its sheet stands, else at its wing's kote for the storey */
    for (const b of own) cutAt(b, name && ids.has(b.id) ? covered.get(b.id) ?? koteIn(b, name) : null);
    for (const b of own) plates.get(b.id).material = covered.has(b.id) ? pm : pmNone;
    floor = drawn?.id ?? null; dirty = true;
    return drawn;
  }
  function setStorey(name) {
    if (section) setMode("3d");
    only = null; const drawn = show(name, new Set(own.map(b => b.id)));
    if (!name) return;
    /* the view goes to the drawing; a storey with no drawing to the buildings it cuts */
    const k = drawn?.kote ?? refKote(name), g = drawn && floorGroups.get(drawn.id).userData;
    const ring = drawn ? null : own.filter(b => { const z = koteIn(b, name); return z != null && z > b.base && z < (b.top ?? 0); }).flatMap(b => b.ring);
    const c = g ? g.centre : ring.length ? [(Math.min(...ring.map(p => p[0])) + Math.max(...ring.map(p => p[0]))) / 2, (Math.min(...ring.map(p => p[1])) + Math.max(...ring.map(p => p[1]))) / 2] : [O.x, O.y];
    const s = g ? g.size : ring.length ? Math.max(Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1]))) : 100;
    glide({ x: c[0], y: c[1], h: k - base, dist: Math.max(70, s * 1.3) });
  }
  /* one building cut at one of its storeys, the rest whole; the view stays where it is */
  function cutBuilding(id, name) {
    if (section) setMode("3d");
    const b = own.find(x => x.id === id); only = name ? id : null;
    show(name, new Set(name ? own.filter(x => x.id === id || (b?.wing && x.wing === b.wing)).map(x => x.id) : []));
  }
  /* a storey's kote set in a wing (an edit of kind level): its levels taken over, the storey shown cut anew there */
  function setLevels(ws) {
    for (const w of ws || []) { const o = wingOf.get(w.id); if (o && JSON.stringify(o.levels || []) !== JSON.stringify(w.levels || [])) o.levels = structuredClone(w.levels || []); }
    if (storey) show(storey, shownIds); dirty = true;
  }
  /* floors.json ids, as before: the drawing's storey in every building */
  function setFloor(id) { setStorey(floors.find(f => f.id === id)?.name ?? null); }

  /* ---------- camera: orbit around a point, or straight down for the plan ---------- */
  const lotC = site.lot.ring.reduce((a, p) => [a[0] + p[0] / site.lot.ring.length, a[1] + p[1] / site.lot.ring.length], [0, 0]);
  const O = { x: lotC[0], y: lotC[1], h: ground(...lotC) - base + 15, yaw: 0, pitch: 0.62, dist: 380, eye: false };   // from the south, north up, as a drawing is read
  /* U3527: a person's eye (eye): the camera stands on the ground dist metres from the centre, toward yaw, EYE_M over the
     ground there, and looks at the centre through a wider lens; turning walks round it, the wheel walks to and from it */
  const EYE_M = 1.7, FOV = 40, FOV_EYE = 55;
  function place() {
    const t = new THREE.Vector3(O.x, O.h, -O.y), cp = Math.cos(O.pitch);
    if (mode === "section") {
      /* a section reads as a drawing too: looking square at the cut, no perspective, kote up */
      const w = container.clientWidth || 600, h = container.clientHeight || 400, half = O.dist * 0.36, n = section.n;
      Object.assign(ortho, { left: -half * w / h, right: half * w / h, top: half, bottom: -half }); ortho.updateProjectionMatrix();
      ortho.position.set(t.x - n[0] * 1500, t.y, t.z + n[1] * 1500); ortho.up.set(0, 1, 0); ortho.lookAt(t);
    } else if (mode === "plan") {
      const w = container.clientWidth || 600, h = container.clientHeight || 400, half = O.dist * 0.36;
      Object.assign(ortho, { left: -half * w / h, right: half * w / h, top: half, bottom: -half }); ortho.updateProjectionMatrix();
      ortho.position.set(t.x, 1500, t.z); ortho.up.set(0, 0, -1); ortho.lookAt(t.x, 0, t.z);
    } else {
      /* never under the ground: the centre at least 1 m over the terrain under it, the eye at least 3 m over the
         terrain under it (raised by tilting down, as a person would) */
      /* and the centre on the terrain: past its edge there is no ground to stand on (pm 23:17Z: wheel ticks took the view
         off the map, under the terrain's edge) */
      const mx = Math.min(60, T.w * T.res / 4), my = Math.min(60, T.h * T.res / 4);
      O.x = Math.max(T.x0 + mx, Math.min(T.x0 + T.w * T.res - mx, O.x)); O.y = Math.max(T.y1 - T.h * T.res + my, Math.min(T.y1 - my, O.y));
      t.x = O.x; t.z = -O.y;
      const tg = ground(O.x, O.y) - base + 1; if (O.h < tg) { O.h = tg; t.y = tg; }
      const fov = O.eye ? FOV_EYE : FOV; if (persp.fov !== fov) { persp.fov = fov; persp.updateProjectionMatrix(); }
      if (O.eye) {
        const ex = t.x + O.dist * Math.sin(O.yaw), ez = t.z + O.dist * Math.cos(O.yaw);
        camera.position.set(ex, ground(ex, -ez) - base + EYE_M, ez); camera.lookAt(t);
        if (rimFor) rimGround();
        dirty = true; onView(view()); return;
      }
      let cp = Math.cos(O.pitch), ex = t.x + O.dist * cp * Math.sin(O.yaw), ez = t.z + O.dist * cp * Math.cos(O.yaw);
      const eg = ground(ex, -ez) - base + 3;
      if (t.y + O.dist * Math.sin(O.pitch) < eg) {
        O.pitch = Math.min(1.53, Math.asin(Math.min(1, (eg - t.y) / O.dist)));
        cp = Math.cos(O.pitch); ex = t.x + O.dist * cp * Math.sin(O.yaw); ez = t.z + O.dist * cp * Math.cos(O.yaw);
      }
      camera.position.set(ex, t.y + O.dist * Math.sin(O.pitch), ez); camera.lookAt(t);
    }
    if (rimFor) rimGround();
    dirty = true; onView(view());
  }
  /* where the ray under the pointer meets the terrain (site x, y and world height), walking out along it */
  function groundUnder(cx, cy) {
    const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    /* a building in front of the ground: toward its face, so the zoom stops 30 m short of it, not inside it */
    const b = ray.intersectObjects([...meshes.values(), ...addedGroups.values()].filter(g => g.visible), true).find(x => x.object.isMesh && shown(x.object));
    if (b) return [b.point.x, -b.point.z, b.point.y];
    for (let s = 0; s < 2500; s += 2) { const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s; if (y <= ground(x, -z) - base) return [x, -z, y]; }
    return null;
  }
  /* a move of the view (a storey, a building, home) eases there from where the view is, at the speed it has: renderkit's
     camera rig (camera.js, as laser's), on this orbit's own numbers (centre, yaw, pitch, log distance). The person's
     hand (a drag, a wheel, a pinch, the zoom buttons) stops it at once; reduced motion goes there at once. */
  const motionLow = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const stateOf = o => [o.x, o.y, o.h, o.yaw, o.pitch, Math.log(o.dist)];
  const putState = v => { Object.assign(O, { x: v[0], y: v[1], h: v[2], yaw: v[3], pitch: Math.max(0.08, Math.min(1.53, v[4])), dist: Math.max(30, Math.min(1200, Math.exp(v[5]))) }); place(); };
  let moving = null, going = null;                                   // the move in flight, and where it goes
  function glide(to, ms = 900) {
    const end = stateOf({ ...O, ...to }); going = end;
    moving = ease(O, { from: stateOf(O), to: end, ms, now: () => performance.now(), raf: f => requestAnimationFrame(f), put: putState,
      low: !!motionLow?.matches, onStop: () => { if (going === end) going = null; } });
  }
  function hand() { moving?.user(); moving = null; }
  /* a picture taken during a move is the one the move goes to */
  function land() { const g = going; if (g) { hand(); putState(g); } }
  /* what the page shows around the picture: the north arrow's turn, and in the plan the metres per screen pixel */
  function view() { return { mode, eye: mode === "3d" && O.eye, floor, storey, only, section: section && { wing: section.wing, kind: section.kind }, north: mode === "plan" ? 0 : O.yaw, mPerPx: mode !== "3d" ? O.dist * 0.72 / (container.clientHeight || 400) : null }; }
  /* the plan reads as a drawing: even light, no cast shadows */
  function setMode(m) {
    if (section && m !== "section") endSection();
    mode = m === "plan" ? "plan" : m === "section" && section ? "section" : "3d"; camera = mode === "3d" ? persp : ortho;
    grid.visible = mode === "plan";
    sunL.castShadow = mode === "3d"; sky.intensity = mode === "3d" ? 2.2 : 2.8; place();
  }
  /* ---------- a section through one wing: across it (tverr) or along it (lengde), through its middle. Everything
     in front of the cut is taken away (the terrain too), every drawn storey's walls stand, and the wing's storeys are
     marked with their kote on the right, as on a drawn section. ---------- */
  let section = null, poche = null; const secPlane = new THREE.Plane(), backPlane = new THREE.Plane(), secTags = [];
  const pocheMat = new THREE.MeshBasicMaterial({ color: 0x2b2824, side: THREE.DoubleSide });
  /* what the cut goes through, filled as on a drawn section: outer walls (0,35 m, assumed), the floor slabs at the
     wing's storeys (0,3 m) and the roof, and the drawn inner walls of every floor sheet (0,15 m) */
  function pocheOf(c, n, u, lo, hi, groundOnly = false) {
    const pos = [], off = 0.03, at = (t, z) => { const v = P([c[0] + u[0] * t + n[0] * off, c[1] + u[1] * t + n[1] * off], z); pos.push(v.x, v.y, v.z); };
    const rect = (t0, t1, z0, z1) => { at(t0, z0); at(t1, z0); at(t1, z1); at(t0, z0); at(t1, z1); at(t0, z1); };
    const cross = ring => {   // where the cut line crosses a ring: positions along u, sorted
      const ts = [];
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i], b = ring[i + 1], sa = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1], sb = (b[0] - c[0]) * n[0] + (b[1] - c[1]) * n[1];
        if ((sa < 0) === (sb < 0)) continue;
        const k = sa / (sa - sb), x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
        ts.push((x - c[0]) * u[0] + (y - c[1]) * u[1]);
      }
      return ts.sort((a, b) => a - b);
    };
    for (const b of groundOnly ? [] : own) {
      const ts = cross(b.ring); if (ts.length < 2) continue;
      const top = b.top ?? b.base + 10, w = (site.wings || []).find(x => x.id === b.wing);
      const slabs = (w?.levels || []).map(l => l.kote).filter(k => k > b.base - 6 && k < top - 1);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const [t0, t1] = [ts[i], ts[i + 1]];
        rect(t0, t0 + 0.35, b.base - 0.5, top); rect(t1 - 0.35, t1, b.base - 0.5, top);
        rect(t0, t1, top - 0.4, top);
        for (const k of slabs) rect(t0, t1, k - 0.3, k);
      }
    }
    for (const f of groundOnly ? [] : floors) for (const line of f.walls || []) for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], sa = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1], sb = (b[0] - c[0]) * n[0] + (b[1] - c[1]) * n[1];
      if ((sa < 0) === (sb < 0)) continue;
      const k = sa / (sa - sb), x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
      if (!own.some(o => inRing([x, y], o.ring))) continue;
      const t = (x - c[0]) * u[0] + (y - c[1]) * u[1];
      rect(t - 0.075, t + 0.075, f.kote, f.kote + (f.height || 3));
    }
    /* the ground along the cut, as a heavy line */
    for (let t = lo - 40; t < hi + 40; t += 1) {
      const z = [t, t + 1].map(q => ground(c[0] + u[0] * q, c[1] + u[1] * q));
      if (z.some(v => v == null)) continue;
      at(t, z[0] - 0.35); at(t + 1, z[1] - 0.35); at(t + 1, z[1]); at(t, z[0] - 0.35); at(t + 1, z[1]); at(t, z[0]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Mesh(g, pocheMat);
  }
  /* kind: tverr, lengde, or fasade (an elevation: looking the way `looking` says at the wing's outside, with what
     stands in front of it taken away and nothing filled). left: px the page covers on the left (the wing card);
     through: a site point the cut goes through, else the wing's middle; looking: [x, y], the way the drawing looks */
  function setSection(wing, kind = "tverr", left = null, through = null, looking = null) {
    const bs = own.filter(b => b.wing === wing); if (!bs.length) return null;
    const main = bs.reduce((a, b) => (b.area_m2 || 0) > (a.area_m2 || 0) ? b : a), r = main.ring;
    let d = [1, 0], L = 0;   // the wing's long direction: its outline's longest side
    for (let i = 0; i + 1 < r.length; i++) { const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1], l = Math.hypot(dx, dy); if (l > L) { L = l; d = [dx / l, dy / l]; } }
    const pts = bs.flatMap(b => b.ring); let c = through || [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    let n = kind === "lengde" ? [-d[1], d[0]] : kind === "fasade" ? looking : d;
    if (kind === "fasade") { const near = Math.min(...pts.map(p => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1])) - 0.6; c = [c[0] + n[0] * near, c[1] + n[1] * near]; }   // just outside the facade
    else if (looking && n[0] * looking[0] + n[1] * looking[1] < 0) n = [-n[0], -n[1]];   // as the sheet: what is on its right is on the screen's right
    const u = [-n[1], n[0]];   // n: the plane's normal (towards what stays), u: along the cut
    const along = pts.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]), lo = Math.min(...along), hi = Math.max(...along);
    const lv = ((site.wings || []).find(x => x.id === wing)?.levels || []).map(l => l.kote);
    const z0 = Math.min(...bs.map(b => b.base), ...lv) - 2, z1 = Math.max(...bs.map(b => b.top ?? b.base + 10));
    setStorey(null); hand();
    section = { wing, kind, n, u, through };
    /* world: x east, y up, z south; the kept side is where n points */
    /* what stays: from the cut to the far side of the wing, so the drawing is the wing, not the town behind it */
    const depth = Math.max(...pts.map(p => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1])) + 1;
    secPlane.normal.set(n[0], 0, -n[1]); secPlane.constant = -(n[0] * c[0] + n[1] * c[1]);
    backPlane.normal.set(-n[0], 0, n[1]); backPlane.constant = n[0] * c[0] + n[1] * c[1] + depth;
    renderer.clippingPlanes = [secPlane, backPlane];
    if (poche) { scene.remove(poche); poche.geometry.dispose(); }
    poche = pocheOf(c, n, u, lo, hi, kind === "fasade"); scene.add(poche);   // an elevation has the ground line only
    cut.constant = 1e6; for (const g of floorGroups.values()) { if (kind !== "fasade") g.userData.fill(); g.visible = kind !== "fasade"; }

    /* the frame holds the wing's width and height with room round it (the ortho frame is 0,72 × dist high) */
    const W = container.clientWidth || 600, H = container.clientHeight || 400, card = left ?? (W > 900 ? 440 : 0), labels = 190;   // the wing card on the left, the kote labels on the right
    const dist = Math.max(40, (hi - lo + 16) / ((W - card - labels) / H), (z1 - z0 + 8) / ((H - 240) / H)) / 0.72, m = dist * 0.72 / H;   // 240 px: the cards above, the bar below
    /* screen right is −u: the middle of the free part is card/2 px right of the screen's middle */
    const mid = c.map((v, i) => v + u[i] * ((lo + hi) / 2 + (card - labels) / 2 * m));
    Object.assign(O, { x: mid[0], y: mid[1], h: (z0 + z1) / 2 - base + 30 * m, dist });
    for (const t of secTags.splice(0)) t.el.remove();
    const w = (site.wings || []).find(x => x.id === wing), at = c.map((v, i) => v + u[i] * (lo - 1.5));   // right of the drawing
    for (const l of w?.levels || []) {
      const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;font-size:12px;border-bottom:1px solid #23211e;padding:0 2px 1px 18px;background:linear-gradient(90deg,transparent 0 14px,#fbf9f4d9 14px)";
      el.textContent = `${l.name.replace(" etasje", " etg.")} ${(l.kote >= 0 ? "+" : "") + l.kote.toFixed(2).replace(".", ",")}${l.how && l.how !== "tegning" ? " (" + l.how + ")" : ""}`;
      tags.appendChild(el); secTags.push({ el, at: P(at, l.kote) });
    }
    mode = "section"; camera = ortho; sunL.castShadow = false; sky.intensity = 2.8; place();
    return { wing, kind };
  }
  function endSection() {
    section = null; renderer.clippingPlanes = []; if (poche) { scene.remove(poche); poche.geometry.dispose(); poche = null; } for (const t of secTags.splice(0)) t.el.remove();
    for (const g of floorGroups.values()) g.visible = false; show(storey, new Set(own.map(b => b.id)));
  }
  const el = renderer.domElement, pts = new Map();
  let drag = null, dirty = true;
  el.addEventListener("pointerdown", e => { hand(); el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, pinch: pts.size === 2 ? pinchOf() : null }; });
  el.addEventListener("pointermove", e => {
    if (!drag || !pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const p = pinchOf(); if (drag.pinch) { O.dist = Math.max(30, Math.min(1200, O.dist * drag.pinch.d / p.d)); pan(p.x - drag.pinch.x, p.y - drag.pinch.y); } drag.pinch = p; drag.moved += 10; place(); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan || mode !== "3d") pan(dx, dy); else { O.yaw -= dx * 0.006; O.pitch = Math.max(0.08, Math.min(1.53, O.pitch + dy * 0.005)); }
    place();
  });
  const up = e => { pts.delete(e.pointerId); if (drag && drag.moved < 6 && !pts.size) pick(e); if (!pts.size) drag = null; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("contextmenu", e => e.preventDefault());
  /* a trackpad as in Maps: two fingers move the view the way the fingers go, a pinch zooms. Chrome and Firefox send
     the pinch as a wheel with ctrlKey, Safari as gesture events (and no wheel). A wheel in lines or pages is a mouse
     and zooms; a mouse on a Mac sends pixels like a trackpad, so it moves the view, and the + and - buttons zoom. */
  let gesture = null;
  el.addEventListener("wheel", e => {
    e.preventDefault(); hand();
    if (gesture) return;
    if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.01), e);
    else if (e.deltaMode !== 0) zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.6)), e);
    /* a notched wheel in Chrome and Safari says pixels too, but in whole notches of 120 and straight up or down */
    else if (!e.deltaX && e.wheelDeltaY && e.wheelDeltaY % 120 === 0) zoom(Math.exp(-Math.sign(e.wheelDeltaY) * 0.18), e);
    else { pan(-e.deltaX, -e.deltaY); place(); }
  }, { passive: false });
  /* on an iPad the same gesture events come with the touches, which the pointer handlers already zoom */
  el.addEventListener("gesturestart", e => { e.preventDefault(); hand(); gesture = pts.size ? null : { dist: O.dist }; });
  el.addEventListener("gesturechange", e => { e.preventDefault(); if (gesture) zoom(gesture.dist / (e.scale || 1) / O.dist, e); });
  el.addEventListener("gestureend", e => { e.preventDefault(); gesture = null; });
  /* zoom by a factor on the distance; in the plan the ground under the pointer stays put */
  function zoom(f, at) {
    const d = Math.max(30, Math.min(1200, O.dist * f)); f = d / O.dist;
    if (mode === "plan" && at && at.clientX != null) {
      const r = el.getBoundingClientRect(), m = O.dist * 0.72 / (r.height || 400);
      O.x += (at.clientX - r.left - r.width / 2) * m * (1 - f); O.y -= (at.clientY - r.top - r.height / 2) * m * (1 - f);
    } else if (mode === "3d" && at && at.clientX != null) {
      /* toward the ground under the pointer: the centre moves that way by as much as the distance shrinks */
      const g = groundUnder(at.clientX, at.clientY);
      if (g) { O.x += (g[0] - O.x) * (1 - f); O.y += (g[1] - O.y) * (1 - f); O.h += (g[2] - O.h) * (1 - f); }
    }
    O.dist = d; place();
  }
  function pinchOf() { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }; }
  /* drag the ground under the pointer: screen right is (cos yaw, sin yaw) east/north, screen up (away from the
     camera) is (-sin yaw, cos yaw); the centre moves against the pointer, so the ground goes with it */
  function pan(dx, dy) {
    if (mode === "section") { const k = O.dist * 0.72 / (container.clientHeight || 400); O.x += dx * k * section.u[0]; O.y += dx * k * section.u[1]; O.h += dy * k; return; }
    const k = mode === "plan" ? O.dist * 0.72 / (container.clientHeight || 400) : O.dist * 0.0016, yaw = mode === "plan" ? 0 : O.yaw, s = Math.sin(yaw), c = Math.cos(yaw); O.x += (-dx * c - dy * s) * k; O.y += (-dx * s + dy * c) * k; }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(); let selected = null;
  function pick(e) {
    const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...[...meshes.values()].filter(g => g.visible), ...addedGroups.values(), ...groundMeshes], true).find(h => h.object.isMesh); select(hit?.object.userData.id || null);
    onPick(selected, { shift: e.shiftKey, x: e.clientX, y: e.clientY, at: hit ? [hit.point.x, -hit.point.z, hit.point.y + base] : null });   // where on it, for a room or a facade
  }
  /* a hit's thing: its id, or its parent's (pm 23:17Z: the first click on the pool took nothing), and only if it shows */
  const idOf = o => { for (; o; o = o.parent) if (o.userData?.id) return o.userData.id; return null; };
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  /* more than one building lit, for a selection of several (app.js «Valgt») */
  let marked = [];
  const groupOf = id => meshes.get(id) || addedGroups.get(id) || groundMeshes.find(m => m.userData.id === id);
  /* a planting picked or under the pointer: a ring on the ground round each of its trees (they share their materials) */
  const treeRings = new THREE.Group(); scene.add(treeRings);
  function ringTrees(picked, hov) {
    for (const o of treeRings.children) o.geometry.dispose(); treeRings.clear();
    for (const [ids, color] of [[hov, "#fff6d6"], [picked, "#ffcf33"]]) for (const t of treeList) if (t[6] && ids.includes(t[6])) {
      const g0 = ground(t[0], t[1]) + 0.3, pts = []; for (let k = 0; k <= 32; k++) { const a = k / 32 * Math.PI * 2; pts.push(P([t[0] + Math.cos(a) * t[3], t[1] + Math.sin(a) * t[3]], g0)); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })); l.renderOrder = 15; treeRings.add(l);
    }
    dirty = true;
  }
  let treePicked = [], treeHov = [];
  /* a picked or hovered pool, lawn or path: a band round its edge over everything (pm 23:17Z: the glow alone is faint
     at site zoom), as wide as about 3 px at the distance the view has, drawn again when the zoom changes much */
  const groundRims = new THREE.Group(); scene.add(groundRims); let rimFor = null;
  function rimGround(force) {
    const picked = [...marked, selected].filter(id => /^(flate|sti)-/.test(id || "")), hov = hovered.filter(id => /^(flate|sti)-/.test(id));
    const key = picked.join() + "|" + hov.join(), w = Math.max(0.25, O.dist * 0.0035);
    if (!force && rimFor && rimFor.key === key && Math.abs(Math.log(rimFor.w / w)) < 0.25) return;
    rimFor = { key, w };
    for (const o of groundRims.children) { o.geometry.dispose(); o.material.dispose(); } groundRims.clear();
    for (const [ids, color] of [[hov, "#fff6d6"], [picked, "#ffcf33"]]) for (const id of ids) {
      const m = groundMeshes.find(x => x.userData.id === id); if (!m) continue;
      const r = m.userData.ring, pos = [], step = Math.max(1, T.res);
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
        const nx = -(b[1] - a[1]) / L * w / 2, ny = (b[0] - a[0]) / L * w / 2, k = Math.max(1, Math.ceil(L / step));
        for (let j = 0; j < k; j++) {
          const p = [a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k], q = [a[0] + (b[0] - a[0]) * (j + 1) / k, a[1] + (b[1] - a[1]) * (j + 1) / k];
          const at = (u, s) => { const v = P([u[0] + nx * s, u[1] + ny * s], ground(...u) + m.userData.lift + 0.1); pos.push(v.x, v.y, v.z); };
          at(p, -1); at(q, -1); at(q, 1); at(p, -1); at(q, 1); at(p, 1);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, side: THREE.DoubleSide })); o.renderOrder = 15; groundRims.add(o);
    }
    dirty = true;
  }
  function mark(ids) {
    treePicked = ids.filter(id => /^tre-/.test(id)); ringTrees(treePicked, treeHov);
    for (const id of marked) if (id !== selected) groupOf(id)?.traverse(o => o.material?.emissive?.set("#000"));
    marked = ids.filter(id => groupOf(id)); for (const id of marked) groupOf(id).traverse(o => o.material?.emissive?.set("#6b5200")); rimGround(); dirty = true;
  }
  /* the pick before the click (U3569, renderkit select.js): a lighter glow on what a click would take */
  let hovered = [];
  function hover(ids) {
    const th = ids.filter(id => /^tre-/.test(id)); if (th.join() !== treeHov.join()) { treeHov = th; ringTrees(treePicked, treeHov); }
    const lit = new Set([...marked, selected].filter(Boolean));
    for (const id of hovered) if (!lit.has(id)) groupOf(id)?.traverse(o => o.material?.emissive?.set("#000"));
    hovered = ids.filter(id => groupOf(id) && !lit.has(id)); for (const id of hovered) groupOf(id).traverse(o => o.material?.emissive?.set("#3d3420")); rimGround(); dirty = true;
  }
  function select(id) {
    if (selected) groupOf(selected)?.traverse(o => o.material?.emissive?.set("#000"));
    selected = id && groupOf(id) ? id : null;
    if (selected) groupOf(selected).traverse(o => o.material?.emissive?.set("#6b5200"));
    rimGround(); dirty = true;
  }
  /* materials are shared within a building, so a building's own copies (made once) light up alone */
  for (const g of meshes.values()) g.traverse(o => { if (o.material) o.material = o.material.clone(); });
  for (const b of own) meshes.get(b.id)?.traverse(o => { if (o.material) o.material.clippingPlanes = [cuts.get(b.id)]; });

  /* ---------- sun ---------- */
  function setSun(date) {
    const s = sunPosition(date, lat, lon), az = s.azimuth * Math.PI / 180, el = Math.max(s.elevation, 1) * Math.PI / 180, d = 700;
    sunL.position.set(O.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), -O.y - d * Math.cos(el) * Math.cos(az)); sunL.target.position.set(O.x, 0, -O.y);
    sunL.intensity = s.elevation > 0 ? 2.2 : 0.15; dirty = true; return s;
  }

  /* ---------- drawing ---------- */
  function size() { const w = container.clientWidth || 600, h = container.clientHeight || 400; renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix(); place(); }
  new ResizeObserver(size).observe(container); size(); place();
  /* what the after has torn down (U3542, Morten 21:15: in place, no reload): hidden, with the plans' walls and the
     rooms' names inside it, and not picked; the camera, the terrain, the streets and the rest stay as they are */
  function setGone(ids) {
    goneIds = new Set(ids); const rings = [...goneIds].map(id => site.buildings.find(b => b.id === id)?.ring).filter(Boolean);
    const inside = p => rings.some(r => inRing(p, r));
    for (const [id, g] of meshes) g.visible = !goneIds.has(id);
    for (const [id, p] of plates) if (goneIds.has(id)) p.visible = false;
    for (const g of floorGroups.values()) for (const w of g.children) w.visible = !inside(w.userData.at);
    for (const list of roomTags.values()) for (const t of list) t.gone = inside(t.xy);
    if (selected && goneIds.has(selected)) select(null);
    if (section && goneIds.has(site.buildings.find(b => b.wing === section.wing)?.id)) setMode("3d");
    if (storey) show(storey, shownIds);
    dirty = true;
  }
  const followers = new Set();   // what the page keeps over a point of the model (app.js float.js: the card over a wing), placed with the names
  /* the shaders compiled before the first frame, off the main thread where the browser can (KHR_parallel_shader_compile;
     pm 21:41Z: the first frame held the page ~0,7 s at full speed, many times that on a slow machine); the frame waits */
  (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).catch(e => console.warn("shaders:", e)).finally(() => { compiled = true; dirty = true; if (later.length) requestAnimationFrame(() => idle(paintNext)); });
  renderer.setAnimationLoop(() => { if (dirty && compiled) { renderer.render(scene, camera); placeTags(); for (const f of followers) f(); dirty = false; markDone(Q); } });

  const home = { ...O };
  return {
    /* a renamed wing's name over its roof (the after's wing edits, in place) */
    relabel(names) { for (const t of wingTags) { const n = names.get(t.id); if (n && t.el.textContent !== n) { t.el.textContent = n; t.size = null; } } dirty = true; },
    /* the yellow band round a picked surface or path, out of the way while its points are dragged */
    bands(on) { if (groundRims.visible !== on) { groundRims.visible = on; dirty = true; } },
    setSun, select, setGone, setTerrain, setAdded, setLandscape, setTrees, setLevels, setRooms, setFloor, setStorey, cutBuilding, setMode, setSection, view, get selected() { return selected; },
    zoom(f) { hand(); zoom(f); },
    home() { setStorey(null); O.eye = false; glide(home); },
    /* the view as it opened, the storey left as it is */
    reset() { hand(); O.eye = false; glide(home); },
    /* a pose set during a move starts from where the move goes (the chat app sets a storey, a wing, then the camera) */
    pose(p) { if (p) { land(); hand(); Object.assign(O, p); place(); } const g = going; return g ? { ...O, x: g[0], y: g[1], h: g[2], yaw: g[3], pitch: g[4], dist: Math.exp(g[5]) } : { ...O }; },
    /* to a building; cam: where to look from as well (yaw, pitch, dist), in the same move */
    focus(id, cam = {}) { const b = site.buildings.find(x => x.id === id); if (!b) return; const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]); hand(); const { eye, ...to } = cam; if (eye != null) O.eye = !!eye; glide({ x: c[0], y: c[1], h: (b.base + (b.top ?? b.base + 10)) / 2 - base, dist: Math.max(90, Math.sqrt(b.area_m2) * 3.2), ...to }); },
    /* the camera moved, from where it is (Anton's «vis meg det fra fugleperspektiv»): yaw, pitch, dist, x, y, h */
    look(cam, ms) { hand(); const { eye, ...to } = cam; if (eye != null) O.eye = !!eye; glide(to, ms); },
    /* a person's eye, or the orbit again, from where the view is */
    eye(on) { hand(); land(); O.eye = !!on; if (on && O.dist > 300) O.dist = 160; place(); },
    get labels() { return tags; },
    get base() { return base; },   // world height 0: a kote less this is a height in the scene
    setNames(on) { names = !!on; dirty = true; }, mark,   // the names and kote over the picture, for a printed sheet
    /* for tools drawn over the model (trace.js): add and take away things, a site point under the pointer at a
       kote, and where a site point at a kote is on the screen */
    add(o) { scene.add(o); dirty = true; }, remove(o) { scene.remove(o); dirty = true; }, redraw() { dirty = true; },
    world: P,
    groundAt(cx, cy, kote) {
      const r = el.getBoundingClientRect(), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
      ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(kote - base)), hit) ? [hit.x, -hit.z] : null;
    },
    /* what is under a screen point: the first face hit (a building, the ground, something added), as [east, north,
       kote] in site metres, or null for the sky (tegn.js: where a pen stroke lies on the site) */
    hit(cx, cy) {
      const r = el.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      const h = ray.intersectObjects(scene.children, true).find(i => i.object.isMesh && i.object.visible && !i.object.material?.transparent);
      return h ? [Math.round(h.point.x * 10) / 10, Math.round(-h.point.z * 10) / 10, Math.round((h.point.y + base) * 100) / 100] : null;
    },
    follow(f) { followers.add(f); dirty = true; return () => followers.delete(f); },
    /* what a pointer at cx, cy is on: a building's or a new building's id, and the point [east, north, kote] */
    hitAt(cx, cy) {
      const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      const h = ray.intersectObjects([...[...meshes.values()].filter(g => g.visible), ...[...addedGroups.values()].filter(g => g.visible), ...groundMeshes], true).find(x => x.object.isMesh && shown(x.object) && idOf(x.object));
      /* a planted tree in front of that: the ray within most of its crown of its trunk's line (U3569) */
      let tree = null; const near = new THREE.Vector3();
      for (const t of treeList) if (t[6]) {
        const g0 = ground(t[0], t[1]), d2 = ray.ray.distanceSqToSegment(P([t[0], t[1]], g0), P([t[0], t[1]], g0 + t[2]), near);
        const along = near.distanceTo(ray.ray.origin);
        if (d2 < (t[3] * 0.8) ** 2 && (!h || along < h.distance + 1) && (!tree || along < tree.along)) tree = { along, t, p: near.clone() };
      }
      if (tree) return { id: tree.t[6], at: [tree.p.x, -tree.p.z, tree.p.y + base] };
      return h ? { id: idOf(h.object), at: [h.point.x, -h.point.z, h.point.y + base] } : null;
    },
    hover,
    /* for renderkit build.js: the scene, the camera in use, the canvas, the site's frame, a thing's shapes, a redraw */
    kit() { return { THREE, scene, camera: () => camera, el, P, ground, groupOf, redraw: () => { dirty = true; } }; },
    /* where a site point at a kote is on the screen, and whether it is in front of the camera */
    project(p, kote) { const v = P(p, kote).project(camera); return [(v.x + 1) / 2 * container.clientWidth, (1 - v.y) / 2 * container.clientHeight, v.z <= 1]; },
    snapshot() { land(); renderer.render(scene, camera); return renderer.domElement.toDataURL("image/jpeg", 0.85); },
  };
}
