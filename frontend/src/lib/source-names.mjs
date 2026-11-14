// Readable names for the raw provider tokens a place or event source can
// carry. This only renames a whole token; any other label is shown exactly as
// the source gave it, so a source that must be credited is never hidden.
const SOURCE_NAMES = {
  overture: "Overture Maps",
  osm: "OpenStreetMap",
  openstreetmap: "OpenStreetMap",
  wikidata: "Wikidata",
};

export function readableSourceName(value) {
  const label = typeof value === "string" ? value.trim() : "";
  const known = label.toLowerCase();
  return Object.hasOwn(SOURCE_NAMES, known) ? SOURCE_NAMES[known] : label;
}
