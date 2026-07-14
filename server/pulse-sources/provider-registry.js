const { normalizeSourceDescriptor } = require("./source-descriptor");
const { normalizeSourceEvent, normalizeSourceSignal } = require("./normalize-event");
const { normalizeTimeSensitiveSourceEvent } = require("./time-sensitive-event");
const { dedupeNormalizedEvents } = require("./dedupe");
const { fuseTimeSensitiveEvents } = require("./event-fusion");
const {
  normalizeProviderCollectionOutcome,
  registryStatusForCollectionOutcome,
} = require("./provider-collection-outcome");

const DEFAULT_ENABLED_STATUSES = new Set(["active"]);

// A provider whose descriptor.city is this sentinel is city-AGNOSTIC: it binds
// to whatever city it is collected for, instead of being skipped on city
// mismatch. The provider's create(cityConfig) is responsible for stamping the
// real city onto the descriptor it returns, which is what normalization uses.
const GENERIC_PROVIDER_CITY = "__generic__";

class SourceProviderRegistry {
  constructor(providerSpecs = []) {
    this.providerSpecs = [];
    this.providerIds = new Set();
    providerSpecs.forEach((spec) => this.register(spec));
  }

  register(providerSpec) {
    const spec = normalizeProviderSpec(providerSpec);
    if (this.providerIds.has(spec.descriptor.id)) {
      throw new Error(`Pulse source provider duplicate id ${spec.descriptor.id}`);
    }
    this.providerIds.add(spec.descriptor.id);
    this.providerSpecs.push(spec);
    return this;
  }

  listProviderIds() {
    return this.providerSpecs.map((spec) => spec.descriptor.id);
  }

  collect(cityConfig, options = {}) {
    return collectPulseSourcesForCity(cityConfig, {
      ...options,
      providerSpecs: this.providerSpecs,
    });
  }
}

async function collectPulseSourcesForCity(cityConfig, options = {}) {
  if (!cityConfig || typeof cityConfig !== "object") {
    throw new Error("collectPulseSourcesForCity requires a city config");
  }

  const providerSpecs = (options.providerSpecs || []).map(normalizeProviderSpec);
  rejectDuplicateProviderIds(providerSpecs);

  const roles = toFilterSet(options.roles);
  const enabledStatuses = toFilterSet(options.enabledStatuses) || DEFAULT_ENABLED_STATUSES;
  const sourceStatuses = [];
  const events = [];
  const signals = [];
  const timeSensitiveEvents = [];

  for (const spec of providerSpecs) {
    const specDescriptor = spec.descriptor;
    const isGeneric = specDescriptor.city === GENERIC_PROVIDER_CITY;

    if (!isGeneric && specDescriptor.city !== cityConfig.key) {
      sourceStatuses.push(statusFor(specDescriptor, "skipped", "city_mismatch"));
      continue;
    }
    if (roles && !roles.has(specDescriptor.role)) {
      sourceStatuses.push(statusFor(specDescriptor, "skipped", "role_filtered"));
      continue;
    }
    if (!enabledStatuses.has(specDescriptor.status)) {
      sourceStatuses.push(statusFor(specDescriptor, "skipped", `status_${specDescriptor.status}`));
      continue;
    }

    // A generic provider's create() returns a city-bound descriptor; normalize
    // against it so the sentinel city never leaks into normalized output.
    let descriptor = specDescriptor;
    try {
      const provider = typeof spec.create === "function" ? spec.create(cityConfig, options.context || {}) : spec.provider;
      if (!provider || typeof provider.collect !== "function") {
        throw new Error(`Pulse source provider ${specDescriptor.id} must expose collect()`);
      }
      if (provider.descriptor && typeof provider.descriptor === "object") {
        descriptor = normalizeSourceDescriptor(provider.descriptor, "provider.descriptor");
      } else if (isGeneric) {
        descriptor = { ...specDescriptor, city: cityConfig.key };
      }

      const result = await Promise.resolve(provider.collect(options.context || {}));
      const rawEvents = Array.isArray(result?.events) ? result.events : [];
      const rawSignals = Array.isArray(result?.signals) ? result.signals : [];
      const rawTimeSensitiveEvents = Array.isArray(result?.time_sensitive_events)
        ? result.time_sensitive_events
        : [];
      const collectionOutcome = normalizeProviderCollectionOutcome(result?.collection_status, {
        eventRows: rawEvents.length + rawSignals.length + rawTimeSensitiveEvents.length,
      });
      const normalizedEvents = rawEvents
        .map((event, index) => normalizeSourceEvent(event, descriptor, { index }))
        .filter(Boolean);
      const normalizedSignals = rawSignals
        .map((signal, index) => normalizeSourceSignal(signal, descriptor, { index }))
        .filter(Boolean);
      const normalizedTimeSensitiveEvents = rawTimeSensitiveEvents
        .map((event, index) =>
          normalizeTimeSensitiveSourceEvent(withDescriptorSourceDefaults(event, descriptor), {
            index,
            city: descriptor.city,
            now: options.context?.now,
          }),
        )
        .filter(Boolean);

      events.push(...normalizedEvents);
      signals.push(...normalizedSignals);
      timeSensitiveEvents.push(...normalizedTimeSensitiveEvents);
      sourceStatuses.push({
        ...statusFor(
          descriptor,
          registryStatusForCollectionOutcome(collectionOutcome),
          ["failed", "unavailable"].includes(collectionOutcome.status) ? collectionOutcome.reason : null,
        ),
        events: normalizedEvents.length,
        signals: normalizedSignals.length,
        time_sensitive_events: normalizedTimeSensitiveEvents.length,
        collection_status: collectionOutcome.status,
        collection_reason: collectionOutcome.reason,
      });
    } catch (error) {
      const reason = error?.message || "provider_failed";
      sourceStatuses.push({
        ...statusFor(descriptor, "failed", reason),
        events: 0,
        signals: 0,
        time_sensitive_events: 0,
        collection_status: "failed",
        collection_reason: reason,
      });
    }
  }

  return {
    city: cityConfig.key,
    events: dedupeNormalizedEvents(events),
    signals,
    time_sensitive_events: fuseTimeSensitiveEvents(timeSensitiveEvents),
    source_status: sourceStatuses,
  };
}

