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
import { sunPosition } from "./sun.js";
import { pickQuality, markStart, markDone, lowerNow } from "./quality.js";

const C = { ground: "#c9cdb8", lot: "#c8102e", wall: "#ece6da", roof: "#8b8f94", own: "#f4efe4", nb: "#d9d6cf", nbRoof: "#a7a6a2", pick: "#ffcf33", sky: "#dfe8ee", cutWall: "#55524d", plate: "#e8e2d4", flatRoof: "#9a9890", steel: "#8e9297" };

export function createViewer({ container, site, floors = [], lat = 59.749, lon = 10.198, onPick = () => {}, onView = () => {}, quality = pickQuality() }) {
  const Q = quality; markStart(Q);   // how much this device carries (quality.js); the mark comes off at the first picture
  const T = site.terrain, base = Math.min(...T.z.filter(v => v != null));
  const at = (grid, x, y) => { const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res); if (c < 0 || r < 0 || c >= T.w || r >= T.h) return null; return grid[r * T.w + c]; };
  const ground = (x, y) => at(T.z, x, y) ?? base;
  const P = ([x, y], h) => new THREE.Vector3(x, h - base, -y);

  const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, preserveDrawingBuffer: true });
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
  {
    const pos = [], idx = [];
    for (let r = 0; r < T.h; r++) for (let c = 0; c < T.w; c++) { const z = T.z[r * T.w + c] ?? base; pos.push(T.x0 + (c + 0.5) * T.res, z - base - 0.05, -(T.y1 - (r + 0.5) * T.res)); }
    for (let r = 0; r < T.h - 1; r++) for (let c = 0; c < T.w - 1; c++) { const a = r * T.w + c; idx.push(a, a + T.w, a + 1, a + 1, a + T.w, a + T.w + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    /* grass (ambientCG Grass004, as in hagekart): one picture to 3 m, a little lighter than the photo so the plan reads */
    g.setAttribute("uv", new THREE.Float32BufferAttribute(pos.flatMap((v, i) => i % 3 === 0 ? [v / 3] : i % 3 === 2 ? [-v / 3] : []), 2));
    const gc = document.createElement("canvas"); gc.width = gc.height = 512; const gx = gc.getContext("2d"); gx.fillStyle = C.ground; gx.fillRect(0, 0, 512, 512);
    const grass = new THREE.CanvasTexture(gc); grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.colorSpace = THREE.SRGBColorSpace; grass.anisotropy = 8;
    const gi = new Image(); gi.onload = () => { gx.drawImage(gi, 0, 0, 512, 512); gx.globalCompositeOperation = "screen"; gx.fillStyle = "rgba(196,205,168,.62)"; gx.fillRect(0, 0, 512, 512); grass.needsUpdate = true; dirty = true; };
    gi.src = new URL("./tex-grass.jpg", import.meta.url).href;
    const m = new THREE.Mesh(g, mat("#ffffff", { map: grass })); m.receiveShadow = true; scene.add(m);
    const lot = site.lot.ring.map(p => P(p, ground(...p) + 0.25));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lot), new THREE.LineDashedMaterial({ color: C.lot, dashSize: 2, gapSize: 1.2 })).computeLineDistances());
  }

  /* ---------- buildings ---------- */
  const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
  const meshes = new Map();
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
      const m = new THREE.Mesh(g, mat("#ffffff", drawnFacade(F.f, b0, z1))); m.castShadow = m.receiveShadow = true; grp.add(m);
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

  /* ---------- trees: where the laser found them (tools/trees.py), grown by EZ-Tree as in hagekart (ez-tree.js, MIT;
     bark and leaf pictures CC0 / MIT, docs/tex-credits.txt). Three models are grown once, oak, aspen and pine, with
     fewer leaves and rounder branches than hagekart's (a few hundred trees here, not a garden's few; quality.js leaves), and every tree is one of them, scaled
     to its height and crown and turned. Anything that goes wrong leaves the site without trees. ---------- */
  const treeHash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  if (site.trees?.length && !Q.ez) {
    /* on a slow device: a trunk and a crown of a few flat faces each, every tree in two draws */
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = site.trees.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6).translate(0, 0.5, 0), mat("#6b5a48"), n);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat("#7f9a5c", { flatShading: true, side: THREE.FrontSide }), n);
    site.trees.forEach(([x, y, h, r, form], i) => {
      const g0 = ground(x, y), cone = form === "cone", ch = cone ? h * 0.8 : Math.min(h * 0.7, r * 2.2);
      m4.compose(P([x, y], g0), q.identity(), new THREE.Vector3(1, h - ch * 0.6, 1)); trunk.setMatrixAt(i, m4);
      m4.compose(P([x, y], g0 + h - ch / 2), q.setFromAxisAngle(up, treeHash(y, x) * 6.28), new THREE.Vector3(cone ? r * 0.8 : r, ch / 2, cone ? r * 0.8 : r)); crown.setMatrixAt(i, m4);
    });
    for (const m of [trunk, crown]) { m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
  }
  if (site.trees?.length && Q.ez) {
    const url = n => new URL(n, import.meta.url).href, load = n => new Promise(ok => new THREE.TextureLoader().load(url(n), ok, undefined, () => ok(null)));
    Promise.all([import("./ez-tree.js"), ...["ez-bark-oak.jpg", "ez-bark-birch.jpg", "ez-bark-pine.jpg", "ez-leaf-oak.png", "ez-leaf-aspen.png", "ez-leaf-pine.png"].map(load)]).then(([EZ, ...tx]) => {
      for (const t of tx) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
      tx.slice(0, 3).forEach(t => { if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping; });
      const KIND = { oak: ["oak_medium", tx[0], tx[3]], aspen: ["aspen_medium", tx[1], tx[4]], pine: ["pine_medium", tx[2], tx[5]] };
      const groups = { oak: [], aspen: [], pine: [] };
      for (const t of site.trees) groups[t[4] === "cone" ? "pine" : treeHash(t[0], t[1]) < 0.35 ? "aspen" : "oak"].push(t);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (const [kind, list] of Object.entries(groups)) {
        if (!list.length) continue;
        const [preset, bark, leaf] = KIND[kind], json = structuredClone(EZ.PRESETS[preset]); json.leaves.count = Math.max(4, Math.round(json.leaves.count * Q.leaves));
        for (const k in json.branch.segments) json.branch.segments[k] = Math.min(json.branch.segments[k], [5, 4, 3, 3][k]);       // rounder than needed from 30 m away:
        for (const k in json.branch.sections) json.branch.sections[k] = Math.max(1, Math.round(json.branch.sections[k] * 0.6));  // about 6 000 triangles a tree
        const tree = new EZ.Tree(); tree.loadFromJson(json);
        const bg = tree.branchesMesh.geometry, lg = tree.leavesMesh.geometry; bg.computeBoundingBox(); lg.computeBoundingBox();
        const Ht = Math.max(bg.boundingBox.max.y, lg.boundingBox.max.y), R = Math.max(-lg.boundingBox.min.x, lg.boundingBox.max.x, -lg.boundingBox.min.z, lg.boundingBox.max.z, 1);
        if (bark && json.bark?.textureScale) bark.repeat.set(json.bark.textureScale.x, 1 / json.bark.textureScale.y);
        const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ map: bark, color: json.bark?.tint ?? 0xffffff, roughness: 0.95 }), list.length);
        const lm = new THREE.InstancedMesh(lg, new THREE.MeshStandardMaterial({ map: leaf, color: kind === "pine" ? "#c9d6c0" : "#d7e3c2", alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }), list.length);
        lm.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: 0.5 });
        list.forEach(([x, y, h, r], i) => {
          const sy = h / Ht, sxz = Math.min(1.4 * sy, Math.max(0.6 * sy, r / R));
          m4.compose(P([x, y], ground(x, y)), q.setFromAxisAngle(up, treeHash(y, x) * Math.PI * 2), new THREE.Vector3(sxz, sy, sxz));
          bm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
        });
        for (const m of [bm, lm]) { m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
        tree.branchesMesh.material.dispose?.(); tree.leavesMesh.material.dispose?.();
      }
      dirty = true;
    }).catch(e => console.warn("trees", e));
  }

  /* ---------- storeys: each wing has its own (site.json wings[].levels, tools/wings.json), at its own kote. A
     building is cut 1.2 m above the floor of the storey chosen for it, as a plan is cut, with a floor plate there;
     the walls of a drawing of that storey (floors.json) stand in the buildings the drawing covers. ---------- */
  const wingOf = new Map((site.wings || []).map(w => [w.id, w]));
  const levelsOf = b => wingOf.get(b.wing)?.levels || [];
  /* a storey's kote where a wing has no kote for it: the middle of the wings that have one */
  const refKote = name => { const ks = (site.wings || []).flatMap(w => (w.levels || []).filter(l => l.name === name).map(l => l.kote)).sort((a, b) => a - b); return ks.length ? ks[ks.length >> 1] : floors.find(f => f.name === name)?.kote ?? null; };
  const own = site.buildings.filter(b => b.own), cuts = new Map(), plates = new Map(), pm = mat(C.plate);
  for (const b of own) {
    cuts.set(b.id, new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6));
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(b.ring.map(([x, y]) => new THREE.Vector2(x, y)))), pm);
    plate.rotation.x = -Math.PI / 2; plate.receiveShadow = true; plate.visible = false; scene.add(plate); plates.set(b.id, plate);
  }
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), floorGroups = new Map();
  for (const f of floors) {
    const grp = new THREE.Group(), wm = mat(C.cutWall, { clippingPlanes: [cut] });
    for (const r of f.walls) {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y))), { depth: f.height, bevelEnabled: false });
      const w = new THREE.Mesh(g, wm); w.rotation.x = -Math.PI / 2; w.position.y = f.kote - base; w.castShadow = w.receiveShadow = true; grp.add(w);
    }
    /* the buildings it covers: those a tenth or more of its wall corners fall in */
    const pts = f.walls.flat(), covers = new Set(own.filter(b => pts.filter(p => inRing(p, b.ring)).length >= pts.length * 0.1).map(b => b.id));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    grp.userData = { covers, centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
    grp.visible = false; scene.add(grp); floorGroups.set(f.id, grp);
  }
  /* cut one building at a kote (null: whole again) */
  function cutAt(b, kote) {
    const on = kote != null && kote > b.base && kote < (b.top ?? 0) && (b.lift == null || kote >= b.lift - 0.1);
    cuts.get(b.id).constant = on ? kote + 1.2 - base : 1e6;
    const p = plates.get(b.id); p.visible = on; if (on) p.position.y = kote - base - 0.02;
  }
  /* where a storey stands in a building: its wing's own kote, else where the wings that have it have it */
  const koteIn = (b, name) => levelsOf(b).find(l => l.name === name)?.kote ?? refKote(name);
  /* the rooms' stamps from the drawing, as on the sheet: name, and the area under it, left edge at the stamp.
     A stamp that would overlap one already placed gives way; larger rooms are placed first. */
  const tags = document.createElement("div"); tags.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;font:12px/1.15 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#23211e";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(tags);
  const roomTags = new Map(floors.map(f => [f.id, (f.rooms || []).map(r => {
    const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;text-shadow:0 0 3px #fffbf0,0 0 3px #fffbf0";
    el.innerHTML = `<b style="font-weight:600">${r.name.replace(/</g, "&lt;")}</b>` + (r.area_m2 ? `<br>${r.area_m2.toLocaleString("nb-NO", { minimumFractionDigits: 1 })} m²` : "");
    tags.appendChild(el); return { el, at: P(r.at, f.kote + 0.05), area: r.area_m2 || 0 };
  }).sort((a, b) => b.area - a.area)]));
  /* the wings' names over their roofs (site.json wings, tools/wings.py), while the whole site is shown */
  const wingTags = site.buildings.filter(b => b.own && b.name).map(b => {
    const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;font-size:14px;font-weight:600;padding:2px 7px;border-radius:6px;background:#fbf9f4e6;border:1px solid #d8d2c6";
    el.textContent = b.name.replace(/ \(.*\)$/, ""); tags.appendChild(el);
    const c = b.ring.slice(0, -1).reduce((a, p, _, r) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
    return { el, at: P(c, (b.top ?? b.base + 10) + 2), area: b.area_m2 || 0 };
  }).sort((a, b) => b.area - a.area);
  const v3 = new THREE.Vector3();
  function placeTags() {
    const w = container.clientWidth, h = container.clientHeight, close = mode === "plan" ? view().mPerPx < 0.09 : O.dist < 150, placed = [];
    for (const t of wingTags) {
      if (storey && !only) { t.el.style.display = "none"; continue; }
      v3.copy(t.at).project(camera);
      const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h;
      if (v3.z > 1 || x < -100 || y < -30 || x > w + 100 || y > h + 30) { t.el.style.display = "none"; continue; }
      t.el.style.display = "block"; t.size ??= [t.el.offsetWidth, t.el.offsetHeight];
      const box = [x - t.size[0] / 2 - 3, y - t.size[1] - 3, x + t.size[0] / 2 + 3, y + 3];
      if (placed.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) { t.el.style.display = "none"; continue; }
      placed.push(box); t.el.style.transform = `translate(${(x - t.size[0] / 2).toFixed(0)}px, ${(y - t.size[1]).toFixed(0)}px)`;
    }
    for (const [id, list] of roomTags) for (const t of list) {
      if (id !== floor || !close) { t.el.style.display = "none"; continue; }
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
  let floor = null, storey = null, only = null;
  function show(name, ids) {
    storey = name; floor = null;
    for (const b of own) cutAt(b, name && ids.has(b.id) ? koteIn(b, name) : null);
    let drawn = null;
    for (const f of floors) {
      const g = floorGroups.get(f.id), on = !!name && f.name === name && [...g.userData.covers].some(id => ids.has(id));
      g.visible = on; if (on) { drawn ??= f; cut.constant = f.kote + 1.2 - base; }
    }
    floor = drawn?.id ?? null; dirty = true;
    return drawn;
  }
  function setStorey(name) {
    only = null; const drawn = show(name, new Set(own.map(b => b.id)));
    if (!name) return;
    /* the view goes to the drawing; a storey with no drawing to the buildings it cuts */
    const k = drawn?.kote ?? refKote(name), g = drawn && floorGroups.get(drawn.id).userData;
    const ring = drawn ? null : own.filter(b => { const z = koteIn(b, name); return z != null && z > b.base && z < (b.top ?? 0); }).flatMap(b => b.ring);
    const c = g ? g.centre : ring.length ? [(Math.min(...ring.map(p => p[0])) + Math.max(...ring.map(p => p[0]))) / 2, (Math.min(...ring.map(p => p[1])) + Math.max(...ring.map(p => p[1]))) / 2] : [O.x, O.y];
    const s = g ? g.size : ring.length ? Math.max(Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1]))) : 100;
    Object.assign(O, { x: c[0], y: c[1], h: k - base, dist: Math.max(70, s * 1.3) }); place();
  }
  /* one building cut at one of its storeys, the rest whole; the view stays where it is */
  function cutBuilding(id, name) {
    const b = own.find(x => x.id === id); only = name ? id : null;
    show(name, new Set(name ? own.filter(x => x.id === id || (b?.wing && x.wing === b.wing)).map(x => x.id) : []));
  }
  /* floors.json ids, as before: the drawing's storey in every building */
  function setFloor(id) { setStorey(floors.find(f => f.id === id)?.name ?? null); }

  /* ---------- camera: orbit around a point, or straight down for the plan ---------- */
  const lotC = site.lot.ring.reduce((a, p) => [a[0] + p[0] / site.lot.ring.length, a[1] + p[1] / site.lot.ring.length], [0, 0]);
  const O = { x: lotC[0], y: lotC[1], h: ground(...lotC) - base + 15, yaw: 0, pitch: 0.62, dist: 380 };   // from the south, north up, as a drawing is read
  function place() {
    const t = new THREE.Vector3(O.x, O.h, -O.y), cp = Math.cos(O.pitch);
    if (mode === "plan") {
      const w = container.clientWidth || 600, h = container.clientHeight || 400, half = O.dist * 0.36;
      Object.assign(ortho, { left: -half * w / h, right: half * w / h, top: half, bottom: -half }); ortho.updateProjectionMatrix();
      ortho.position.set(t.x, 1500, t.z); ortho.up.set(0, 0, -1); ortho.lookAt(t.x, 0, t.z);
    } else { camera.position.set(t.x + O.dist * cp * Math.sin(O.yaw), t.y + O.dist * Math.sin(O.pitch), t.z + O.dist * cp * Math.cos(O.yaw)); camera.lookAt(t); }
    dirty = true; onView(view());
  }
  /* what the page shows around the picture: the north arrow's turn, and in the plan the metres per screen pixel */
  function view() { return { mode, floor, storey, only, north: mode === "plan" ? 0 : O.yaw, mPerPx: mode === "plan" ? O.dist * 0.72 / (container.clientHeight || 400) : null }; }
  /* the plan reads as a drawing: even light, no cast shadows */
  function setMode(m) { mode = m === "plan" ? "plan" : "3d"; camera = mode === "plan" ? ortho : persp; sunL.castShadow = mode !== "plan"; sky.intensity = mode === "plan" ? 2.8 : 2.2; place(); }
  const el = renderer.domElement, pts = new Map();
  let drag = null, dirty = true;
  el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, pinch: pts.size === 2 ? pinchOf() : null }; });
  el.addEventListener("pointermove", e => {
    if (!drag || !pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const p = pinchOf(); if (drag.pinch) { O.dist = Math.max(30, Math.min(1200, O.dist * drag.pinch.d / p.d)); pan(p.x - drag.pinch.x, p.y - drag.pinch.y); } drag.pinch = p; drag.moved += 10; place(); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan || mode === "plan") pan(dx, dy); else { O.yaw -= dx * 0.006; O.pitch = Math.max(0.08, Math.min(1.53, O.pitch + dy * 0.005)); }
    place();
  });
  const up = e => { pts.delete(e.pointerId); if (drag && drag.moved < 6 && !pts.size) pick(e); if (!pts.size) drag = null; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("contextmenu", e => e.preventDefault());
  /* a trackpad as in Maps: two fingers move the view the way the fingers go, a pinch zooms. Chrome and Firefox send
     the pinch as a wheel with ctrlKey, Safari as gesture events (and no wheel). A wheel in lines or pages is a mouse
     and zooms; a mouse on a Mac sends pixels like a trackpad, so it moves the view, and the + and - buttons zoom. */
  let gesture = null;
  el.addEventListener("wheel", e => {
    e.preventDefault();
    if (gesture) return;
    if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.01), e);
    else if (e.deltaMode !== 0) zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.6)), e);
    else { pan(-e.deltaX, -e.deltaY); place(); }
  }, { passive: false });
  /* on an iPad the same gesture events come with the touches, which the pointer handlers already zoom */
  el.addEventListener("gesturestart", e => { e.preventDefault(); gesture = pts.size ? null : { dist: O.dist }; });
  el.addEventListener("gesturechange", e => { e.preventDefault(); if (gesture) zoom(gesture.dist / (e.scale || 1) / O.dist, e); });
  el.addEventListener("gestureend", e => { e.preventDefault(); gesture = null; });
  /* zoom by a factor on the distance; in the plan the ground under the pointer stays put */
  function zoom(f, at) {
    const d = Math.max(30, Math.min(1200, O.dist * f)); f = d / O.dist;
    if (mode === "plan" && at && at.clientX != null) {
      const r = el.getBoundingClientRect(), m = O.dist * 0.72 / (r.height || 400);
      O.x += (at.clientX - r.left - r.width / 2) * m * (1 - f); O.y -= (at.clientY - r.top - r.height / 2) * m * (1 - f);
    }
    O.dist = d; place();
  }
  function pinchOf() { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }; }
  /* drag the ground under the pointer: screen right is (cos yaw, sin yaw) east/north, screen up (away from the
     camera) is (-sin yaw, cos yaw); the centre moves against the pointer, so the ground goes with it */
  function pan(dx, dy) { const k = mode === "plan" ? O.dist * 0.72 / (container.clientHeight || 400) : O.dist * 0.0016, yaw = mode === "plan" ? 0 : O.yaw, s = Math.sin(yaw), c = Math.cos(yaw); O.x += (-dx * c - dy * s) * k; O.y += (-dx * s + dy * c) * k; }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(); let selected = null;
  function pick(e) {
    const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...meshes.values()], true)[0]; select(hit?.object.userData.id || null); onPick(selected);
  }
  function select(id) {
    if (selected) meshes.get(selected)?.traverse(o => o.material?.emissive?.set("#000"));
    selected = id && meshes.has(id) ? id : null;
    if (selected) meshes.get(selected).traverse(o => o.material?.emissive?.set("#6b5200"));
    dirty = true;
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
  renderer.setAnimationLoop(() => { if (dirty) { renderer.render(scene, camera); placeTags(); dirty = false; markDone(Q); } });

  const home = { ...O };
  return {
    setSun, select, setFloor, setStorey, cutBuilding, setMode, view, get selected() { return selected; },
    zoom(f) { zoom(f); },
    home() { setStorey(null); Object.assign(O, home); place(); },
    pose(p) { if (p) { Object.assign(O, p); place(); } return { ...O }; },
    focus(id) { const b = site.buildings.find(x => x.id === id); if (!b) return; const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]); Object.assign(O, { x: c[0], y: c[1], h: (b.base + (b.top ?? b.base + 10)) / 2 - base, dist: Math.max(90, Math.sqrt(b.area_m2) * 3.2) }); place(); },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/jpeg", 0.85); },
  };
}
