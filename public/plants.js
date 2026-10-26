/* The plants Anton can set on the site: hagekart's list (~/Projects/hagekart public/plants.json at e636f49, 2026-10-25),
   the same ids its search_plants and check_species give, with height and spread in metres (ht, sp) to size them in 3D.
   banned: forbidden to plant in Norway (forskrift om fremmede organismer), as hagekart has it; never planted here.
   Copied by hand (the categories but bulbs and none, and every banned one); hagekart is the authority, so copy again when its list grows. */
export const PLANTS = [
  {"id":"tre","no":"Tre (ukjent art)","la":"","cat":"tree","ht":10,"sp":6,"form":"round"},
  {"id":"busk","no":"Busk (ukjent art)","la":"","cat":"shrub_old","ht":2,"sp":1.5,"form":"dome"},
  {"id":"gran","no":"Gran","la":"Picea abies","cat":"conifer","ht":25,"sp":6,"form":"cone"},
  {"id":"furu","no":"Furu","la":"Pinus sylvestris","cat":"conifer","ht":20,"sp":7,"form":"pine"},
  {"id":"bjork","no":"Hengebjørk","la":"Betula pendula","cat":"tree","ht":20,"sp":8,"form":"birch"},
  {"id":"rogn","no":"Rogn","la":"Sorbus aucuparia","cat":"tree","ht":10,"sp":5,"form":"round"},
  {"id":"hegg","no":"Hegg","la":"Prunus padus","cat":"tree","ht":10,"sp":6,"form":"round"},
  {"id":"lind","no":"Lind","la":"Tilia cordata","cat":"tree","ht":25,"sp":14,"form":"round"},
  {"id":"bok","no":"Bøk","la":"Fagus sylvatica","cat":"tree","ht":28,"sp":18,"form":"round"},
  {"id":"eik","no":"Sommereik","la":"Quercus robur","cat":"tree","ht":25,"sp":18,"form":"round"},
  {"id":"kastanje","no":"Hestekastanje","la":"Aesculus hippocastanum","cat":"tree","ht":22,"sp":15,"form":"round"},
  {"id":"lonn","no":"Spisslønn","la":"Acer platanoides","cat":"tree","ht":20,"sp":12,"form":"round"},
  {"id":"japlonn","no":"Japansk lønn","la":"Acer palmatum","cat":"tree","ht":4,"sp":3,"form":"mound"},
  {"id":"aroma","no":"Eple 'Aroma'","la":"Malus domestica 'Aroma'","cat":"fruit","ht":4,"sp":4,"form":"round"},
  {"id":"gravenstein","no":"Eple 'Gravenstein'","la":"Malus domestica 'Gravenstein'","cat":"fruit","ht":5,"sp":5,"form":"round"},
  {"id":"opal","no":"Plomme 'Opal'","la":"Prunus domestica 'Opal'","cat":"fruit","ht":4,"sp":3.5,"form":"round"},
  {"id":"syrin","no":"Syrin","la":"Syringa vulgaris","cat":"shrub_old","ht":4,"sp":2.5,"form":"vase"},
  {"id":"hortensia","no":"Hagehortensia","la":"Hydrangea macrophylla","cat":"shrub_old","ht":1.5,"sp":1.2,"form":"dome"},
  {"id":"limelight","no":"Syrinhortensia 'Limelight'","la":"Hydrangea paniculata 'Limelight'","cat":"shrub_new","ht":2,"sp":1.8,"form":"vase"},
  {"id":"rhodo","no":"Rododendron","la":"Rhododendron catawbiense","cat":"shrub_old","ht":2,"sp":1.5,"form":"dome"},
  {"id":"grefsheim","no":"Spirea 'Grefsheim'","la":"Spiraea × cinerea 'Grefsheim'","cat":"shrub_old","ht":1.5,"sp":1.5,"form":"arch"},
  {"id":"kornell","no":"Kornell 'Sibirica'","la":"Cornus alba 'Sibirica'","cat":"shrub_new","ht":2.5,"sp":2,"form":"vase"},
  {"id":"buksbom","no":"Buksbom","la":"Buxus sempervirens","cat":"hedge","ht":1,"sp":0.6,"form":"clipped"},
  {"id":"smaragd","no":"Tuja 'Smaragd'","la":"Thuja occidentalis 'Smaragd'","cat":"hedge","ht":4,"sp":1,"form":"column"},
  {"id":"liguster","no":"Liguster 'Atrovirens'","la":"Ligustrum vulgare 'Atrovirens'","cat":"hedge","ht":2,"sp":0.8,"form":"clipped"},
  {"id":"poppius","no":"Rose 'Poppius'","la":"Rosa × poppiusii 'Poppius'","cat":"rose","ht":1.5,"sp":1.2,"form":"arch"},
  {"id":"gloriadei","no":"Edelrose 'Gloria Dei'","la":"Rosa 'Gloria Dei'","cat":"rose","ht":1,"sp":0.7,"form":"arch"},
  {"id":"pion","no":"Pion 'Sarah Bernhardt'","la":"Paeonia lactiflora 'Sarah Bernhardt'","cat":"perennial","ht":0.9,"sp":0.9,"form":"clump"},
  {"id":"hosta","no":"Hosta","la":"Hosta sieboldiana","cat":"perennial","ht":0.7,"sp":0.8,"form":"rosette"},
  {"id":"bergenia","no":"Bergenia","la":"Bergenia cordifolia","cat":"perennial","ht":0.4,"sp":0.5,"form":"rosette"},
  {"id":"ridderspore","no":"Ridderspore","la":"Delphinium × elatum","cat":"perennial","ht":1.8,"sp":0.6,"form":"spike"},
  {"id":"akeleie","no":"Akeleie","la":"Aquilegia vulgaris","cat":"perennial","ht":0.7,"sp":0.4,"form":"clump"},
  {"id":"kattemynte","no":"Kattemynte 'Walker's Low'","la":"Nepeta × faassenii 'Walker's Low'","cat":"perennial","ht":0.5,"sp":0.6,"form":"mound"},
  {"id":"solhatt","no":"Purpursolhatt","la":"Echinacea purpurea","cat":"perennial","ht":1,"sp":0.5,"form":"clump"},
  {"id":"hagelupin","no":"Hagelupin","la":"Lupinus polyphyllus","cat":"none","ht":1.2,"sp":0.6,"form":"spike","banned":true},
  {"id":"rynkerose","no":"Rynkerose","la":"Rosa rugosa","cat":"none","ht":1.5,"sp":1.5,"form":"arch","banned":true},
  {"id":"parkslirekne","no":"Parkslirekne","la":"Reynoutria japonica","cat":"none","ht":3,"sp":2,"form":"vase","banned":true},
];

/* U3655: the species picker's search over the list above: by Norwegian or Latin name or id, accents and case ignored; the
   banned ones come back too, with the reason, so the picker shows them greyed and the server (landscape.js plantOf) still refuses them */
const fold = t => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a");
export const BANNED_WHY = "Forbudt å plante i Norge (forskrift om fremmede organismer)";
export function searchPlants(q, limit = 8) {
  const k = fold(q).trim(); if (!k) return [];
  return PLANTS.filter(p => p.id !== "tre" && p.id !== "busk" && [p.no, p.la, p.id].some(v => fold(v).includes(k)))
    .sort((a, b) => (fold(b.no).startsWith(k) - fold(a.no).startsWith(k)) || a.no.localeCompare(b.no, "nb")).slice(0, limit)
    .map(p => ({ id: p.id, no: p.no, la: p.la, cat: p.cat, ht: p.ht, sp: p.sp, banned: !!p.banned, ...(p.banned ? { why: BANNED_WHY } : {}) }));
}
