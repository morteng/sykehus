/* What setAdded (viewer.js) does with the new buildings when the after changes: one that is the same as it was drawn keeps its
   group (its triangles are not built again, and a construction's mesh is not fetched or laid out again); only a changed or a
   new one is drawn, and one that is gone is taken away. Pure, so a test can pin it: keys is id -> the key it was drawn with. */
export const addedKey = a => JSON.stringify(a);
export function planAdded(keys, list) {
  const next = new Map((list || []).map(a => [a.id, addedKey(a)]));
  const keep = [], draw = [], drop = [];
  for (const a of list || []) (keys.get(a.id) === next.get(a.id) ? keep : draw).push(a.id);
  for (const id of keys.keys()) if (!next.has(id) || draw.includes(id)) drop.push(id);
  return { keep, draw, drop, keys: next };
}
