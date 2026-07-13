const {
  SourceProviderRegistry,
  collectPulseSourcesForCity,
} = require("./provider-registry");
const {
  normalizeSourceDescriptor,
  validateSourceDescriptor,
} = require("./source-descriptor");
const {
  normalizeSourceEvent,
  normalizeSourceSignal,
  normalizedEventToLiveEvent,
} = require("./normalize-event");
const { buildDisplayGate } = require("./display-gates");
const {
  SOURCE_PROVIDER_INSPECT_EVENT_LIMIT,
  SOURCE_PROVIDER_INSPECT_SIGNAL_LIMIT,
  SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT,
  buildSourceProviderInspect,
} = require("./inspect");
const { dedupeNormalizedEvents } = require("./dedupe");
const {
  WEATHER_CONTEXT_PROVIDER_ID,
  weatherContextDescriptor,
  createWeatherContextProvider,
  interpretWeatherForDayflow,
} = require("./weather-context-provider");
const {
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
} = require("./time-sensitive-event");
const {
  SCHEMA_ORG_EVENT_PROVIDER_ID,
  createSchemaOrgEventProvider,
  resolveDefaultSchemaOrgEventProvider,
  extractSchemaOrgEvents,
  mapSchemaOrgEventToRaw,
} = require("./schema-org-event-provider");
const {
  LINKED_EVENTS_PROVIDER_ID,
  createLinkedEventsProvider,
  resolveDefaultLinkedEventsProvider,
  extractLinkedEvents,
  mapLinkedEventToRaw,
  buildEventsUrl,
} = require("./linked-events-source-provider");
const {
  EVENTS_CALENDAR_PROVIDER_ID,
  createEventsCalendarProvider,
  resolveDefaultEventsCalendarProvider,
  extractEventsCalendarSourceEvents,
  extractTheEventsCalendarEvents,
  extractIcalEvents,
  mapEventsCalendarEventToRaw,
  mapTheEventsCalendarEventToRaw,
  mapIcalEventToRaw,
} = require("./events-calendar-source-provider");
const {
  HTML_VENUE_CALENDAR_PROVIDER_ID,
  createHtmlVenueCalendarProvider,
  extractHtmlVenueCalendarEvents,
  extractHtmlVenueEventDetail,
} = require("./html-venue-calendar-provider");
const {
  EXTRACTION_TIERS,
  SOURCE_FAMILIES,
  evaluateLiveEventSourceCandidate,
  normalizeSourceCandidate,
} = require("./source-discovery");
const {
  DEFAULT_REQUIRED_FAMILIES,
  buildLocalLiveSourceGraph,
} = require("./local-live-source-graph");

module.exports = {
  SourceProviderRegistry,
  collectPulseSourcesForCity,
  normalizeSourceDescriptor,
  validateSourceDescriptor,
  normalizeSourceEvent,
  normalizeSourceSignal,
  normalizedEventToLiveEvent,
  buildDisplayGate,
  SOURCE_PROVIDER_INSPECT_EVENT_LIMIT,
  SOURCE_PROVIDER_INSPECT_SIGNAL_LIMIT,
  SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT,
  buildSourceProviderInspect,
  dedupeNormalizedEvents,
  WEATHER_CONTEXT_PROVIDER_ID,
  weatherContextDescriptor,
  createWeatherContextProvider,
  interpretWeatherForDayflow,
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
  SCHEMA_ORG_EVENT_PROVIDER_ID,
  createSchemaOrgEventProvider,
  resolveDefaultSchemaOrgEventProvider,
  extractSchemaOrgEvents,
  mapSchemaOrgEventToRaw,
  LINKED_EVENTS_PROVIDER_ID,
  createLinkedEventsProvider,
  resolveDefaultLinkedEventsProvider,
  extractLinkedEvents,
  mapLinkedEventToRaw,
  buildEventsUrl,
  EVENTS_CALENDAR_PROVIDER_ID,
  createEventsCalendarProvider,
  resolveDefaultEventsCalendarProvider,
  extractEventsCalendarSourceEvents,
  extractTheEventsCalendarEvents,
  extractIcalEvents,
  mapEventsCalendarEventToRaw,
  mapTheEventsCalendarEventToRaw,
  mapIcalEventToRaw,
  HTML_VENUE_CALENDAR_PROVIDER_ID,
  createHtmlVenueCalendarProvider,
  extractHtmlVenueCalendarEvents,
  extractHtmlVenueEventDetail,
  EXTRACTION_TIERS,
  SOURCE_FAMILIES,
  evaluateLiveEventSourceCandidate,
  normalizeSourceCandidate,
  DEFAULT_REQUIRED_FAMILIES,
  buildLocalLiveSourceGraph,
};
