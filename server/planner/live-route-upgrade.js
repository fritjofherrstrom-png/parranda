"use strict";

const { weaveEveningEvent } = require('../candidates/evening-event-weave');
const { matchesPreferenceFocus } = require('./preference-focus');
const { composeAgnosticRouteOutput } = require('./agnostic-route-output');
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;

// Preserve private array/symbol metadata (including excluded loaded IDs), not
// merely JSON rows. No retained array or context can follow a provider mutation.
function cloneTrusted(value) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  const clone = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!('value' in descriptor)) throw new Error('unsupported_retained_accessor');
    Object.defineProperty(clone, key, { ...descriptor, value: cloneTrusted(descriptor.value) });
  }
  return clone;
}

// Count non-enumerable/symbol array metadata too; JSON length omits it.
function contextFits(value) {
  const stack = [value];
  let bytes = 0;
  const ancestors = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) continue;
      ancestors.add(item);
      for (const key of Reflect.ownKeys(item)) {
        bytes += Buffer.byteLength(String(key)) + 8;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!('value' in descriptor)) return false;
        stack.push(descriptor.value);
      }
    } else if (typeof item !== 'function') {
      bytes += Buffer.byteLength(JSON.stringify(item) || 'null') + 8;
    }
    if (bytes > MAX_CONTEXT_BYTES) return false;
  }
  return true;
}

function retainComposition(snapshot) {
  if (!contextFits(snapshot)) return null;
  return cloneTrusted(snapshot);
}

function occurrenceKey(event) {
  // Source/title/end-time updates do not create another occurrence of an ID.
  return JSON.stringify([event?.id || event?.source_url || event?.title, event?.occurrence_date, event?.starts_at]);
}

function createRouteUpgrade({ args, retained, structure, initialLive, published, publish }) {
  if (!retained || !published?.agnostic_route_output_experiment?.promotion?.promote || !structure) return null;
  if (!contextFits({ args, retained, structure, initialLive, published })) return null;
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
  const pools = live => [...(live?.tonight || []), ...(live?.this_week || []), ...(live?.browse?.tonight?.more || []), ...(live?.browse?.this_week?.more || [])];
  const originalRows = cloneTrusted(pools(initialLive));
  for (const row of originalRows) {
    const woven = weaveEveningEvent(savedStructure, { tonight: [row] }, { selectedDate: savedArgs.date });
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
      const woven = weaveEveningEvent(savedStructure, { tonight: [row] }, { selectedDate: savedArgs.date });
      const event = woven?.district_day?.evening_event;
      const eligible = event && !previous.has(occurrenceKey(event)) && matchesPreferenceFocus(event, savedArgs.preferences);
      if (eligible) newKeys.add(occurrenceKey(event));
      return eligible;
    });
    if (!newRows.length) return no('not_eligible');
    // Keep completed source ranking (including displaced discovery highlights)
    // and original evidence. Filtering to only new rows would wrongly replace
    // an unchanged higher-ranked original anchor with a losing newcomer.
    const replayLive = cloneTrusted(live);
    replayLive.this_week = [...(replayLive.this_week || []), ...originalRows];
    const nextStructure = weaveEveningEvent(savedStructure, replayLive, { selectedDate: savedArgs.date });
    if (!newKeys.has(occurrenceKey(nextStructure?.district_day?.evening_event))) return no('not_eligible');
    const composed = await composeAgnosticRouteOutput({
      ...cloneTrusted(savedArgs),
      openDataLoader: async () => cloneTrusted(retained.records),
      retainedContext: retained.context,
      onRetainComposition: null,
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
