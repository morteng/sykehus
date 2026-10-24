// Copied from hagekart fix/osm-building-relations e76a538 (osm-water.mjs joinRings), 2026-10-24. Keep in step until it moves to a shared module.
export function joinRings(ways) {   // ways: arrays of [lon, lat]; returns closed rings
  const open = ways.filter(w => w.length > 1).map(w => w.slice()), rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (open.length) {
    let ring = open.shift();
    for (let guard = 0; !same(ring[0], ring[ring.length - 1]) && guard < 10000; guard++) {
      const end = ring[ring.length - 1], k = open.findIndex(w => same(w[0], end) || same(w[w.length - 1], end));
      if (k < 0) break;
      const w = open.splice(k, 1)[0];
      ring = ring.concat((same(w[0], end) ? w : w.slice().reverse()).slice(1));
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length > 3) rings.push(ring);
  }
  return rings;
}
