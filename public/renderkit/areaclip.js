/* A scene cut at the edge of the chosen area, and the cut filled (U3818; hagekart's "focus" cut, garden3d.js xrayPatch, in
   the kit's words). Nothing is built twice and no geometry is clipped on the CPU: a material's shader drops every fragment
   whose world position (x, z) is outside the rectangle, and where the cut shows the inside of a building (the back of a
   wall or roof, seen through the cut) it paints one solid colour for that material, so a cut house reads as a section,
   not as a hollow shell. One rectangle, four compares a fragment, no stencil pass, no extra draw: cheap on a tablet.

   The shadow pass has its own depth material and is not touched: what is cut away still casts its shadow in.
   Leaf cards and other see-through materials (alphaTest, transparent) are cut but not filled, and so are lines and points.

   No imports: three.js objects come in as arguments, so this file tests without a browser.
     const clip = createAreaClip({ rect: [x0, z0, x1, z1] });      // world x and z (three's z is south)
     clip.watch(scene);                                            // every child added from now on is patched, and the ones there are
     clip.patch(group);                                            // or one group by hand (idempotent per material)
     clip.set([x0, z0, x1, z1]); clip.on = false;                  // another area, or off (then redraw)
   A material says its fill with material.userData.cutFill (a css hex string or a number), else its colour × 0.8. */

const EDGE = "#include <clipping_planes_fragment>";

/** The uniforms every patched material shares: xcBox = (x0, z0, x1, z1), xcOn = 1 or 0. */
export function clipUniforms(rect) {
  return { xcBox: { value: { x: rect[0], y: rect[1], z: rect[2], w: rect[3] } }, xcOn: { value: 1 } };
}

/** GLSL for a colour as the shader's linear working colour, as three holds it (material.color.r/g/b). */
const vec3 = c => `vec3(${[c.r, c.g, c.b].map(v => (+v).toFixed(4)).join(", ")})`;

/** The fill colour of a material as {r, g, b} in the working space, or null where the material is not filled. */
export function fillOf(m, THREE) {
  if (!m || !m.color || m.alphaTest > 0 || m.transparent || m.isLineBasicMaterial || m.isPointsMaterial || m.isShaderMaterial) return null;
  if (m.userData && m.userData.cutFill != null) { const c = new THREE.Color(m.userData.cutFill); return { r: c.r, g: c.g, b: c.b }; }
  return { r: m.color.r * 0.8, g: m.color.g * 0.8, b: m.color.b * 0.8 };
}

/** The shader text, cut at the rectangle and (with fill = {r, g, b}) filled behind it. Pure: text in, text out. */
export function patchShader(sh, fill) {
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec2 xcWp;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 xcW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nxcW = instanceMatrix * xcW;\n#endif\nxcW = modelMatrix * xcW; xcWp = xcW.xz; }");
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec2 xcWp; uniform vec4 xcBox; uniform float xcOn;")
    .replace(EDGE, `${EDGE}\nif (xcOn > 0.5 && (xcWp.x < xcBox.x || xcWp.x > xcBox.z || xcWp.y < xcBox.y || xcWp.y > xcBox.w)) discard;`);
  if (fill) sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", `#include <opaque_fragment>\nif (xcOn > 0.5 && !gl_FrontFacing) gl_FragColor.rgb = ${vec3(fill)};`);
  return sh;
}

/** A strip of wall round a grid's edge, down to `bottom`: the ground cut at the area's edge shows earth, not a sheet.
 *  `w`, `h` points; at(c, r) → [x, y, z] of a point. Returns { position: Float32Array, index: Uint32Array } (outward not
 *  guaranteed: draw it double-sided). */
export function gridSkirt({ w, h, at, bottom }) {
  const ring = [];                                                     // the edge points, once round
  for (let c = 0; c < w; c++) ring.push([c, 0]);
  for (let r = 1; r < h; r++) ring.push([w - 1, r]);
  for (let c = w - 2; c >= 0; c--) ring.push([c, h - 1]);
  for (let r = h - 2; r > 0; r--) ring.push([0, r]);
  const n = ring.length, position = new Float32Array(n * 6), index = new Uint32Array(n * 6);
  ring.forEach(([c, r], i) => { const [x, y, z] = at(c, r); position.set([x, y, z, x, bottom, z], i * 6); });
  for (let i = 0; i < n; i++) { const a = i * 2, b = ((i + 1) % n) * 2; index.set([a, a + 1, b, b, a + 1, b + 1], i * 6); }
  return { position, index };
}

export function createAreaClip({ rect, THREE }) {
  const u = clipUniforms(rect), seen = new WeakSet();
  const api = {
    uniforms: u,
    get on() { return u.xcOn.value > 0.5; }, set on(v) { u.xcOn.value = v ? 1 : 0; },
    set(r) { Object.assign(u.xcBox.value, { x: r[0], y: r[1], z: r[2], w: r[3] }); },
    contains: (x, z) => { const b = u.xcBox.value; return x >= b.x && x <= b.z && z >= b.y && z <= b.w; },
    patch(root) {
      root.traverse(o => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          if (!m || seen.has(m)) continue; seen.add(m);
          const fill = fillOf(m, THREE), prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
          m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); Object.assign(sh.uniforms, u); patchShader(sh, fill); };
          m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ""}xc${fill ? vec3(fill) : "-"}`;
          m.needsUpdate = true;
        }
      });
      return root;
    },
    watch(scene) { scene.addEventListener("childadded", e => api.patch(e.child)); api.patch(scene); return api; },
  };
  return api;
}
