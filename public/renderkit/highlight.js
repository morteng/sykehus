// renderkit highlight: a selection or hover drawn over a mesh, as a see-through fill and outlines in a person's colour (an
// overlay with polygon offset, never z-fighting). From laser's view3d.js (U2890, L16), moved here unchanged in slice 1 (U3453).
import * as T from '../vendor/three.module.js'

// the boundary of a set of triangles (indices t into pos): the edges they use once, as line segments; by place, so a mesh
// that does not share its corners still has one outline
export function boundary(t, pos) {
  const cnt = new Map(), at = a => [0, 1, 2].map(k => pos[a * 3 + k].toFixed(2)) + ''
  for (let k = 0; k < t.length; k += 3) for (const [a, b] of [[t[k], t[k + 1]], [t[k + 1], t[k + 2]], [t[k + 2], t[k]]]) { const x = at(a), y = at(b), key = x < y ? x + '|' + y : y + '|' + x; cnt.set(key, [(cnt.get(key) || [0])[0] + 1, a, b]) }
  const out = []; for (const [n, a, b] of cnt.values()) if (n === 1) out.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2])
  return out
}

// L: three's line addons {LineSegments2, LineSegmentsGeometry, LineMaterial} (the app's own copies); r: the renderer.
// -> {fill(position, ix, colour, a), lines(p, colour, px, a, depth, order), clear(group), resize(w, h)}
export function highlighter(L, r) {
  const mats = new Set()
  return {
    fill(position, ix, colour, a) {                                  // the triangles ix of a position attribute, see-through
      const g = new T.BufferGeometry(); g.setAttribute('position', position); g.setIndex(ix)
      // the attribute is the mesh's own, so disposing the fill must not free it: three's dispose deletes the GL buffer of every
      // attribute the geometry lists, and the mesh's vertex array keeps drawing that freed buffer, so its faces stop moving
      // (laser 2026-10-25 00:05Z: after a hover, Flat laid down only the outlines; the faces stayed where they stood)
      g.dispose = () => { g.deleteAttribute('position'); T.BufferGeometry.prototype.dispose.call(g) }
      return new T.Mesh(g, new T.MeshBasicMaterial({ color: colour, transparent: true, opacity: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }))
    },
    lines(p, colour, px, a = 1, depth = true, order = 2) {           // segments p (x, y, z pairs), px wide on screen
      const g = new L.LineSegmentsGeometry(); g.setPositions(p)
      const m = new L.LineMaterial({ color: colour, linewidth: px, transparent: a < 1, opacity: a, depthTest: depth }); m.resolution.set(r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio()); mats.add(m)
      const l = new L.LineSegments2(g, m); l.renderOrder = order; return l
    },
    clear(group) { for (const c of [...group.children]) { group.remove(c); c.geometry.dispose(); if (c.material.isLineMaterial) mats.delete(c.material); c.material.dispose() } },
    resize(w, h) { for (const m of mats) m.resolution.set(w, h) },
  }
}
