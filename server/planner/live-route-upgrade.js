"use strict";

const { weaveEveningEvent, selectedDayCandidates } = require('../candidates/evening-event-weave');
const { matchesPreferenceFocus } = require('./preference-focus');
const { activeLiveChoices } = require('./live-occurrence-choice');
const { composeAgnosticRouteOutput } = require('./agnostic-route-output');
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;

// Preserve private descriptors and aliases without expanding a DAG into a tree.
// Validation and copying use the same iterative, identity-based budget. Debit
// before allocating each clone/property; active identities are cycles, not aliases.
function walkTrusted(value, copy) {
  const memo = new Map();
  const active = new Set();
  const stack = [];
  let bytes = 0;
  const debit = amount => {
    bytes += amount;
    if (bytes > MAX_CONTEXT_BYTES) throw new Error('oversized_retained_context');
  };
  const stringBytes = text => {
    // JSON escaping is counted without constructing an unbounded JSON string.
    if (text.length > MAX_CONTEXT_BYTES) throw new Error('oversized_retained_context');
    let size = Buffer.byteLength(text) + 2;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) size++;
      else if (code < 32) size += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
      else if (code >= 0xd800 && code <= 0xdfff) {
        if (code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) i++;
        else size += 3; // JSON escapes lone surrogates rather than UTF-8 replacement.
      }
      if (size > MAX_CONTEXT_BYTES) throw new Error('oversized_retained_context');
    }
    return size;
  };
  const visit = item => {
    if (!item || typeof item !== 'object') {
      if (typeof item !== 'function') debit((typeof item === 'string' ? stringBytes(item) : Buffer.byteLength(JSON.stringify(item) || 'null')) + 8);
      return item;
    }
    if (active.has(item)) throw new Error('cyclic_retained_context');
    if (memo.has(item)) return memo.get(item);
    debit(8); // Empty objects also consume bounded traversal/allocation work.
    const keys = Reflect.ownKeys(item);
    // Debit all queued keys before allocating a clone/frame or descending;
    // otherwise wide ancestors can accumulate unbounded pending key arrays.
    debit(keys.length * 8);
    for (const key of keys) debit(Buffer.byteLength(String(key)));
    const clone = copy ? (Array.isArray(item) ? [] : item instanceof Date ? new Date(Date.prototype.getTime.call(item)) : {}) : null;
    memo.set(item, clone);
    active.add(item);
    stack.push({ item, clone, keys, index: 0 });
    return clone;
  };
  const result = visit(value);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.keys.length) {
      active.delete(frame.item);
      stack.pop();
      continue;
    }
    const key = frame.keys[frame.index++];
    const descriptor = Object.getOwnPropertyDescriptor(frame.item, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('unsupported_retained_accessor');
    const child = visit(descriptor.value);
    if (copy) Object.defineProperty(frame.clone, key, { ...descriptor, value: child });
  }
  return result;
}

function cloneTrusted(value) {
  return walkTrusted(value, true);
}

function contextFits(value) {
  try {
    walkTrusted(value, false);
    return true;
  } catch {
    return false;
  }
}

function retainComposition(snapshot) {
  try {
    return cloneTrusted(snapshot);
  } catch {
    return null;
  }
}

function occurrenceKey(event) {
  // Source/title/end-time updates do not create another occurrence of an ID.
  return JSON.stringify([event?.id || event?.source_url || event?.title, event?.occurrence_date, event?.starts_at]);
}

