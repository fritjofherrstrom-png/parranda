'use strict';
const { capturePublishedDayPrivacy } = require('./published-day-privacy');
const { projectPublishedDay } = require('./published-day-projection');
const { publicSourceUrlsForRecords } = require('../place-candidates/source-url-evidence');
const { SOURCE_COMPLETION } = require('../place-candidates/background-source');
const { retainLivePublication } = require('./live-completion');
const { publicLiveSourceUrls, liveDestinationRetention } = require('../place-candidates/live-source-destination-evidence');

function livePrivacy(privacy, live) {
  const witnessed = publicLiveSourceUrls(live);
  if (witnessed === null) return null;
  // Complete per-claim validation precedes union with the independent original
  // route authority. The route's URL bag cannot launder a refused contributor.
  const urls = new Set(Set.prototype.values.call(privacy.publicSourceUrls));
  for (const url of witnessed) urls.add(url);
  return { ...privacy, publicSourceUrls: urls };
}

function hasPendingSources(records) {
  const completion = records?.loader_metadata?.source_completion;
  // A private completion-bearing initial frame is not a terminal snapshot,
  // even when no JSON metadata was materialized for the direct request.
  return Boolean(records?.[SOURCE_COMPLETION]) || completion?.status === 'partial' || completion?.pending > 0;
}

// Owned only by the original HTTP operation, never read from public fields.
function createDayPublication(request, isCurrent) {
  if (request.query?.include_day_snapshot !== '1') return null;
  const privacy = capturePublishedDayPrivacy(request);
  let retained = null;
  let pendingSources = false;
  return {
    observeLoader(loader) {
      if (typeof loader !== 'function') return loader;
      const observed = async (...args) => {
        const records = await loader(...args);
        // Observe the original frame before exclusions drop private symbols.
        pendingSources ||= hasPendingSources(records);
        return records;
      };
      if (typeof loader.enrichSelected === 'function') {
        observed.enrichSelected = (...args) => loader.enrichSelected(...args);
      }
      return observed;
    },
    retain(snapshot, intent) {
      // A failed frame must never leave an earlier publication context usable.
      retained = null;
      try {
        if (!Array.isArray(intent.preferences)) return;
        const preferences = [...new Set(intent.preferences)];
        // Foreign JSON elements are not portable intent, even if the ordinary
        // composer can ignore them. Refuse sharing rather than cloning them.
        if (preferences.length > 7 || preferences.some(value => typeof value !== 'string')) return;
        // Collect producer witnesses before retainComposition/JSON destroys identity.
        retained = { intent: structuredClone({ ...intent, preferences, dateIso: snapshot.date }),
          pendingSources: pendingSources || hasPendingSources(snapshot.records),
          privacy: { ...privacy, publicSourceUrls: publicSourceUrlsForRecords(snapshot.records) } };
      } catch (_) {
        // Optional sharing may fail closed without throwing through composition.
        retained = null;
      }
    },
    liveContext(published, language) {
      // A distinct immutable answer: the original accepted route plus exactly
      // its terminal Live sidecar. Never retain a bearer or an older ref. The
      // private native Set is deliberately NOT sent through JSON cloning.
      try {
        const context = retained && retainLivePublication({ ...retained, published, language });
        if (!context) return null;
        // Strip transient fields only after the bounded copy, never with an
        // unbounded rest/spread of the original response before admission.
        delete context.published.live_completion;
        delete context.published.day_snapshot;
        return context;
      } catch (_) { return null; }
    },
    async publish(published, language, store) {
      const experiment = published.agnostic_route_output_experiment;
      if (!(experiment?.promotion?.promote === true || experiment?.manual_edit_published === true)) return;
      const unavailable = () => { if (isCurrent()) published.day_snapshot = { version: 1, state: 'unavailable' }; };
      try {
        // This slice owns terminal direct/cold bodies, never deferred Live or
        // completion-bearing publications. Upgrade trials use the pure builder.
        if (retained?.pendingSources || published.live_events?.pending === true ||
            Object.hasOwn(published, 'live_completion') ||
            published.live_events?.acquisition?.source_health?.status === 'pending' ||
            published.live_events?.acquisition?.source_health?.result === 'pending') { unavailable(); return; }
        const privacy = retained && livePrivacy(retained.privacy, published.live_events);
        const bounded = privacy && retainLivePublication({ published, language, ...retained, privacy,
          provenance: liveDestinationRetention(published.live_events) });
        const projection = bounded && projectPublishedDay(bounded);
        if (!projection || !isCurrent()) { unavailable(); return; }
        const saved = await store.put(projection);
        if (!isCurrent()) return;
        if (saved?.state !== 'ready') { unavailable(); return; }
        const { ref, created_at, expires_at } = saved.snapshot;
        published.day_snapshot = { version: 1, state: 'ready', ref, created_at, expires_at };
      } catch (_) { unavailable(); }
    },
  };
}
async function publishTerminalDay(context, liveEvents, isCurrent, store) {
  const unavailable = { version: 1, state: 'unavailable' };
  try {
    if (!context || context.pendingSources || liveEvents.pending === true ||
        liveEvents.acquisition?.source_health?.status === 'pending' ||
        liveEvents.acquisition?.source_health?.result === 'pending') return unavailable;
    const privacy = livePrivacy(context.privacy, liveEvents);
    if (!privacy) return unavailable;
    const bounded = retainLivePublication({ ...context, privacy,
      published: { ...context.published, live_events: liveEvents }, provenance: liveDestinationRetention(liveEvents) });
    const projection = bounded && projectPublishedDay(bounded);
    if (!projection || !isCurrent()) return unavailable;
    const saved = await store.put(projection);
    if (!isCurrent() || saved?.state !== 'ready') return unavailable;
    const { ref, created_at, expires_at } = saved.snapshot;
    return { version: 1, state: 'ready', ref, created_at, expires_at };
  } catch (_) { return unavailable; }
}
module.exports = { createDayPublication, publishTerminalDay };
