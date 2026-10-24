/* renderkit quality: how much 3D a device can carry. From hagekart public/quality.js by way of sykehus (a993cb9), 2026-10-24
   (U3453): the tiers, how a device is placed (pickTier, chooseTier) and the crash mark; a software renderer (no graphics
   card: SwiftShader, llvmpipe) counts as the lowest tier. An app gives its own table and storage keys to qualityKit.
     high  desktop
     mid   iPads and other touch devices
     low   iPhones, weak phones, software rendering
   Always overridable: ?q=low|mid|high in the address. */

export const TIERS = ["low", "mid", "high"];

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

/* The tier in use: the address, else the person's choice, else the device's tier held down by the last failed attempt.
   keys: { mark, pref, cap }, the app's storage keys. */
export function chooseTier({ env, search = "", store = null, now = Date.now(), keys }) {
  const { mark: MARK, pref: PREF, cap: CAP } = keys;
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

/* An app's quality: table { tier: settings }, keys { mark, pref, cap }. -> { pickQuality, markStart, markDone, lowerNow, choose } */
export function qualityKit({ table, keys }) {
  const { mark: MARK, pref: PREF, cap: CAP } = keys;
  return {
    pickQuality() {
      let store = null; try { store = localStorage; } catch { /* blocked */ }
      const { tier, why } = chooseTier({ env: browserEnv(), search: location.search, store, keys });
      return { tier, why, ...table[tier], store };
    },
    /* A build writes a mark when it starts and removes it when the model is on screen. Nothing else is needed to learn that it crashed. */
    markStart: Q => { try { Q.store?.setItem(MARK, `${Q.tier}@${Date.now()}`); } catch { /* private window */ } },
    markDone: Q => { try { Q.store?.removeItem(MARK); } catch { /* private window */ } },
    /* Lowered at once when the browser says the GL context was lost: the next model is simpler. */
    lowerNow: Q => { try { Q.store?.setItem(CAP, down(Q.tier)); } catch { /* private window */ } },
    choose: (Q, tier) => { try { if (tier) Q.store?.setItem(PREF, tier); else Q.store?.removeItem(PREF); Q.store?.removeItem(CAP); } catch { /* private window */ } },
  };
}
