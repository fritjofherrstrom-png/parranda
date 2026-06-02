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
  buildSourceProviderInspect,
} = require("./inspect");
const { dedupeNormalizedEvents } = require("./dedupe");

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
  buildSourceProviderInspect,
  dedupeNormalizedEvents,
};
