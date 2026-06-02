const { buildDisplayGate, normalizeConfidence } = require("./display-gates");

function normalizeSourceEvent(rawEvent, descriptor, options = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const sourceOwned = pickOwnedFields(rawEvent, descriptor.sourceOwnedFields);
  const parrandaOwned = {
    ...pickOwnedFields(rawEvent, descriptor.parrandaOwnedFields || []),
    ...(rawEvent.parranda_owned && typeof rawEvent.parranda_owned === "object" ? rawEvent.parranda_owned : {}),
  };
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

function normalizeEventConfidence(rawEvent, descriptor, sourceOwned, parrandaOwned) {
  const explicit = firstString(
    rawEvent.confidence,
    rawEvent.trust?.confidence,
    rawEvent.parranda_owned?.confidence,
    parrandaOwned.confidence,
  );
  if (explicit) return normalizeConfidence(explicit);

  if (Number.isFinite(sourceOwned.lat) && Number.isFinite(sourceOwned.lng)) {
    return "medium";
  }
  if (parrandaOwned.known_place_id || Number.isFinite(parrandaOwned.geocode?.lat)) {
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

module.exports = {
  normalizeSourceEvent,
  normalizeSourceSignal,
  normalizeEventConfidence,
};
