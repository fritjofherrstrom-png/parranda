const { collectOpenDataAgendaEventsForDates } = require("./live");
const { buildProviderCollectionOutcome } = require("../../pulse-sources/provider-collection-outcome");

const OPEN_DATA_BCN_AGENDA_PROVIDER_ID = "barcelona-open-data-agenda";

const openDataBcnAgendaDescriptor = {
  id: OPEN_DATA_BCN_AGENDA_PROVIDER_ID,
  label: "Open Data BCN",
  city: "barcelona",
  role: "official_live_baseline",
  sourceType: "official_open_data",
  sourceUrl: "https://opendata-ajuntament.barcelona.cat/data/en/dataset/agenda-diaria",
  status: "active",
  intendedUse: "live",
  supportedLanguages: ["ca", "es", "en"],
  updateCadence: "daily",
  parsingRisk: "medium",
  trust: {
    source_tier: "official",
    confidence: "high",
    human_verified: false,
    freshness: "fresh",
  },
  cachePolicy: {
    kind: "memory",
    ttlSeconds: 1800,
  },
  sourceOwnedFields: [
    "title",
    "venue",
    "address",
    "start_date",
    "end_date",
    "source_url",
    "url",
    "provider_category",
    "source_language",
    "raw_summary",
    "summary",
    "lat",
    "lng",
    "geocode_label",
    "geocode_source",
  ],
  parrandaOwnedFields: [
    "tags_intents",
    "route_fit",
    "match_reason",
    "quality_reasons",
  ],
};

function createOpenDataBcnAgendaProvider(cityConfig, providerOptions = {}) {
  return {
    descriptor: openDataBcnAgendaDescriptor,
    create(_cityConfig, context = {}) {
      return {
        async collect(collectionContext = {}) {
          const dates = normalizeDates(collectionContext.dates || context.dates || providerOptions.dates);
          if (!dates.length) {
            return {
              events: [],
              signals: [],
              collection_status: buildProviderCollectionOutcome("unavailable", {
                reason: "collection_context_unavailable",
                eventRows: 0,
              }),
            };
          }

          const fetchForDates =
            collectionContext.collectOpenDataAgendaEventsForDates ||
            context.collectOpenDataAgendaEventsForDates ||
            providerOptions.collectOpenDataAgendaEventsForDates ||
            collectOpenDataAgendaEventsForDates;

          const byDate = await fetchForDates(dates, {
            ...providerOptions,
            ...context,
            ...collectionContext,
          });

          const events = flattenDateKeyedEvents(byDate).map(toSourceProviderEvent);
          return {
            events,
            signals: [],
            collection_status: buildProviderCollectionOutcome(events.length ? "ok" : "empty", {
              reason: events.length ? null : "source_empty",
              eventRows: events.length,
            }),
          };
        },
      };
    },
  };
}

function flattenDateKeyedEvents(byDate) {
  if (!byDate || typeof byDate !== "object" || Array.isArray(byDate)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const date of Object.keys(byDate).sort()) {
    const list = Array.isArray(byDate[date]) ? byDate[date] : [];
    for (const event of list) {
      if (!event || typeof event !== "object") continue;
      const key = event.id || `${event.title || ""}:${event.venue || ""}:${event.start_date || date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(event);
    }
  }
  return out;
}

function toSourceProviderEvent(event) {
  return {
    ...event,
    provider_id: event.id,
    source_owned: {
      title: event.title,
      venue: event.venue,
      address: event.address,
      start_date: event.start_date,
      end_date: event.end_date,
      source_url: event.source_url,
      url: event.url,
      provider_category: event.provider_category,
      source_language: event.source_language,
      raw_summary: event.raw_summary,
      summary: event.summary,
      lat: event.lat,
      lng: event.lng,
      geocode_label: event.geocode_label,
      geocode_source: event.geocode_source,
    },
    parranda_owned: {
      tags_intents: Array.isArray(event.match_tags) ? event.match_tags : [],
      route_fit: Array.isArray(event.match_tags) && event.match_tags.length ? "source_quality_filter" : null,
      match_reason: event.match_reason || null,
    },
  };
}

function normalizeDates(value) {
  return Array.isArray(value)
    ? value.map((date) => String(date || "").trim()).filter(Boolean)
    : [];
}

module.exports = {
  OPEN_DATA_BCN_AGENDA_PROVIDER_ID,
  createOpenDataBcnAgendaProvider,
  openDataBcnAgendaDescriptor,
  flattenDateKeyedEvents,
  toSourceProviderEvent,
};
