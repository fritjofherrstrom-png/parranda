import { normalizeDayEdit } from '../../../shared/planner-intent.mjs';
import { normalizeDayPlaceSearch } from '../../../shared/day-place-search.mjs';
import { buildAnywherePayload } from './anywhere-payload.mjs';
import { scopeLiveChoices } from './live-stop-choice.mjs';
import { fetchPlannerLifecycle } from './planner-lifecycle.mjs';
import { takeLiveCompletion, followLiveCompletion, LIVE_COMPLETION_QUERY } from './live-completion.mjs';
import { primaryRouteStops } from './maps-links.mjs';

// Work on copies of the frozen answer. Only IDs return to the trusted composer.
export function buildDayPlacePayload({ anchor, entry, commitments = {}, query, candidate, replaceId } = {}) {
  if (!anchor || !entry?.dateIso || !entry.inputs) throw new Error('day_place_scope_unavailable');
  const ids = primaryRouteStops(entry.safeResponse).map(stop => String(stop.id || ''));
  if (!ids.length || ids.some(id => !id)) throw new Error('day_place_scope_unavailable');
  const next = { ...commitments };
  let edit = normalizeDayEdit(entry.inputs.dayEdit);
  if (candidate) {
    if (!candidate.id || ids.includes(candidate.id) || (replaceId && (!ids.includes(replaceId) || next[replaceId]?.kind === 'pin'))) throw new Error('invalid_place_choice');
    edit = normalizeDayEdit({ version: 1, action: replaceId ? 'replace' : 'add',
      candidate_id: replaceId || candidate.id,
      ...(replaceId ? { replacement_candidate_id: candidate.id } : {}),
      retained_candidate_ids: ids.filter(id => id !== replaceId), target_stop_count: ids.length + (replaceId ? 0 : 1),
      slot_index: replaceId ? ids.indexOf(replaceId) : Math.min(5, ids.length), replacement_preference: null,
      removed_candidate_ids: [...new Set([...(edit?.removed_candidate_ids || []), ...(replaceId ? [replaceId] : [])])] });
    if (!edit) throw new Error('day_place_capacity');
    next[candidate.id] = { kind: 'pin', label: candidate.label || '' };
    if (replaceId) next[replaceId] = { kind: 'exclude', label: primaryRouteStops(entry.safeResponse).find(stop => stop.id === replaceId)?.label || '' };
  }
  const ledger = scopeLiveChoices(next, entry.dateIso);
  const excluded = [...new Set([...ledger.excludedIds, ...(edit ? [...(edit.action === 'add' ? [] : [edit.candidate_id]), ...edit.removed_candidate_ids] : [])])];
  if (ledger.pinnedIds.length > 12) throw new Error('day_place_capacity');
  const payload = buildAnywherePayload({ ...anchor, coords: anchor.coords ?? null, dates: [entry.dateIso],
    preferences: entry.inputs.selected, preferencePriority: entry.inputs.preferencePriority, dayRhythm: entry.inputs.walkKey,
    dayEdit: edit, excludedCandidateIds: excluded, pinnedCandidateIds: ledger.pinnedIds, liveEventChoices: ledger.liveEventChoices });
  if (query !== undefined) {
    const search = normalizeDayPlaceSearch({ query, visible_candidate_ids: ids });
    if (!search) throw new Error('invalid_day_place_search');
    payload.day_place_search = search;
  }
  return { payload, edit, commitments: next };
}

export async function requestDayPlace({ payload, lang, signal, onCancellationReady, onPending, fetcher }) {
  const result = await fetchPlannerLifecycle(`/api/route-recommendations?lang=${lang === 'sv' ? 'sv' : 'en'}&${LIVE_COMPLETION_QUERY}${Number.isFinite(payload.lat) ? '' : '&include_day_snapshot=1'}`,
    { payload, signal, onCancellationReady, onPending, ...(fetcher ? { fetcher } : {}) });
  let { body, capability } = takeLiveCompletion(result.body);
  if (body?.live_events?.pending === true) {
    if (!capability) throw new Error('day_place_live_unavailable');
    let liveEvents = null, daySnapshot;
    const completion = await followLiveCompletion({ capability, signal, ...(fetcher ? { fetcher } : {}),
      onLiveEvents: (live, snapshot) => { liveEvents = live; daySnapshot = snapshot; } });
    if (completion.live !== 'terminal' || !liveEvents || liveEvents.pending === true) throw new Error('day_place_live_unavailable');
    body = completion.upgrade?.kind === 'applied' ? takeLiveCompletion(completion.upgrade.result).body
      : { ...body, live_events: liveEvents, day_snapshot: daySnapshot || { version: 1, state: 'unavailable' } };
    if (body?.live_events?.pending === true) throw new Error('day_place_live_unavailable');
  }
  return { ...result, body };
}

// Releasing Add is not a rejection of that venue. Only actual earlier removals
// can form a durable remove/cap command; otherwise ordinary rhythm owns depth.
export function releaseAddedDayEdit(edit, currentIds, releaseExtent = false) {
  if (edit?.action !== 'add' || !edit.removed_candidate_ids.length) return null;
  const retained = currentIds.filter(id => !edit.removed_candidate_ids.includes(id));
  return normalizeDayEdit({ version: 1, action: 'remove', candidate_id: edit.removed_candidate_ids[0],
    retained_candidate_ids: retained, target_stop_count: retained.length, slot_index: Math.min(5, edit.slot_index),
    replacement_preference: null, removed_candidate_ids: edit.removed_candidate_ids,
    preserve_retained: false, ...(releaseExtent ? { release_extent: true } : {}) });
}

export function validDayPlacePreview(body, { edit, dateIso }) {
  const day = body?.days?.[0], outcome = body?.agnostic_route_output_experiment?.day_edit;
  const ids = primaryRouteStops(body).map(stop => stop.id);
  const chosenId = edit.action === 'add' ? edit.candidate_id : edit.replacement_candidate_id;
  return day?.date === dateIso && body?.agnostic_route_output_experiment?.promotion?.promote === true &&
    outcome?.status === 'applied' && outcome.action === edit.action && outcome.candidate_id === edit.candidate_id &&
    ids.length === edit.target_stop_count && new Set(ids).size === ids.length && ids.includes(chosenId) &&
    edit.removed_candidate_ids.every(id => !ids.includes(id)) &&
    JSON.stringify(ids.filter(id => id !== chosenId)) === JSON.stringify(edit.retained_candidate_ids) &&
    JSON.stringify(outcome.result_candidate_ids) === JSON.stringify(ids) &&
    outcome.actual_stop_count === ids.length && outcome.unavailable_retained_candidate_ids?.length === 0;
}
