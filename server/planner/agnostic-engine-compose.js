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
      return [];
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

// --- candidate supply ------------------------------------------------------

function finiteCoords(coordinates) {
  if (!coordinates || typeof coordinates !== "object") return null;
  const { lat, lng } = coordinates;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Index the RICH role candidates (from formatRoleCandidate) by role+id and by
// bare id. The combination's `selected[]` (formatSelected) is intentionally
// lossy — it drops type/provenance/attribution — so to build honestly-attributed
// source candidates we join each selected pick back to its rich source here.
function buildRichCandidateIndex(plannerRoles) {
  const index = new Map();
  const roles = Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : [];
  for (const roleEntry of roles) {
    const role = roleEntry?.role;
    const candidates = Array.isArray(roleEntry?.candidates) ? roleEntry.candidates : [];
    for (const candidate of candidates) {
      const id = candidate?.candidate_id;
      if (!id) continue;
      if (role) index.set(`${role}::${id}`, candidate);
      if (!index.has(`*::${id}`)) index.set(`*::${id}`, candidate);
    }
  }
  return index;
}

// Map ONE admitted, source-backed candidate to the engine's sourceCandidate
// (place-candidate draft_place) shape. Trust is reconstructed CONSERVATIVELY:
// these are never curated/human-verified, so the route built from them stays
// honestly low-confidence. Source attribution (provider label/url) is preserved
// from the rich candidate's provenance so provenance survives to the stop.
function toSourceCandidate({ pick, rich, coords, city, role }) {
  const provenance = (rich && rich.provenance) || {};
  const attribution = Array.isArray(provenance.attribution) ? provenance.attribution : [];
  const firstSource = attribution[0] || {};
  const confidence = (rich && rich.confidence) || pick.confidence || "needs_review";
  return {
    id: pick.candidate_id,
    city,
    label: (rich && rich.label) || pick.label || pick.candidate_id,
    type: (rich && rich.type) || "place",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: coords.lat,
    lng: coords.lng,
    area: null,
    tags: [],
    route_roles: role ? [role] : [],
    source: {
      kind: "open_geo_source",
      label: firstSource.label || provenance.source_family || "open data",
      url: firstSource.url || null,
    },
    trust: {
      source_tier: provenance.source_tier || "inferred",
      confidence,
      human_verified: provenance.human_verified === true,
      freshness: "unknown",
    },
    confidence,
    freshness: "unknown",
    provenance: {
      why_included: "Source-backed candidate admitted to the agnostic route.",
      provider_id: provenance.provider_id || null,
      attribution,
      corroborated_by_external: provenance.corroborated_by_external === true,
      weatherTags: [],
    },
  };
}

/**
 * Join the selected role-combination back to the rich planner-role candidates
 * and project the result into engine `sourceCandidates`. Only candidates with
 * finite coordinates survive (a stop must have a location); duplicates by id are
 * collapsed. Pure / side-effect free.
 *
 * @param {object} params
 * @param {Array<object>} params.selected     candidateCombination.selected[]
 * @param {object} params.plannerRoles         selectPlannerRoleCandidates() result
 * @param {string} [params.city]               cityConfig.key the candidates bind to
 * @returns {Array<object>} sourceCandidate[]
 */
function mapAdmittedSelectionToSourceCandidates({ selected = [], plannerRoles = null, city = AGNOSTIC_ENGINE_CITY_KEY } = {}) {
  const index = buildRichCandidateIndex(plannerRoles);
  const out = [];
  const seen = new Set();
  for (const pick of Array.isArray(selected) ? selected : []) {
    const id = pick && pick.candidate_id;
    if (!id || seen.has(id)) continue;
    const role = pick.role || null;
    const rich = (role && index.get(`${role}::${id}`)) || index.get(`*::${id}`) || null;
    const coords = finiteCoords(pick.coordinates) || (rich && finiteCoords(rich.coordinates));
    if (!coords) continue; // no geo → cannot honestly be a stop
    seen.add(id);
    out.push(toSourceCandidate({ pick, rich, coords, city, role }));
  }
  return out;
}

module.exports = {
  AGNOSTIC_ENGINE_CITY_KEY,
  buildAgnosticEngineCityConfig,
  buildAgnosticNoopServices,
  mapAdmittedSelectionToSourceCandidates,
};