function normalizeProviderSpec(providerSpec) {
  if (!providerSpec || typeof providerSpec !== "object" || Array.isArray(providerSpec)) {
    throw new Error("Pulse source provider spec must be an object");
  }
  const descriptor = normalizeSourceDescriptor(
    providerSpec.descriptor || providerSpec.source || providerSpec,
    "provider.descriptor",
  );
  const create = providerSpec.create;
  const provider = providerSpec.provider;
  if (typeof create !== "function" && (!provider || typeof provider.collect !== "function")) {
    throw new Error(`Pulse source provider ${descriptor.id} must expose create() or provider.collect()`);
  }
  return { descriptor, create, provider };
}

function rejectDuplicateProviderIds(providerSpecs) {
  const seen = new Set();
  for (const spec of providerSpecs) {
    if (seen.has(spec.descriptor.id)) {
      throw new Error(`Pulse source provider duplicate id ${spec.descriptor.id}`);
    }
    seen.add(spec.descriptor.id);
  }
}

function statusFor(descriptor, status, reason = null) {
  return {
    id: descriptor.id,
    city: descriptor.city,
    role: descriptor.role,
    status,
    reason,
  };
}

function toFilterSet(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
}

// The descriptor carries provider-level source backing (label/url/type/tier).
// An event's own source field WINS when it is non-empty, but an explicitly
// EMPTY event field must not erase the descriptor's real backing — otherwise a
// provider that returns `source_label: ""` per event would silently drop its
// own provenance and get downgraded. (firstNonEmpty, not spread-clobber.)
function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (value != null && typeof value !== "string") return value;
  }
  return null;
}

function withDescriptorSourceDefaults(event, descriptor) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return event;
  }
  return {
    city: descriptor.city,
    ...event,
    source_label: firstNonEmpty(event.source_label, descriptor.label),
    source_url: firstNonEmpty(event.source_url, descriptor.sourceUrl),
    source_type: firstNonEmpty(event.source_type, descriptor.sourceType),
    source_tier: firstNonEmpty(event.source_tier, descriptor.trust?.source_tier),
    confidence: firstNonEmpty(event.confidence, event.trust?.confidence, descriptor.trust?.confidence),
    source_provider_id: firstNonEmpty(event.source_provider_id, descriptor.id),
    source_identity: firstNonEmpty(
      event.source_identity,
      event.publisher_id,
      descriptor.publisherId,
      sourceHost(descriptor.sourceUrl),
      descriptor.id,
    ),
    source_family: firstNonEmpty(event.source_family, descriptor.sourceFamily, descriptor.sourceType),
  };
}

function sourceHost(value) {
  try {
    return new URL(String(value || "").trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

module.exports = {
  DEFAULT_ENABLED_STATUSES,
  GENERIC_PROVIDER_CITY,
  SourceProviderRegistry,
  collectPulseSourcesForCity,
  normalizeProviderSpec,
};
