'use strict';
const { budget, MAX_BYTES, own } = require('./published-day-fields');
const { normalizePreferencePriority, normalizeDayEdit } = require('../../shared/planner-intent.mjs');
const { normalizeUserIntents } = require('../candidates/intent-vocabulary');
const { dayEditOutcome } = require('./day-composition-policy');
const { isDeepStrictEqual } = require('node:util');
const { MAX_PINNED_IDS, parsePinnedCandidateIds, summarizePinnedOutcome } = require('./pinned-candidates');
const { MAX_EXCLUDED_IDS } = require('./excluded-candidates');
const { parseLiveEventChoices, activeLiveChoices, summarizeLiveChoices } = require('./live-occurrence-choice');
const { isRealIsoDate } = require('./requested-dates');
const { isAgnosticAppliedDay } = require('../../anywhere-render-decision');
const PRIVACY_FLAGS = ['explicitCoordinatesPresent','customEndpointPresent','biasPresent',
  'contextSelectionPresent','selectionPresent','requestedPlaceRefPresent'];

/** Only the caller's FINAL trusted server publication belongs at this seam.
 * This pure closed projection is not authentication for a public upload.
 * Store admission still owns the byte bound of the persisted envelope.
 */
function projectPublishedDay(input = {}) {
  try {
    const published = own(input,'published').value;
    let intent = own(input,'intent').value;
    const privacy = own(input,'privacy').value;
    const language = own(input,'language').value;
    if (!privacy || !['en','sv'].includes(language) || PRIVACY_FLAGS.some(key => {
      const atom = own(privacy,key); return !atom.present || typeof atom.value !== 'boolean';
    }) || PRIVACY_FLAGS.slice(0,4).some(key => own(privacy,key).value)) return null;
    // Separate bounded intake work from the exact output byte counter. The
    // original one-shot command is not part of AcknowledgedIntent.
    intent = budget(privacy).copy('InputIntent', intent);
    const bounded = budget(privacy);
    if (new Set(intent.preferences).size !== intent.preferences.length ||
        JSON.stringify(normalizePreferencePriority(intent.preferencePriority,intent.preferences)) !== JSON.stringify(intent.preferencePriority) ||
        JSON.stringify(parsePinnedCandidateIds(intent.pinnedCandidateIds)) !== JSON.stringify(intent.pinnedCandidateIds) ||
        new Set(intent.excludedCandidateIds).size !== intent.excludedCandidateIds.length ||
        !parseLiveEventChoices(intent.liveEventChoices).valid ||
        (intent.dayEdit !== null && !normalizeDayEdit(intent.dayEdit))) return null;
    const result = bounded.copy('Result', published);
    const experiment = result.agnostic_route_output_experiment;
    const day = result.days[0];
    if (!isRealIsoDate(intent?.dateIso) || day.date !== intent.dateIso ||
        experiment.route_mutation !== true || experiment.eligibility.eligible !== true ||
        !(experiment.intake.resolved.confidence === 'explicit' || ['high','medium'].includes(experiment.intake.resolved.confidence.toLowerCase()))) return null;
    const empty = intent.dayEdit?.action === 'remove' && intent.dayEdit.target_stop_count === 0 &&
      day.manual_empty_day === true && day.primary_route === null && experiment.manual_edit_published === true &&
      experiment.promotion.promote === false && experiment.day_edit?.version === 1 && experiment.day_edit.action === 'remove' &&
      experiment.day_edit.status === 'applied' && experiment.day_edit.target_stop_count === 0 &&
      experiment.day_edit.actual_stop_count === 0 && experiment.day_edit.result_candidate_ids.length === 0;
    if (!empty && (experiment.promotion.promote !== true || !isAgnosticAppliedDay(day) ||
      day.manual_empty_day === true || experiment.manual_edit_published === true || !day.primary_route)) return null;
    if (result.live_events?.selected_date && result.live_events.selected_date !== day.date) return null;
    if (experiment.constraint_negotiation && experiment.constraint_negotiation.route_present !== (day.primary_route !== null)) return null;
    if (experiment.constraint_negotiation) {
      const requested = normalizeUserIntents(experiment.constraint_negotiation.preference_coverage.requested_preferences).intents;
      const expected = normalizeUserIntents(intent.preferences).intents;
      if (requested.length !== experiment.constraint_negotiation.preference_coverage.requested_preferences.length ||
        !isDeepStrictEqual([...requested].sort(),[...expected].sort())) return null;
    }
    const finalStops = day.primary_route?.main_stops || [];
    if (finalStops.some(stop=>intent.excludedCandidateIds.includes(stop.id))) return null;
    const active = activeLiveChoices(intent.liveEventChoices,day.date);
    if (active.some(choice=>choice.action !== 'keep' && finalStops.some(stop=>stop.live_occurrence_id === choice.occurrence_id))) return null;
    const resolved = experiment.intake.resolved;
    const acknowledged = { dateIso: result.days[0].date, place: resolved.label, placeLabel: resolved.label,
      placeRef: resolved.place_ref, mode: 'typed', selected: [...intent.preferences], walkKey: intent.dayRhythm,
      excludedCandidateIds: [...intent.excludedCandidateIds], pinnedCandidateIds: [...intent.pinnedCandidateIds],
      liveEventChoices: intent.liveEventChoices.map(c => ({occurrence_id:c.occurrence_id, action:c.action})) };
    if (intent.dayEdit) {
      const command = normalizeDayEdit(intent.dayEdit);
      const stops = day.primary_route?.main_stops || [];
      const finalIds = stops.map(stop => stop.id);
      if (!isDeepStrictEqual(experiment.day_edit,dayEditOutcome(command,stops)) ||
          finalIds.includes(command.candidate_id) || command.removed_candidate_ids.some(id=>finalIds.includes(id)) ||
          ![command.candidate_id,...command.removed_candidate_ids].every(id=>intent.excludedCandidateIds.includes(id))) return null;
      const applied = normalizeDayEdit({ version:1, action:'remove', candidate_id:command.candidate_id,
        retained_candidate_ids:finalIds, target_stop_count:finalIds.length, slot_index:command.slot_index,
        replacement_preference:null, removed_candidate_ids:command.removed_candidate_ids,
        ...(command.preserve_retained === false ? {preserve_retained:false} : {}) });
      if (!applied) return null;
      acknowledged.dayEdit = applied;
    } else if (experiment.day_edit) return null;
    if (intent.preferencePriority.length) acknowledged.preferencePriority = [...intent.preferencePriority];
    const stops = day.primary_route?.main_stops || [];
    if (!isDeepStrictEqual(experiment.pinned_candidates,
      summarizePinnedOutcome(intent.pinnedCandidateIds,stops,experiment.pinned_candidates?.unhonored))) return null;
    if (intent.liveEventChoices.length ? !isDeepStrictEqual(experiment.live_event_choices,
      summarizeLiveChoices(intent.liveEventChoices,stops,day.date)) : Object.hasOwn(experiment,'live_event_choices')) return null;
    if (!commitmentsFit(acknowledged,result)) return null;
    const projectedIntent = bounded.copy('AcknowledgedIntent',acknowledged);
    // Three closed envelope keys, two commas, three colons and two braces.
    bounded.charge(7);
    for (const key of ['intent','result','language']) bounded.string(key);
    bounded.string(language);
    const projection = { intent: projectedIntent, result, language };
    return Buffer.byteLength(JSON.stringify(projection), 'utf8') <= MAX_BYTES ? projection : null;
  } catch (_) { return null; }
}
function commitmentsFit(input,result) {
  const entries = Object.create(null);
  const labels = new Map();
  const remember = (id,label) => { if (id && typeof label === 'string' && !labels.has(id)) labels.set(id,label); };
  for (const stop of result.days[0].primary_route?.main_stops || []) {
    for (const id of [stop.id,stop.place_id,stop.candidate_id,stop.live_occurrence_id]) remember(id,stop.label || stop.name);
  }
  for (const area of result.place_structure?.district_day?.areas || []) for (const stop of area.stops || []) {
    for (const id of [stop.id,stop.place_id,stop.candidate_id]) remember(id,stop.name);
  }
  const event = row => { remember(row.live_occurrence_id,row.title); for (const child of row.occurrences || []) event(child); };
  const live = result.live_events;
  if (live) for (const row of [...live.tonight,...live.this_week,...(live.browse?.tonight.more||[]),...(live.browse?.this_week.more||[])]) event(row);
  let pins = 0, exclusions = 0;
  const add = (id,kind,liveAction) => {
    // Snapshot v3 uses a normal object; __proto__ cannot survive its own-key
    // construction. Never let that helper silently discard an acknowledged ID.
    if (id === '__proto__' || Object.hasOwn(entries,id) || id.length > 128 || id !== id.trim()) return false;
    const label = labels.get(id) || '';
    if (label.length > 120 || label !== label.trim()) return false;
    if (kind === 'pin' ? ++pins > MAX_PINNED_IDS : ++exclusions > MAX_EXCLUDED_IDS) return false;
    Object.defineProperty(entries,id,{value:{kind,label,...(liveAction ? {liveAction} : {})},enumerable:true});
    return true;
  };
  for (const id of input.pinnedCandidateIds) if (id.startsWith('live:') || !add(id,'pin')) return false;
  for (const id of input.excludedCandidateIds) if (id.startsWith('live:') || !add(id,'exclude')) return false;
  for (const choice of activeLiveChoices(input.liveEventChoices,input.dateIso)) {
    if (!add(choice.occurrence_id,choice.action === 'keep' ? 'pin' : 'exclude',choice.action === 'keep' ? null : choice.action)) return false;
  }
  // This API returns AcknowledgedIntent, not a SavedEntry or ledger. All
  // entries now fit the snapshot's aggregate ID/label/action bounds; source
  // verdict IDs/counts/reasons were revalidated above. The recipient builds
  // its snapshot with the existing canonical helpers (exercised by the tests),
  // rather than duplicating anchor/day key formulas here or importing modules
  // from frontend/src, which the existing server image does not contain.
  return true;
}
module.exports = { projectPublishedDay };
