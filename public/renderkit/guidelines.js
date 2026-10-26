/* The faint snap guides of a drag (U3878): one line buffer made once and refilled, so a pointer move makes no geometry;
   thin, dashed, low in contrast. A small label only where a guide has one (symmetry, equal spacing).
   const G = createGuides({ THREE, scene, host, el, camera, P, ground }); G.set(list) with list of [from, to, kind, label]
   in the app's metres; G.clear(); G.destroy(). */
export function createGuides({ THREE, scene, host, el, camera, P, ground, max = 12, color = 0x2f6fde, opacity = 0.5 }) {
  const pos = new Float32Array(max * 6), dist = new Float32Array(max * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("lineDistance", new THREE.BufferAttribute(dist, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.5, transparent: true, opacity, depthTest: false, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 22; lines.visible = false; scene.add(lines);
  const tag = Object.assign(document.createElement("div"), { className: "rk-guide-tag" }); tag.hidden = true;
  tag.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:5;white-space:nowrap;font:500 11px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.8);color:#2f6fde";
  host.append(tag);
  function set(list) {
    let n = 0, lab = null;
    for (const g of list || []) {
      if (n >= max) break;
      const a = P(g[0], ground(...g[0]) + 0.3), b = P(g[1], ground(...g[1]) + 0.3);
      pos[n * 6] = a.x; pos[n * 6 + 1] = a.y; pos[n * 6 + 2] = a.z; pos[n * 6 + 3] = b.x; pos[n * 6 + 4] = b.y; pos[n * 6 + 5] = b.z;
      dist[n * 2] = 0; dist[n * 2 + 1] = Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]);
      if (g[3] && !lab) lab = g;
      n++;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.lineDistance.needsUpdate = true; geo.setDrawRange(0, n * 2); lines.visible = n > 0;
    if (!lab) { tag.hidden = true; return; }
    const mid = [(lab[0][0] + lab[1][0]) / 2, (lab[0][1] + lab[1][1]) / 2], v = P(mid, ground(...mid) + 0.3).project(camera());
    tag.textContent = lab[3]; tag.hidden = false;
    const hb = host.getBoundingClientRect(), eb = el.getBoundingClientRect(), x = (v.x + 1) / 2 * el.clientWidth, y = (1 - v.y) / 2 * el.clientHeight;
    tag.style.transform = `translate(${Math.round(x + eb.left - hb.left - tag.offsetWidth / 2)}px, ${Math.round(y + eb.top - hb.top - tag.offsetHeight - 4)}px)`;
  }
  const clear = () => set([]);
  return { set, clear, lines, get count() { return geo.drawRange.count / 2; }, destroy() { scene.remove(lines); geo.dispose(); mat.dispose(); tag.remove(); } };
}
