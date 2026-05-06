const { summarizeAvailability } = require("./availability");
const { getIsoWeekday } = require("./lib/iso-date");

function createEmptyLocalTruthEffect() {
  return {
    score_adjustments: [],
    caution_notes: [],
    verify_opening_hours: [],
    route_context_notes: [],
    live_context_notes: [],
    prefer_tags: [],
    avoid_tags: [],
    score_delta: 0,
  };
}

function toNonEmptyStringArray(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function appendUniqueById(existing, additions) {
  const seenIds = new Set(existing.map((item) => item.id));
  additions.forEach((item) => {
    if (!item?.id || seenIds.has(item.id)) {
      return;
    }
    seenIds.add(item.id);
    existing.push(item);
  });
}

function normalizeScoreAdjustments(entries = [], ruleId) {
  return (entries || [])
    .filter((entry) => entry && Number.isFinite(Number(entry.delta)))
    .map((entry, index) => ({
      id: entry.id || `${ruleId}:score:${index + 1}`,
      rule_id: ruleId,
      reason: String(entry.reason || "Local truth-justering").trim(),
      delta: Number(Number(entry.delta).toFixed(2)),
    }));
}

function normalizeCautionNotes(entries = [], ruleId) {
  return (entries || [])
    .filter((entry) => entry && String(entry.text || "").trim())
    .map((entry, index) => ({
      id: entry.id || `${ruleId}:caution:${index + 1}`,
      rule_id: ruleId,
      severity: String(entry.severity || "medium").trim(),
      text: String(entry.text).trim(),
    }));
}

function normalizeVerifyOpeningHours(entries = [], ruleId) {
  return (entries || [])
    .filter((entry) => entry && String(entry.reason || "").trim())
    .map((entry, index) => ({
      id: entry.id || `${ruleId}:verify:${index + 1}`,
      rule_id: ruleId,
      scope: String(entry.scope || "route").trim(),
      reason: String(entry.reason).trim(),
    }));
}

function normalizeContextNotes(entries = [], ruleId, kind) {
  return (entries || [])
    .filter((entry) => entry && String(entry.text || "").trim())
    .map((entry, index) => ({
      id: entry.id || `${ruleId}:${kind}:${index + 1}`,
      rule_id: ruleId,
      text: String(entry.text).trim(),
    }));
}

function normalizeRuleEffects(ruleId, rawEffects = {}) {
  const normalized = createEmptyLocalTruthEffect();
  const effects = rawEffects && typeof rawEffects === "object" ? rawEffects : {};

  normalized.score_adjustments = normalizeScoreAdjustments(effects.score_adjustments, ruleId);
  normalized.caution_notes = normalizeCautionNotes(effects.caution_notes, ruleId);
  normalized.verify_opening_hours = normalizeVerifyOpeningHours(
    effects.verify_opening_hours,
    ruleId,
  );
  normalized.route_context_notes = normalizeContextNotes(
    effects.route_context_notes,
    ruleId,
    "route-context",
  );
  normalized.live_context_notes = normalizeContextNotes(
    effects.live_context_notes,
    ruleId,
    "live-context",
  );
  normalized.prefer_tags = toNonEmptyStringArray(effects.prefer_tags);
  normalized.avoid_tags = toNonEmptyStringArray(effects.avoid_tags);

  return normalized;
}

function mergeLocalTruthEffects(baseEffect, nextEffect) {
  const merged = createEmptyLocalTruthEffect();

  merged.score_adjustments = [...baseEffect.score_adjustments];
  appendUniqueById(merged.score_adjustments, nextEffect.score_adjustments || []);

  merged.caution_notes = [...baseEffect.caution_notes];
  appendUniqueById(merged.caution_notes, nextEffect.caution_notes || []);

  merged.verify_opening_hours = [...baseEffect.verify_opening_hours];
  appendUniqueById(merged.verify_opening_hours, nextEffect.verify_opening_hours || []);

  merged.route_context_notes = [...baseEffect.route_context_notes];
  appendUniqueById(merged.route_context_notes, nextEffect.route_context_notes || []);

  merged.live_context_notes = [...baseEffect.live_context_notes];
  appendUniqueById(merged.live_context_notes, nextEffect.live_context_notes || []);

  merged.prefer_tags = toNonEmptyStringArray([
    ...(baseEffect.prefer_tags || []),
    ...(nextEffect.prefer_tags || []),
  ]);
  merged.avoid_tags = toNonEmptyStringArray([
    ...(baseEffect.avoid_tags || []),
    ...(nextEffect.avoid_tags || []),
  ]);

  return merged;
}

function resolveActiveCalendarEntries(dateString, calendarEntries = []) {
  if (!dateString || !Array.isArray(calendarEntries) || !calendarEntries.length) {
    return [];
  }

  const [, , monthString, dayString] = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];

  if (!monthString || !dayString) {
    return [];
  }

  const month = Number(monthString);
  const day = Number(dayString);

  return calendarEntries.filter((entry) => entry?.month === month && entry?.day === day);
}

