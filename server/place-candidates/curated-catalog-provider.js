const {
  normalizePlaceCandidate,
  validatePlaceCandidate,
} = require("./contract");

class CuratedCatalogProvider {
  constructor(cityConfig) {
    if (!cityConfig || typeof cityConfig !== "object") {
      throw new Error("CuratedCatalogProvider requires a city config");
    }
    this.cityConfig = cityConfig;
  }

  listCandidates(options = {}) {
    return buildCuratedCatalogPlaceCandidates(this.cityConfig, options);
  }
}

function buildCuratedCatalogPlaceCandidates(cityConfig, options = {}) {
  const items = Array.isArray(cityConfig?.catalog?.allItems)
    ? cityConfig.catalog.allItems
    : [];
  const includeStructural = options.includeStructural !== false;

  return items
    .map((item) => normalizeCatalogItem(cityConfig, item))
    .filter((candidate) => includeStructural || !candidate.is_structural)
    .map((candidate, index) =>
      validatePlaceCandidate(candidate, `catalogCandidate[${index}]`),
    );
}

function normalizeCatalogItem(cityConfig, item = {}) {
  const candidateKind = resolveCatalogCandidateKind(item);
  const area = resolveAreaToken(cityConfig, item);
  const macro = resolveMacroToken(cityConfig, area);

  const candidate = normalizePlaceCandidate({
    id: item.id,
    city: cityConfig.key,
    label: item.name || item.label,
    type: item.kind || "place",
    candidate_kind: candidateKind,
    lat: item.lat,
    lng: item.lng,
    area,
    macro,
    tags: item.tags || [],
    vibes: item.vibes || [],
    time_fit: item.time_fit || item.timeFit || item.weatherTags || [],
    route_roles: buildRouteRoles(item, candidateKind),
    source: {
      kind: "city_catalog",
      id: `${cityConfig.key}-catalog`,
      label: `${cityConfig.label || cityConfig.key} catalog`,
    },
    trust: {
      source_tier: "curated",
      confidence: "high",
      human_verified: true,
      freshness: "fresh",
    },
    city_pack_owned: true,
  });

  // Preserve a stable identity key from the pack (e.g. a Wikidata Q-id) when
  // present. Additive field — only entity-resolution (#238/#239) reads it, to
  // hard-match a curated place against an external twin and, when the curated
  // entry lacks coordinates, fill them from that twin.
  const knownId = firstNonEmpty(item.wikidata, item.wikidata_id, item.known_place_id);
  if (knownId) {
    candidate.known_place_id = knownId;
  }

  return candidate;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value === undefined || value === null ? "" : value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function resolveCatalogCandidateKind(item = {}) {
  if (item.structuralRouteAnchor === true || item.kind === "district-group") {
    return "structural_anchor";
  }
  if (item.kind === "district") {
    return "area_preset";
  }
  return "real_place";
}

function buildRouteRoles(item = {}, candidateKind) {
  const roles = [];
  if (candidateKind === "structural_anchor") roles.push("structural_anchor");
  if (candidateKind === "area_preset") roles.push("area_preset");
  if (candidateKind === "real_place") roles.push("catalog_stop");
  if (Number.isFinite(item.goodAsStart) && item.goodAsStart > 0) roles.push("start");
  if (Number.isFinite(item.goodAsFinal) && item.goodAsFinal > 0) roles.push("final");
  return roles;
}

function resolveAreaToken(cityConfig, item = {}) {
  const definitions = cityConfig?.routing?.areaDefinitions || {};
  const rawArea = String(item.area || "").trim();
  const candidates = [
    rawArea,
    slugify(rawArea),
    ...rawArea.split(/[\/,]/).map((part) => slugify(part)),
    item.id,
  ].filter(Boolean);

  return candidates.find((candidate) => definitions[candidate]) || slugify(rawArea || item.id);
}

function resolveMacroToken(cityConfig, area) {
  return cityConfig?.routing?.areaDefinitions?.[area]?.macro || "";
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
  CuratedCatalogProvider,
  buildCuratedCatalogPlaceCandidates,
  normalizeCatalogItem,
  resolveCatalogCandidateKind,
};
