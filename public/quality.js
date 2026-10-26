/* How much 3D a device can carry: renderkit's quality.js (public/renderkit/, U3453) with this site's table and storage keys.
     high  desktop: facades with relief and gloss, the generated tree models, a 4096 px shadow map, ground and new
           buildings in their materials' pictures (pbr: renderkit materials-three.js, U3618)
     mid   iPads and other touch devices: the same with a 2048 px shadow map and fewer leaves
     low   iPhones, weak phones, software rendering: flat facade pictures, trees as plain solids, no antialiasing, pixel
           ratio 1, materials as flat colours
   Always overridable: ?q=low|mid|high in the address. */
import { qualityKit } from "./renderkit/quality.js";

export { TIERS, pickTier, chooseTier, browserEnv } from "./renderkit/quality.js";
export const QUALITY = {
  high: { dpr: 2, aa: true, shadow: 4096, relief: true, ez: true, leaves: 0.65, pbr: true },
  mid: { dpr: 1.5, aa: true, shadow: 2048, relief: true, ez: true, leaves: 0.45, pbr: true },
  low: { dpr: 1, aa: false, shadow: 1024, relief: false, ez: false, leaves: 0, pbr: false },
};
export const MARK = "sk.try", PREF = "sk.q", CAP = "sk.cap";
export const { pickQuality, markStart, markDone, lowerNow, choose } = qualityKit({ table: QUALITY, keys: { mark: MARK, pref: PREF, cap: CAP } });
