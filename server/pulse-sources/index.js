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
  buildSourceProviderInspect,
  dedupeNormalizedEvents,
  WEATHER_CONTEXT_PROVIDER_ID,
  weatherContextDescriptor,
  createWeatherContextProvider,
  interpretWeatherForDayflow,
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
};
