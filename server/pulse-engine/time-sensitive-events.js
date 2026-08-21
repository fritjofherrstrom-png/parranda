/**
 * Convert normalized time-sensitive source events into gated Pulse signals.
 *
 * Source providers own raw facts. The Pulse engine owns whether those facts are
 * timely, source-backed, salient enough, and honest to show. These signals are
 * still context only: they do not become route stops or route candidates here.
 */

const DISPLAYABLE_TIMING = new Set(["now", "today", "tonight"]);
const DISPLAYABLE_CONFIDENCE = new Set(["strong", "medium"]);
const MAX_TIME_SENSITIVE_EVENT_SIGNALS = 3;

function timeSensitiveEventsToPulseSignals(events = [], context = {}) {
  if (!Array.isArray(events) || events.length === 0) return [];

  return events
    .map((event) => buildTimeSensitiveEventSignal(event, context))
    .filter(Boolean)
    .sort((left, right) => {
      const scoreDelta = (right.score || 0) - (left.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(left.id || "").localeCompare(String(right.id || ""));
    })
    .slice(0, MAX_TIME_SENSITIVE_EVENT_SIGNALS);
}

function buildTimeSensitiveEventSignal(event, context = {}) {
  if (!event || typeof event !== "object") return null;
  if (!isDisplayableTimeSensitiveEvent(event)) return null;

  const title = compactText(event.title || event.name);
  if (!title) return null;

  const sourceLabel = compactText(event.source_label || event.provenance?.source_label);
  const sourceUrl = compactText(event.source_url || event.provenance?.source_url);
  const place = compactText(event.place_context || event.area || event.city || context.city?.label);
  const roleHint = compactText(event.route_role_hint);
  const signalType = signalTypeForEvent(event);
  const salience = scoreTimeSensitiveEventSalience(event);
  const kindLabel = kindLabelForEvent(event, context.lang);

  return {
    id: `source-event-${slugify(event.id || sourceUrl || title)}`,
    type: signalType,
    level: event.lat != null && event.lng != null ? "venue" : "city",
    title,
    native_title: title,
    area: place || undefined,
    where: place || undefined,
    venue: place || undefined,
    when: whenLabelForEvent(event, context.lang),
    blurb: blurbForEvent(event, context.lang),
    editorial_pitch: editorialPitchForEvent(event, context.lang),
    reason: reasonForEvent(event, context.lang),
    why_it_matters: reasonForEvent(event, context.lang),
    kind: sourceLabel ? `${kindLabel} · ${sourceLabel}` : kindLabel,
    kindLabel,
    time_window: timeWindowForEvent(event),
    matches_vibes: vibesForEvent(event),
    source: {
      kind: "live_feed",
      label: sourceLabel || null,
      url: sourceUrl || undefined,
      id: compactText(event.source_type || event.source_tier || sourceLabel) || undefined,
    },
    source_label: sourceLabel || undefined,
    source_url: sourceUrl || undefined,
    trust_level: trustLevelForEvent(event),
    freshness: freshnessForEvent(event),
    official_event_id: event.id || undefined,
    place_query: place || undefined,
    action: sourceUrl
      ? {
          kind: "external",
          target: sourceUrl,
          label: context.lang === "en" ? "Open source" : "Öppna källa",
        }
      : undefined,
    route_hints: routeHintsForEvent(event),
    confidence: event.confidence || undefined,
    score: salience.score,
    salience_reasons: salience.reasons,
    time_sensitive_source_event: compactObject({
      id: event.id || null,
      candidate_kind: event.candidate_kind || null,
      timing_relevance: event.timing_relevance || null,
      confidence: event.confidence || null,
      route_role_hint: roleHint || null,
      source_label: sourceLabel || null,
      source_url: sourceUrl || null,
      starts_at: event.starts_at || null,
      ends_at: event.ends_at || null,
    }),
  };
}

function isDisplayableTimeSensitiveEvent(event) {
  if (!DISPLAYABLE_TIMING.has(event.timing_relevance)) return false;
  if (!DISPLAYABLE_CONFIDENCE.has(event.confidence)) return false;
  if (!hasSourceBacking(event)) return false;
  if (!compactText(event.title || event.name)) return false;
  return true;
}

function hasSourceBacking(event) {
  return Boolean(
    compactText(event.source_url) ||
      compactText(event.source_label) ||
      compactText(event.provenance?.source_url) ||
      compactText(event.provenance?.source_label),
  );
}

function scoreTimeSensitiveEventSalience(event) {
  const reasons = [];
  let score = 4;

  if (event.timing_relevance === "now") {
    score += 4;
    reasons.push("timing_now");
  } else if (event.timing_relevance === "tonight") {
    score += 3;
    reasons.push("timing_tonight");
  } else if (event.timing_relevance === "today") {
    score += 2;
    reasons.push("timing_today");
  }

  if (event.confidence === "strong") {
    score += 2;
    reasons.push("strong_confidence");
  } else if (event.confidence === "medium") {
    score += 1;
    reasons.push("medium_confidence");
  }

  if (compactText(event.source_tier) === "official") {
    score += 1;
    reasons.push("official_source_tier");
  }
  if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
    score += 1;
    reasons.push("has_coordinates");
  }
  if (compactText(event.place_context || event.area)) {
    score += 1;
    reasons.push("has_place_context");
  }
  if (compactText(event.route_role_hint)) {
    score += 0.5;
    reasons.push(`role_hint_${slugify(event.route_role_hint)}`);
  }

  const significance = event.local_significance;
  if (
    significance?.source_prominence === "dedicated_programme" &&
    significance.current_year_evidence === true &&
    ["official", "verified"].includes(compactText(event.source_tier).toLowerCase()) &&
    Number(significance.programme_event_count) >= 4
  ) {
    score += 0.75;
    reasons.push("dedicated_programme_prominence");
  }
  if (Number(significance?.programme_day_count) >= 2) {
    score += 0.5;
    reasons.push("multi_day_programme_evidence");
  }
  if (Number(event.independent_source_count) >= 2) {
    score += 1;
    reasons.push("independent_source_corroboration");
  }
  if (!event.recurrence) {
    score += 0.5;
    reasons.push("non_recurring_or_specific");
  }

  return {
    score: Number(Math.min(score, 10).toFixed(2)),
    reasons,
  };
}