function buildRouteTagSet(route, routeStops = []) {
  const tags = new Set();

  (routeStops || []).forEach((stop) => {
    (stop.tags || []).forEach((tag) => tags.add(tag));
  });

  (route?.main_stops || []).forEach((stop) => {
    (stop.tags || []).forEach((tag) => tags.add(tag));
  });

  return tags;
}

function buildRouteStopKindSet(routeStops = []) {
  return new Set((routeStops || []).map((stop) => stop.kind).filter(Boolean));
}

function buildLocalTruthContext(cityConfig, input = {}) {
  const activeCalendarEntries = resolveActiveCalendarEntries(
    input.date,
    cityConfig?.localTruth?.calendar || [],
  );
  const weekday =
    input.weekday === undefined || input.weekday === null ? getIsoWeekday(input.date) : input.weekday;

  return {
    ...input,
    cityConfig,
    weekday,
    activeCalendarEntries,
    activeCalendarIds: new Set(activeCalendarEntries.map((entry) => entry.id)),
    routeTags: buildRouteTagSet(input.route, input.routeStops),
    routeStopKinds: buildRouteStopKindSet(input.routeStops),
    availabilitySummary: summarizeAvailability(input.routeStops, weekday),
  };
}

function matchesRule(rule, context) {
  const match = rule?.match || {};

  if (Array.isArray(match.weekdays) && match.weekdays.length && !match.weekdays.includes(context.weekday)) {
    return false;
  }

  if (
    Array.isArray(match.calendar_ids) &&
    match.calendar_ids.length &&
    !match.calendar_ids.some((calendarId) => context.activeCalendarIds.has(calendarId))
  ) {
    return false;
  }

  if (
    Array.isArray(match.route_tags_any) &&
    match.route_tags_any.length &&
    !match.route_tags_any.some((tag) => context.routeTags.has(tag))
  ) {
    return false;
  }

  if (
    Array.isArray(match.route_tags_all) &&
    match.route_tags_all.length &&
    !match.route_tags_all.every((tag) => context.routeTags.has(tag))
  ) {
    return false;
  }

  if (
    Array.isArray(match.route_stop_kinds_any) &&
    match.route_stop_kinds_any.length &&
    !match.route_stop_kinds_any.some((kind) => context.routeStopKinds.has(kind))
  ) {
    return false;
  }

  if (
    Array.isArray(match.route_stop_kinds_all) &&
    match.route_stop_kinds_all.length &&
    !match.route_stop_kinds_all.every((kind) => context.routeStopKinds.has(kind))
  ) {
    return false;
  }

  return true;
}

function deriveTagScoreAdjustments(effect, context) {
  const derived = [];

  effect.prefer_tags.forEach((tag) => {
    if (context.routeTags.has(tag)) {
      derived.push({
        id: `prefer-tag:${tag}`,
        rule_id: "local-truth-tag-preference",
        reason: `${tag} stämmer bättre med lokal truth-signalen`,
        delta: 0.45,
      });
    }
  });

  effect.avoid_tags.forEach((tag) => {
    if (context.routeTags.has(tag)) {
      derived.push({
        id: `avoid-tag:${tag}`,
        rule_id: "local-truth-tag-avoidance",
        reason: `${tag} blir skörare eller mindre lämpligt enligt lokal truth-signal`,
        delta: -0.65,
      });
    }
  });

  return derived;
}

function finalizeLocalTruthEffect(effect, context) {
  const finalized = mergeLocalTruthEffects(effect, createEmptyLocalTruthEffect());
  const tagScoreAdjustments = deriveTagScoreAdjustments(finalized, context);
  appendUniqueById(finalized.score_adjustments, tagScoreAdjustments);
  finalized.score_delta = Number(
    finalized.score_adjustments
      .reduce((sum, entry) => sum + Number(entry.delta || 0), 0)
      .toFixed(2),
  );
  return finalized;
}

function evaluateLocalTruth(cityConfig, input = {}) {
  const truthConfig = cityConfig?.localTruth || { calendar: [], rules: [] };
  const context = buildLocalTruthContext(cityConfig, input);
  const rules = Array.isArray(truthConfig.rules) ? truthConfig.rules : [];
  let combinedEffect = createEmptyLocalTruthEffect();

  rules.forEach((rule) => {
    if (!matchesRule(rule, context)) {
      return;
    }

    let ruleEffect = createEmptyLocalTruthEffect();

    if (rule.effects) {
      ruleEffect = mergeLocalTruthEffects(ruleEffect, normalizeRuleEffects(rule.id, rule.effects));
    }

    if (typeof rule.evaluate === "function") {
      ruleEffect = mergeLocalTruthEffects(
        ruleEffect,
        normalizeRuleEffects(rule.id, rule.evaluate(context) || {}),
      );
    }

    combinedEffect = mergeLocalTruthEffects(combinedEffect, ruleEffect);
  });

  return finalizeLocalTruthEffect(combinedEffect, context);
}

module.exports = {
  createEmptyLocalTruthEffect,
  evaluateLocalTruth,
  resolveActiveCalendarEntries,
};
