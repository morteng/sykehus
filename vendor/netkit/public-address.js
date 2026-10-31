// The one "public address only" check for the Node apps. Its Python twin is agentkit/netguard.py;
// both read the same table (public-address.vectors.json). A fetch that takes a host from a person vets each resolved
// address, and the peer address after connect, with privateAddress(). It fails toward a refusal: text that is not an
// address is private.
//
// Private (never fetched): 0/8, 10/8, 127/8, 100.64/10 (CGNAT, NetBird), 169.254/16 (cloud metadata), 172.16/12 (Docker),
// 192.168/16, 192.0.0/24, 198.18/15, 224/4 and up; IPv6 ::, ::1, fc00::/7, fe80::/10, ff00::/8. An IPv6 form that carries an
// IPv4 address (mapped ::ffff:a.b.c.d or ::ffff:ac11:1, compatible ::a.b.c.d, SIIT ::ffff:0:a.b.c.d) is judged as that
// IPv4 address. 6to4 (2002::/16), NAT64 (64:ff9b::/32), Teredo (2001::/32) and 2001:db8::/32 are refused whole.
import net from "node:net";

/* the eight 16-bit groups of an IPv6 text (:: and a dotted tail expanded), or null */
function groups6(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    if (!net.isIPv4(m[1])) return null;
    const [a, b, c, d] = m[1].split(".").map(Number);
    s = s.slice(0, m.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [h, t, extra] = s.split("::");
  if (extra !== undefined) return null;
  const hs = h ? h.split(":") : [], ts = t === undefined ? [] : t ? t.split(":") : [];
  const fill = t === undefined ? 0 : 8 - hs.length - ts.length;
  if (fill < 0 || (t === undefined && hs.length !== 8)) return null;
  const all = [...hs, ...Array(fill).fill("0"), ...ts].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every(Number.isInteger) ? all : null;
}

/** True for an address a fetch must never reach: this box, its networks, the cloud's metadata, multicast, or text that is no address. */
export function privateAddress(ip) {
  if (typeof ip !== "string") return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const g = groups6(ip);
    if (!g) return true;
    const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const head5 = g.slice(0, 5).every((x) => x === 0);
    if (head5 && (g[5] === 0xffff || g[5] === 0)) return privateAddress(v4(g[6], g[7])); // ::ffff:a.b.c.d, ::ac11:1, ::a.b.c.d
    if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return privateAddress(v4(g[6], g[7])); // ::ffff:0:a.b.c.d
    if (g[0] === 0x2002) return true; // 6to4
    return g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) || (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00 || (g[0] === 0x64 && g[1] === 0xff9b) || (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8));
  }
  return true;
}

export const publicAddress = (ip) => !privateAddress(ip);
