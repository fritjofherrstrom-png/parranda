const { validateCityConfig } = require("../cities/contract");
const { assessCityCandidateReadiness } = require("../place-candidates/readiness");

function inspectCityPack(cityConfig, options = {}) {
  const validationErrors = validateSafely(cityConfig);
  const metadata = buildMetadataSummary(cityConfig);
  const catalog = inspectCatalog(cityConfig);
  const candidateReadiness = buildCandidateReadiness(cityConfig, options);
  const support = buildSupportSummary({
    validationErrors,
    catalog,
    candidateReadiness,
    cityConfig,
  });
  const status = resolveFinalStatus({
    validationErrors,
    catalog,
    candidateReadiness,
    support,
  });

  return {
    city: metadata.key,
    label: metadata.label,
    visibility: metadata.visibility,
    metadata,
    catalog,
    place_candidate_readiness: candidateReadiness.readiness,
    support,
    status,
    blocking_issues: collectBlockingIssues({ validationErrors, catalog, candidateReadiness }),
    warnings: collectWarnings({ catalog, candidateReadiness }),
  };
}

function validateSafely(cityConfig) {
  try {
    validateCityConfig(cityConfig);
    return [];
  } catch (error) {
    return [error.message];
  }
}

function buildMetadataSummary(cityConfig = {}) {
  return {
    key: cityConfig.key || "",
    label: cityConfig.label || cityConfig.key || "",
    visibility: cityConfig.visibility || "curated-public",
    timezone: cityConfig.timezone || "",
    locale: cityConfig.locale || "",
    currency: cityConfig.currency || "",
    center: {
      lat: cityConfig.center?.lat,
      lng: cityConfig.center?.lng,
      present: Number.isFinite(cityConfig.center?.lat) && Number.isFinite(cityConfig.center?.lng),
    },
  };
}

function inspectCatalog(cityConfig = {}) {
  const allItems = Array.isArray(cityConfig.catalog?.allItems) ? cityConfig.catalog.allItems : [];
  const routeTemplates = Array.isArray(cityConfig.catalog?.routeTemplates)
    ? cityConfig.catalog.routeTemplates
    : [];
  const areaDefinitions = cityConfig.routing?.areaDefinitions || {};
  const provenanceById = cityConfig.catalog?.provenanceById;
  const hasProvenanceMap =
    provenanceById && typeof provenanceById === "object" && !Array.isArray(provenanceById);

  const duplicateIds = findDuplicateIds(allItems);
  const missingIds = allItems
    .filter((item) => !isNonEmptyString(item?.id))
    .map((item, index) => item?.name || item?.label || `catalog[${index}]`);
  const missingCoordinates = allItems.filter(hasMissingCoordinates).map(itemLabel);
  const invalidAreaTokens = allItems
    .filter((item) => item?.area && !hasResolvableAreaToken(areaDefinitions, item))
    .map((item) => ({ id: itemLabel(item), area: item.area }));
  const missingSearchTerms = allItems
    .filter((item) => !Array.isArray(item?.searchTerms) || item.searchTerms.length === 0)
    .map(itemLabel);
  const missingProvenance = hasProvenanceMap
    ? allItems.filter((item) => isNonEmptyString(item?.id) && !provenanceById[item.id]).map(itemLabel)
    : [];

  return {
    item_count: allItems.length,
    real_place_count: allItems.filter(isRealPlaceItem).length,
    structural_anchor_count: allItems.filter(isStructuralAnchorItem).length,
    area_preset_count: allItems.filter(isAreaPresetItem).length,
    route_template_count: routeTemplates.length,
    area_token_count: Object.keys(areaDefinitions).length,
    has_provenance_map: Boolean(hasProvenanceMap),
    issues: {
      duplicate_ids: duplicateIds,
      missing_ids: missingIds,
      missing_coordinates: missingCoordinates,
      invalid_area_tokens: invalidAreaTokens,
      missing_search_terms: missingSearchTerms,
      missing_provenance: missingProvenance,
    },
  };
}

function buildCandidateReadiness(cityConfig, options = {}) {
  try {
    return {
      readiness: assessCityCandidateReadiness(
        cityConfig,
        options.candidateReadinessOptions || {},
      ),
      errors: [],
    };
  } catch (error) {
    return {
      readiness: null,
      errors: [error.message],
    };
  }
}