function createRouteUpgrade({ args, retained, structure, initialLive, published, publish }) {
  if (!retained || !structure) return null;
  if (!contextFits({ args, retained, structure, initialLive, published })) return null;
  const selectedDate = published?.days?.[0]?.date || args?.date;
  const blockers = published?.agnostic_route_output_experiment?.eligibility?.blockers;
  const edit = published?.agnostic_route_output_experiment?.day_edit;
  // A strict saved edit can contain an ephemeral ID absent only because its
  // original producer is still running. Keep that preliminary answer withheld,
  // but allow THIS producer to finish it. Every terminal replay still runs the
  // unchanged composition/publication gates below. Other withheld days never
  // acquire this capability.
  const keeps = activeLiveChoices(args?.liveEventChoices, selectedDate).filter(choice => choice.action === 'keep');
  const deferredLiveChoice = args?.liveSelectionPending === true && initialLive?.pending === true &&
    initialLive.selected_date === selectedDate && keeps.length === 1 &&
    args.dayEdit?.preserve_retained !== false &&
    args.dayEdit?.retained_candidate_ids?.some(id => id.startsWith('live-event-')) &&
    edit?.status === 'refused' && edit.reason === 'retained_live_not_preserved' &&
    Array.isArray(blockers) && blockers.length === 1 && blockers[0] === 'retained_live_not_preserved';
  if (!published?.agnostic_route_output_experiment?.promotion?.promote && !deferredLiveChoice) return null;
  const savedArgs = cloneTrusted(args);
  // Omitted dates were normalized by composition, not by the public request.
  savedArgs.date = published?.days?.[0]?.date || savedArgs.date;
  // The replay cannot retain or invoke acquisition/context dependencies.
  savedArgs.openDataLoader = null;
  savedArgs.weatherProvider = null;
  savedArgs.clock = null;
  savedArgs.todayIsoDate = savedArgs.date;
  const savedStructure = cloneTrusted(structure);
  const original = cloneTrusted(published);
  // Every occurrence already considered by the original selected-day weave,
  // even when it lost salience or walking gates, remains previous evidence.
  const previous = new Set();
  // Share the selected-day candidate spine: a series wrapper is not evidence
  // for each occurrence's eligibility, clock or venue.
  const pools = selectedDayCandidates;
  const originalRows = cloneTrusted(pools(initialLive));
  for (const row of originalRows) {
    const woven = weaveEveningEvent(savedStructure, { tonight: [row] }, { selectedDate: savedArgs.date, liveEventChoices: savedArgs.liveEventChoices || [] });
    const event = woven?.district_day?.evening_event;
    if (event) previous.add(occurrenceKey(event));
  }
  return async live => {
    const no = state => ({ live_route_upgrade: { version: 1, state } });
    const health = live?.acquisition?.source_health;
    if (live?.pending || live?.coverage !== 'covered' || live?.selected_date !== savedArgs.date ||
        health?.status !== 'healthy' || health?.result !== 'events_found') return no('not_eligible');
    const newKeys = new Set();
    const newRows = pools(live).filter(row => {
      // Source-normalized explicit route eligibility is mandatory for this new
      // capability. The existing weaker legacy fixture fallback is not proof.
      if (row?.route_eligible !== true) return false;
      const woven = weaveEveningEvent(savedStructure, { tonight: [row] }, { selectedDate: savedArgs.date, liveEventChoices: savedArgs.liveEventChoices || [] });
      const event = woven?.district_day?.evening_event;
      const eligible = event && !previous.has(occurrenceKey(event)) &&
        (event.explicit_live_choice === true || matchesPreferenceFocus(event, savedArgs.preferences));
      if (eligible) newKeys.add(occurrenceKey(event));
      return eligible;
    });
    if (!newRows.length) return no('not_eligible');
    // Keep completed source ranking (including displaced discovery highlights)
    // and original evidence. Filtering to only new rows would wrongly replace
    // an unchanged higher-ranked original anchor with a losing newcomer.
    const replayLive = cloneTrusted(live);
    replayLive.this_week = [...(replayLive.this_week || []), ...originalRows];
    const nextStructure = weaveEveningEvent(savedStructure, replayLive, { selectedDate: savedArgs.date, liveEventChoices: savedArgs.liveEventChoices || [] });
    if (!newKeys.has(occurrenceKey(nextStructure?.district_day?.evening_event))) return no('not_eligible');
    const composed = await composeAgnosticRouteOutput({
      ...cloneTrusted(savedArgs),
      openDataLoader: async () => cloneTrusted(retained.records),
      retainedContext: retained.context,
      onRetainComposition: null,
      liveSelectionPending: false,
      eveningEventStructure: nextStructure,
    });
    const result = await publish(composed, nextStructure, { live_events: live });
    // A real final engine weave AND the unchanged publication gate must agree.
    // Never let response fallback weaving promote a withheld engine trial.
    const finalEvent = result?.days?.[0]?.primary_route?.main_stops?.find(stop => stop.event_id === nextStructure.district_day.evening_event?.id);
    if (!composed.eventWeave?.applied || !result?.agnostic_route_output_experiment?.promotion?.promote || !finalEvent ||
        JSON.stringify(result.days) === JSON.stringify(original.days)) return no('rejected');
    return { live_route_upgrade: { version: 1, state: 'applied' }, result };
  };
}

module.exports = { retainComposition, createRouteUpgrade };
