/* renderkit atmosphere (U3886): the weather of an outdoor scene, in the kit's words. From hagekart garden3d.js and scenekit.js
   (FROZEN; read, never edited): snow, wind in the trees, the sky and light by the sun's height, haze, and a soft shade under
   crowns. Nothing is built twice and nothing is done per tree in JavaScript each frame:
     - snow is a blend in the material's own shader, toward white where the surface faces up (ground, roofs, crowns), one
       uniform; no geometry;
     - wind is a sway in the vertex shader of a material that says it is a tree (material.userData.sway = the model's height
       in its own units), one time uniform; instanced trees need no bookkeeping;
     - the sky is one dome whose colours are painted when the sun moves, not each frame; the haze is the scene's fog;
     - the shade under crowns is one instanced mesh of soft discs.
   No imports: three.js comes in as an argument, so the pure parts test without a browser.
     const atm = createAtmosphere({ THREE, renderer, scene, hemi, sun, reduced });
     atm.install();            // Neutral tone mapping, fog #dfe8ee from 100 to 1000 m, the sky dome
     atm.setSun(elevation);    // the sky, the haze, the sun's colour and strength, the sky light's colours (degrees above the horizon)
     atm.setSnow(mm);          // snow depth in mm (NVE's "sd"); 0 clears it
     atm.patch(root);          // every mesh under root takes the snow and the wind (idempotent per material); atm.watch(scene) does it as children come
     atm.shade(list, y);       // [[x, z, crown radius, ground y?], …] in world metres → the discs mesh (add it to the scene)
     atm.windDue(now) → true when the wind wants a picture drawn (throttled, stops after idleMs without input and when hidden)
   A material says what it is with userData: sway (tree height, local units), snow (0..1, how much of the
   snow it takes; default 1; 0 keeps a road or a window clear). */

export const FOG = { color: "#dfe8ee", near: 100, far: 1000 };
export const SNOW_FULL_MM = 60;                       // hagekart's: 60 mm of snow on the ground is a white world
export const WIND = { amp: 0.017, gapMs: 66, idleMs: 20000 };   // sway as a share of a tree's height; ~15 pictures a second; stops after 20 s of no input

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = c => "#" + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
export const mixHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * clamp(t, 0, 1))); };

/* the sky by the sun's height (degrees): [elevation, zenith, horizon]. The high sun's horizon is the haze colour, #dfe8ee. */
export const SKY = [[-8, "#0b1322", "#17233a"], [-2, "#1f2f57", "#7a5f6e"], [2, "#3a5a92", "#eaa677"], [10, "#4a80c0", "#efd2ae"], [25, "#3d86d0", FOG.color]];
export function skyAt(el) {
  let k = 1; while (k < SKY.length - 1 && SKY[k][0] < el) k++;
  const [e0, z0, h0] = SKY[k - 1], [e1, z1, h1] = SKY[k], t = clamp((el - e0) / (e1 - e0), 0, 1);
  return { zenith: mixHex(z0, z1, t), horizon: mixHex(h0, h1, t) };
}
/* the sun's colour and the share of its full strength at a height: orange at the horizon, full from about 12 degrees; none below it */
export function sunAt(el) {
  return { color: mixHex("#ff9a5e", "#fff4df", el / 14), strength: el > 0 ? Math.min(1, el / 12 + 0.2) : 0 };
}
/* snow depth (mm) → how white the world is, 0..1 */
export const snowCover = mm => clamp((+mm || 0) / SNOW_FULL_MM, 0, 1);

/* The shader edits, text in and text out. The fragment edit comes after the normal is known and before the light is worked out,
   so the snow is lit as snow (soft, rough) and not painted on after the light. */
