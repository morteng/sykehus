/* U3684: does the ground fit what was asked? Pure functions over a kote reader (groundAt), so a test can hand in a flat or a sloped fixture.
   fallOf: the kote spread round a place, in words. findDrops: up to 3 spots where the ground falls about `drop` metres over a short run to a way. */
const r1 = v => Math.round(v * 10) / 10, com = v => String(r1(v)).replace(".", ",");
const DIR = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"];
const dirWord = (c, p) => DIR[Math.round(((Math.atan2(p[0] - c[0], p[1] - c[1]) * 180 / Math.PI + 360) % 360) / 45) % 8];

export function inRing(ring, p) { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) o = !o; } return o; }

/* kote spread over the centre and two rings (R/2, R) of eight points: {high, low, spread_m, line} */
export function fallOf(groundAt, c, R) {
  const pts = [c]; for (const f of [0.5, 1]) for (let i = 0; i < 8; i++) { const th = i * Math.PI / 4; pts.push([c[0] + Math.sin(th) * R * f, c[1] + Math.cos(th) * R * f]); }
  const ks = pts.map(p => ({ p, k: groundAt(p) })).filter(x => Number.isFinite(x.k)); if (!ks.length) return null;
  const hi = ks.reduce((a, b) => b.k > a.k ? b : a), lo = ks.reduce((a, b) => b.k < a.k ? b : a), spread = hi.k - lo.k;
  const where = x => x.p === c ? "på stedet" : `${dirWord(c, x.p)} for stedet`;
  const line = spread < 0.75 ? `Terrenget her er ${spread < 0.15 ? "helt" : "nesten"} flatt: ${com(spread)} m mellom høyeste og laveste punkt innen ${Math.round(R)} m.`
    : `Terrenget faller ${com(spread)} m innen ${Math.round(R)} m: høyest ${com(hi.k)} (${where(hi)}), lavest ${com(lo.k)} (${where(lo)}).`;
  return { high: { kote: r1(hi.k), x: r1(hi.p[0]), y: r1(hi.p[1]) }, low: { kote: r1(lo.k), x: r1(lo.p[0]), y: r1(lo.p[1]) }, spread_m: r1(spread), line };
}

/* ways: [{id, what, ring}], buildings: [{ring}], surfaces: [{name, surface, ring}]. A candidate stands on a way's edge (bottom), a run of 2..10 m up the slope (top). */
export function findDrops({ groundAt, c, R, drop, ways = [], buildings = [], surfaces = [] }) {
  const want = Math.abs(drop), out = [];
  const near = (p, ring) => ring.some((q, i) => { const B = ring[(i + 1) % ring.length], dx = B[0] - q[0], dy = B[1] - q[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)); return Math.hypot(q[0] + t * dx - p[0], q[1] + t * dy - p[1]) < 0.01; });
  for (const w of ways) {
    const n = w.ring.length, samples = [];
    for (let i = 0; i < n; i++) { const A = w.ring[i], B = w.ring[(i + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]), k = Math.max(1, Math.round(L / 3)); for (let j = 0; j < k; j++) samples.push([A[0] + (B[0] - A[0]) * j / k, A[1] + (B[1] - A[1]) * j / k]); }
    for (const b of samples) {
      if (Math.hypot(b[0] - c[0], b[1] - c[1]) > R) continue;
      const kb = groundAt(b); if (!Number.isFinite(kb)) continue;
      for (let a = 0; a < 16; a++) {
        const th = a * Math.PI / 8; let hit = null;
        for (let d = 2; d <= 10; d += 1) {
          const p = [b[0] + Math.sin(th) * d, b[1] + Math.cos(th) * d], kp = groundAt(p); if (!Number.isFinite(kp)) break;
          if (inRing(w.ring, p) || buildings.some(x => inRing(x.ring, p))) break;
          if (kp - kb >= want * 0.9) { hit = { p, d, kp }; break; }
        }
        if (!hit) continue;
        const fall = hit.kp - kb, laid = surfaces.find(s => inRing(s.ring, hit.p));
        out.push({ score: Math.abs(fall - want) + hit.d * 0.05 + Math.hypot(b[0] - c[0], b[1] - c[1]) * 0.01, bottom: b, top: hit.p, run_m: hit.d, kb, kt: hit.kp,
          cand: { top: { x: r1(hit.p[0]), y: r1(hit.p[1]), kote: r1(hit.kp), is: laid ? `${laid.name || laid.surface} (${laid.surface})` : "åpen mark" },
            bottom: { x: r1(b[0]), y: r1(b[1]), kote: r1(kb), is: w.what || w.id },
            drop_m: r1(fall), run_m: hit.d, distance_m: r1(Math.hypot(b[0] - c[0], b[1] - c[1])) } });
      }
    }
  }
  out.sort((p, q) => p.score - q.score);
  const pick = []; for (const o of out) { if (pick.length >= 3) break; if (pick.every(x => Math.hypot(x.bottom[0] - o.bottom[0], x.bottom[1] - o.bottom[1]) >= 10)) pick.push(o); }
  return pick.map(x => x.cand);
}

/* the sentence Anton reads: does the asked drop fit the ground round the place? */
export function fitLine(fall, drop, cands, R = 20) {
  const want = Math.abs(drop);
  if (fall && fall.spread_m >= want * 0.9) return { fits_here: true, answer: `Terrenget her har ${com(fall.spread_m)} m fall innen ${Math.round(R)} m, så ${com(want)} m kan passe.` };
  return { fits_here: false, answer: `Terrenget her faller bare ${com(fall?.spread_m ?? 0)} m innen ${Math.round(R)} m, ikke ${com(want)} m.${cands.length ? ` Nærmeste steder som passer: ${cands.map(c => `${com(c.top.kote)} ned til ${com(c.bottom.kote)} ved ${c.bottom.is} (x=${c.bottom.x}, y=${c.bottom.y})`).join("; ")}.` : " Fant ikke noe sted innen radiusen med så mye fall mot en vei eller sti."}` };
}
