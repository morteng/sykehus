// The still's key (U4461): the one string a still is filed under, and its sha256. Fab (Python, U4463) builds the SAME string;
// the exact format is in README.md «The still key». No three.js, no DOM. A change to anything that changes the picture changes
// the key: the geometry, the bought parts, each look and its version and tint, the scene, the camera, the size, the kit, the quality.
//
// stillKey is async because WebCrypto's digest is: globalThis.crypto.subtle works in browsers and in node >= 19 (no import), so
// the same call runs in the page and in node --test.

const KEY_FORMAT = 'stillkey/1'

const ID = /^[A-Za-z0-9._+-]{1,80}$/
const word = (what, s) => { s = String(s ?? ''); if (!ID.test(s)) throw new Error(`stillkey: ${what} «${s}» must be 1-80 of A-Z a-z 0-9 . _ + -`); return s }
const int = (what, n) => { if (!Number.isInteger(n) || n < 0) throw new Error(`stillkey: ${what} must be a whole number >= 0, got ${n}`); return String(n) }
const hex6 = t => { const m = /^#?([0-9a-fA-F]{6})$/.exec(String(t)); if (!m) throw new Error(`stillkey: tint «${t}» must be #rrggbb`); return m[1].toLowerCase() }
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)      // by UTF-16 code unit, never localeCompare

// [id, v] or [id, v, tint] -> "id:v" or "id:v:rrggbb"; camera and scene may be {id, v}, [id, v] or an id (v 0)
const pair = (what, x) => {
  const [id, v] = Array.isArray(x) ? x : typeof x === 'object' && x ? [x.id, x.v] : [x, 0]
  return `${word(what + ' id', id)}:${int(what + ' v', v ?? 0)}`
}

// -> the canonical string. looks: [[id, v, tint?], ...] in any order; models: the bought parts' key ('' when none)
export function stillKeyInput({ geom, models = '', looks = [], scene, camera, size, kit, quality }) {
  if (!Array.isArray(size) || size.length !== 2) throw new Error('stillkey: size must be [w, h]')
  const ls = looks.map(l => `${pair('look', l)}${l[2] == null ? '' : ':' + hex6(l[2])}`).sort(cmp)
  return [
    KEY_FORMAT,
    'geom=' + word('geom', geom),
    'models=' + (models === '' || models == null ? '' : word('models', models)),
    'looks=' + ls.join(';'),
    'scene=' + pair('scene', scene),
    'camera=' + pair('camera', camera),
    `size=${int('width', size[0])}x${int('height', size[1])}`,
    'kit=' + word('kit', kit),
    'quality=' + word('quality', quality),
  ].join('\n')
}

// -> sha256 hex (64 lowercase chars) of the string's UTF-8 bytes. Takes the input object, or a string already built
export async function stillKey(input) {
  const s = typeof input === 'string' ? input : stillKeyInput(input)
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
