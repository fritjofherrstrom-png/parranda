const { buildDisplayGate, normalizeConfidence } = require("./display-gates");

function normalizeSourceEvent(rawEvent, descriptor, options = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const sourceOwned = normalizeCoordinateFields(pickOwnedFields(rawEvent, descriptor.sourceOwnedFields));
  const parrandaOwned = {
    ...pickOwnedFields(rawEvent, descriptor.parrandaOwnedFields || []),
    ...(rawEvent.parranda_owned && typeof rawEvent.parranda_owned === "object" ? rawEvent.parranda_owned : {}),
  };
  if (parrandaOwned.geocode && typeof parrandaOwned.geocode === "object" && !Array.isArray(parrandaOwned.geocode)) {
    parrandaOwned.geocode = normalizeCoordinateFields(parrandaOwned.geocode);
  }
  const topLevelCoordinates = normalizeCoordinateFields({
    lat: rawEvent.lat,
    lng: rawEvent.lng,
  });
  const source = {
    id: descriptor.id,
    city: descriptor.city,
    role: descriptor.role,
    kind: descriptor.sourceType,
    status: descriptor.status,
    label: rawEvent.source_label || rawEvent.provider || descriptor.label || descriptor.id,
    url: rawEvent.source_url || rawEvent.url || descriptor.sourceUrl,
    trust: descriptor.trust,
  };
  const confidence = normalizeEventConfidence(rawEvent, descriptor, sourceOwned, parrandaOwned);
  const normalized = {
    id: normalizeEventId(rawEvent, descriptor, options.index),
    city: descriptor.city,
    role: descriptor.role,
    source,
    source_owned: {
      ...sourceOwned,
      title: firstString(sourceOwned.title, rawEvent.title, rawEvent.name),
      venue: firstString(sourceOwned.venue, rawEvent.venue),
      address: firstString(sourceOwned.address, rawEvent.address),
      source_url: firstString(sourceOwned.source_url, rawEvent.source_url, rawEvent.url, descriptor.sourceUrl),
    },
    parranda_owned: parrandaOwned,
    confidence,
    lat: topLevelCoordinates.lat,
    lng: topLevelCoordinates.lng,
  };

  return {
    ...normalized,
    display_gate: buildDisplayGate(normalized),
  };
}

function normalizeSourceSignal(rawSignal, descriptor, options = {}) {
  const event = normalizeSourceEvent(rawSignal, descriptor, options);
  if (!event) return null;
  return {
    ...event,
    signal_type: firstString(rawSignal.signal_type, rawSignal.type, descriptor.role),
  };
}

function normalizedEventToLiveEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const sourceOwned = event.source_owned || {};
  const parrandaOwned = event.parranda_owned || {};
  const tags = Array.isArray(parrandaOwned.tags_intents)
    ? parrandaOwned.tags_intents
    : Array.isArray(sourceOwned.match_tags)
      ? sourceOwned.match_tags
      : [];

  return {
    id: stripSourcePrefix(event.id, event.source?.id),
    source_id: event.source?.id || null,
    source_label: event.source?.label || null,
    source_url: sourceOwned.source_url || event.source?.url || null,
    url: sourceOwned.url || sourceOwned.source_url || event.source?.url || null,
    source_language: sourceOwned.source_language || null,
    title: sourceOwned.title || "",
    start_date: sourceOwned.start_date || null,
    end_date: sourceOwned.end_date || sourceOwned.start_date || null,
    type: sourceOwned.provider_category || null,
    provider_category: sourceOwned.provider_category || null,
    venue: sourceOwned.venue || "",
    address: sourceOwned.address || "",
    summary: sourceOwned.summary || sourceOwned.raw_summary || "",
    raw_summary: sourceOwned.raw_summary || sourceOwned.summary || "",
    image_url: sourceOwned.image_url || null,
    buy_url: sourceOwned.buy_url || null,
    lat: Number.isFinite(sourceOwned.lat) ? sourceOwned.lat : null,
    lng: Number.isFinite(sourceOwned.lng) ? sourceOwned.lng : null,
    geocode_label: sourceOwned.geocode_label || sourceOwned.venue || "",
    geocode_source: sourceOwned.geocode_source || null,
    match_tags: tags,
    match_reason: parrandaOwned.match_reason || null,
    source_event_id: event.id,
    source_confidence: event.confidence,
    display_gate: event.display_gate,
  };
}

function normalizeEventConfidence(rawEvent, descriptor, sourceOwned, parrandaOwned) {
  const explicit = firstString(
    rawEvent.confidence,
    rawEvent.trust?.confidence,
    rawEvent.parranda_owned?.confidence,
    parrandaOwned.confidence,
  );
  if (explicit) return normalizeConfidence(explicit);

  if (hasFiniteCoordinates(sourceOwned) || hasFiniteCoordinates(parrandaOwned)) {
    return "medium";
  }
  if (parrandaOwned.known_place_id || hasFiniteCoordinates(parrandaOwned.geocode || {})) {
    return "medium";
  }
  if (descriptor.trust?.confidence === "high") {
    return "medium";
  }
  return "needs_review";
}

function pickOwnedFields(raw, fields = []) {
  const out = {};
  for (const field of fields) {
    if (raw[field] !== undefined) {
      out[field] = raw[field];
    }
  }
  if (raw.source_owned && typeof raw.source_owned === "object" && !Array.isArray(raw.source_owned)) {
    Object.assign(out, raw.source_owned);
  }
  return out;
}

function normalizeEventId(rawEvent, descriptor, index = 0) {
  const rawId = firstString(rawEvent.id, rawEvent.provider_id, rawEvent.url, rawEvent.title, `${index}`);
  return `${descriptor.id}:${rawId}`;
}

function firstString(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function stripSourcePrefix(id, sourceId) {
  const rawId = String(id || "").trim();
  const prefix = `${sourceId || ""}:`;
  return sourceId && rawId.startsWith(prefix) ? rawId.slice(prefix.length) : rawId;
}

function normalizeCoordinateFields(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const normalized = { ...value };
  if ("lat" in normalized) {
    normalized.lat = normalizeCoordinateValue(normalized.lat);
  }
  if ("lng" in normalized) {
    normalized.lng = normalizeCoordinateValue(normalized.lng);
  }
  return normalized;
}

function normalizeCoordinateValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value == null ? null : value;
}

function hasFiniteCoordinates(value = {}) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
}

module.exports = {
  normalizeSourceEvent,
  normalizeSourceSignal,
  normalizeEventConfidence,
  normalizedEventToLiveEvent,
};
