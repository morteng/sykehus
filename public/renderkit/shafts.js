/* renderkit shafts (U3887): soft light shafts and a little more haze for a PICTURE (a photo-mode render), never for the live view.
   The classic screen-space "god rays": the sky is a mask (white where nothing is drawn, black where the model or ground is), and each
   pixel adds up that mask along the line toward the sun's place on the screen, so gaps in the skyline and between trees throw rays
   from the sun. One pass over a half-size mask, put on top of the finished picture with a screen blend (1-(1-a)(1-b)) so it can
   lighten but never blow out; the gain is capped. Costs one extra scene draw and one quad, once per picture; the live loop never calls it.
   Needs the weather (atmosphere.js) for the sun's height, the sky dome and the haze. Off for a parallel camera, for a sun below the
   horizon, and for a sun behind the camera or far outside the frame. Pure parts (sunScreen, shaftStrength, hazeFor, shaftPlan) test
   without a browser; three.js comes in as an argument.
     const sh = createShafts({ THREE, renderer });
     sh.shoot(scene, cam, { atm, sunDir, draw });   // sunDir: unit vector from the scene toward the sun; draw(cam) is the app's own draw
     sh.dispose(); */

export const SHAFTS = { gain: 0.3, decay: 0.965, steps: 56, maskScale: 0.5, margin: 0.6, hazeMax: 0.3 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* where the sun is in the picture. cam: { forward, right, up } unit vectors in the world, fovY in degrees, aspect = width / height.
   → { x, y } in 0..1 over the picture (y down; outside 0..1 = off the picture), front (the sun is ahead of the lens), out (how far
   outside the picture, in picture-heights; 0 when inside) */
export function sunScreen(dir, { forward, right, up, fovY, aspect, shift = [0, 0] }) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], f = dot(dir, forward);
  if (!(f > 1e-4)) return { x: 0.5, y: 0.5, front: false, out: Infinity };
  const t = Math.tan(fovY * Math.PI / 360), nx = dot(dir, right) / f / (t * aspect) - shift[0], ny = dot(dir, up) / f / t - shift[1];   // -1..1 over the picture; shift = a lens shift (projectionMatrix elements 8 and 9)
  const x = (nx + 1) / 2, y = (1 - ny) / 2, ox = Math.max(0, -x, x - 1) * aspect, oy = Math.max(0, -y, y - 1);
  return { x, y, front: true, out: Math.hypot(ox, oy) };
}
/* how strong the shafts are by the sun's height (degrees): none at or under the horizon, full by 6 degrees, thinner as the sun climbs (high noon throws none worth seeing) */
export const shaftStrength = el => (el > 0 ? smooth(0, 6, el) * (1 - 0.7 * smooth(30, 70, el)) : 0);
/* the share by which the haze pulls in (fog distances divided by 1 + this): most with a low sun, none at night */
export const hazeFor = el => SHAFTS.hazeMax * shaftStrength(el);
/* the plan for one picture: { on, strength (0..1), sun: [x, y over the picture, y UP for the shader], haze }. ortho = a parallel camera */
export function shaftPlan({ ortho = false, elevation, sun }) {
  const s = shaftStrength(elevation), near = sun?.front ? 1 - smooth(0, SHAFTS.margin, sun.out) : 0, strength = s * near;
  if (ortho || !(strength > 0.01)) return { on: false, strength: 0, sun: null, haze: 0 };
  return { on: true, strength, sun: [sun.x, 1 - sun.y], haze: hazeFor(elevation) };
}

const QUAD_V = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const QUAD_F = `precision highp float; uniform sampler2D tMask; uniform vec2 uSun; uniform float uStrength, uGain, uDecay; uniform vec3 uTint; varying vec2 vUv;
const int N = ${SHAFTS.steps};
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 d = uSun - vUv; float len = length(d);
  vec2 stepv = d / float(N) * 0.92; vec2 uv = vUv + stepv * hash(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++) { acc += texture2D(tMask, uv).r * w; wsum += w; w *= uDecay; uv += stepv; }
  float ray = acc / wsum * (1.0 - smoothstep(0.15, 1.3, len) * 0.8);          // fades with distance from the sun
  float a = (1.0 - exp(-2.2 * ray * ray)) * uGain * uStrength;                // soft shoulder; never past uGain
  gl_FragColor = vec4(uTint * a, 1.0);
}`;