function signalTypeForEvent(event) {
  const roleHint = compactText(event.route_role_hint).toLowerCase();
  const tags = new Set([...(event.tags || []), ...(event.intents || [])].map((tag) => compactText(tag).toLowerCase()));
  if (roleHint.includes("market") || tags.has("market") || tags.has("markets")) {
    return "market_timing";
  }
  return "live_event_nearby";
}

function kindLabelForEvent(event, lang) {
  const isEnglish = lang === "en";
  const roleHint = compactText(event.route_role_hint).toLowerCase();
  const tags = new Set([...(event.tags || []), ...(event.intents || [])].map((tag) => compactText(tag).toLowerCase()));
  if (roleHint.includes("market") || tags.has("market") || tags.has("markets")) {
    return isEnglish ? "Market timing" : "Marknadsläge";
  }
  if (roleHint.includes("evening") || tags.has("nightlife") || tags.has("night")) {
    return isEnglish ? "Tonight" : "Ikväll";
  }
  if (roleHint.includes("culture") || tags.has("culture") || tags.has("cultural")) {
    return isEnglish ? "Culture" : "Kultur";
  }
  return isEnglish ? "Live signal" : "Livesignal";
}

function whenLabelForEvent(event, lang) {
  const isEnglish = lang === "en";
  if (event.timing_relevance === "now") return isEnglish ? "Now" : "Just nu";
  if (event.timing_relevance === "tonight") return isEnglish ? "Tonight" : "Ikväll";
  if (event.timing_relevance === "today") return isEnglish ? "Today" : "I dag";
  return event.starts_at || event.ends_at || "";
}