export function snowFragment(sh) {
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uSnow; uniform float uSnowTake;")
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{ float snowUp = dot(normalize(normal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float snowK = uSnow * uSnowTake * smoothstep(0.35, 0.8, snowUp);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snowK); roughnessFactor = mix(roughnessFactor, 0.95, snowK); }`);
  return sh;
}
export function swayVertex(sh) {
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uWind; uniform float uWindAmp; uniform float uSwayH;")
    .replace("#include <begin_vertex>", `#include <begin_vertex>
{ vec3 swAnchor = modelMatrix[3].xyz;
#ifdef USE_INSTANCING
  swAnchor = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
#endif
  float swK = clamp(position.y / uSwayH, 0.0, 1.0), swA = uWindAmp * uSwayH * pow(swK, 1.6);
  float swP = uWind * 1.5 + swAnchor.x * 0.55 + swAnchor.z * 0.7 + position.y * 0.35;
  transformed.x += sin(swP) * swA; transformed.z += cos(swP * 0.83) * swA * 0.8; }`);
  return sh;
}

export function createAtmosphere({ THREE, renderer, scene, hemi = null, sun = null, reduced = false, idleMs = WIND.idleMs, gapMs = WIND.gapMs, input = typeof window !== "undefined" ? window : null }) {
  const snowU = { uSnow: { value: 0 } }, windU = { uWind: { value: 0 }, uWindAmp: { value: reduced ? 0 : WIND.amp } };
  const seen = new WeakSet(), sunFull = sun ? sun.intensity : 0;
  let dome = null, hz = new THREE.Color(FOG.color), lastInput = performance.now(), lastWind = 0, el = 45, treesSway = false, discTex = null;
  if (input?.addEventListener) for (const e of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"]) input.addEventListener(e, () => { lastInput = performance.now(); }, { passive: true });

  const api = {
    snowUniforms: snowU, windUniforms: windU,
    install() {
      renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
      scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
      const g = new THREE.SphereGeometry(1, 32, 16); g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
      dome.scale.setScalar(2200); dome.renderOrder = -10; dome.frustumCulled = false; dome.userData.skipGuide = true; dome.userData.snow = 0; scene.add(dome);
      scene.onBeforeRender = (r, s, cam) => api.forCamera(cam);
      api.setSun(el); return api;
    },
    /* a perspective camera sees the dome and the haze; a parallel one (a plan, a section, a picture of an elevation) sees neither: its eye
       is far off and the haze would whiten the whole model */
    forCamera(cam) {
      const persp = !!cam.isPerspectiveCamera;
      if (scene.fog) { scene.fog.near = persp ? FOG.near : 1e7; scene.fog.far = persp ? FOG.far : 2e7; }
      if (dome) { dome.visible = persp; dome.position.copy(cam.position); }
      if (scene.background?.isColor) scene.background.copy(persp ? hz : api.flatSky);
    },
    flatSky: new THREE.Color(FOG.color),
    setSun(elevation) {
      el = elevation; const { zenith, horizon } = skyAt(elevation), z = new THREE.Color(zenith); hz = new THREE.Color(horizon);
      if (dome) {
        const p = dome.geometry.attributes.position, c = dome.geometry.attributes.color, t = new THREE.Color();
        for (let i = 0; i < p.count; i++) { const y = p.getY(i); t.copy(hz).lerp(z, y <= 0 ? 0 : Math.pow(y, 0.5)); c.setXYZ(i, t.r, t.g, t.b); }
        c.needsUpdate = true;
      }
      if (scene.fog) scene.fog.color.copy(hz);
      if (hemi) { hemi.color.copy(z).lerp(new THREE.Color("#ffffff"), 0.55); hemi.groundColor.set("#6b7a55").lerp(hz, 0.15).lerp(new THREE.Color("#e6edf2"), 0.5 * snowU.uSnow.value); }
      if (sun) { const s = sunAt(elevation); sun.color.set(s.color); sun.intensity = elevation > 0 ? sunFull * s.strength : 0.07 * sunFull; }
      return { zenith, horizon };
    },
    setSnow(mm) {
      const v = snowCover(mm); if (Math.abs(v - snowU.uSnow.value) < 0.01) return false;
      snowU.uSnow.value = v; if (hemi) api.setSun(el); return true;
    },
    get snow() { return snowU.uSnow.value; },
    /* the materials under root take the snow and the wind through their own shader (chained after any onBeforeCompile already there) */
    patch(root) {
      root.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        for (const m of [].concat(o.material)) {
          if (!m || seen.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue; seen.add(m);
          const take = m.userData.snow ?? 1, sway = m.userData.sway;
          if (m.userData.snow === 0 && !sway) continue;
          const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
          m.onBeforeCompile = (sh, r) => {
            if (prev) prev.call(m, sh, r);
            Object.assign(sh.uniforms, snowU, windU, { uSnowTake: { value: take }, uSwayH: { value: sway || 1 } });
            if (take > 0) snowFragment(sh);
            if (sway) swayVertex(sh);
          };
          m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ""}atm${take > 0 ? "s" : ""}${sway ? "w" : ""}`;
          if (sway) treesSway = true;
          m.needsUpdate = true;
        }
      });
      return root;
    },
    watch(sc) { sc.addEventListener("childadded", e => api.patch(e.child)); api.patch(sc); return api; },
    /* soft discs under crowns: list of [x, z, radius, groundY]; one instanced mesh, one draw */
    shade(list, lift = 0.08) {
      if (!discTex) {
        const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, "rgba(20,28,16,0.55)"); gr.addColorStop(0.55, "rgba(20,28,16,0.3)"); gr.addColorStop(1, "rgba(20,28,16,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        discTex = new THREE.CanvasTexture(cv);
      }
      const geo = new THREE.CircleGeometry(1, 20); geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), mx = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach(([x, z, r, y = 0], i) => { mx.compose(new THREE.Vector3(x, y + lift, z), q, new THREE.Vector3(r * 1.15, 1, r * 1.15)); m.setMatrixAt(i, mx); });
      m.count = list.length; m.renderOrder = 1; m.userData.snow = 0; m.userData.shade = true; m.raycast = () => {}; m.frustumCulled = false;
      const free = m.dispose.bind(m); m.dispose = () => { free(); geo.dispose(); mat.dispose(); };   // the picture is shared and stays
      return m;
    },
    /* the wind's clock, once per call; true when the wind wants a picture now (trees that sway, motion allowed, input within idleMs, page shown) */
    windDue(now = performance.now()) {
      if (reduced || !treesSway || (typeof document !== "undefined" && document.hidden) || now - lastInput > idleMs || now - lastWind < gapMs) return false;
      lastWind = now; windU.uWind.value = now / 1000; return true;
    },
    get swaying() { return treesSway && !reduced; },
  };
  return api;
}
