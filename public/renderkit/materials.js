/* The materials a builder or a gardener names (U3618): one list for the page, the picture an agent looks at, the IFC file
   and the amounts. Pure: no three.js, no DOM (materials-three.js makes three's materials from it).

   Each entry, keyed by the word the tools take (concrete, gravel, …):
     no, en      its name in Norwegian and in English
     colour      the flat colour the page and look.js draw it in (opaque: where it is drawn without see-through)
     card        the FreeCAD material card it is, from FreeCAD's Material workbench (Resources/Materials, as the worker's
                 FreeCAD ships it): uuid, name, file, author, license, density (kg/m³), code (StandardCode, where the card has
                 one). The IFC file names the material by the card's name. null where FreeCAD has no card for it
     density     kg/m³: the card's, or for an entry with no card a typical bulk figure (density_from says which), so a
                 volume can say tonnes
     hatch       the FreeCAD hatch pattern (Patterns/Pattern Files) the plan and a section draw it with: hatch-<name>.svg here
     texture     the ambientCG set (CC0) a 3D view lays on it: set, tile [m across, m up the picture]; null: the flat colour
                 and its look (glass, steel, water are drawn by their settings, not a picture)
     look        three's material settings beside the colour (roughness, metalness, opacity …)
     category    IfcMaterial.Category (IFC4's suggested values)
     kind        "building" (a volume, a balcony, a part), "ground" (a surface or a path), or both
   Credits: docs/credits.txt (the cards CC-BY-3.0 or LGPL, the hatches CC-BY-4.0, the pictures CC0). */

export const MATERIALS = {
  concrete: {
    no: "Betong", en: "Concrete", colour: "#ddd8cc", kind: ["building"],
    card: { uuid: "26042aa5-56e6-4d99-8b63-dd8b9ea5a37a", name: "Concrete", file: "Standard/Aggregate/Concrete-Generic.FCMat", author: "Yorik van Havre", license: "CC-BY-3.0", density: 2400, code: "Masterformat 03 33 13" },
    density: 2400, density_from: "card", hatch: "concrete", texture: { set: "Concrete034", tile: [1.1, 1.1] }, look: { roughness: 0.9 }, category: "concrete",
  },
  glass: {
    no: "Glass", en: "Glass", colour: "#cfe6e2", opaque: "#a8d8cf", kind: ["building"],   // opaque: drawn without see-through (look.js)
    card: { uuid: "3e3a3e13-04a4-410e-8e36-bbd83ca66847", name: "Glass", file: "Standard/Glass/Glass-Generic.FCMat", author: "Przemo Firszt", license: "CC-BY-3.0", density: 2520, code: null },
    density: 2520, density_from: "card", hatch: "glass", texture: null, look: { transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.1, depthWrite: false }, category: "glass",
  },
  /* U3656: the glazing of a facade, seen from outside: the same glass (card), dark blue-grey and near-opaque so it reads in a wall,
     smooth and half metal so the sky shows in it. `glass` stays see-through for a greenhouse or a conservatory. Not a building choice
     (kind facade): a person asks for glass, the IFC window is drawn in this */
  window_glass: {
    no: "Vindusglass", en: "Window glass", colour: "#5f8398", opaque: "#5f8398", kind: ["facade"],
    card: { uuid: "3e3a3e13-04a4-410e-8e36-bbd83ca66847", name: "Glass", file: "Standard/Glass/Glass-Generic.FCMat", author: "Przemo Firszt", license: "CC-BY-3.0", density: 2520, code: null },
    density: 2520, density_from: "card", hatch: "glass", texture: null, look: { roughness: 0.03, metalness: 0.9, envMapIntensity: 2 }, category: "glass",
  },
  steel: {
    no: "Stål", en: "Steel", colour: "#8e9297", kind: ["building"],
    card: { uuid: "90bbd8ef-8623-4d78-b3bf-e0bdb9b74dd3", name: "Steel-Generic", file: "Standard/Metal/Steel/Steel-Generic.FCMat", author: "Juergen Riegel", license: "CC-BY-3.0", density: 7900, code: null },
    density: 7900, density_from: "card", hatch: "steel", texture: null, look: { roughness: 0.5, metalness: 0.4 }, category: "steel",
  },
  wood: {
    no: "Tre", en: "Wood", colour: "#b48a5a", kind: ["building", "ground"],
    card: { uuid: "b588224e-e8d6-47ad-ba1f-a058333fd1c6", name: "Wood", file: "Standard/Wood/Wood-Generic.FCMat", author: "Bernd Hahnebach", license: "CC-BY-3.0", density: 700, code: null },
    density: 700, density_from: "card", hatch: "wood", texture: { set: "Planks037A", tile: [2, 2] }, look: { roughness: 0.8 }, category: "wood",
  },
  brick: {
    no: "Tegl", en: "Brick", colour: "#a65b44", kind: ["building"], card: null,
    density: 1800, density_from: "typical solid clay brick", hatch: "brick01", texture: { set: "Bricks097", tile: [3, 1.5] }, look: { roughness: 0.9 }, category: "brick",
  },
  grass: {
    no: "Plen", en: "Lawn", colour: "#a3c072", kind: ["ground"], card: null,
    density: null, density_from: null, hatch: "earth", texture: { set: "Grass005", tile: [2, 2] }, look: { roughness: 1 }, category: "earth",
  },
  meadow: {
    no: "Eng", en: "Meadow", colour: "#bcc47e", kind: ["ground"], card: null,
    density: null, density_from: null, hatch: "earth", texture: null, look: { roughness: 1 }, category: "earth",
  },
  planting: {
    no: "Beplantning", en: "Planting bed", colour: "#6f8c4c", kind: ["ground"], card: null,
    density: null, density_from: null, hatch: "earth", texture: null, look: { roughness: 1 }, category: "earth",
  },
  gravel: {
    no: "Grus", en: "Gravel", colour: "#d3cab6", kind: ["ground"], card: null,
    density: 1700, density_from: "typical loose gravel", hatch: "earth", texture: { set: "Gravel023", tile: [1.5, 1.5] }, look: { roughness: 1 }, category: "earth",
  },
  paving: {
    no: "Belegningsstein", en: "Paving stones", colour: "#bdb6aa", kind: ["ground"], card: null,
    density: 2300, density_from: "typical concrete pavers", hatch: "concrete", texture: { set: "PavingStones138", tile: [1.25, 2.5] }, look: { roughness: 0.9 }, category: "concrete",
  },
  asphalt: {
    no: "Asfalt", en: "Asphalt", colour: "#66655f", kind: ["ground"], card: null,
    density: 2300, density_from: "typical asphalt concrete", hatch: "solid", texture: { set: "Asphalt033", tile: [2.5, 2.5] }, look: { roughness: 0.95 }, category: "asphalt",
  },
  water: {
    no: "Vann", en: "Water", colour: "#7fa8c2", kind: ["ground"],
    card: { uuid: "7e5559d5-be15-4571-a72f-20c39edd41cf", name: "Water", file: "Fluid/Water.FCMat", author: "Qingfeng Xia", license: "LGPL-2.1-or-later", density: 998, code: null },
    density: 998, density_from: "card", hatch: "hatch45L", texture: null, look: { roughness: 0.1, metalness: 0 }, category: "water",
  },
  soil: {
    no: "Jord", en: "Soil", colour: "#8a7458", kind: ["ground"], card: null,
    density: 1800, density_from: "typical moist soil, as dug", hatch: "earth", texture: null, look: { roughness: 1 }, category: "earth",
  },
};

