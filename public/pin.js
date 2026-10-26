/* A pin on the ground (U3671): where the person tapped when Anton asked for a place. A red ball on a thin stalk, sized to the view so it
   reads from the plan's 90 m and from 3D; one at a time. dropPin(viewer, [x, y, kote]) puts it, clearPin() takes it away. */
import * as THREE from "./vendor/three.module.js";

let current = null;
export function clearPin(viewer) { if (current) { viewer.remove(current); current = null; } }
export function dropPin(viewer, [x, y, kote = 0]) {
  clearPin(viewer);
  const s = Math.max(0.5, (viewer.pose().dist || 90) / 90), g = new THREE.Group(), red = new THREE.MeshBasicMaterial({ color: 0xc62828, depthTest: false }), white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 5 * s, 8), red); stalk.position.y = 2.5 * s;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 16, 12), red); ball.position.y = 5.2 * s;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35 * s, 12, 8), white); dot.position.y = 5.2 * s; dot.position.z = 0.7 * s;
  for (const m of [stalk, ball, dot]) { m.renderOrder = 30; g.add(m); }
  g.position.copy(viewer.world([x, y], kote)); viewer.add(g); current = g;
  return () => clearPin(viewer);
}
