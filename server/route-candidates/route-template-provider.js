const { buildCuratedCatalogPlaceCandidates } = require("../place-candidates/curated-catalog-provider");
const {
  normalizeRouteCandidate,
  validateRouteCandidate,
} = require("./contract");

class RouteTemplateProvider {
  constructor(cityConfig) {
    if (!cityConfig || typeof cityConfig !== "object") {
      throw new Error("RouteTemplateProvider requires a city config");
    }
    this.cityConfig = cityConfig;
  }

  listCandidates(options = {}) {
    return buildRouteTemplateCandidates(this.cityConfig, options);
  }
}

function buildRouteTemplateCandidates(cityConfig, options = {}) {
  const templates = Array.isArray(cityConfig?.catalog?.routeTemplates)
    ? cityConfig.catalog.routeTemplates
    : [];
  const catalogCandidates = buildCuratedCatalogPlaceCandidates(cityConfig);
  const candidateById = new Map(catalogCandidates.map((candidate) => [candidate.id, candidate]));

  return templates.map((template, index) =>
    validateRouteCandidate(
      normalizeRouteTemplate(cityConfig, template, {
        candidateById,
        includeDebugLabels: options.includeDebugLabels,
      }),
      `routeTemplateCandidate[${index}]`,
    ),
  );
}

function normalizeRouteTemplate(cityConfig, template = {}, options = {}) {
  const candidateById = options.candidateById || new Map();
  const stops = Array.isArray(template.stops) ? template.stops : [];
  const normalizedStops = stops.map((stopId) => normalizeTemplateStop(stopId, candidateById));
  const unresolvedStops = normalizedStops
    .filter((stop) => stop.unresolved)
    .map((stop) => stop.candidate_id || stop.label)
    .filter(Boolean);
  const routeShape = resolveRouteShape(template, stops);
  const sourceMix = ["curated_template"];
  const confidence = unresolvedStops.length ? "medium" : "high";

  return normalizeRouteCandidate({
    id: template.id,
    city: cityConfig.key,
    route_shape: routeShape,
    stops: normalizedStops,
    estimated_walking_km: Number.isFinite(template.defaultKm) ? template.defaultKm : undefined,
    covered_intents: template.preferenceTags || [],
    missing_intents: [],
    area_flow: uniqueValues(normalizedStops.map((stop) => stop.area)),
    macro_flow: uniqueValues(normalizedStops.map((stop) => stop.macro)),
    source_mix: sourceMix,
    trust_summary: {
      source_tiers: ["curated"],
      confidence,
      human_verified: true,
      freshness: "fresh",
    },
    confidence,
    explanation_inputs: {
      template_id: template.id,
      title: template.title,
      summary: template.summary,
      optimizer_modes: template.optimizerModes || [],
      default_km: Number.isFinite(template.defaultKm) ? template.defaultKm : undefined,
    },
    warnings: unresolvedStops.length
      ? [`unresolved_template_stops:${unresolvedStops.join(",")}`]
      : [],
    limitations: [],
  });
}

function normalizeTemplateStop(stopId, candidateById) {
  const id = String(stopId || "").trim();
  const candidate = candidateById.get(id);

  if (!candidate) {
    return {
      candidate_id: id,
      label: id,
      stop_kind: "user_stop",
      is_user_facing: true,
      role: "template_stop",
      unresolved: true,
    };
  }

  return {
    candidate_id: candidate.id,
    label: candidate.label,
    candidate_kind: candidate.candidate_kind,
    stop_kind: candidate.is_structural ? "route_structure" : "user_stop",
    is_user_facing: !candidate.is_structural,
    area: candidate.area,
    macro: candidate.macro,
    role: candidate.is_structural ? "template_structure" : "template_stop",
  };
}

function resolveRouteShape(template = {}, stops = []) {
  const explicitShape = String(template.route_shape || template.routeShape || template.shape || "").trim();
  if (explicitShape) return explicitShape;
  if (stops.length >= 2 && String(stops[0]) === String(stops[stops.length - 1])) {
    return "loop";
  }
  if (stops.length <= 2) return "nearby_move";
  if (stops.length <= 3) return "mini_route";
  return "arc";
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  RouteTemplateProvider,
  buildRouteTemplateCandidates,
  normalizeRouteTemplate,
};
