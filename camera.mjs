/* One camera for every picture Anton takes (Morten 2026-10-27: «we should ensure Anton gets exactly the pictures and framing it wants»).
   look and try_change's picture take the same fields (cameraProps); the automatic framing is only the default they start from.
   The kit's lens is fixed (public/renderkit/look.js camera(): 38° over the height, no fov argument; hash-locked), so there is no lens field.
   aimCamera(c, base, ctx): the fields over a default camera → what picture() is given, or a refusal that names the limits. */
import { VIEWS } from "./public/renderkit/look.js";

const PT = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 3 };
export const cameraProps = VIEW_NAME => ({
  focus: { type: "string", description: "A wing, building or new building (id or name): aimed at and picked out in orange" },
  at: { ...PT, description: "Look-at [east, north, kote?]; kote default ground or roof there" },
  frame: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, minItems: 2, maxItems: 2, description: "Fit this box [[e,n],[e,n]], with margin" },
  distance_m: { type: "number", minimum: 30, maximum: 1200 },
  from_direction: { type: ["string", "number"], description: "Where the camera stands: N, NØ, Ø, SØ, S, SV, V, NV or degrees" },
  tilt_deg: { type: "number", minimum: 5, maximum: 90, description: "90 = plan" },
  view_name: VIEW_NAME,
  eye: { type: "object", description: "Person's view: at [e,n], height_m 1.7, look_at [e,n,kote?]", properties: { at: PT, height_m: { type: "number" }, look_at: PT } },
  era: { type: "string", enum: ["før", "etter"], description: "før: draw the before" },
  views: { type: "array", maxItems: 3, items: { type: "object", description: "Another camera, same fields" }, description: "Up to 3 cameras in one call" },
  width: { type: "integer", minimum: 320, maximum: 1280 }, height: { type: "integer", minimum: 240, maximum: 960 },
});
export const CAMERA_KEYS = ["at", "frame", "eye", "era", "views"];
export const hasCamera = c => !!c && CAMERA_KEYS.some(k => c[k] != null);
/* a call's cameras: its own fields, or each of views over them */
export const cameras = c => Array.isArray(c?.views) && c.views.length ? c.views.slice(0, 3).map(v => ({ ...c, ...v, views: undefined })) : [{ ...c, views: undefined }];

const com = v => String(v).replace(".", ",");
const SIDES = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"];
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

