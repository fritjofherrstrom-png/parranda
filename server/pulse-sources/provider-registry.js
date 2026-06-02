const { normalizeSourceDescriptor } = require("./source-descriptor");
const { normalizeSourceEvent, normalizeSourceSignal } = require("./normalize-event");
const { dedupeNormalizedEvents } = require("./dedupe");

const DEFAULT_ENABLED_STATUSES = new Set(["active"]);

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

  for (const spec of providerSpecs) {
    const descriptor = spec.descriptor;

    if (descriptor.city !== cityConfig.key) {
      sourceStatuses.push(statusFor(descriptor, "skipped", "city_mismatch"));
      continue;
    }
    if (roles && !roles.has(descriptor.role)) {
      sourceStatuses.push(statusFor(descriptor, "skipped", "role_filtered"));
      continue;
    }
    if (!enabledStatuses.has(descriptor.status)) {
      sourceStatuses.push(statusFor(descriptor, "skipped", `status_${descriptor.status}`));
      continue;
    }

    try {
      const provider = typeof spec.create === "function" ? spec.create(cityConfig, options.context || {}) : spec.provider;
      if (!provider || typeof provider.collect !== "function") {
        throw new Error(`Pulse source provider ${descriptor.id} must expose collect()`);
      }

      const result = await Promise.resolve(provider.collect(options.context || {}));
      const rawEvents = Array.isArray(result?.events) ? result.events : [];
      const rawSignals = Array.isArray(result?.signals) ? result.signals : [];
      const normalizedEvents = rawEvents
        .map((event, index) => normalizeSourceEvent(event, descriptor, { index }))
        .filter(Boolean);
      const normalizedSignals = rawSignals
        .map((signal, index) => normalizeSourceSignal(signal, descriptor, { index }))
        .filter(Boolean);

      events.push(...normalizedEvents);
      signals.push(...normalizedSignals);
      sourceStatuses.push({
        ...statusFor(descriptor, "ok"),
        events: normalizedEvents.length,
        signals: normalizedSignals.length,
      });
    } catch (error) {
      sourceStatuses.push({
        ...statusFor(descriptor, "failed", error?.message || "provider_failed"),
        events: 0,
        signals: 0,
      });
    }
  }

  return {
    city: cityConfig.key,
    events: dedupeNormalizedEvents(events),
    signals,
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

module.exports = {
  DEFAULT_ENABLED_STATUSES,
  SourceProviderRegistry,
  collectPulseSourcesForCity,
  normalizeProviderSpec,
};
