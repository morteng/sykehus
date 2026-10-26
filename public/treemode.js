/* U3676: the trees' three states (full, simple, off), the order the button cycles them in, and the words on screen */
export const TREE_MODES = ["full", "simple", "off"];
export const TREE_NO = { full: "full", simple: "enkel", off: "av" };
export const nextTree = m => TREE_MODES[(TREE_MODES.indexOf(m) + 1) % TREE_MODES.length] || "full";
export const treeTitle = m => `Trær: ${TREE_NO[m]}. Trykk for ${TREE_NO[nextTree(m)]}`;
