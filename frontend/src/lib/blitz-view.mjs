const CONTRACT = "anywhere_contextual_blitz_v1";

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function sourceLabel(value) {
  const label = text(value);
  if (!label) return null;
  const known = {
    osm: "OpenStreetMap",
    openstreetmap: "OpenStreetMap",
    wikidata: "Wikidata",
  };
  return known[label.toLocaleLowerCase()] || label;
}

function attribution(move) {
  if (move?.kind === "live_event") {
    return {
      label: sourceLabel(move?.source?.label),
      url: text(move?.source?.url),
      source_kind: text(move?.source?.type) || "live_event",
    };
  }
  const rows = Array.isArray(move?.provenance?.attribution)
    ? move.provenance.attribution
    : [];
  const row = rows.find((item) => text(item?.label) || text(item?.url)) || null;
  return {
    label: sourceLabel(row?.label),
    url: text(row?.url),
    source_kind: text(move?.provenance?.source_family) || text(move?.origin),
  };
}

function moveKey(move) {
  return text(move?.event_id) || text(move?.candidate_id) || null;
}

function normalizeMove(move) {
  if (!move || typeof move !== "object") return null;
  const title = text(move.title) || text(move.label) || text(move.name);
  if (!title) return null;
  const source = attribution(move);
  return {
    key: moveKey(move),
    kind: move.kind === "live_event" ? "live_event" : "place",
    title,
    type: text(move.type),
    lat: finite(move.lat),
    lng: finite(move.lng),
    distance_km: finite(move.distance_km),
    walking_minutes: finite(move.walking_minutes),
    starts_in_minutes: finite(move.starts_in_minutes),
    starts_at: text(move.starts_at),
    ends_at: text(move.ends_at),
    starts_on: text(move.starts_on),
    ends_on: text(move.ends_on),
    timezone: text(move.timezone),
    time_window: move.time_window && typeof move.time_window === "object" ? { ...move.time_window } : null,
    covered_preferences: Array.isArray(move.covered_preferences) ? [...move.covered_preferences] : [],
    partial_preferences: Array.isArray(move.partial_preferences) ? [...move.partial_preferences] : [],
    source,
  };
}

/**
 * Product-safe view of the trusted any-place Blitz response. It intentionally
 * excludes raw reason tokens, inspect fields and route-like language: Blitz is
 * one next move beside the current day, never a second itinerary.
 */
export function anywhereBlitzView(response) {
  if (!response || response.contract !== CONTRACT) {
    return { state: "invalid", best: null, backup: null, live_option: null, confidence_level: null };
  }
  const best = normalizeMove(response.best_move);
  const backup = normalizeMove(response.backup_option);
  const liveOption = normalizeMove(response.live_option);
  const bestKey = best?.key;
  return {
    state: response.status === "available" && best ? "available" : "blocked",
    best,
    backup: backup?.key && backup.key === bestKey ? null : backup,
    live_option: liveOption?.key && liveOption.key === bestKey ? null : liveOption,
    confidence_level: text(response?.confidence?.level),
    time_band: text(response?.context?.time_band),
    timezone_known: Boolean(text(response?.context?.timezone)),
  };
}

export { CONTRACT as ANYWHERE_BLITZ_CONTRACT };
