/**
 * Generic Pulse signal quality classifier.
 *
 * This is intentionally city-agnostic. City packs and source adapters can
 * improve signal quality by providing better place/timing/source metadata, but
 * no city gets special rules here.
 */

const CONFIDENCE = {
  STRONG: "strong",
  MEDIUM: "medium",
  WEAK: "weak",
  FALLBACK: "fallback",
};

const PLACEHOLDER_PATTERNS = [
  /^venue$/i,
  /^[a-zåäöéèíìóòúùüñç' -]+ venue$/i,
  /^(concert|event|cultural event|live event) (at|in|near) [a-zåäöéèíìóòúùüñç' -]+ venue$/i,
];

const MASTHEAD_TYPES = new Set([
  "live_event_nearby",
  "golden_hour",
  "evening_window",
  "crowd_warning",
]);

/**
 * @param {import("./types").PulseSignal | import("./types").RawSignal} signal
 * @returns {{
 *   displayable: boolean,
 *   promotable: boolean,
 *   actionable: boolean,
 *   confidence: "strong" | "medium" | "weak" | "fallback",
 *   reasons: string[],
 * }}
 */
function classifySignalQuality(signal) {
  const reasons = [];
  const type = compact(signal?.type);
  const title = getSignalTitle(signal);
  const placeTarget = getPlaceTarget(signal);
  const source = signal?.source || {};
  const hasTitle = isMeaningfulText(title);
  const hasPlaceholderTitle = isPlaceholderSignalText(title);
  const hasPlaceTarget = isMeaningfulText(placeTarget) && !isPlaceholderSignalText(placeTarget);
  const hasTiming = hasSignalTiming(signal);
  const hasSource = hasSignalSource(signal);
  const hasSourceUrl = isMeaningfulText(source.url || signal?.source_url);
  const hasInternalAction =
    isMeaningfulText(signal?.official_event_id) ||
    isMeaningfulText(signal?.place_query) ||
    isMeaningfulText(signal?.related_stop_id) ||
    isMeaningfulText(signal?.linked_wildcard_id);
  const hasExternalAction = signal?.action?.kind === "external" && isMeaningfulText(signal?.action?.target);
  const sourceKind = compact(source.kind);
  const trustLevel = compact(signal?.trust_level);
  const isComputed = sourceKind === "computed" || sourceKind === "weather";
  const isOfficialLive = type === "live_event_nearby" || sourceKind === "live_feed";

  if (hasTitle) reasons.push("meaningful_title");
  if (hasPlaceTarget) reasons.push("has_place_target");
  if (hasTiming) reasons.push("has_timing");
  if (hasSource) reasons.push("has_source");
  if (hasSourceUrl) reasons.push("has_source_url");
  if (hasInternalAction) reasons.push("has_internal_action");
  if (hasExternalAction) reasons.push("has_external_action");
  if (isComputed) reasons.push("computed_signal");
  if (trustLevel === "official") reasons.push("official_source");
  if (trustLevel === "verified") reasons.push("verified_rule");

  if (!signal || !hasTitle || hasPlaceholderTitle) {
    return weak("missing_or_placeholder_title", reasons);
  }

  if (isOfficialLive && (hasPlaceholderTitle || !hasSource)) {
    return weak("live_signal_missing_clear_source", reasons);
  }

  if (isOfficialLive && !hasPlaceTarget && !hasSourceUrl && !hasInternalAction) {
    return weak("live_signal_missing_actionable_target", reasons);
  }

  const actionable = hasInternalAction || hasExternalAction || (isOfficialLive && hasSourceUrl);

  if (isOfficialLive && hasPlaceTarget && hasTiming && hasSource && actionable) {
    return {
      displayable: true,
      promotable: true,
      actionable: true,
      confidence: CONFIDENCE.STRONG,
      reasons: [...reasons, "clear_live_signal"],
    };
  }

  if (isOfficialLive && hasTiming && hasSource && actionable) {
    return {
      displayable: true,
      promotable: false,
      actionable: true,
      confidence: CONFIDENCE.MEDIUM,
      reasons: [...reasons, "partial_live_signal"],
    };
  }

  if (isComputed && hasTitle) {
    return {
      displayable: true,
      promotable: true,
      actionable: false,
      confidence: CONFIDENCE.MEDIUM,
      reasons: [...reasons, "computed_context_signal"],
    };
  }

  if (hasTitle && hasSource && ["official", "verified", "editorial"].includes(trustLevel)) {
    return {
      displayable: true,
      promotable: true,
      actionable,
      confidence: trustLevel === "official" && actionable ? CONFIDENCE.STRONG : CONFIDENCE.MEDIUM,
      reasons: [...reasons, "trusted_signal"],
    };
  }

  return {
    displayable: true,
    promotable: false,
    actionable,
    confidence: CONFIDENCE.WEAK,
    reasons: [...reasons, "limited_signal_metadata"],
  };
}

function weak(reason, existingReasons = []) {
  return {
    displayable: false,
    promotable: false,
    actionable: false,
    confidence: CONFIDENCE.WEAK,
    reasons: [...existingReasons, reason],
  };
}

function isDisplayableSignal(signal) {
  const quality = signal?.signal_quality || classifySignalQuality(signal);
  return quality.displayable === true;
}

function isPromotableSignal(signal) {
  const quality = signal?.signal_quality || classifySignalQuality(signal);
  return quality.displayable === true && quality.promotable === true;
}

function isActionableSignal(signal) {
  const quality = signal?.signal_quality || classifySignalQuality(signal);
  return quality.displayable === true && quality.actionable === true;
}

function isWeakLivePlaceholderSignal(signal) {
  if (signal?.type !== "live_event_nearby") {
    return false;
  }

  return (
    isPlaceholderSignalText(signal?.safe_headline) ||
    isPlaceholderSignalText(getPlaceTarget(signal)) ||
    classifySignalQuality(signal).displayable === false
  );
}

function hasSignalTiming(signal) {
  return Boolean(
    signal?.time_window ||
      isMeaningfulText(signal?.when) ||
      isMeaningfulText(signal?.start_date) ||
      isMeaningfulText(signal?.starts_at) ||
      isMeaningfulText(signal?.timing?.label),
  );
}

function hasSignalSource(signal) {
  const source = signal?.source || {};
  return Boolean(
    isMeaningfulText(source.kind) ||
      isMeaningfulText(source.label) ||
      isMeaningfulText(source.url) ||
      isMeaningfulText(signal?.source_label) ||
      isMeaningfulText(signal?.source_url),
  );
}

function getSignalTitle(signal) {
  return compact(
    signal?.title ||
      signal?.safe_headline ||
      signal?.kindLabel ||
      signal?.signal_label,
  );
}

function getPlaceTarget(signal) {
  return compact(
    signal?.venue ||
      signal?.venue_label ||
      signal?.location ||
      signal?.place ||
      signal?.place_query ||
      signal?.where ||
      signal?.area,
  );
}

function isPlaceholderSignalText(value) {
  const text = compact(value);
  if (!text) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function isMeaningfulText(value) {
  return compact(value).length > 0;
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  CONFIDENCE,
  classifySignalQuality,
  isActionableSignal,
  isDisplayableSignal,
  isPromotableSignal,
  isWeakLivePlaceholderSignal,
  isPlaceholderSignalText,
};
