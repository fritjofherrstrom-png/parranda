const { buildEngineContext } = require("./context");
const { normalizeSignal } = require("./normalize");
const { scoreSignals } = require("./rank");
const { isDisplayableSignal } = require("./signal-quality");
const {
  collectPulseSourcesForCity,
  normalizedEventToLiveEvent,
  buildSourceProviderInspect,
  resolveDefaultSchemaOrgEventProvider,
  resolveDefaultLinkedEventsProvider,
} = require("../pulse-sources");
const liveEventsGenerator = require("./generators/live-events");
const cityRhythmGenerator = require("./generators/city-rhythm");
const goldenHourGenerator = require("./generators/golden-hour");

/**
 * Engine-level generators that run for every city. A generator is only
 * useful here if it can honestly produce signals from city-agnostic
 * inputs (live events, weather, lat/lng + date). The list is short on
 * purpose — new generators must be backed by real sources or rules.
 */
const CITY_AGNOSTIC_GENERATORS = [
  liveEventsGenerator,
  cityRhythmGenerator,
  goldenHourGenerator,
];

/**
 * Build a city's Pulse for a given moment.
 *
 * Runs city-agnostic generators + the city's own signalGenerators,
 * normalizes their output into PulseSignal[], ranks, and returns a
 * stable shape ready for the API.
 *
 * @param {Object} cityConfig
 * @param {Object} options
 * @param {string} options.date
 * @param {Date}   [options.now]
 * @param {string} [options.lang]
 */
async function buildCityPulse(cityConfig, options = {}) {
  const { date, lang } = options;
  // Default to wall-clock when a caller omits `now` (the real /api/city-pulse
  // route does). buildEngineContext already defaults internally, but the
  // time-sensitive source-event bridge needs a concrete `now` to downgrade
  // expired/stale events — without it an expired event a provider claims is
  // "now" would be trusted verbatim. Tests inject `now` for determinism.
  const now = options.now || new Date();

  const [weather, sourceResult] = await Promise.all([
    safeFetchWeather(cityConfig, date),
    safeFetchPulseSources(cityConfig, date, {
      ...(options.sourceContext || {}),
      now,
      lang,
      collectOpenDataAgendaEventsForDates: options.collectOpenDataAgendaEventsForDates,
    }),
  ]);
  const events = sourceResult.events || [];

  const context = buildEngineContext({
    cityConfig,
    date,
    now,
    weather: weather || null,
    events: events || [],
    lang,
  });

  const generators = [
    ...CITY_AGNOSTIC_GENERATORS,
    ...readCitySignalGenerators(cityConfig),
  ];

  // Source-backed signals (e.g. the generic weather-context provider) enter the
  // same pipeline as generator output. They are already normalized source
  // signals; we strip them back to raw signal shape so normalizeSignal() applies
  // the same trust/freshness/source defaults a generator would receive.
  const rawSignals = [];
  for (const sourceSignal of sourceResult.signals || []) {
    const raw = sourceSignalToRawSignal(sourceSignal);
    if (raw) rawSignals.push(raw);
  }
  for (const generator of generators) {
    try {
      const result = await Promise.resolve(generator(context));
      if (Array.isArray(result)) {
        for (const raw of result) {
          if (raw) rawSignals.push(raw);
        }
      }
    } catch (error) {
      // A misbehaving generator must not break the whole engine.
      // Log to stderr so it surfaces in tests/CI without crashing.
      // eslint-disable-next-line no-console
      console.error(
        `pulse-engine: generator threw (${generator.generatorId || "anonymous"}):`,
        error?.message || error,
      );
    }
  }

  const normalized = rawSignals
    .map((raw) => normalizeSignal(raw, context))
    .filter(Boolean)
    .filter(isDisplayableSignal);

  const ranked = scoreSignals(normalized, context);

  const providerSpecs = resolvePulseSourceProviders(cityConfig);

  return {
    city: context.city.key,
    date: context.date,
    requested_at: context.now.toISOString(),
    timezone: context.timezone,
    lang: context.lang,
    signals: ranked,
    weather: context.weather,
    events: context.events,
    source_status: sourceResult.source_status || [],
    source_provider_inspect: options.inspectSources
      ? buildSourceProviderInspect({
          city: context.city.key,
          date: context.date,
          providerSpecs,
          source_status: sourceResult.source_status || [],
          normalized_events: sourceResult.normalized_events || [],
          compat_events: sourceResult.compat_events || [],
          normalized_signals: sourceResult.normalized_signals || [],
          normalized_time_sensitive_events: sourceResult.normalized_time_sensitive_events || [],
        })
      : null,
  };
}

function readCitySignalGenerators(cityConfig) {
  const list = cityConfig?.services?.signalGenerators;
  if (!Array.isArray(list)) return [];
  return list.filter((entry) => typeof entry === "function");
}