function buildSupportSummary({ validationErrors, catalog, candidateReadiness, cityConfig }) {
  const hasValidConfig = validationErrors.length === 0;
  const hasServices = [
    "getCityPulse",
    "getDateSignals",
    "fetchLiveEventsForDates",
  ].every((serviceKey) => typeof cityConfig?.services?.[serviceKey] === "function");
  const hasBlockingCatalogIssues = hasBlockingCatalogIssue(catalog);
  const readiness = candidateReadiness.readiness;

  return {
    city_page: hasValidConfig && !hasBlockingCatalogIssues,
    pulse_baseline: hasValidConfig && hasServices,
    blitz_baseline:
      hasValidConfig &&
      !hasBlockingCatalogIssues &&
      Boolean(readiness?.can_support_blitz),
    planner_baseline:
      hasValidConfig &&
      !hasBlockingCatalogIssues &&
      Boolean(readiness?.can_support_planner) &&
      catalog.route_template_count > 0,
  };
}

function resolveFinalStatus({ validationErrors, catalog, candidateReadiness, support }) {
  if (
    validationErrors.length ||
    candidateReadiness.errors.length ||
    hasBlockingCatalogIssue(catalog)
  ) {
    return "blocked";
  }

  if (
    support.city_page &&
    support.pulse_baseline &&
    support.blitz_baseline &&
    support.planner_baseline
  ) {
    return hasWarningIssue(catalog) || candidateReadiness.readiness?.warnings?.length
      ? "partial"
      : "ready";
  }

  if (support.city_page && support.pulse_baseline) {
    return hasWarningIssue(catalog) ? "partial" : "preview_ready";
  }

  return "partial";
}

function collectBlockingIssues({ validationErrors, catalog, candidateReadiness }) {
  return {
    validation_errors: validationErrors,
    duplicate_ids: catalog.issues.duplicate_ids,
    missing_ids: catalog.issues.missing_ids,
    place_candidate_readiness_errors: candidateReadiness.errors,
  };
}

function collectWarnings({ catalog, candidateReadiness }) {
  return {
    invalid_area_tokens: catalog.issues.invalid_area_tokens,
    missing_coordinates: catalog.issues.missing_coordinates,
    missing_search_terms: catalog.issues.missing_search_terms,
    missing_provenance: catalog.issues.missing_provenance,
    place_candidate_readiness: candidateReadiness.readiness?.warnings || [],
  };
}

function hasBlockingCatalogIssue(catalog) {
  return Boolean(catalog.issues.duplicate_ids.length || catalog.issues.missing_ids.length);
}

function hasWarningIssue(catalog) {
  return Boolean(
    catalog.issues.invalid_area_tokens.length ||
      catalog.issues.missing_coordinates.length ||
      catalog.issues.missing_search_terms.length ||
      catalog.issues.missing_provenance.length,
  );
}

function findDuplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();

  items.forEach((item) => {
    if (!isNonEmptyString(item?.id)) return;
    if (seen.has(item.id)) {
      duplicates.add(item.id);
      return;
    }
    seen.add(item.id);
  });

  return [...duplicates].sort();
}

function hasResolvableAreaToken(areaDefinitions, item = {}) {
  const rawArea = String(item.area || "").trim();
  const candidates = [
    rawArea,
    slugify(rawArea),
    ...rawArea.split(/[\/,]/).map((part) => slugify(part)),
    item.id,
  ].filter(Boolean);

  return candidates.some((candidate) => areaDefinitions[candidate]);
}

function isRealPlaceItem(item = {}) {
  return !isStructuralAnchorItem(item) && !isAreaPresetItem(item);
}

function isStructuralAnchorItem(item = {}) {
  return item.structuralRouteAnchor === true || item.kind === "district-group";
}

function isAreaPresetItem(item = {}) {
  return item.kind === "district";
}

function hasMissingCoordinates(item = {}) {
  return !Number.isFinite(item.lat) || !Number.isFinite(item.lng);
}

function itemLabel(item = {}) {
  return item.id || item.name || item.label || "unknown";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  inspectCityPack,
};
