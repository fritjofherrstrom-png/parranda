/**
 * Registered-city agnostic fill (#registered-reservoir).
 *
 * Thin registered citypacks keep their curated catalog as the trusted spine, but
 * may opt into source-backed external candidates as supplemental fill through
 * the same candidate reservoir the any-place experiment uses. This helper never
 * fetches sources and never trusts public payload data; callers pass already
 * trusted helper channels.
 */

const { selectPlannerRoleCandidates } = require("./role-selector");
const { summarizeDayflowHonesty } = require("./dayflow-honesty");
const { buildCandidateCombination } = require("./candidate-combination");
const { mapAdmittedSelectionToSourceCandidates } = require("./agnostic-engine-compose");
const { admitExperimentalInferredExternalCandidate } = require("./agnostic-route-output");

function buildRegisteredCityCandidateFill({
  cityConfig,
  rolePayload,
  roleOrigin = null,
  helpers = {},
  sourceStatus = null,
  catalogDensity = null,
} = {}) {
  const baseSidecar = {
    scope: "registered_city",
    used: false,
    reason: "not_attempted",
    catalog_density: catalogDensity,
    source_status: sourceStatus ? [sourceStatus] : [],
    supplemental_candidate_count: 0,
    candidate_ids: [],
    trust: "curated_first_source_backed_fill",
  };

  if (!cityConfig || typeof cityConfig !== "object") {
    return { cityConfig, sidecar: { ...baseSidecar, reason: "missing_city_config" } };
  }
  if (!helpers || !helpers.external_provider) {
    return { cityConfig, sidecar: { ...baseSidecar, reason: "no_trusted_external_provider" } };
  }

  try {
    const plannerRoles = selectPlannerRoleCandidates(cityConfig, rolePayload, {
      ...helpers,
      experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
    });
    const dayflowHonesty = summarizeDayflowHonesty(plannerRoles);
    const combination = buildCandidateCombination(plannerRoles, dayflowHonesty, { origin: roleOrigin });
    const selected = Array.isArray(combination?.selected) ? combination.selected : [];
    const externalSelected = selected.filter((pick) => pick && pick.origin !== "curated_catalog");
    const mapped = mapAdmittedSelectionToSourceCandidates({
      selected: externalSelected,
      plannerRoles,
      city: cityConfig.key,
    });
    const supplemental = filterNewSupplementalCandidates(cityConfig, mapped);
    if (!supplemental.length) {
      return {
        cityConfig,
        sidecar: {
          ...baseSidecar,
          reason: externalSelected.length ? "no_new_supplemental_candidates" : "curated_candidates_satisfied_roles",
          catalog_density: catalogDensity,
          source_status: sourceStatus ? [sourceStatus] : [],
        },
      };
    }

    return {
      cityConfig: {
        ...cityConfig,
        sourceCandidates: mergeSourceCandidates(cityConfig.sourceCandidates, supplemental),
      },
      sidecar: {
        ...baseSidecar,
        used: true,
        reason: "thin_registered_city_source_fill",
        catalog_density: catalogDensity,
        source_status: sourceStatus ? [sourceStatus] : [],
        supplemental_candidate_count: supplemental.length,
        candidate_ids: supplemental.map((candidate) => candidate.id),
      },
    };
  } catch (error) {
    return {
      cityConfig,
      sidecar: {
        ...baseSidecar,
        reason: "fill_failed_closed",
        error: error && error.message ? error.message : "unknown_error",
      },
    };
  }
}

function filterNewSupplementalCandidates(cityConfig, candidates) {
  const existingIds = new Set([
    ...catalogIds(cityConfig),
    ...(Array.isArray(cityConfig?.sourceCandidates) ? cityConfig.sourceCandidates : [])
      .map((candidate) => candidate && candidate.id)
      .filter(Boolean),
  ]);
  const out = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || !candidate.id || existingIds.has(candidate.id) || seen.has(candidate.id)) continue;
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue;
    seen.add(candidate.id);
    out.push({
      ...candidate,
      city_pack_owned: false,
      provisional: true,
      trust: {
        ...(candidate.trust || {}),
        human_verified: false,
      },
    });
  }
  return out;
}

function mergeSourceCandidates(existing, supplemental) {
  return [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(supplemental) ? supplemental : []),
  ];
}

function catalogIds(cityConfig) {
  const items = Array.isArray(cityConfig?.catalog?.allItems) ? cityConfig.catalog.allItems : [];
  return items.map((item) => item && item.id).filter(Boolean);
}

module.exports = {
  buildRegisteredCityCandidateFill,
  filterNewSupplementalCandidates,
};
