/**
 * Agnostic → engine convergence (#convergence).
 *
 * The route engine already composes an honest, low-confidence walk for a city
 * with zero curated templates: the `agnostic_compose` branch builds the stop
 * pool from `cityConfig.sourceCandidates` (provisional, source-backed places)
 * and orders it through the SAME geometry/scoring/walking-truth pipeline as a
 * registered city. A coordinates-only "any-place" context is just that branch
 * with an empty curated catalog.
 *
 * This module builds the engine-shaped cityConfig for such a place so the
 * any-place path runs through `generateAgnosticRecommendations` — the existing
 * engine — instead of a separate synthesizer. There is deliberately no second
 * routing pipeline here: we only assemble inputs the engine already knows how
 * to consume.
 *
 * Trust posture (mirrors CLAUDE.md):
 *   - Public payload data never becomes a service or a trusted candidate; the
 *     caller supplies already-trusted, source-backed candidates and (optionally)
 *     server-injected context. The services below are honest NO-OPS — they never
 *     fabricate pulse/weather/live signals for a place we have no source for.
 *   - Ordering is the engine's geometry; daypart rhythm (#274–278) is preserved
 *     by the caller as a route LABEL, not the sequencer (staged convergence —
 *     promoting daypart into compose ordering is a follow-up).
 *
 * Pure / side-effect free.
 */

const { buildAgnosticCityContext } = require("../candidates/agnostic-context");

const AGNOSTIC_ENGINE_CITY_KEY = "agnostic-engine-area";

// Honest no-op services. The engine reaches city services for pulse/weather/
// signals/live/geocode; an any-place context has no curated source for any of
// them, so each returns its empty-but-well-formed shape rather than inventing
// data. `getCityPulse` must expose `.items` (the loop reads `pulse.items`);
// weather/live are `.catch`-guarded in the engine, so an empty object is safe.
// Trusted weather/time, when available, is injected by the caller as route
// context — it is never synthesized here.
function buildAgnosticNoopServices() {
  return {
    async geocodeQuery() {
      return null;
    },
    async fetchWeatherForDates() {
      return {};
    },
    getCityPulse() {
      return { items: [] };
    },
    getDateSignals() {
      return {};
    },
    async fetchLiveEventsForDates() {
      return {};
    },
  };
}

/**
 * Build the engine-shaped cityConfig for a resolved any-place anchor.
 *
 * @param {object} params
 * @param {{lat:number,lng:number}} params.anchor  trusted, resolved coordinates
 * @param {Array<object>} [params.sourceCandidates] source-backed provisional
 *   candidates (place-candidate `draft_place` shape with finite lat/lng). These
 *   become the engine's `sourceCandidates`, feeding `buildProvisionalComposeStops`.
 * @param {string} [params.timezone]
 * @param {(string|function)} [params.todayIsoDate]
 * @param {string} [params.label]
 * @param {string} [params.key]
 * @returns {object} cityConfig accepted by generateAgnosticRecommendations
 */
function buildAgnosticEngineCityConfig({
  anchor,
  sourceCandidates = [],
  timezone = "UTC",
  todayIsoDate,
  label = "Nearby",
  key = AGNOSTIC_ENGINE_CITY_KEY,
} = {}) {
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) {
    throw new Error("buildAgnosticEngineCityConfig requires a finite anchor lat/lng");
  }

  const base = buildAgnosticCityContext({
    key,
    label,
    lat: anchor.lat,
    lng: anchor.lng,
    timezone: timezone || "UTC",
    todayIsoDate,
  });

  // Only finite-geo candidates can become stops; the engine filters again, but
  // dropping the rest here keeps the provisional pool honest and inspectable.
  const usableCandidates = (Array.isArray(sourceCandidates) ? sourceCandidates : []).filter(
    (candidate) => candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng),
  );

  return {
    ...base,
    fallbackLabel: label,
    // The engine reaches the catalog for allItems / routeTemplates /
    // findItemByName. An any-place context has an empty VERIFIED catalog (every
    // real stop comes from sourceCandidates), so findItemByName resolves to
    // nothing rather than throwing on the bare shape buildAgnosticCityContext
    // returns. Zero templates is exactly what triggers the agnostic_compose
    // branch.
    catalog: {
      allItems: [],
      routeTemplates: [],
      provenanceById: {},
      findItemByName: () => null,
    },
    // The provisional pool the engine's agnostic_compose orders into a walk.
    // Never part of the verified spine — each carries its own low trust.
    sourceCandidates: usableCandidates,
    services: buildAgnosticNoopServices(),
  };
}

module.exports = {
  AGNOSTIC_ENGINE_CITY_KEY,
  buildAgnosticEngineCityConfig,
  buildAgnosticNoopServices,
};