function blurbForEvent(event, lang) {
  const isEnglish = lang === "en";
  const place = compactText(event.place_context || event.area || event.city);
  const kind = kindLabelForEvent(event, lang).toLowerCase();
  if (place) {
    return isEnglish
      ? `${kindLabelForEvent(event, lang)} at ${place}.`
      : `${kindLabelForEvent(event, lang)} på ${place}.`;
  }
  return isEnglish
    ? `Source-backed ${kind} for the day.`
    : `Källbelagd ${kind} för dagen.`;
}

function reasonForEvent(event, lang) {
  const isEnglish = lang === "en";
  const place = compactText(event.place_context || event.area || event.city);
  if (event.timing_relevance === "now") {
    return isEnglish
      ? `A source-backed event is active now${place ? ` around ${place}` : ""}.`
      : `En källbelagd händelse pågår just nu${place ? ` vid ${place}` : ""}.`;
  }
  if (event.timing_relevance === "tonight") {
    return isEnglish
      ? `A source-backed event may shape tonight${place ? ` around ${place}` : ""}.`
      : `En källbelagd händelse kan forma kvällen${place ? ` vid ${place}` : ""}.`;
  }
  return isEnglish
    ? `A source-backed event is relevant today${place ? ` around ${place}` : ""}.`
    : `En källbelagd händelse är relevant idag${place ? ` vid ${place}` : ""}.`;
}

function editorialPitchForEvent(event, lang) {
  const isEnglish = lang === "en";
  const type = signalTypeForEvent(event);
  if (type === "market_timing") {
    return isEnglish
      ? "Let the day touch the local rhythm while it is actually active."
      : "Låt dagen nudda den lokala rytmen medan den faktiskt pågår.";
  }
  if (event.timing_relevance === "tonight") {
    return isEnglish
      ? "Use the evening signal as a hinge, not background noise."
      : "Använd kvällssignalen som gångjärn, inte bakgrundsbrus.";
  }
  return isEnglish
    ? "A real timed signal deserves attention before another static stop."
    : "En riktig tidsbunden signal förtjänar uppmärksamhet före ännu ett statiskt stopp.";
}

function timeWindowForEvent(event) {
  if (!event.starts_at && !event.ends_at && !event.time_window) return undefined;
  return compactObject({
    starts_at: event.starts_at || event.time_window?.starts_at || undefined,
    ends_at: event.ends_at || event.time_window?.ends_at || undefined,
    label: event.time_window?.label || undefined,
  });
}

function routeHintsForEvent(event) {
  const preferredTags = [...new Set([...(event.tags || []), ...(event.intents || [])].map(compactText).filter(Boolean))];
  if (event.route_role_hint) preferredTags.push(compactText(event.route_role_hint));
  return preferredTags.length
    ? {
        preferred_tags: [...new Set(preferredTags)],
      }
    : undefined;
}

function vibesForEvent(event) {
  const tags = [...(event.tags || []), ...(event.intents || []), event.route_role_hint]
    .map((tag) => compactText(tag).toLowerCase())
    .filter(Boolean);
  const vibes = [];
  if (tags.some((tag) => /night|bar|evening|music/.test(tag))) vibes.push("buzzy");
  if (tags.some((tag) => /market|food/.test(tag))) vibes.push("slow");
  if (tags.some((tag) => /culture|museum|exhibition/.test(tag))) vibes.push("curious");
  return [...new Set(vibes)];
}

function trustLevelForEvent(event) {
  if (event.source_tier === "official" || event.confidence === "strong") return "official";
  if (event.confidence === "medium") return "editorial";
  return "inferred";
}

function freshnessForEvent(event) {
  return event.timing_relevance === "now" ? "live" : "today";
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return compactText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function compactObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry !== undefined && entry !== null && entry !== "") {
      out[key] = entry;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = {
  DISPLAYABLE_TIMING,
  DISPLAYABLE_CONFIDENCE,
  MAX_TIME_SENSITIVE_EVENT_SIGNALS,
  timeSensitiveEventsToPulseSignals,
  buildTimeSensitiveEventSignal,
  isDisplayableTimeSensitiveEvent,
  scoreTimeSensitiveEventSalience,
};