/* the FreeCAD hatch cards the entries name (Patterns/Pattern Files, David Carter, CC-BY-4.0): the picture is hatch-<name>.svg */
export const HATCHES = {
  concrete: "39221178-f9a4-40f5-927f-eed2f17c748d", wood: "c693952c-5f5a-4f8f-9e6f-714464219a8b", glass: "0f8f1e63-885e-4940-a562-afed029b172a",
  steel: "e8555d5c-c9ff-458f-9ad3-ecabd02b5327", brick01: "37b63834-928e-444c-a1b7-49a3f3fba3d1", earth: "94149a01-f4ad-4e6a-a6df-acb3ea97eb0b",
  hatch45L: "f2421e27-1b54-4c6e-8da9-e0be3f1783a5", solid: "d7c6b577-b41b-4d4b-a2b3-2139a1a9a7af",
};

export const BUILDING = Object.keys(MATERIALS).filter(k => MATERIALS[k].kind.includes("building"));   // concrete, glass, steel, wood, brick
/* the IFC classes a construction's parts come in, and the material each is drawn in when the part does not say */
export const CLASS_MAT = { IfcMember: "steel", IfcAnnotation: "steel", IfcBeam: "steel", IfcColumn: "steel", IfcRailing: "steel", IfcPlate: "glass", IfcWindow: "window_glass", IfcCurtainWall: "glass",
  IfcSlab: "concrete", IfcWall: "concrete", IfcFooting: "concrete", IfcStair: "concrete", IfcRoof: "concrete", IfcDoor: "wood", IfcCovering: "wood", IfcFurnishingElement: "wood" };

export const materialOf = key => MATERIALS[key] || null;
export const nameOf = (key, lang = "no") => MATERIALS[key]?.[lang] ?? key;
/* the material's weight for a volume in m³: tonnes to 0.1, or null where it has no density */
export const tonnes = (key, m3) => MATERIALS[key]?.density ? Math.round(m3 * MATERIALS[key].density / 100) / 10 : null;
/* what an IFC file says of it: IfcMaterial's Name (the card's name where there is a card), Description and Category */
export const ifcMaterial = key => {
  const m = MATERIALS[key]; if (!m) return null;
  return { name: m.card?.name || m.en, description: m.no, category: m.category, card: m.card?.uuid || null };
};
