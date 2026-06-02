const SOURCE_PROVIDER_INSPECT_EVENT_LIMIT = 10;

function buildSourceProviderInspect({
  city,
  date,
  providerSpecs = [],
  source_status = [],
  normalized_events = [],
  compat_events = [],
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
  buildSourceProviderInspect,
};
