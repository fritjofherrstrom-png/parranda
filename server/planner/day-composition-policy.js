'use strict';

// Selection policy over the ALREADY admitted engine reservoir. This module
// never acquires candidates, manufactures fit, or changes a source/trust gate.
const { normalizePreferencePriority, normalizeDayEdit } = require('../../shared/planner-intent.mjs');
const { normalizeUserIntents } = require('../candidates/intent-vocabulary');
const { preferenceFit } = require('./preference-focus');
const { selectAgnosticCandidateSet } = require('./agnostic-candidate-set');

const UI_BY_INTENT = Object.freeze({ food: 'food', museums: 'culture', scenic: 'views',
  coffee: 'fika', bars: 'nightlife', green: 'green', second_hand: 'second_hand' });

function canonicalPriority(value, preferences) {
  const selected = normalizeUserIntents(preferences).intents.map(intent => UI_BY_INTENT[intent]).filter(Boolean);
  return normalizeUserIntents(normalizePreferencePriority(value, selected)).intents;
}

function* subsets(values, count, offset = 0, prefix = []) {
  if (prefix.length === count) { yield prefix; return; }
  for (let index = offset; index <= values.length - (count - prefix.length); index += 1) {
    yield* subsets(values, count, index + 1, [...prefix, values[index]]);
  }
}

function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > 1e-9) return left[index] - right[index];
  }
  return 0;
}

function isMeal(candidate) {
  return preferenceFit(candidate).coveredPreferences.includes('food');
}

function selectBalancedDay({ rankedCandidates = [], selected = [], preferences = [],
  preferencePriority = [], pinnedIds = [], ...context } = {}) {
  const requested = normalizeUserIntents(preferences).intents;
  const priority = canonicalPriority(preferencePriority, preferences);
  if (requested.length < 2 || (!priority.length && !requested.includes('food'))) return selected;
  // Exhaustive set evaluation is deliberately bounded to the same 12-place
  // reservoir as the existing chooser, not factorial route-order search.
  const unique = new Map();
  for (const entry of rankedCandidates) if (!unique.has(entry.item.id)) unique.set(entry.item.id, entry);
  const pool = [...unique.values()].slice(0, 12);
  const count = Math.min(selected.length, pool.length, 6);
  if (!count) return selected;
  const describe = entries => selectAgnosticCandidateSet({ ...context,
    rankedCandidates: entries, desiredCount: entries.length, requestedPreferences: preferences,
    allowExpansion: false }).diagnostics;
  const baseline = describe(selected.map(item => unique.get(item.id) || { item, score: 0 }));
  const fits = new Map(pool.map(({ item }) => [item, preferenceFit(item)]));
  const weights = new Map(requested.map(intent => [intent, 1]));
  // Two/three interests have a clear leading focus. With many interests the
  // slope tapers rather than treating every numbered chip as a rigid quota.
  const slope = requested.length <= 3 ? 1.8 : requested.length === 4 ? 0.75 : 0.3;
  priority.forEach((intent, index) => weights.set(intent,
    1 + slope * (priority.length - 1 - index) / Math.max(1, priority.length - 1)));
  const poolIds = new Set(pool.map(({ item }) => item.id));
  const required = pinnedIds.filter(id => poolIds.has(id));
  let best = null;
  for (const entries of subsets(pool, count)) {
    if (required.some(id => !entries.some(({ item }) => item.id === id))) continue;
    const diagnostics = describe(entries);
    // A content preference is never permission for a large new detour. The
    // existing final engine/walking checks remain authoritative after this.
    if (diagnostics.estimated_km > Math.max(baseline.estimated_km * 1.25, baseline.estimated_km + 0.5)) continue;
    if (diagnostics.longest_leg_km > Math.max(baseline.longest_leg_km, 1.5)) continue;
    let utility = 0;
    for (const intent of requested) {
      const hits = entries.filter(({ item }) => fits.get(item).coveredPreferences.includes(intent)).length;
      for (let hit = 0; hit < hits; hit += 1) utility += weights.get(intent) / (hit + 1);
    }
    const meals = entries.filter(({ item }) => isMeal(item)).length;
    // A fixed six-role combination is a neutral fallback, not a veto on an
    // explicitly higher-priority seventh interest. Coverage and walking still
    // lead; only explicit priority moves content utility ahead of that spine.
    const score = [diagnostics.within_budget ? 1 : 0,
      diagnostics.exact_preference_count,
      ...(!priority.length ? [diagnostics.spine_role_count] : []), diagnostics.partial_preference_count,
      -Math.max(0, meals - 2), utility,
      ...(priority.length ? [diagnostics.spine_role_count] : []),
      diagnostics.local_quality, diagnostics.operational_quality, diagnostics.trust_quality,
      diagnostics.within_target_band ? 1 : 0, -diagnostics.target_distance_km,
      diagnostics.unique_family_count, diagnostics.individual_score];
    const key = entries.map(({ item }) => item.id).sort().join('|');
    if (!best || compare(score, best.score) > 0 || (compare(score, best.score) === 0 && key < best.key)) {
      best = { entries, score, key };
    }
  }
  return best ? best.entries.map(({ item }) => item) : selected;
}

function* orders(values, prefix = []) {
  if (!values.length) { yield prefix; return; }
  for (let index = 0; index < values.length; index += 1) {
    yield* orders([...values.slice(0, index), ...values.slice(index + 1)], [...prefix, values[index]]);
  }
}

