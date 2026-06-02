function dedupeNormalizedEvents(events = []) {
  const seen = new Set();
  const out = [];

  for (const event of events) {
    if (!event) continue;
    const key = buildEventDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }

  return out;
}

function buildEventDedupeKey(event = {}) {
  const sourceId = event.source?.id || "unknown-source";
  const sourceOwned = event.source_owned || {};
  return [
    event.city || "",
    sourceId,
    event.id || "",
    sourceOwned.title || "",
    sourceOwned.venue || "",
    sourceOwned.start_date || sourceOwned.starts_at || "",
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

module.exports = {
  dedupeNormalizedEvents,
  buildEventDedupeKey,
};
