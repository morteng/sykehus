/* How much 3D a device can carry. Copied from hagekart (public/quality.js, 2026-10-24): the tiers, how a device is
   placed (pickTier, chooseTier) and the crash mark are the same; the table is this site's and so are the storage
   keys, and a software renderer (no graphics card: SwiftShader, llvmpipe) counts as the lowest tier.
     high  desktop: facades with relief and gloss, the generated tree models, a 4096 px shadow map
     mid   iPads and other touch devices: the same with a 2048 px shadow map and fewer leaves
     low   iPhones, weak phones, software rendering: flat facade pictures, trees as plain solids, no antialiasing, pixel
           ratio 1
   Always overridable: ?q=low|mid|high in the address. */

export const TIERS = ["low", "mid", "high"];
export const QUALITY = {
  high: { dpr: 2, aa: true, shadow: 4096, relief: true, ez: true, leaves: 0.65 },
  mid: { dpr: 1.5, aa: true, shadow: 2048, relief: true, ez: true, leaves: 0.45 },
  low: { dpr: 1, aa: false, shadow: 1024, relief: false, ez: false, leaves: 0 },
};
export const MARK = "sk.try", PREF = "sk.q", CAP = "sk.cap";

/* The tier a device starts at. env: { ua, touchPoints, coarse, memory (GB, or undefined), cores, short (shorter screen side in px), gpu (renderer name) } */
export function pickTier(env = {}) {
  if (/SwiftShader|llvmpipe|Software/i.test(env.gpu || "")) return "low";   // drawn by the processor, not a graphics card
  const ua = env.ua || "", iphone = /iPhone|iPod/.test(ua), ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (env.touchPoints || 0) > 1);
  if (iphone) return "low";                                            // 4 GB shared with the system, and a hard per-page limit
  if (ipad) return "mid";
  if (env.coarse) return (env.memory && env.memory <= 3) || (env.cores && env.cores <= 4) ? "low" : "mid";
  return env.memory && env.memory <= 2 ? "low" : "high";
}
const down = t => TIERS[Math.max(0, TIERS.indexOf(t) - 1)];

/* The tier in use: the address, else the person's choice, else the device's tier held down by the last failed attempt. */
export function chooseTier({ env, search = "", store = null, now = Date.now() }) {
  const q = new URLSearchParams(search).get("q");
  if (TIERS.includes(q)) return { tier: q, why: "address" };
  const get = k => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  const set = (k, v) => { try { store?.setItem(k, v); } catch { /* private window */ } };
  const del = k => { try { store?.removeItem(k); } catch { /* private window */ } };
  const pref = get(PREF); if (TIERS.includes(pref)) { del(MARK); return { tier: pref, why: "choice" }; }
  let tier = pickTier(env), why = "device";
  const mark = get(MARK);
  if (mark) {                                                          // the last build on this device started and never finished
    const [t, at] = mark.split("@"); del(MARK);
    if (TIERS.includes(t) && now - +at < 6 * 36e5) set(CAP, down(t));
  }
  const cap = get(CAP);
  if (TIERS.includes(cap) && TIERS.indexOf(cap) < TIERS.indexOf(tier)) { tier = cap; why = "crash"; }
  return { tier, why };
}
export const browserEnv = () => ({
  ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches,
  memory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, short: Math.min(screen.width, screen.height), gpu: gpuName(),
});
function gpuName() {
  try { const c = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl"), d = c?.getExtension("WEBGL_debug_renderer_info"); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : ""; } catch { return ""; }
}
export function pickQuality() {
  let store = null; try { store = localStorage; } catch { /* blocked */ }
  const { tier, why } = chooseTier({ env: browserEnv(), search: location.search, store });
  return { tier, why, ...QUALITY[tier], store };
}
/* A build writes a mark when it starts and removes it when the model is on screen. Nothing else is needed to learn that it crashed. */
export const markStart = Q => { try { Q.store?.setItem(MARK, `${Q.tier}@${Date.now()}`); } catch { /* private window */ } };
export const markDone = Q => { try { Q.store?.removeItem(MARK); } catch { /* private window */ } };
/* Lowered at once when the browser says the GL context was lost: the next model is simpler. */
export const lowerNow = Q => { try { Q.store?.setItem(CAP, down(Q.tier)); } catch { /* private window */ } };
export const choose = (Q, tier) => { try { if (tier) Q.store?.setItem(PREF, tier); else Q.store?.removeItem(PREF); Q.store?.removeItem(CAP); } catch { /* private window */ } };
