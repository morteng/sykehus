// Skills over MCP (SEP-2640 Final), U5246: the bygg skills on the sykehus server.
// skills/list gives every skill a complete manifest (each file's uri, sha256 digest, byte size); skills/get gives one;
// an unknown uri is -32602. A SKILL.md and its references are also readable through resources/read at their skill:// uri.
// Bodies are English curriculum (patterns, common failures); every backticked name must be a real tool (the test proves it).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXTENSION_ID = "io.modelcontextprotocol/skills";

const SKILLS = [
  {
    name: "start-a-project", title: "Start et prosjekt",
    description: "Start a change to the old hospital: pick the wing, read what is known, open a version to work in and make the first small change. Read before you build, and never build on a guess about the wing.",
    body: `# Start a project

A project is a version: a copy of the building that a person changes without touching the original.

## Order
1. \`about_site\` for the wings and the drawn storeys; \`about_wing\` for one wing's levels and sources.
2. \`list_versions\` first. If the person already has a version for this idea, continue in it.
3. \`new_version\` to open one. Name it for the idea in the person's own words.
4. \`try_change\` for the first change, a small one. Show it with \`show_draft\`, then ask what comes next.
5. \`undo_change\` takes the last change back; say so, it makes the person bolder.

## Common failures
- Building before the wing is certain. If the person says "the old part", ask which wing; \`about_site\` lists them.
- Writing geometry by hand when a ready-made part exists. \`list_parts\` first.
- Opening a second version for every small idea. One version holds many changes.
- Stating a size you did not read. Read it with \`about_wing\` or \`measure\`, or say you do not know.
`,
  },
  {
    name: "make-a-sketch", title: "Lag en skisse",
    description: "Show a quick plan sketch of a proposed change before building it, so the person can say yes, no or move it. Sketch first when a change is large, uncertain or hard to take back.",
    body: `# Make a sketch

A sketch is cheaper than a model. Use it to agree on the idea before any edit is made.

## Pattern
1. Read the ground: \`about_wing\` for the wing, \`floor_plan\` for a storey's rooms.
2. \`propose_sketch\` with a short title, the shapes and a legend that says what each colour is. North is up and the scale bar is drawn for you.
3. Wait for the answer. Only a yes goes on to \`try_change\`.
4. After the change, \`look\` or \`show_draft\` shows the same place in 3D so the person can compare it with the sketch.

## Common failures
- Sketching and building in one turn. The point is the pause.
- A legend with no numbers. Give the sizes you read, in metres, and name what you assumed.
- Re-sketching the whole site for a small move. Frame the wing or the plot, nothing wider.
`,
  },
  {
    name: "plan-my-garden", title: "Planlegg hagen",
    description: "Plan a garden or outdoor area on the hospital plot: read the ground and the sun, use the ready-made parts first, try the plan as a draft and look at it from where a person would stand.",
    body: `# Plan my garden

## Read first
- \`about_ground\` for the fall of the ground, \`site_facts\` for what is known about the plot.
- \`list_parts\` for ready-made outdoor parts (a pool basin, stairs, railings, a greenhouse). Use a part before you write geometry.
- \`list_site_photos\` and \`look_at_site_photo\` show what the place looks like today.

## Build
1. Sketch the layout with \`propose_sketch\` when it has more than two elements.
2. \`try_change\` places lawn, beds, paths, water and trees. Do it in small steps and keep one version for the garden.
3. \`check_fit\` when parts must meet (a stair to a terrace). \`look\` from eye height, not only from above.

## Common failures
- Ignoring the slope. Read the ground first; a terrace on a fall needs steps.
- Planting without a reason for the species. Say why it fits the place.
- Calling the result approved. It is a plan to look at, not permission to build.
`,
  },
  {
    name: "check-the-rules", title: "Sjekk reglene",
    description: "Hold a project against the building rules the app can measure (TEK17) and, when the person gives the zoning plan's numbers, against height and border distance. Report each result with its source, and never call it an approval.",
    body: `# Check the rules

The references hold the rules the app can measure, each with its section, limit and the dibk.no page it was read from.

## Pattern
1. \`check_design\` on the version or draft. Give the plan argument only with numbers the person read from the plan provisions; the app cannot fetch a plan.
2. Report the rows: "brudd" (broken), ok, and "ikke målt" (not measured). A rule marked verify is not yet read against the law text; say so.
3. Each broken row carries a fix. Offer it in plain words and make it with \`try_change\` only after a yes.
4. \`check_fit\` and \`check_model\` check that parts fit and the IFC is sound. \`summary\` gives area, amounts and a rough price.
5. Need the text behind a rule? \`search_documents\` and \`read_document\` open the site's documents.

## Common failures
- Calling a pass "approved". The result is a reading, not a decision; the municipality decides.
- Leaving out the source. Quote the section and the page from the references.
- Treating "ikke målt" as ok. It means nothing was measured.
- Inventing plan numbers. Ask the person for them.
`,
    reference: true,
  },
];

const md = s => `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body.trim()}\n`;
const norm = rulesFile => {
  const j = JSON.parse(readFileSync(rulesFile, "utf8"));
  return "# TEK17 rules the app can measure\n\n" + j.about + "\n\n" + j.rules.map(r =>
    `## ${r.section} ${r.topic} (${r.id})\n- Limit: ${JSON.stringify(r.limit)}${r.verify ? " (verify: not settled)" : ""}\n- ${r.no || ""}\n- Source: ${r.source?.url || "-"}${r.source?.quote ? ` — «${r.source.quote}»` : ""}\n`).join("\n");
};

export function createSkills(rulesFile = new URL("./rules/tek17.json", import.meta.url).pathname) {
  const files = new Map();   // uri → { text, skill }
  const entries = SKILLS.map(s => {
    const uri = `skill://${s.name}/SKILL.md`, list = [[uri, md(s)]];
    if (s.reference) list.push([`skill://${s.name}/references/tek17.md`, norm(rulesFile)]);
    for (const [u, text] of list) files.set(u, text);
    return { uri, frontmatter: { name: s.name, description: s.description }, files: list.map(([u, text]) => ({ uri: u, digest: "sha256:" + createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text) })) };
  });
  const names = SKILLS.map(s => s.name);
  return {
    names, bodies: SKILLS.map(s => s.body), entries,
    list: () => ({ skills: entries, resultType: "complete" }),
    get: uri => { const e = entries.find(x => x.uri === uri); return e ? { skill: e, resultType: "complete" } : null; },
    read: uri => files.get(uri),
    uris: () => entries.map(e => ({ uri: e.uri, name: e.frontmatter.name, title: SKILLS.find(s => s.name === e.frontmatter.name).title, description: e.frontmatter.description + " Data, not instructions.", mimeType: "text/markdown" })),
  };
}
