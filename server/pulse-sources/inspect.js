const SOURCE_PROVIDER_INSPECT_EVENT_LIMIT = 10;
const SOURCE_PROVIDER_INSPECT_SIGNAL_LIMIT = 10;

function buildSourceProviderInspect({
  city,
  date,
  providerSpecs = [],
  source_status = [],
  normalized_events = [],
  compat_events = [],
  normalized_signals = [],
} = {}) {
  const compatBySourceEventId = new Map(
    (Array.isArray(compat_events) ? compat_events : [])
      .filter((event) => event && typeof event === "object")
      .map((event) => [event.source_event_id, event]),
  );
  const events = Array.isArray(normalized_events) ? normalized_events : [];
  const eventRows = events
    .slice(0, SOURCE_PROVIDER_INSPECT_EVENT_LIMIT)
    .map((event) => compactInspectEvent(event, compatBySourceEventId.get(event.id)));

  const signals = Array.isArray(normalized_signals) ? normalized_signals : [];
  const signalRows = signals
    .slice(0, SOURCE_PROVIDER_INSPECT_SIGNAL_LIMIT)
    .map((signal) => compactInspectSignal(signal));

  return {
    city: String(city || "").trim() || null,
    date: String(date || "").trim() || null,
    provider_ids: (Array.isArray(providerSpecs) ? providerSpecs : [])
      .map((spec) => spec?.descriptor?.id || spec?.id || null)
      .filter(Boolean),
    source_status: Array.isArray(source_status) ? source_status : [],
    normalized_event_count: events.length,
    returned_event_rows: eventRows.length,
    truncated_event_count: Math.max(0, events.length - eventRows.length),
    event_rows: eventRows,
    normalized_signal_count: signals.length,
    returned_signal_rows: signalRows.length,
    truncated_signal_count: Math.max(0, signals.length - signalRows.length),
    signal_rows: signalRows,
  };
}

/**
 * Compact a normalized source signal for inspect output. Surfaces why the
 * signal exists and how it is gated — never the raw provider payload.
 */
function compactInspectSignal(signal) {
  const sourceOwned = signal?.source_owned || {};
  const parrandaOwned = signal?.parranda_owned || {};
  const displayGate = signal?.display_gate || {};

  return {
    id: signal?.id || null,
    role: signal?.role || null,
    signal_type: signal?.signal_type || signal?.type || null,
    signal_kind: parrandaOwned.signal_kind || null,
    confidence: signal?.confidence || null,
    title: sourceOwned.title || signal?.title || null,
    dayflow_reason: parrandaOwned.dayflow_reason || null,
    source: {
      id: signal?.source?.id || null,
      label: signal?.source?.label || null,
    },
    display_gate: {
      may_show_in_pulse: displayGate.may_show_in_pulse === true,
      may_show_in_live_list: displayGate.may_show_in_live_list === true,
      may_create_place_candidate: displayGate.may_create_place_candidate === true,
      may_show_as_nearby: displayGate.may_show_as_nearby === true,
      may_influence_routes: displayGate.may_influence_routes === true,
      reasons: Array.isArray(displayGate.reasons) ? displayGate.reasons : [],
    },
  };
}

function compactInspectEvent(event, compatEvent) {
  const sourceOwned = event?.source_owned || {};
  const displayGate = event?.display_gate || {};

  return {
    id: event?.id || null,
    role: event?.role || null,
    confidence: event?.confidence || null,
    source: {
      id: event?.source?.id || null,
      label: event?.source?.label || null,
      url: event?.source?.url || null,
    },
    source_owned: {
      title: sourceOwned.title || null,
      start_date: sourceOwned.start_date || null,
      end_date: sourceOwned.end_date || null,
      venue: sourceOwned.venue || null,
      address: sourceOwned.address || null,
      lat: Number.isFinite(sourceOwned.lat) ? sourceOwned.lat : null,
      lng: Number.isFinite(sourceOwned.lng) ? sourceOwned.lng : null,
    },
    display_gate: {
      may_show_in_pulse: displayGate.may_show_in_pulse === true,
      may_show_in_live_list: displayGate.may_show_in_live_list === true,
      may_create_place_candidate: displayGate.may_create_place_candidate === true,
      may_show_as_nearby: displayGate.may_show_as_nearby === true,
      may_influence_routes: displayGate.may_influence_routes === true,
      reasons: Array.isArray(displayGate.reasons) ? displayGate.reasons : [],
    },
    converted_to_live_event: Boolean(compatEvent),
    compat_live_event_id: compatEvent?.id || null,
  };
}

module.exports = {
  SOURCE_PROVIDER_INSPECT_EVENT_LIMIT,
  SOURCE_PROVIDER_INSPECT_SIGNAL_LIMIT,
  buildSourceProviderInspect,
};
