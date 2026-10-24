// renderkit camera rig (U3453 slice 3), from laser's L29 cammove.js (Morten 2026-10-24 21:14Z: «make sure the camera stays
// smooth through all transitions and such»; 21:15Z: one camera rig for laser and sykehus): the one camera move.
// It eases the orbit's target, direction and distance from where the camera is to a new framing; a move started during a move
// starts from the current pose and the current speed, so nothing snaps; a drag or a wheel stops it at once.
//
// The move itself is a pure function of time (plan, poseOf: plain arrays, no three.js), so a test reads the camera without a
// browser (tests/camera.test.mjs, Morten 22:50Z: «you can read the camera params and see if it is jerky?»). The three.js
// parts take three as T, so this file imports nothing.

// a camera as one vector: the target (x, y, z), the azimuth and elevation of the camera seen from the target (z up, azimuth 0
// looks along +y, as view3d's orbit keys), the log of the distance (so a zoom is even), and the field of view
export function stateOf(target, position, fov = 25) {
  const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2], d = Math.hypot(dx, dy, dz) || 1e-9
  return [target[0], target[1], target[2], Math.atan2(dx, -dy), Math.asin(Math.max(-1, Math.min(1, dz / d))), Math.log(d), fov]
}
export function poseOf(s) {
  const d = Math.exp(s[5]), c = Math.cos(s[4])
  return { target: [s[0], s[1], s[2]], position: [s[0] + d * Math.sin(s[3]) * c, s[1] - d * Math.cos(s[3]) * c, s[2] + d * Math.sin(s[4])], fov: s[6] }
}

// from s0 moving at v0 (per ms) to s1 at rest, over ms: a cubic per value (Hermite), so the pose and the speed are continuous
// where a move starts, and the speed is 0 where it ends. The azimuth goes the short way round. -> {at(t), vel(t), ms, to}
export function plan(s0, v0, s1, ms) {
  const to = s1.slice(); to[3] = s0[3] + Math.atan2(Math.sin(s1[3] - s0[3]), Math.cos(s1[3] - s0[3]))
  const at = t => {
    if (ms <= 0 || t >= ms) return to.slice()
    const u = Math.max(0, t / ms), a = 2 * u ** 3 - 3 * u * u + 1, b = (u ** 3 - 2 * u * u + u) * ms, c = 3 * u * u - 2 * u ** 3
    return s0.map((x, i) => a * x + b * v0[i] + c * to[i])
  }
  const vel = t => {
    if (ms <= 0 || t >= ms) return s0.map(() => 0)
    const u = Math.max(0, t / ms), a = (6 * u * u - 6 * u) / ms, b = 3 * u * u - 4 * u + 1
    return s0.map((x, i) => a * x + b * v0[i] - a * to[i])
  }
  return { at, vel, ms, to }
}

// ---- the move in time, for any camera state vector: from (the state now) to to (at rest) over ms, carrying the speed of the
// move in flight for the same key when that move was stopped this frame by the new one (not by the person). put(s) shows a
// state; now() and raf(fn) are the view's clock, so a test can step it a frame at a time. low: at once (reduced motion).
// onStop runs when the move ends or is stopped. -> {stop(), user()}: user() is the person taking over (a drag, a wheel), so
// the next move starts from rest. moveCamera below is this on an OrbitControls camera; an app with its own orbit state
// (sykehus: centre, yaw, pitch, log distance) calls it directly.
const live = new WeakMap()                                          // key -> the move in flight: {p, start, stoppedAt, byUser}
export function ease(key, { from, to, ms = 900, now, raf, put, low = false, onStop = () => {} }) {
  const t = now(), was = live.get(key)
  if (was && was.stoppedAt === null) was.stoppedAt = t
  const v0 = was && !was.byUser && t - was.stoppedAt <= 1000 / 30 ? was.p.vel(t - was.start) : null   // stopped this frame by a new move: keep its speed
  const me = { p: plan(from, v0 || from.map(() => 0), to, low ? 0 : ms), start: t, stoppedAt: null, byUser: false }
  live.set(key, me)
  const stop = () => { if (me.stoppedAt === null) me.stoppedAt = now(); onStop() }
  const user = () => { me.byUser = true; stop() }
  if (low || ms <= 0) { put(me.p.to); stop(); return { stop, user } }
  const step = tt => { if (me.stoppedAt !== null) return; const e = tt - me.start; put(me.p.at(e)); if (e < ms) raf(step); else stop() }
  raf(step)
  return { stop, user }
}

// ---- three.js: moves cam and its OrbitControls ctl to {target, dist} (and dir, a unit vector from the target to the camera,
// when given; else the camera's own) over ms. now() and raf(fn) are the view's clock, so a test can step it a frame at a time.
// onFrame runs after each step. low: at once (reduced motion). -> stop()
export function moveCamera(T, { cam, ctl, target, dist, dir = null, ms = 900, now, raf, onFrame = () => {}, low = false }) {
  const s0 = stateOf(ctl.target.toArray(), cam.position.toArray(), cam.fov), d = (dir || cam.position.clone().sub(ctl.target)).clone().normalize()
  const s1 = stateOf(target.toArray(), target.clone().addScaledVector(d, dist).toArray(), cam.fov)
  const put = s => { const q = poseOf(s); ctl.target.fromArray(q.target); cam.position.fromArray(q.position); ctl.update(); onFrame() }
  let me = null
  const user = () => me.user()                                      // the person's drag or wheel takes over at once
  me = ease(cam, { from: s0, to: s1, ms, now, raf, put, low, onStop: () => ctl.removeEventListener('start', user) })
  if (!(low || ms <= 0)) ctl.addEventListener('start', user)
  return me.stop
}

// the framing of a box seen from dir (a unit vector from the target to the camera): its centre, and the distance at which it
// fills the picture inside the margins (mx, my px of a W x H stage); the camera itself does not move
export function frame(T, cam, box, dir, W, H, mx = 96, my = 296) {
  const c = box.getCenter(new T.Vector3()), probe = cam.clone(), pts = []
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new T.Vector3(x, y, z))
  let d = Math.max(1, box.getSize(new T.Vector3()).length() * 2)
  for (let i = 0; i < 6; i++) {
    probe.position.copy(c).addScaledVector(dir, d); probe.lookAt(c); probe.updateMatrixWorld(true)
    d *= Math.max(...pts.map(p => { const q = p.clone().project(probe); return Math.max(Math.abs(q.x) / (1 - mx / W), Math.abs(q.y) / (1 - my / H)) }))
  }
  return { target: c, dist: d }
}