/* ctx: { site (the model drawn), ground(s, [e,n]), dirDeg, err(msg) } */
export function aimCamera(c, base, ctx) {
  const { site: s, err } = ctx, t = s.terrain, fin = (v, what) => { if (!Number.isFinite(v)) throw err(`${what} må være et tall.`); return v; };
  const onSite = (p, what) => { const [x, y] = [fin(p?.[0], what), fin(p?.[1], what)], X1 = t.x0 + t.w * t.res, Y0 = t.y1 - t.h * t.res; if (x < t.x0 || x > X1 || y < Y0 || y > t.y1) throw err(`${what} [${x}, ${y}] ligger utenfor modellen: øst ${Math.round(t.x0)}–${Math.round(X1)}, nord ${Math.round(Y0)}–${Math.round(t.y1)}.`); return [x, y]; };
  const kote = (p, what) => { const [x, y] = onSite(p, what); if (p.length > 2 && p[2] != null) return fin(p[2], what + " sin kote"); const b = (s.buildings || []).find(b => inside([x, y], b.ring)); return b ? b.top ?? b.base + 8 : ctx.ground(s, [x, y]); };
  const out = { ...base, target: [...base.target] };
  if (c.view_name != null && VIEWS[c.view_name]) { const v = VIEWS[c.view_name]; out.plan = !!v.plan; if (!v.plan) { out.from = v.from; out.tilt = v.tilt; } }
  if (c.from_direction != null) { const d = ctx.dirDeg(c.from_direction); if (!Number.isFinite(d)) throw err(`from_direction «${c.from_direction}» er ikke N, NØ, Ø, SØ, S, SV, V, NV eller grader.`); out.from = d; if (c.tilt_deg == null && out.plan) { out.plan = false; out.tilt = 30; } }
  if (c.tilt_deg != null) { const k = fin(c.tilt_deg, "tilt_deg"); if (k < 5 || k > 90) throw err(`tilt_deg må være 5–90 grader (90 er plan); ${k} er utenfor.`); out.plan = k >= 90; if (!out.plan) out.tilt = k; }
  if (c.at != null) { if (!Array.isArray(c.at)) throw err("at må være [øst, nord] eller [øst, nord, kote]."); out.target = [...onSite(c.at, "at"), kote(c.at, "at")]; }
  if (c.frame != null) {
    const f = c.frame; if (!Array.isArray(f) || f.length !== 2) throw err("frame må være to hjørner [[øst, nord], [øst, nord]].");
    const [a, b] = [onSite(f[0], "frame"), onSite(f[1], "frame")], w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]), side = Math.max(w, h);
    if (side < 5 || side > 1000) throw err(`frame må være mellom 5 og 1000 m på den lengste siden; denne er ${com(Math.round(side * 10) / 10)} m.`);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; out.target = [mid[0], mid[1], c.at?.[2] ?? kote(mid, "frame")]; out.dist = 2.2 * side; out.framed = [a, b];
  }
  if (c.distance_m != null) { const d = fin(c.distance_m, "distance_m"); if (d < 30 || d > 1200) throw err(`distance_m må være 30–1200 m; ${d} er utenfor.`); out.dist = d; }
  if (c.eye != null) {
    const e = c.eye, p = onSite(e.at, "eye.at"), h = e.height_m == null ? 1.7 : fin(e.height_m, "eye.height_m");
    if (h < 0.5 || h > 100) throw err(`eye.height_m må være 0,5–100 m; ${h} er utenfor.`);
    if (!Array.isArray(e.look_at)) throw err("eye trenger look_at [øst, nord] eller [øst, nord, kote].");
    const tg = [...onSite(e.look_at, "eye.look_at"), kote(e.look_at, "eye.look_at")], d = Math.hypot(p[0] - tg[0], p[1] - tg[1]);
    if (d < 5) throw err(`eye.at og eye.look_at må være minst 5 m fra hverandre (nå ${com(Math.round(d * 10) / 10)} m).`);
    const up = ctx.ground(s, p) + h - tg[2];
    out.target = tg; out.from = (Math.atan2(p[0] - tg[0], p[1] - tg[1]) * 180 / Math.PI + 360) % 360; out.tilt = Math.atan2(up, d) * 180 / Math.PI; out.dist = Math.hypot(d, up); out.plan = false; out.eye = { at: p, height_m: h };
  }
  out.dist = Math.max(out.eye ? 5 : 30, Math.min(1200, Math.round(out.dist)));
  return out;
}

/* the camera as it was used: in the caption (Norwegian) and as numbers for structuredContent */
export function usedCamera(cam, era) {
  const r1 = v => Math.round(v * 10) / 10, side = SIDES[Math.round(((cam.from ?? 0) % 360 + 360) % 360 / 45) % 8];
  const num = { target: cam.target.map(r1), distance_m: Math.round(cam.dist), plan: !!cam.plan, ...(cam.plan ? {} : { from_deg: Math.round(cam.from), tilt_deg: r1(cam.tilt) }), ...(cam.framed ? { frame: cam.framed.map(p => p.map(r1)) } : {}), ...(cam.eye ? { eye: cam.eye } : {}), era: era === "før" ? "før" : "etter" };
  const say = `Kamera: mot [øst ${com(r1(cam.target[0]))}, nord ${com(r1(cam.target[1]))}, kote ${com(r1(cam.target[2]))}], ${Math.round(cam.dist)} m unna, ${cam.plan ? "rett ovenfra" : `fra ${Math.round(cam.from)}° (${side}), ${com(r1(cam.tilt))}° over bakken`}${cam.framed ? ", rammen passet inn" : ""}${cam.eye ? `, øyet ${com(cam.eye.height_m)} m over bakken` : ""}${era === "før" ? ", modellen slik den var før" : ""}.`;
  return { num, say };
}