async function safeFetchWeather(cityConfig, date) {
  const fetcher = cityConfig?.services?.fetchWeatherForDates;
  if (typeof fetcher !== "function" || !date) return null;
  try {
    const byDate = await fetcher([date], cityConfig.center);
    if (byDate && typeof byDate === "object") {
      return byDate[date] || null;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

async function safeFetchLiveEvents(cityConfig, date) {
  const fetcher = cityConfig?.services?.fetchLiveEventsForDates;
  if (typeof fetcher !== "function" || !date) return [];
  try {
    const byDate = await fetcher([date], {});
    if (byDate && typeof byDate === "object") {
      const list = byDate[date];
      return Array.isArray(list) ? list : [];
    }
    return [];
  } catch (_error) {
    return [];
  }
}

function resolvePulseSourceProviders(cityConfig) {
  const configured = Array.isArray(cityConfig?.services?.pulseSourceProviders)
    ? cityConfig.services.pulseSourceProviders
    : [];
  const defaults = [resolveDefaultSchemaOrgEventProvider(), resolveDefaultLinkedEventsProvider()].filter(Boolean);
  if (configured.length === 0) return dedupeProviderSpecs(defaults);
  if (defaults.length === 0) return configured;
  return dedupeProviderSpecs([...configured, ...defaults]);
}

function dedupeProviderSpecs(providerSpecs = []) {
  const seen = new Set();
  const out = [];
  for (const spec of providerSpecs) {
    const id = spec?.descriptor?.id || spec?.id || null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(spec);
  }
  return out;
}

async function safeFetchPulseSources(cityConfig, date, sourceContext = {}) {
  const providerSpecs = resolvePulseSourceProviders(cityConfig);
  if (!Array.isArray(providerSpecs) || providerSpecs.length === 0) {
    return {
      events: await safeFetchLiveEvents(cityConfig, date),
      compat_events: [],
      normalized_events: [],
      signals: [],
      normalized_signals: [],
      normalized_time_sensitive_events: [],
      source_status: [],
    };
  }

  try {
    const result = await collectPulseSourcesForCity(cityConfig, {
      providerSpecs,
      context: {
        ...sourceContext,
        date,
        dates: date ? [date] : [],
      },
    });
    const compatEvents = (result.events || []).map(normalizedEventToLiveEvent).filter(Boolean);
    const normalizedSignals = result.signals || [];
    return {
      events: compatEvents,
      compat_events: compatEvents,
      normalized_events: result.events || [],
      signals: normalizedSignals,
      normalized_signals: normalizedSignals,
      normalized_time_sensitive_events: result.time_sensitive_events || [],
      source_status: result.source_status || [],
    };
  } catch (_error) {
    return {
      events: [],
      compat_events: [],
      normalized_events: [],
      signals: [],
      normalized_signals: [],
      normalized_time_sensitive_events: [],
      source_status: providerSpecs.map((spec) => ({
        id: spec?.descriptor?.id || spec?.id || "unknown-source-provider",
        city: cityConfig?.key || null,
        status: "failed",
        reason: "source_registry_failed",
        events: 0,
        signals: 0,
        time_sensitive_events: 0,
      })),
    };
  }
}

/**
 * Convert a normalized source signal (from the registry) back into the raw
 * signal shape that normalizeSignal() expects from a generator. The source
 * layer wraps fields under source_owned/parranda_owned; the generator pipeline
 * reads a flatter shape. We keep compact provider provenance alongside the raw
 * signal so ranked signals can still be traced back without exposing full raw
 * provider payloads.
 */
function sourceSignalToRawSignal(sourceSignal) {
  if (!sourceSignal || typeof sourceSignal !== "object") {
    return null;
  }
  const sourceOwned = sourceSignal.source_owned || {};
  const parrandaOwned = sourceSignal.parranda_owned || {};
  const title = sourceSignal.title || sourceOwned.title;
  const type = sourceSignal.signal_type || sourceSignal.type;
  if (!title || !type) {
    return null;
  }
  const source = sourceSignal.source || {};
  return {
    id: sourceSignal.id,
    type,
    title,
    blurb: sourceSignal.blurb || sourceOwned.blurb || undefined,
    reason: sourceSignal.reason || parrandaOwned.dayflow_reason || undefined,
    why_it_matters: sourceSignal.why_it_matters || parrandaOwned.dayflow_reason || undefined,
    editorial_pitch: sourceSignal.editorial_pitch || undefined,
    kindLabel: sourceSignal.kindLabel || undefined,
    // Mark provenance so normalizeSignal infers a weather/computed source.
    source: {
      ...source,
      kind: source.kind || "weather",
      label: source.label || "weather",
    },
    confidence: sourceSignal.confidence || undefined,
    source_signal: true,
    source_provider_signal: {
      id: sourceSignal.id || null,
      provider_id: source.id || null,
      role: source.role || sourceSignal.role || null,
      city: source.city || sourceSignal.city || null,
      confidence: sourceSignal.confidence || null,
      signal_type: sourceSignal.signal_type || sourceSignal.type || null,
      signal_kind: parrandaOwned.signal_kind || null,
      dayflow_reason: parrandaOwned.dayflow_reason || null,
      source_owned: sourceOwned,
      parranda_owned: parrandaOwned,
      display_gate: sourceSignal.display_gate || null,
    },
  };
}

module.exports = {
  buildCityPulse,
  CITY_AGNOSTIC_GENERATORS,
};
