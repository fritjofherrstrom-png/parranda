const CONFIDENCE_RANK = {
  needs_review: 0,
  low: 1,
  medium: 2,
  strong: 3,
};

function buildDisplayGate(event = {}) {
  const confidence = normalizeConfidence(event.confidence);
  const sourceOwned = event.source_owned || {};
  const parrandaOwned = event.parranda_owned || {};
  const hasTitle = hasText(sourceOwned.title || event.title);
  const hasSourceUrl = hasText(event.source?.url || sourceOwned.source_url || sourceOwned.url);
  const hasProviderCoordinates = hasCoordinates(sourceOwned) || hasCoordinates(event);
  const hasKnownPlace = hasText(parrandaOwned.known_place_id || event.known_place_id);
  const hasGeocode = hasCoordinates(parrandaOwned.geocode || event.geocode || {});
  const hasVenueAndAddress = hasText(sourceOwned.venue || event.venue) && hasText(sourceOwned.address || event.address);
  const hasReliablePlaceTarget =
    hasProviderCoordinates ||
    hasKnownPlace ||
    hasGeocode ||
    (hasVenueAndAddress && confidenceAtLeast(confidence, "medium"));
  const hasTiming = hasText(sourceOwned.start_date || event.start_date) || hasText(sourceOwned.starts_at || event.starts_at);
  const isWeak = !hasTitle || confidenceAtMost(confidence, "low");

  return {
    may_show_in_pulse: hasTitle && confidenceAtLeast(confidence, "low"),
    may_show_in_live_list: hasTitle && hasTiming && confidenceAtLeast(confidence, "low"),
    may_influence_routes: hasReliablePlaceTarget && confidenceAtLeast(confidence, "medium"),
    may_create_place_candidate: hasReliablePlaceTarget && confidenceAtLeast(confidence, "medium"),
    may_show_as_nearby: hasReliablePlaceTarget && confidenceAtLeast(confidence, "medium"),
    reasons: buildReasons({
      hasTitle,
      hasSourceUrl,
      hasProviderCoordinates,
      hasKnownPlace,
      hasGeocode,
      hasVenueAndAddress,
      hasTiming,
      hasReliablePlaceTarget,
      isWeak,
      confidence,
    }),
  };
}

function buildReasons(facts) {
  const reasons = [];
  if (facts.hasTitle) reasons.push("has_title");
  if (facts.hasTiming) reasons.push("has_timing");
  if (facts.hasSourceUrl) reasons.push("has_source_url");
  if (facts.hasProviderCoordinates) reasons.push("has_provider_coordinates");
  if (facts.hasKnownPlace) reasons.push("has_known_place");
  if (facts.hasGeocode) reasons.push("has_geocode");
  if (facts.hasVenueAndAddress) reasons.push("has_venue_and_address");
  if (facts.hasReliablePlaceTarget) reasons.push("has_reliable_place_target");
  if (facts.isWeak) reasons.push("weak_or_missing_metadata");
  reasons.push(`confidence_${facts.confidence}`);
  return reasons;
}

function normalizeConfidence(value) {
  const confidence = String(value || "").trim();
  if (confidence === "high") return "strong";
  if (confidence === "weak") return "low";
  if (confidence === "strong" || confidence === "medium" || confidence === "low" || confidence === "needs_review") {
    return confidence;
  }
  return "needs_review";
}

function confidenceAtLeast(value, minimum) {
  return (CONFIDENCE_RANK[normalizeConfidence(value)] || 0) >= (CONFIDENCE_RANK[normalizeConfidence(minimum)] || 0);
}

function confidenceAtMost(value, maximum) {
  return (CONFIDENCE_RANK[normalizeConfidence(value)] || 0) <= (CONFIDENCE_RANK[normalizeConfidence(maximum)] || 0);
}

function hasCoordinates(value = {}) {
  return Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  buildDisplayGate,
  confidenceAtLeast,
  normalizeConfidence,
};
