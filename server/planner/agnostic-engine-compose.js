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
const { normalizeSelectedDayHoursFact } = require("../place-candidates/opening-hours");
const { plannerUsableOptionsForRole } = require("./candidate-combination");

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
 * @param {"light"|"peak"} [params.dayProfile]
 * @returns {object} cityConfig accepted by generateAgnosticRecommendations
 */
function buildAgnosticEngineCityConfig({
  anchor,
  sourceCandidates = [],
  timezone = "UTC",
  todayIsoDate,
  label = "Nearby",
  key = AGNOSTIC_ENGINE_CITY_KEY,
  dayProfile = null,
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
    // Server-owned any-place depth policy. This sits on the constructed config,
    // not the public request payload, so callers cannot promote their own route.
    __agnosticDayProfile: dayProfile === "light" || dayProfile === "peak" ? dayProfile : null,
    services: buildAgnosticNoopServices(),
  };
}

// --- candidate supply ------------------------------------------------------

function finiteCoords(coordinates) {
  if (!coordinates || typeof coordinates !== "object") return null;
  const { lat, lng } = coordinates;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function isExplicitlyUnavailable(candidate) {
  return candidate?.availability?.eligible === false;
}

function isExperimentallyAdmitted(candidate) {
  return candidate?.experimental_admission?.allowed === true;
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
function toSourceCandidate({
  pick,
  rich,
  coords,
  city,
  role,
  reservoirSelected = false,
  reservoirSupport = false,
  requestedIntents = null,
}) {
  const provenance = (rich && rich.provenance) || {};
  const attribution = Array.isArray(provenance.attribution) ? provenance.attribution : [];
  const firstSource = attribution[0] || {};
  const confidence = (rich && rich.confidence) || pick.confidence || "needs_review";
  const roleCovered = Array.isArray(rich?.covered_preferences) ? [...rich.covered_preferences] : [];
  const rolePartial = Array.isArray(rich?.partial_preferences) ? [...rich.partial_preferences] : [];
  const requested = Array.isArray(requestedIntents) ? [...new Set(requestedIntents)] : null;
  const coveredPreferences = requested
    ? roleCovered.filter((intent) => requested.includes(intent))
    : roleCovered;
  const partialPreferences = requested
    ? rolePartial.filter((intent) => requested.includes(intent))
    : rolePartial;
  const missingPreferences = requested
    ? requested.filter(
        (intent) => !coveredPreferences.includes(intent) && !partialPreferences.includes(intent),
      )
    : Array.isArray(rich?.missing_preferences)
      ? [...rich.missing_preferences]
      : [];
  const selectedDayHours = normalizeSelectedDayHoursFact(rich?.availability?.selected_day_hours);
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
    // Role semantics remain available to the route engine even when this is a
    // supporting stop. User-facing coverage below is narrowed to what the user
    // actually requested, so a scenic support stop cannot claim to cover
    // "views" in a food-only request.
    tags: roleCovered,
    role: role || null,
    route_roles: role ? [role] : [],
    candidate_status: (rich && rich.candidate_status) || pick.candidate_status || null,
    planner_usable: rich ? rich.planner_usable === true : pick.planner_usable === true,
    origin: (rich && rich.origin) || pick.origin || "external_open",
    covered_preferences: coveredPreferences,
    partial_preferences: partialPreferences,
    missing_preferences: missingPreferences,
    fit_reasons: Array.isArray(rich?.fit_reasons) ? [...rich.fit_reasons] : [],
    lens_reasons: Array.isArray(rich?.lens_reasons) ? [...rich.lens_reasons] : [],
    weather_reasons: Array.isArray(rich?.weather_reasons) ? [...rich.weather_reasons] : [],
    time_reasons: Array.isArray(rich?.time_reasons) ? [...rich.time_reasons] : [],
    also_covers: Array.isArray(rich?.also_covers)
      ? rich.also_covers.map((entry) => ({ ...entry }))
      : [],
    reconciliation: rich?.reconciliation || null,
    ...(selectedDayHours ? { selected_day_hours: selectedDayHours } : {}),
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
    reservoir_selected: reservoirSelected === true,
    reservoir_support: reservoirSupport === true,
    chain: rich?.chain === true,
    brand: typeof rich?.brand === "string" ? rich.brand : null,
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
 * Project a bounded, role-safe candidate reservoir into the route engine.
 * Candidate Combination winners remain the trusted spine; at most one extra
 * candidate per selected role adds geometric choice. A selected winner may use
 * the explicit experimental-admission seam, but role-depth extras must clear
 * the shared gates; coverage and local-feel tiers remain shared with Candidate
 * Combination.
 */
function mapPlannerReservoirToSourceCandidates({
  selected = [],
  plannerRoles = null,
  city = AGNOSTIC_ENGINE_CITY_KEY,
  limit = 8,
  perRole = 2,
} = {}) {
  const richIndex = buildRichCandidateIndex(plannerRoles);
  const selectedPicks = Array.isArray(selected) ? selected : [];
  const requestedIntents = Array.isArray(plannerRoles?.requested_preferences)
    ? plannerRoles.requested_preferences
    : null;
  const out = mapAdmittedSelectionToSourceCandidates({
    selected: selectedPicks,
    plannerRoles,
    city,
    requestedIntents,
  }).map(
    (candidate) => ({ ...candidate, reservoir_selected: true }),
  );
  const seen = new Set(out.map((candidate) => candidate.id));
  const selectedRoles = new Set(selectedPicks.map((pick) => pick?.role).filter(Boolean));
  const boundedLimit = Math.max(out.length, Math.min(12, Math.max(1, Math.trunc(Number(limit) || 8))));
  const boundedPerRole = Math.min(3, Math.max(1, Math.trunc(Number(perRole) || 2)));

  for (const roleEntry of Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : []) {
    const role = roleEntry?.role;
    if (!role || !selectedRoles.has(role)) continue;
    let roleCount = 1;
    for (const rich of plannerUsableOptionsForRole(roleEntry)) {
      if (roleCount >= boundedPerRole || out.length >= boundedLimit) break;
      // Candidate Combination may honestly use one experimentally admitted
      // candidate to represent an explicitly requested role. Do not multiply
      // that lower-trust exception into role depth: extra candidates must have
      // cleared the shared gates. A long day should grow because evidence is
      // richer, not merely because more inferred rows exist for the same role.
      if (isExperimentallyAdmitted(rich)) continue;
      const id = rich?.candidate_id;
      if (!id || seen.has(id)) continue;
      const coords = finiteCoords(rich.coordinates);
      if (!coords) continue;
      seen.add(id);
      roleCount += 1;
      out.push(
        toSourceCandidate({
          pick: { role, candidate_id: id, coordinates: coords },
          rich: richIndex.get(`${role}::${id}`) || rich,
          coords,
          city,
          role,
          requestedIntents,
        }),
      );
    }
    if (out.length >= boundedLimit) break;
  }

  // A target-role combination answers "what best matches the request", not
  // "what makes a complete day". A single selected intent therefore often
  // yields only one candidate family (for example two restaurants), which the
  // honest promotion gate correctly rejects as a thin day. Give the route
  // engine bounded breadth from the SAME planner-safe reservoir: one candidate
  // from each unrequested anchor/stop role. The engine still owns geometry,
  // distance, ordering and final selection; fallback/option candidates never
  // enter through this seam, and sparse contexts remain sparse.
  const supportRoles = (Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : []).filter(
    (roleEntry) =>
      roleEntry &&
      !selectedRoles.has(roleEntry.role) &&
      (roleEntry.slot === "anchor" || roleEntry.slot === "stop"),
  );
  const deferredExperimentalSupport = [];
  let gatePassingSupportCount = 0;
  for (const roleEntry of supportRoles) {
    if (out.length >= boundedLimit) break;
    const role = roleEntry.role;
    const options = plannerUsableOptionsForRole(roleEntry);
    const rich = options.find(
      (candidate) =>
        candidate?.candidate_id &&
        !seen.has(candidate.candidate_id) &&
        !isExperimentallyAdmitted(candidate),
    );
    if (!rich) {
      const admitted = options.find(
        (candidate) =>
          candidate?.candidate_id &&
          !seen.has(candidate.candidate_id) &&
          isExperimentallyAdmitted(candidate),
      );
      if (admitted) deferredExperimentalSupport.push({ role, rich: admitted });
      continue;
    }
    const coords = finiteCoords(rich.coordinates);
    if (!coords) continue;
    seen.add(rich.candidate_id);
    gatePassingSupportCount += 1;
    out.push(
      toSourceCandidate({
        pick: { role, candidate_id: rich.candidate_id, coordinates: coords },
        rich: richIndex.get(`${role}::${rich.candidate_id}`) || rich,
        coords,
        city,
        role,
        reservoirSupport: true,
        requestedIntents,
      }),
    );
  }

  // Experimental admission remains available for a role the user explicitly
  // requested. For unrequested day breadth it is only a bounded bridge: all
  // shared-gate support is admitted first, and at most one lower-trust option
  // may extend an already supported spine. This keeps a useful three-stop thin
  // day possible without padding it with several uncorroborated places.
  if (gatePassingSupportCount > 0 && out.length < boundedLimit) {
    const deferred = deferredExperimentalSupport.find(
      ({ rich }) => rich?.candidate_id && !seen.has(rich.candidate_id) && finiteCoords(rich.coordinates),
    );
    if (deferred) {
      const coords = finiteCoords(deferred.rich.coordinates);
      seen.add(deferred.rich.candidate_id);
      out.push(
        toSourceCandidate({
          pick: {
            role: deferred.role,
            candidate_id: deferred.rich.candidate_id,
            coordinates: coords,
          },
          rich: richIndex.get(`${deferred.role}::${deferred.rich.candidate_id}`) || deferred.rich,
          coords,
          city,
          role: deferred.role,
          reservoirSupport: true,
          requestedIntents,
        }),
      );
    }
  }

  return out;
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
function mapAdmittedSelectionToSourceCandidates({
  selected = [],
  plannerRoles = null,
  city = AGNOSTIC_ENGINE_CITY_KEY,
  requestedIntents = null,
} = {}) {
  const index = buildRichCandidateIndex(plannerRoles);
  const out = [];
  const seen = new Set();
  for (const pick of Array.isArray(selected) ? selected : []) {
    const id = pick && pick.candidate_id;
    if (!id || seen.has(id)) continue;
    const role = pick.role || null;
    const rich = (role && index.get(`${role}::${id}`)) || index.get(`*::${id}`) || null;
    // Availability is computed from trusted server time/opening-hours facts.
    // Do not let a stale pre-combination selection reintroduce a candidate
    // which the shared role reservoir now knows is closed for the day window.
    if (isExplicitlyUnavailable(rich)) continue;
    const coords = finiteCoords(pick.coordinates) || (rich && finiteCoords(rich.coordinates));
    if (!coords) continue; // no geo → cannot honestly be a stop
    seen.add(id);
    out.push(toSourceCandidate({ pick, rich, coords, city, role, requestedIntents }));
  }
  return out;
}

module.exports = {
  AGNOSTIC_ENGINE_CITY_KEY,
  buildAgnosticEngineCityConfig,
  buildAgnosticNoopServices,
  mapAdmittedSelectionToSourceCandidates,
  mapPlannerReservoirToSourceCandidates,
};