function orderBalancedDay({ stops, geometry, geometryFor, chainKm, preferences = [], dayEdit = null }) {
  const unchanged = { stops, geometry, changed: false };
  const strictEdit = dayEdit && (dayEdit.action === 'replace' || dayEdit.preserve_retained !== false);
  if (stops.length > 6 || (!strictEdit && (normalizeUserIntents(preferences).intents.length < 2 ||
      !stops.some(isMeal) || stops.every(isMeal)))) return unchanged;
  const baseKm = chainKm(stops);
  const score = candidate => {
    const retained = candidate.filter(stop => dayEdit?.retained_candidate_ids.includes(stop.id));
    const orderDrift = strictEdit ? retained.reduce((sum, stop, index) =>
      sum + Math.abs(index - dayEdit.retained_candidate_ids.filter(id => stops.some(stop => stop.id === id)).indexOf(stop.id)), 0) : 0;
    const replacementIndex = strictEdit && dayEdit.action === 'replace'
      ? candidate.findIndex(stop => !dayEdit.retained_candidate_ids.includes(stop.id)) : -1;
    return [
      ...(strictEdit ? [replacementIndex < 0 ? 0 : -Math.abs(replacementIndex - dayEdit.slot_index), -orderDrift] : []),
      -candidate.slice(1).filter((stop, index) => isMeal(stop) && isMeal(candidate[index])).length,
      -(isMeal(candidate[0]) && isMeal(candidate[1]) ? 1 : 0),
      -chainKm(candidate),
    ];
  };
  let best = { ...unchanged, score: score(stops) };
  for (const candidate of orders(stops)) {
    const km = chainKm(candidate);
    if (km > Math.max(baseKm * 1.08, baseKm + 0.25)) continue;
    const nextScore = score(candidate);
    if (compare(nextScore, best.score) <= 0) continue;
    const nextGeometry = geometryFor(candidate);
    if (nextGeometry.estimatedKm > Math.max(geometry.estimatedKm * 1.08, geometry.estimatedKm + 0.25)) continue;
    best = { stops: candidate, geometry: nextGeometry,
      changed: candidate.some((stop, index) => stop !== stops[index]), score: nextScore };
  }
  return best;
}

function selectEditedDay({ rankedCandidates = [], selected = [], dayEdit, pinnedIds = [],
  preferences = [], ...context } = {}) {
  const excluded = new Set([dayEdit.candidate_id, ...dayEdit.removed_candidate_ids]);
  const byId = new Map(rankedCandidates.map(({ item }) => [item.id, item]));
  const refused = reason => ({ selected: [], reason });
  if (dayEdit.action === 'remove' && dayEdit.preserve_retained === false) {
    const capped = selected.filter(item => !excluded.has(item.id)).slice(0, dayEdit.target_stop_count);
    return pinnedIds.some(id => !capped.some(item => item.id === id))
      ? refused('pin_conflict') : { selected: capped, reason: null };
  }
  const retained = dayEdit.retained_candidate_ids.map(id => byId.get(id))
    .filter(item => item && !excluded.has(item.id));
  if (pinnedIds.some(id => !retained.some(item => item.id === id))) return refused('pin_conflict');
  if (dayEdit.action === 'remove') return { selected: retained, reason: null };
  if (retained.length !== dayEdit.retained_candidate_ids.length) return refused('retained_candidates_unavailable');
  const requested = normalizeUserIntents(preferences).intents;
  const intent = dayEdit.replacement_preference
    ? normalizeUserIntents([dayEdit.replacement_preference]).intents[0]
    : requested.length === 1 ? requested[0] : null;
  if (!intent || !requested.includes(intent)) return refused('no_safe_replacement');
  const kept = new Set(retained.map(item => item.id));
  let best = null;
  for (const item of byId.values()) {
    if (excluded.has(item.id) || kept.has(item.id)) continue;
    const fit = preferenceFit(item);
    const strength = fit.coveredPreferences.includes(intent) ? 2 : fit.partialPreferences.includes(intent) ? 1 : 0;
    if (!strength) continue;
    const entries = [...retained, item].map(item => ({ item, score: 0 }));
    const diagnostics = selectAgnosticCandidateSet({ ...context, rankedCandidates: entries,
      desiredCount: entries.length, requestedPreferences: preferences }).diagnostics;
    if (!diagnostics.within_budget || diagnostics.longest_leg_km > 6 || diagnostics.estimated_km > 25) continue;
    const score = [strength, diagnostics.local_quality, diagnostics.operational_quality,
      diagnostics.trust_quality, -diagnostics.estimated_km];
    if (!best || compare(score, best.score) > 0 ||
        (compare(score, best.score) === 0 && item.id < best.item.id)) best = { item, score };
  }
  return best ? { selected: [...retained, best.item], reason: null } : refused('no_safe_replacement');
}

function dayEditOutcome(dayEdit, stops = [], reason = null) {
  const ids = stops.map(stop => stop.id);
  const retained = dayEdit.retained_candidate_ids.filter(id => ids.includes(id));
  return { version: 1, action: dayEdit.action, status: reason ? 'refused' : 'applied',
    reason: reason || (dayEdit.action === 'replace' ? 'replaced' : dayEdit.preserve_retained === false ? 'recomposed_with_cap' : 'removed'), candidate_id: dayEdit.candidate_id,
    target_stop_count: dayEdit.target_stop_count, actual_stop_count: ids.length,
    retained_candidate_ids: retained,
    unavailable_retained_candidate_ids: dayEdit.retained_candidate_ids.filter(id => !ids.includes(id)),
    replacement_candidate_id: dayEdit.action === 'replace' && !reason
      ? ids.find(id => !dayEdit.retained_candidate_ids.includes(id)) || null : null,
    result_candidate_ids: ids };
}

module.exports = { canonicalPriority, isMeal, selectBalancedDay, orderBalancedDay, selectEditedDay, dayEditOutcome, normalizeDayEdit };
