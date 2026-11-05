// The look library (U4458, plan U4451): one physically based record per look in looklib.json, read by every preview. Pure, no three.js:
// looks.js turns a record into materials. Field names follow three's MeshPhysicalMaterial and glTF KHR_materials_*; lengths in mm.

export const BASES = ['measured', 'sourced', 'guessed']
export const FALLBACK = 'steel-satin'

// what a part of this kind looks like when it names no finish; an id missing from the library falls through to a flat look from the part's colour
export const KIND_LOOKS = {
  plywood: 'ply-birch', acrylic: 'acrylic-clear', filament: 'pla', pla: 'pla', petg: 'petg', tpu: 'tpu',
  plastic: 'plastic', steel: 'steel-satin', aluminium: 'aluminium', brass: 'brass', copper: 'copper', fr4: 'fr4',
  rubber: 'rubber', glass: 'glass', ceramic: 'ceramic', battery: 'battery',
  mdf: 'mdf', osb: 'osb', bamboo: 'bamboo', pine: 'pine', basswood: 'basswood', okoume: 'okoume',
}
// name hints within a kind, first match wins
const HINTS = {
  plywood: [[/walnut|valn[øo]tt/i, 'ply-walnut'], [/birch|bj[øo]rk/i, 'ply-birch'], [/poplar|poppel/i, 'ply-poplar'], [/oak|eik/i, 'ply-oak'], [/okoum/i, 'okoume']],
  acrylic: [[/opal/i, 'acrylic-opal'], [/clear|transparent|klar/i, 'acrylic-clear']],
  filament: [[/petg/i, 'petg'], [/tpu/i, 'tpu'], [/pla/i, 'pla']],
}

const loaded = new Map()
// the library from its url, once per page (a failed fetch is tried again); -> {id: record}
export function loadLooks(url) {
  if (!loaded.has(url)) loaded.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() }).then(indexLooks).catch(e => { loaded.delete(url); throw e }))
  return loaded.get(url)
}
export const indexLooks = list => Object.fromEntries(list.map(r => [r.id, r]))

// a colour as '#rrggbb', from '#rgb', '#rrggbb', 'rrggbb' or a number; null when it is none of them
export function hexOf(c) {
  if (typeof c === 'number') return Number.isInteger(c) && c >= 0 && c <= 0xffffff ? '#' + c.toString(16).padStart(6, '0') : null
  const m = typeof c === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return '#' + (h.length === 3 ? [...h].map(x => x + x).join('') : h)
}
export const hexNum = c => parseInt(hexOf(c).slice(1), 16)

// the look of a part: {id, tint}. By order: rec.finish, rec.look, KIND_LOOKS[rec.kind] (its name hints first: rec.name or rec.material),
// a flat look from rec.colour, steel-satin. tint: the part's colour as '#rrggbb' for a look that takes one (a spool's, a plain colour), else null.
export function lookFor(rec, looks) {
  rec = rec || {}
  const has = id => typeof id === 'string' && Object.hasOwn(looks, id)
  const tinted = id => looks[id].cat === 'filament' || id === 'flat'
  const done = id => ({ id, tint: tinted(id) ? hexOf(rec.colour) : null })
  if (has(rec.finish)) return done(rec.finish)
  if (has(rec.look)) return done(rec.look)
  const kind = typeof rec.kind === 'string' ? rec.kind.toLowerCase() : ''
  const text = `${rec.name || ''} ${rec.material || ''}`
  for (const [re, id] of HINTS[kind] || []) if (re.test(text) && has(id)) return done(id)
  if (has(KIND_LOOKS[kind])) return done(KIND_LOOKS[kind])
  const colour = hexOf(rec.colour)
  if (colour && has('flat')) return { id: 'flat', tint: colour }
  return { id: FALLBACK, tint: null }
}

// the credits to show for these look ids: [{id, licence, credit}] for those that need one, one per credit line
export function credits(ids, looks) {
  const seen = new Set(), out = []
  for (const id of ids) {
    const r = looks?.[id]
    if (!r?.credit || seen.has(r.credit)) continue
    seen.add(r.credit); out.push({ id, licence: r.licence, credit: r.credit })
  }
  return out
}
