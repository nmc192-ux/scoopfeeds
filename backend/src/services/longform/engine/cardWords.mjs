// What a viewer actually READS on a card.
//
// build.mjs sizes the readability hold from this: a card whose type takes
// longer to read than its narration takes to speak gets the shot extended, up
// to MAX_HOLD. Extracted from build.mjs so tooling can ask the same question
// WITHOUT importing build.mjs — which resolves a project's storyboard at module
// load and therefore cannot be imported just to count words.
//
// It counts the strings the RENDERER puts on screen, not the fields of the
// spec. A project script that walked the spec's JSON instead counted its keys
// ("card", "kicker", "items", "label"...) and reported a 5-word stat card as
// nineteen words to read.

/** Every string the renderer puts on screen, unjoined. */
export function cardStrings(v) {
  const bits = [];
  if (v.lines) bits.push(...v.lines);
  for (const k of ["title", "label", "note", "figure", "name", "unit", "text", "who", "role"]) {
    if (v[k]) bits.push(String(v[k]));
  }
  if (v.items) v.items.forEach((i) => bits.push(i.label, i.display));
  if (v.rows) v.rows.forEach((r) => bits.push(r.who, r.what));
  if (v.stages) v.stages.forEach((x) => bits.push(x.name, x.sub || ""));
  return bits.filter((b) => typeof b === "string" && b.length);
}

export function cardWords(v) {
  return cardStrings(v).join(" ").replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
}
