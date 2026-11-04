/* U3966: the tool's own household words (nb and en), served in tools/list under _meta["no.gulden/words"], so the chat
   card needs no table in gulden-ai. nb is the tool's title (and its group, FAMILY); en is EN below, else the nb title
   (a new tool shows its card words at once; an English title is added here, or as `en:` on the tool). */
import { FAMILY } from "./toolguide.mjs";
export const WORDS_KEY = "no.gulden/words";
export const EN = {
  about_site: "The site and the wings", site_facts: "The site's hazards and heritage", heritage_records: "Heritage records around the site", about_wing: "One wing",
  storeys: "The storeys", floor_plan: "One storey: rooms and areas", openings: "Windows and doors in a facade", try_change: "Try a change", propose_sketch: "Show a sketch first",
  show_draft: "See a draft or a version", make_shots: "Make a picture series", undo_change: "Undo a change", redo_change: "Redo an undone change", list_wishes: "My wishes",
  new_version: "New version", photo_spots: "My photo spots", list_site_photos: "My pictures of the building", look_at_site_photo: "Look at a picture of the building",
  about_ground: "The ground around a place", ask_point: "Ask for a point on the plan", retake_photos: "Take new pictures from the photo spots", list_versions: "The versions",
  delete_version: "Delete versions", undelete_version: "Bring deleted versions back", set_sharing: "Who sees the version", send_wish: "Send a wish",
  check_design: "Check against the building rules", measure: "Measure and read back", shadow_view: "Shadow and view toward the neighbours", summary: "Area, quantities and cost", check_fit: "Do the parts fit together",
  check_model: "Check the BIM model", export_ifc: "Export to IFC for FreeCAD", list_parts: "Ready-made parts", find_models: "Find models in open libraries", upload_url: "A link for a file", add_site_photo: "Add a picture of the building", fetch_model: "Fetch a model",
  rename_version: "Rename the version", search_documents: "Search the documents", read_document: "Read a document", list_documents: "Document list", look: "Look at the model",
  show_building: "Show the building", find_tool: "Find the right tool", start: "Start with the building", tool_map: "Tool map",
};
export const toolWords = t => {
  const nb = { title: t.fullTitle ?? t.title }, en = { title: t.en ?? EN[t.name] ?? nb.title };
  if (FAMILY[t.name]) nb.group = FAMILY[t.name];
  return { nb, en };
};
