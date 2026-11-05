// The still cameras (U4461): the named shots a still is taken from. Plain data plus the one direction function; the framing is
// camera.js frame(), not a copy. Fab and the apps read the same list, and a still's key holds {id, v}: change a shot's numbers
// and bump its v.
//
// azimuth_deg / elevation_deg: the camera seen from the target, z up, azimuth 0 looks along +y (camera.js stateOf); 0 elevation is
// level, 90 straight down. fov_deg is the vertical field of view. fit: the share of the picture's width and height kept clear
// round the model (frame() takes it as pixel margins). exploded: the model is drawn pulled apart.
// dof: the physical camera (focal_mm on a sensor [w, h] mm, f_stop), for the hero shot ONLY (hero_only); the other shots are pinhole.
import { frame } from './camera.js'

export const CAMERAS = [
  { id: 'hero', v: 1, en: 'Hero 3/4', no: 'Hero 3/4', azimuth_deg: 35, elevation_deg: 25, fov_deg: 25, fit: 0.08, exploded: false,
    dof: { hero_only: true, focal_mm: 54, f_stop: 4, sensor: [36, 24] } },
  { id: 'front', v: 1, en: 'Front', no: 'Forfra', azimuth_deg: 0, elevation_deg: 0, fov_deg: 25, fit: 0.08, exploded: false },
  { id: 'top', v: 1, en: 'Top', no: 'Ovenfra', azimuth_deg: 0, elevation_deg: 90, fov_deg: 25, fit: 0.08, exploded: false },
  { id: 'side', v: 1, en: 'Side', no: 'Fra siden', azimuth_deg: 90, elevation_deg: 0, fov_deg: 25, fit: 0.08, exploded: false },
  { id: 'exploded', v: 1, en: 'Exploded', no: 'Eksplodert', azimuth_deg: 35, elevation_deg: 30, fov_deg: 25, fit: 0.12, exploded: true },
]

export const cameraFor = id => CAMERAS.find(c => c.id === id) || null

// the unit vector from the target to the camera (the `dir` camera.js frame() and moveCamera take); a top view is tipped a hair so lookAt keeps an up
export function dirOf(c) {
  const az = c.azimuth_deg * Math.PI / 180, el = Math.min(c.elevation_deg, 89.9) * Math.PI / 180
  return [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)]
}

// {target, dist} for a box of three (T) seen from this shot on a W x H picture: camera.js frame() with the shot's direction and margins
export function frameShot(T, cam, box, c, W, H) {
  const [x, y, z] = dirOf(c)
  return frame(T, cam, box, new T.Vector3(x, y, z), W, H, c.fit * W, c.fit * H)
}