export function createShafts({ THREE, renderer }) {
  let target = null, quad = null, scn = null, cam = null;
  const ensure = () => {
    if (quad) return;
    quad = new THREE.ShaderMaterial({
      vertexShader: QUAD_V, fragmentShader: QUAD_F, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor,
      uniforms: { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uStrength: { value: 0 }, uGain: { value: SHAFTS.gain }, uDecay: { value: SHAFTS.decay }, uTint: { value: new THREE.Vector3(1, 0.93, 0.8) } },
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quad); m.frustumCulled = false;
    scn = new THREE.Scene(); scn.add(m); cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  };
  const api = {
    /* draw the picture with a little more haze, then lay the shafts over it. Without shafts (parallel camera, sun out of reach) it is just draw(camera). */
    shoot(scene, camera, { atm, sunDir, draw }) {
      const e = camera.matrixWorld.elements, v = i => [e[i], e[i + 1], e[i + 2]];
      const plan = shaftPlan({
        ortho: !camera.isPerspectiveCamera, elevation: atm.elevation,
        sun: camera.isPerspectiveCamera ? sunScreen(sunDir, { forward: v(8).map(x => -x), right: v(0), up: v(4), fovY: camera.fov, aspect: camera.aspect, shift: camera.projectionMatrix ? [camera.projectionMatrix.elements[8], camera.projectionMatrix.elements[9]] : [0, 0] }) : null,
      });
      if (!plan.on) { draw(camera); return plan; }
      atm.haze = 1 + plan.haze;
      try { draw(camera); } finally { atm.haze = 1; }
      api.overlay(scene, camera, plan, atm);
      return plan;
    },
    overlay(scene, camera, plan, atm) {
      ensure();
      const size = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, Math.round(size.x * SHAFTS.maskScale)), h = Math.max(2, Math.round(size.y * SHAFTS.maskScale));
      if (!target || target.width !== w || target.height !== h) { target?.dispose(); target = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }); }
      /* the mask: everything black, the sky dome gone, no fog, the clear colour white; anything that is not a mesh is hidden */
      const hid = [], prevBg = scene.background, prevFog = scene.fog, prevOver = scene.overrideMaterial, prevBefore = scene.onBeforeRender, domeShown = atm.dome?.visible;
      const clear = new THREE.Color(), clearA = renderer.getClearAlpha(), prevT = renderer.getRenderTarget(), prevAuto = renderer.autoClear; renderer.getClearColor(clear);
      scene.traverse(o => { if (o.visible && (o.isLine || o.isPoints || o.isSprite)) { o.visible = false; hid.push(o); } });
      try {
        if (atm.dome) atm.dome.visible = false;
        scene.background = null; scene.fog = null; scene.onBeforeRender = () => {};
        scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false, toneMapped: false });
        renderer.setRenderTarget(target); renderer.setClearColor(0xffffff, 1); renderer.autoClear = true; renderer.render(scene, camera);
        scene.overrideMaterial.dispose();
      } finally {
        scene.overrideMaterial = prevOver; scene.background = prevBg; scene.fog = prevFog; scene.onBeforeRender = prevBefore;
        if (atm.dome) atm.dome.visible = domeShown; for (const o of hid) o.visible = true;
        renderer.setRenderTarget(prevT); renderer.setClearColor(clear, clearA);
      }
      /* the shafts: warm, on top of the finished picture */
      const u = quad.uniforms; u.tMask.value = target.texture; u.uSun.value.set(plan.sun[0], plan.sun[1]); u.uStrength.value = plan.strength;
      renderer.autoClear = false;
      try { renderer.render(scn, cam); } finally { renderer.autoClear = prevAuto; }
    },
    dispose() { target?.dispose(); quad?.dispose(); scn?.children[0]?.geometry.dispose(); target = quad = scn = cam = null; },
  };
  return api;
}
