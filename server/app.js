const fs = require("node:fs");
const express = require("express");
const path = require("path");
const { resolveCityConfig, cityConfigs } = require("./cities");
const { buildBlitzDecision } = require("./blitz-engine");
const { buildAnywhereBlitzDecision } = require("./blitz-anywhere");
const { generateRecommendations } = require("./route-engine");
const {
  classifyRuntimeReadiness,
  buildUnsupportedCityReadiness,
} = require("./city-readiness/runtime-readiness");
const { diversifyRecommendationDays } = require("./route-diversity");
const { buildClientI18nPayload, normalizeLanguage, translate } = require("./ui-i18n");
const { buildCityPulse } = require("./pulse-engine");
const { buildCandidateIntelligenceInspect } = require("./candidates");
const { createPublicAccessGuard } = require("./lib/public-access-guard");
const { buildAgnosticCityContext } = require("./candidates/agnostic-context");
const { isExternalCandidatesEnabled } = require("./candidates/blitz-candidate-mode");
const { classifyCatalogDensity } = require("./candidates/source-calibration");
const { selectPlannerRoleCandidates } = require("./planner/role-selector");
const { summarizeDayflowHonesty } = require("./planner/dayflow-honesty");
const { buildCandidateCombinationInspect } = require("./planner/candidate-combination-inspect");
const { buildRouteCandidateAdapterInspect } = require("./planner/candidate-combination-route-adapter");
const { buildRouteAbScoringInspect } = require("./planner/route-ab-scoring");
const { buildRouteOutputDiagnostics } = require("./planner/route-output-diagnostics");
const { buildAgnosticRouteCandidateDiagnostics } = require("./planner/agnostic-route-candidate-diagnostics");
const {
  composeAgnosticRouteOutput,
  buildBlockedAgnosticRouteOutputExperiment,
  buildAgnosticPublicResult,
} = require("./planner/agnostic-route-output");
const { buildRegisteredCityCandidateFill } = require("./planner/registered-city-candidate-fill");
const { buildPreviewPreferenceFit } = require("./planner/preview-preference-fit");
const { buildPreviewBetaEngineStatus } = require("./planner/preview-beta-engine-status");
const { classifyPromotionReadiness } = require("./planner/agnostic-promotion-gate");
const { normalizeUserIntents } = require("./candidates/intent-vocabulary");
const { buildEngineReadinessVerdict } = require("./planner/agnostic-engine-readiness");
const { reconcileAgnosticConstraintNegotiation } = require("./planner/agnostic-constraint-negotiation");
const { resolveAgnosticWalkingTargetBand } = require("./planner/agnostic-walking-target");
const { resolveAgnosticIntake, parsePlaceQuery } = require("./planner/agnostic-place-intake");
const { collectPlaceCandidatesForCity } = require("./place-candidates/provider-registry");
const { resolveDefaultOpenDataLoader } = require("./place-candidates/open-data-loader");
const { resolveDefaultPlaceResolver } = require("./place-candidates/place-resolver");
const { resolveDefaultEventSupply } = require("./place-candidates/agnostic-event-supply");
const {
  resolveDefaultSourceProfileCatalog,
} = require("./pulse-sources/source-profile-catalog");
const {
  executeLiveEventQuery,
  shapeCollectedLiveEvents,
} = require("./place-candidates/live-event-query");
const { EXTERNAL_OPEN_PROVIDER_META } = require("./place-candidates/external-open-provider");
const { buildMasthead } = require("./pulse-engine/masthead");
const { classifySignalQuality } = require("./pulse-engine/signal-quality");
const {
  buildLiveEventEditorialPitch,
} = require("./pulse-engine/generators/live-events");

const appRoot = path.resolve(__dirname, "..");
const appShellTemplate = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const landingShellTemplate = fs.readFileSync(path.join(appRoot, "landing.html"), "utf8");
const dogfoodShellTemplate = fs.readFileSync(path.join(appRoot, "dogfood.html"), "utf8");
const publicRootFiles = new Set([
  "styles.css",
  "script.js",
  "ux-pass1.js",
  "planner-trust.js",
  "manifest.webmanifest",
  "sw.js",
  // #264 — dogfood UI assets (the page itself is env-gated; these two files are
  // small, harmless leaf assets that only do anything when /dogfood is enabled).
  "dogfood.js",
  "dogfood-render.js",
  // any-place alpha (/labs/anywhere): shared honest-result classifier used by the
  // planner shell and Node tests (UMD). Harmless leaf asset elsewhere.
  "anywhere-render-decision.js",
]);
const blockedPublicPrefixes = ["/server/", "/tests/", "/docs/"];
const blockedPublicRootFiles = new Set([
  "/package.json",
  "/package-lock.json",
  "/render.yaml",
  "/README.md",
]);
const TRUTHY_INSPECT_FLAGS = new Set([true, 1, "1", "on", "yes", "true"]);

const pulseVibeByTag = {
  kultur: "curious",
  kyrkor: "curious",
  "hidden gems": "curious",
  nattliv: "buzzy",
  cocktail: "buzzy",
  öl: "buzzy",
  vin: "romantic",
  utsikt: "romantic",
  mat: "slow",
};

function getCitySearchLabel(cityConfig) {
  return cityConfig?.searchLabel || cityConfig?.label || "Rome";
}

function isRealPlannerAreaItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (item.structuralRouteAnchor === true) {
    return false;
  }

  if (["district", "district-group", "area_preset"].includes(item.kind)) {
    return false;
  }

  return Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

function normalizePlannerAreaValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPlannerAreas(cityConfig) {
  const areaDefinitions = cityConfig?.routing?.areaDefinitions;

  if (!areaDefinitions || typeof areaDefinitions !== "object") {
    return [];
  }

  const catalogItems = Array.isArray(cityConfig?.catalog?.allItems)
    ? cityConfig.catalog.allItems.filter(isRealPlannerAreaItem)
    : [];
  const candidates = Object.entries(areaDefinitions).map(([id, definition], index) => {
    const label = String(definition?.label || "").trim() || humanizeCityKey(id);
    const macro = String(definition?.macro || "").trim() || "";
    const areaIdKey = normalizePlannerAreaValue(id);
    const areaLabelKey = normalizePlannerAreaValue(label);
    const matches = catalogItems.filter((item) => {
      const itemAreaKey = normalizePlannerAreaValue(item.area);

      if (!itemAreaKey) {
        return false;
      }

      return (
        itemAreaKey === areaIdKey ||
        itemAreaKey === areaLabelKey ||
        itemAreaKey.includes(areaIdKey) ||
        itemAreaKey.includes(areaLabelKey)
      );
    });
    const centroid = matches.length
      ? {
          lat: matches.reduce((sum, item) => sum + item.lat, 0) / matches.length,
          lng: matches.reduce((sum, item) => sum + item.lng, 0) / matches.length,
        }
      : null;

    return {
      id,
      label,
      macro,
      type: String(definition?.type || "district"),
      area: label,
      lat: centroid?.lat ?? null,
      lng: centroid?.lng ?? null,
      matchCount: matches.length,
      index,
    };
  });

  const dedupedByIdentity = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.label}::${candidate.macro}`;
    const existing = dedupedByIdentity.get(identity);

    if (
      !existing ||
      candidate.matchCount > existing.matchCount ||
      (candidate.matchCount === existing.matchCount && candidate.index < existing.index)
    ) {
      dedupedByIdentity.set(identity, candidate);
    }
  }

  return [...dedupedByIdentity.values()]
    .sort((left, right) => left.index - right.index)
    .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
    .map(({ matchCount, index, ...plannerArea }) => plannerArea);
}

function humanizeCityKey(cityKey) {
  const normalized = String(cityKey || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.toLowerCase() === "rome") {
    return "Rom";
  }

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildExternalSearchUrl(label, cityConfig) {
  return `https://www.google.com/search?q=${encodeURIComponent(
    `${label} ${getCitySearchLabel(cityConfig)}`,
  )}`;
}

function buildExternalMapUrl(label, cityConfig) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${label} ${getCitySearchLabel(cityConfig)}`,
  )}`;
}

function buildOfficialPulseWhen(event, date, lang = "sv") {
  const isEnglish = normalizeLanguage(lang) === "en";

  if (event.start_date && event.end_date && event.start_date === event.end_date) {
    return event.start_date === date ? (isEnglish ? "Today" : "I dag") : event.start_date;
  }

  if (event.start_date === date) {
    return isEnglish ? "Starts today" : "Börjar i dag";
  }

  if (event.end_date === date) {
    return isEnglish ? "Running today" : "Pågår i dag";
  }

  return event.start_date || event.end_date || (isEnglish ? "Right now" : "Just nu");
}

function compactOfficialPulseText(text, maxLength = 220) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  const boundary = sentenceEnd >= 80 ? sentenceEnd + 1 : clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 80 ? boundary : maxLength).trim()}...`;
}

/*
 * Event-kind taxonomy. Live-event feeds (e.g. Open Data BCN) publish titles in
 * the local language (Catalan). We don't translate provider titles — but we do
 * derive an EN/SV kind label from the existing match_tags so the user always
 * has app-owned framing around the native title, never a feed-dump-only card.
 *
 * Ordered by specificity: music wins over kultur, market wins over kultur,
 * etc. "generic" is the catch-all so every live-event card has a kind label.
 */
const EVENT_KIND_TAXONOMY = [
  ["music", { sv: "Konsert", en: "Concert" }],
  ["exhibition", { sv: "Utställning", en: "Exhibition" }],
  ["market", { sv: "Marknad", en: "Market" }],
  ["nattliv", { sv: "Nattliv", en: "Nightlife" }],
  ["mat", { sv: "Matevent", en: "Food event" }],
  ["civic", { sv: "Föreläsning", en: "Talk" }],
  ["family", { sv: "Familjeevent", en: "Family event" }],
  ["community", { sv: "Lokalt event", en: "Local event" }],
  ["kultur", { sv: "Kulturevent", en: "Cultural event" }],
];
const EVENT_KIND_GENERIC = { sv: "Liveevent", en: "Live event" };

function deriveEventKindLabel(event, lang = "sv") {
  const isEnglish = normalizeLanguage(lang) === "en";
  const tags = event?.match_tags || [];
  for (const [tag, labels] of EVENT_KIND_TAXONOMY) {
    if (tags.includes(tag)) {
      return isEnglish ? labels.en : labels.sv;
    }
  }
  return isEnglish ? EVENT_KIND_GENERIC.en : EVENT_KIND_GENERIC.sv;
}

function isEventSourceLanguageForeign(event, lang) {
  const sourceLang = (event?.source_language || "").toLowerCase();
  if (!sourceLang) {
    return false;
  }
  return sourceLang !== normalizeLanguage(lang);
}

function buildOfficialPulseKind(event, lang = "sv") {
  const isEnglish = normalizeLanguage(lang) === "en";
  const sourceLabel = event.source_label || event.provider || "";
  const kindLabel = deriveEventKindLabel(event, lang);
  // Use the derived kind first so the chip reads as "Concert · Open Data BCN"
  // rather than the generic "Official live · Open Data BCN", which made the
  // card depend on the (Catalan) title to communicate what kind of thing it is.
  const primary = kindLabel || (isEnglish ? "Official live" : "Officiellt live");
  return [primary, sourceLabel].filter(Boolean).join(" · ");
}

function buildOfficialPulseBlurb(event, cityLabel, lang = "sv") {
  const isEnglish = normalizeLanguage(lang) === "en";
  const summary = compactOfficialPulseText(event.summary || event.raw_summary);
  const venue = event.venue || event.address || "";

  // When the provider summary is in a different language than the UI, don't
  // dump it as the explanatory body — the user is left interpreting a feed
  // string. The native title can still surface (set elsewhere). Synthesise
  // an EN/SV framing line from the derived kind + venue instead. The
  // original native blurb is preserved on event.summary/raw_summary for
  // callers that want to expose it via a "show original" affordance.
  if (summary && !isEventSourceLanguageForeign(event, lang)) {
    return summary;
  }

  const kindLabel = deriveEventKindLabel(event, lang);
  if (venue) {
    return isEnglish
      ? `${kindLabel} at ${venue}.`
      : `${kindLabel} på ${venue}.`;
  }

  // No venue — fall back to city label. Source label stays off user-facing copy.
  return isEnglish
    ? `${kindLabel} in ${cityLabel || "the city"}.`
    : `${kindLabel} i ${cityLabel || "staden"}.`;
}

function buildOfficialPulseWhy(event, cityLabel, lang = "sv") {
  // Action-oriented subhead — never exposes source labels.
  const isEnglish = normalizeLanguage(lang) === "en";
  const kindLabel = deriveEventKindLabel(event, lang);
  const city = (cityLabel || "").trim() || (isEnglish ? "the city" : "staden");
  return isEnglish
    ? `${kindLabel} on today in ${city}. Worth adding to the plan if the timing works.`
    : `${kindLabel} idag i ${city}. Lägg in på planen om timingen passar.`;
}

function buildOfficialPulseItem(event, date, cityConfig, lang = "sv") {
  const cityLabel = resolveDisplayLabel(cityConfig, null, lang);
  // Venue name only — full postal address belongs in the detail view.
  // "Rom" hardcoded fallback removed: cityLabel is always set for a
  // configured city, so the city-specific string is dead code.
  const where = event.venue || cityConfig?.editorialAreaLabel || cityLabel || "";
  const matchesVibes = [...new Set((event.match_tags || []).map((tag) => pulseVibeByTag[tag]).filter(Boolean))];

  const item = {
    id: `official-${event.id}`,
    level: "venue",
    signal_type: "live_event_nearby",
    kind: buildOfficialPulseKind(event, lang),
    title: event.title,
    // Mirror the native title so the UI can label or hint "Catalan title"
    // when needed. The title stays native intentionally — we don't translate
    // provider titles or local place names.
    native_title: event.title,
    source_language: event.source_language || null,
    where,
    when: buildOfficialPulseWhen(event, date, lang),
    blurb: buildOfficialPulseBlurb(event, cityLabel, lang),
    editorial_pitch: buildLiveEventEditorialPitch(event, lang),
    why_it_matters: buildOfficialPulseWhy(event, cityLabel, lang),
    matches_vibes: matchesVibes,
    official_event_id: event.id,
    lat: typeof event.lat === "number" ? event.lat : null,
    lng: typeof event.lng === "number" ? event.lng : null,
    source: {
      kind: "live_feed",
      label: event.source_label || event.provider || null,
      url: event.source_url || event.url || undefined,
      id: event.source_id || event.provider || undefined,
    },
    priority: 6,
  };

  return {
    ...item,
    signal_quality: classifySignalQuality({
      ...item,
      type: item.signal_type,
    }),
  };
}

function resolveRequestCity(city) {
  const resolution = resolveCityConfig(city);

  return {
    cityConfig: resolution.cityConfig,
    requestedCity: resolution.requestedKey,
    cityFallbackUsed: resolution.fallbackUsed,
  };
}

/**
 * Parse a {lat,lng} pair from the /api/blitz request. Accepts top-level
 * fields (query or body) or the existing `origin.{lat,lng}` shape. Returns
 * null when the inputs are missing, non-finite, or outside valid ranges —
 * invalid coordinates are IGNORED (predictable fall-through to normal city
 * behavior), they never throw or 400 the request.
 */
function parseBlitzCoordinates(request) {
  const body = request.body || {};
  const query = request.query || {};
  const origin = body.origin && typeof body.origin === "object" ? body.origin : {};

  const latRaw = body.lat ?? query.lat ?? origin.lat;
  const lngRaw = body.lng ?? query.lng ?? origin.lng;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * Curated catalog density of a recognized city ("rich" | "thin" | "absent"),
 * measured the same way the engine does (curated, non-structural real places).
 * Used to gate open-data augmentation to thin cities only — rich citypacks like
 * Rome/Barcelona never auto-augment and stay curated-first.
 */
function curatedDensityOf(cityConfig) {
  try {
    const collected = collectPlaceCandidatesForCity(cityConfig).candidates || [];
    const curatedRealPlaces = collected.filter(
      (c) => c.city_pack_owned === true && c.is_structural !== true,
    ).length;
    const density = classifyCatalogDensity(curatedRealPlaces);
    if (cityConfig?.visibility === "preview" && density === "rich") {
      return "thin";
    }
    return density;
  } catch (_error) {
    return "rich"; // on any error, never augment (treat as rich → no augmentation)
  }
}

/**
 * Whether the request opts into external/open candidates. Delegates to the
 * engine's canonical flag check so HTTP and engine never drift. Accepts both
 * snake_case and camelCase, query and body.
 */
function isExternalCandidatesRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return isExternalCandidatesEnabled({
    include_external_candidates:
      query.include_external_candidates ??
      query.includeExternalCandidates ??
      body.include_external_candidates ??
      body.includeExternalCandidates,
    candidate_sources:
      query.candidate_sources ?? query.candidateSources ?? body.candidate_sources ?? body.candidateSources,
  });
}

function isPlannerCandidateInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    isCandidateCombinationInspectRequested(request) ||
    isRouteCandidateAdapterInspectRequested(request) ||
    isRouteAbScoringInspectRequested(request) ||
    inspectListHas(query.inspect, "planner_roles") ||
    isTruthyInspectFlag(query.planner_inspect) ||
    isTruthyInspectFlag(query.plannerInspect) ||
    isTruthyInspectFlag(query.include_candidate_roles) ||
    isTruthyInspectFlag(query.includeCandidateRoles) ||
    isTruthyInspectFlag(body.planner_inspect) ||
    isTruthyInspectFlag(body.plannerInspect) ||
    isTruthyInspectFlag(body.include_candidate_roles) ||
    isTruthyInspectFlag(body.includeCandidateRoles)
  );
}

function isCandidateCombinationInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    inspectListHas(query.inspect, "candidate_combination") ||
    isTruthyInspectFlag(query.inspect_candidate_combination) ||
    isTruthyInspectFlag(query.inspectCandidateCombination) ||
    isTruthyInspectFlag(body.inspect_candidate_combination) ||
    isTruthyInspectFlag(body.inspectCandidateCombination)
  );
}

function isRouteCandidateAdapterInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    inspectListHas(query.inspect, "route_candidate_adapter") ||
    isTruthyInspectFlag(query.inspect_route_candidate_adapter) ||
    isTruthyInspectFlag(query.inspectRouteCandidateAdapter) ||
    isTruthyInspectFlag(body.inspect_route_candidate_adapter) ||
    isTruthyInspectFlag(body.inspectRouteCandidateAdapter)
  );
}

function isRouteAbScoringInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    inspectListHas(query.inspect, "route_ab_scoring") ||
    isTruthyInspectFlag(query.inspect_route_ab_scoring) ||
    isTruthyInspectFlag(query.inspectRouteAbScoring) ||
    isTruthyInspectFlag(body.inspect_route_ab_scoring) ||
    isTruthyInspectFlag(body.inspectRouteAbScoring)
  );
}

function isRouteOutputInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    inspectListHas(query.inspect, "route_output") ||
    isTruthyInspectFlag(query.inspect_route_output) ||
    isTruthyInspectFlag(query.inspectRouteOutput) ||
    isTruthyInspectFlag(body.inspect_route_output) ||
    isTruthyInspectFlag(body.inspectRouteOutput)
  );
}

// #257 — INDEPENDENT of isPlannerCandidateInspectRequested on purpose: this
// sidecar must be requestable alone without exposing planner_roles /
// dayflow_honesty / candidate_combination / route_candidate_adapter /
// route_ab_scoring / route_output_diagnostics.
function isAgnosticRouteCandidateInspectRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    inspectListHas(query.inspect, "agnostic_route_candidate") ||
    isTruthyInspectFlag(query.inspect_agnostic_route_candidate) ||
    isTruthyInspectFlag(query.inspectAgnosticRouteCandidate) ||
    isTruthyInspectFlag(body.inspect_agnostic_route_candidate) ||
    isTruthyInspectFlag(body.inspectAgnosticRouteCandidate)
  );
}

function inspectListHas(value, token) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(token);
}

// #259 — the explicit EXPERIMENT flag that authorizes route mutation/synthesis.
// Parsed INDEPENDENTLY of the `inspect` list on purpose: `inspect=` may only
// expose diagnostics and must NEVER mutate route output. Primary flag is
// `experimental_agnostic_route_output=1`; optional alias `experiment=agnostic_route_output`.
function isAgnosticRouteOutputExperimentRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    isTruthyInspectFlag(query.experimental_agnostic_route_output) ||
    isTruthyInspectFlag(query.experimentalAgnosticRouteOutput) ||
    isTruthyInspectFlag(body.experimental_agnostic_route_output) ||
    isTruthyInspectFlag(body.experimentalAgnosticRouteOutput) ||
    inspectListHas(query.experiment, "agnostic_route_output") ||
    inspectListHas(body.experiment, "agnostic_route_output")
  );
}

// Convergence gate (env/flag-gated, default off). When set, the agnostic route
// is synthesized through the route engine's own agnostic_compose and only
// PROMOTED to the returned route when the readiness calibration clears the
// thin_usable/low bar (else baseline + diagnostic). Default-off keeps the
// legacy in-module synthesizer and the prior always-return behavior unchanged,
// and respects "no public flip without persistent cache" — production opts in
// via PARRANDA_AGNOSTIC_ENGINE_COMPOSE only when ready.
// EVENTS AS ROUTE STOPS: when the evening anchor is a genuinely walkable
// extension of the AGNOSTIC day, weave it in as the walking-validated final
// stop (see candidates/event-route-stop-weave). Fail-soft + honest: any error
// or failed gate returns the inputs unchanged — the anchor card remains and no
// walk is claimed. The module itself refuses non-agnostic days, so a fallback
// city's route can never receive the typed place's event.
async function weaveEventStopFailSoft({ result, placeStructure, walkingRouter, walkingConfig }) {
  try {
    const { weaveEveningEventRouteStop } = require("./candidates/event-route-stop-weave");
    return await weaveEveningEventRouteStop({ result, placeStructure, walkingRouter, walkingConfig });
  } catch (_error) {
    return { result, placeStructure, applied: false, blockers: ["weave_error"] };
  }
}

function reconcileConstraintAfterEventWeave({ experiment, woven, walkingKmTarget }) {
  if (!woven?.applied || !experiment?.constraint_negotiation) return;
  const finalRoute = woven.result?.days?.[0]?.primary_route || null;
  experiment.constraint_negotiation = reconcileAgnosticConstraintNegotiation({
    negotiation: experiment.constraint_negotiation,
    experimentalRoute: finalRoute,
    walkingKmTarget,
    walkingValidated: true,
  });
}

function isAgnosticEngineComposeRequested(request) {
  const query = request.query || {};
  const body = request.body || {};
  return (
    isEnabledRuntimeFlag(process.env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE) ||
    isTruthyInspectFlag(query.agnostic_engine_compose) ||
    isTruthyInspectFlag(query.agnosticEngineCompose) ||
    isTruthyInspectFlag(body.agnostic_engine_compose) ||
    isTruthyInspectFlag(body.agnosticEngineCompose)
  );
}

function isEnabledRuntimeFlag(value) {
  return (
    String(value ?? "").trim().toLowerCase() === "enabled" ||
    isTruthyInspectFlag(value)
  );
}

function isTruthyInspectFlag(value) {
  return TRUTHY_INSPECT_FLAGS.has(value) || TRUTHY_INSPECT_FLAGS.has(String(value).toLowerCase());
}

function resolvePlannerRoleOrigin(cityConfig, requestBody = {}) {
  const explicit = requestBody.origin || requestBody.selected_origin || requestBody.home_base || requestBody.homeBase || requestBody.start;
  const explicitCoords = resolveLatLng(explicit);
  if (explicitCoords) return explicitCoords;
  const center = cityConfig?.center;
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    return { lat: center.lat, lng: center.lng, label: cityConfig.label || cityConfig.key || null };
  }
  return null;
}

function resolveLatLng(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
    return { lat: value.lat, lng: value.lng, label: value.label || value.name || null };
  }
  if (Number.isFinite(value.coordinates?.lat) && Number.isFinite(value.coordinates?.lng)) {
    return { lat: value.coordinates.lat, lng: value.coordinates.lng, label: value.label || value.name || null };
  }
  return null;
}

function buildPlannerRolePayload(cityConfig, request, routePayload, roleOrigin) {
  return {
    city: cityConfig.key,
    date: routePayload.dates[0] || cityConfig.todayIsoDate(),
    now: request.body?.now || null,
    preferences: routePayload.preferences,
    lens: request.body?.lens || request.query?.lens || null,
    weather: request.body?.weather || null,
    origin: roleOrigin,
    include_external_candidates:
      request.query?.include_external_candidates ??
      request.query?.includeExternalCandidates ??
      request.body?.include_external_candidates ??
      request.body?.includeExternalCandidates,
    candidate_sources:
      request.query?.candidate_sources ??
      request.query?.candidateSources ??
      request.body?.candidate_sources ??
      request.body?.candidateSources,
  };
}

function resolveSelectedRouteDate(payload, baselineBody, cityConfig) {
  const explicitDate = Array.isArray(payload?.dates) ? payload.dates[0] : null;
  if (explicitDate) return explicitDate;
  const baselineDate = Array.isArray(baselineBody?.days) ? baselineBody.days[0]?.date : null;
  if (baselineDate) return baselineDate;
  const configuredToday = typeof cityConfig?.todayIsoDate === "function"
    ? cityConfig.todayIsoDate()
    : cityConfig?.todayIsoDate;
  return configuredToday || null;
}

async function buildPlannerCandidateInspectSidecar({ cityConfig, request, routePayload, routeResult, openDataLoader }) {
  const roleOrigin = resolvePlannerRoleOrigin(cityConfig, request.body || {});
  const externalRequested = isExternalCandidatesRequested(request);
  const rolePayload = buildPlannerRolePayload(cityConfig, request, routePayload, roleOrigin);

  const { helpers, sourceStatus } = await resolvePlannerRoleHelpers({
    externalRequested,
    openDataLoader,
    anchor: roleOrigin,
  });
  const plannerRoles = selectPlannerRoleCandidates(cityConfig, rolePayload, helpers);
  const dayflowHonesty = summarizeDayflowHonesty(plannerRoles);
  const primaryRoute = routeResult?.days?.[0]?.primary_route || null;
  // The route-candidate adapter (#253) consumes the candidate combination, and
  // the A/B scoring sidecar (#254) consumes the adapter. Build upstream
  // diagnostics when any downstream flag needs them, but only expose the
  // sidecars that were explicitly requested.
  const wantCombination = isCandidateCombinationInspectRequested(request);
  const wantAdapter = isRouteCandidateAdapterInspectRequested(request);
  const wantAbScoring = isRouteAbScoringInspectRequested(request);
  const candidateCombination = (wantCombination || wantAdapter || wantAbScoring)
    ? buildCandidateCombinationInspect({
        plannerRoles,
        dayflowHonesty,
        route: primaryRoute,
        options: { origin: roleOrigin },
      })
    : null;
  // Experimental, inspect-only A/B adapter. Default route output is untouched.
  const routeCandidateAdapter = (wantAdapter || wantAbScoring)
    ? buildRouteCandidateAdapterInspect({
        city: cityConfig.key,
        candidateCombination,
        route: primaryRoute,
        context: { origin: roleOrigin },
      })
    : null;
  const routeAbScoring = wantAbScoring
    ? buildRouteAbScoringInspect({
        city: cityConfig.key,
        primaryRoute,
        routeCandidateAdapter,
      })
    : null;

  return {
    planner_roles: {
      scope: "plan",
      density: plannerRoles.density,
      lens: plannerRoles.lens,
      context: plannerRoles.context,
      summary: plannerRoles.summary,
      source_status: [sourceStatus],
      roles: plannerRoles.roles,
    },
    dayflow_honesty: dayflowHonesty,
    ...(wantCombination && candidateCombination ? { candidate_combination: candidateCombination } : {}),
    ...(wantAdapter && routeCandidateAdapter ? { route_candidate_adapter: routeCandidateAdapter } : {}),
    ...(routeAbScoring ? { route_ab_scoring: routeAbScoring } : {}),
  };
}

async function resolvePlannerRoleHelpers({ externalRequested, openDataLoader, anchor }) {
  const baseStatus = {
    provider_id: EXTERNAL_OPEN_PROVIDER_META.provider_id,
    status: "skipped",
    external_candidates_requested: externalRequested,
    anchor: anchor || null,
  };
  if (!externalRequested) {
    return { helpers: {}, sourceStatus: baseStatus };
  }
  if (typeof openDataLoader !== "function") {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_loader_configured" } };
  }
  if (!anchor) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_anchor" } };
  }
  try {
    const records = await openDataLoader(anchor);
    const loaderStatus = typeof records?.loader_status === "string" ? records.loader_status : null;
    const loaderError = records?.loader_error || null;
    if (loaderStatus === "error_failed_closed") {
      return {
        helpers: {},
        sourceStatus: { ...baseStatus, status: "error_failed_closed", error: loaderError },
      };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { helpers: {}, sourceStatus: { ...baseStatus, status: "loaded:0", error: loaderError } };
    }
    return {
      helpers: { external_provider: { dataset: records } },
      sourceStatus: { ...baseStatus, status: `loaded:${records.length}`, error: loaderError },
    };
  } catch (_error) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "error_failed_closed", error: "fetch_error" } };
  }
}

// #257 — builds ONLY the agnostic_route_candidate sidecar, independently of the
// planner-inspect sidecar (so it can be requested alone). Fails closed and never
// throws: a loader/diagnostic failure must not break route generation.
async function buildAgnosticRouteCandidateSidecar({ cityConfig, request, routePayload, routeResult, openDataLoader }) {
  const primaryRoute = routeResult?.days?.[0]?.primary_route || null;
  const externalRequested = isExternalCandidatesRequested(request);
  try {
    // Fail-closed before any fetch when external candidates were not opted in.
    if (!externalRequested) {
      return {
        agnostic_route_candidate: buildAgnosticRouteCandidateDiagnostics({
          city: cityConfig.key,
          externalRequested: false,
          sourceStatus: null,
          candidateCombination: null,
          primaryRoute,
        }),
      };
    }
    const roleOrigin = resolvePlannerRoleOrigin(cityConfig, request.body || {});
    const rolePayload = buildPlannerRolePayload(cityConfig, request, routePayload, roleOrigin);
    const { helpers, sourceStatus } = await resolvePlannerRoleHelpers({
      externalRequested,
      openDataLoader,
      anchor: roleOrigin,
    });
    const plannerRoles = selectPlannerRoleCandidates(cityConfig, rolePayload, helpers);
    const candidateCombination = buildCandidateCombinationInspect({
      plannerRoles,
      dayflowHonesty: summarizeDayflowHonesty(plannerRoles),
      route: primaryRoute,
      options: { origin: roleOrigin },
    });
    return {
      agnostic_route_candidate: buildAgnosticRouteCandidateDiagnostics({
        city: cityConfig.key,
        externalRequested: true,
        sourceStatus,
        candidateCombination,
        primaryRoute,
      }),
    };
  } catch (error) {
    return {
      agnostic_route_candidate: {
        status: "unavailable",
        city: cityConfig.key,
        experimental: true,
        route_mutation: false,
        source: "trusted_candidate_pool",
        source_status: { status: "diagnostic_failed" },
        candidate: null,
        comparison_to_route_output: null,
        blockers: ["agnostic_route_candidate_inspect_failed", `error:${error.message}`],
        signals: [],
        recommendation: "needs_more_data",
      },
    };
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}


function resolveShellMode(cityConfig, cityFallbackUsed) {
  if (cityConfig?.visibility === "internal") {
    return "internal-preview";
  }

  if (cityFallbackUsed) {
    return "fallback-preview";
  }

  if (cityConfig?.visibility === "preview") {
    return "city-preview";
  }

  if (cityConfig?.visibility === "beta") {
    return "curated-public";
  }

  return "curated-public";
}

function isPreviewCityConfig(cityConfig) {
  return cityConfig?.visibility === "preview";
}

function shouldReturnPreviewRouteNoop(cityConfig) {
  // A preview city with real catalog items can now be routed by the engine's
  // agnostic compose path even with zero curated route templates (see
  // route-engine buildAgnosticComposeTemplate). Only short-circuit to the
  // honest empty noop when there is genuinely nothing to compose from.
  return isPreviewCityConfig(cityConfig) && !cityConfig.catalog?.allItems?.length;
}

function getLocalizedPreviewSurfaceValue(cityConfig, lang, key) {
  const value = cityConfig?.previewSurface?.[key];

  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value : null;
  }

  return value[normalizeLanguage(lang)] || value.en || value.sv || null;
}

function buildShellCopy(shellMode, options = {}) {
  const cityLabel = options.displayLabel || "Staden";
  const lang = normalizeLanguage(options.lang);
  const cityUpper = cityLabel.toLocaleUpperCase(lang === "en" ? "en-US" : "sv-SE");
  const cityConfig = options.cityConfig || null;
  const scope =
    shellMode === "fallback-preview"
      ? "shell.fallback"
      : shellMode === "city-preview"
        ? "shell.preview"
      : shellMode === "internal-preview"
        ? "shell.internal"
        : "shell.curated";
  const replacements = { city: cityLabel, cityUpper };
  const tr = (key, fallback = "") => translate(lang, `${scope}.${key}`, replacements, fallback);
  const previewOverride = (key, fallback) =>
    getLocalizedPreviewSurfaceValue(cityConfig, lang, key) || fallback;

  return {
    brandSubtitle: previewOverride("brandSubtitle", tr("brandSubtitle")),
    eyebrow: scope === "shell.curated" ? "" : tr("eyebrow"),
    heroHeadline: previewOverride("heroHeadline", tr("heroHeadline")),
    heroLead: previewOverride("heroLead", tr("heroLead")),
    heroLiveLabel: tr("heroLiveLabel"),
    plannerTitle: previewOverride("plannerTitle", tr("plannerTitle")),
    plannerSummary: previewOverride("plannerSummary", tr("plannerSummary")),
    plannerCtaLabel: previewOverride("plannerCtaLabel", tr("plannerCtaLabel")),
    plannerMicrocopy: previewOverride("plannerMicrocopy", tr("plannerMicrocopy")),
    wildcardLabel: previewOverride("wildcardLabel", tr("wildcardLabel")),
    wildcardTitle: previewOverride("wildcardTitle", tr("wildcardTitle")),
    wildcardSummary: previewOverride("wildcardSummary", tr("wildcardSummary")),
    wildcardMeta: previewOverride("wildcardMeta", tr("wildcardMeta")),
    wildcardTag1: previewOverride("wildcardTag1", tr("wildcardTag1")),
    wildcardTag2: previewOverride("wildcardTag2", tr("wildcardTag2")),
    wildcardTag3: previewOverride("wildcardTag3", tr("wildcardTag3")),
    wildcardActionsHidden: scope === "shell.curated" ? "" : "hidden",
  };
}

function buildShellMeta(cityConfig, options = {}) {
  const cityLabel = options.displayLabel || cityConfig?.label || "Staden";
  const citySearchLabel = options.searchLabel || cityLabel || getCitySearchLabel(cityConfig);
  const lang = normalizeLanguage(options.lang);
  const scope =
    options.shellMode === "fallback-preview"
      ? "meta.fallback"
      : options.shellMode === "city-preview"
        ? "meta.preview"
      : options.shellMode === "internal-preview"
        ? "meta.internal"
        : "meta.curated";
  const replacements = { city: cityLabel };
  const tr = (key, fallback = "") => translate(lang, `${scope}.${key}`, replacements, fallback);

  return {
    title: tr("title"),
    metaDescription: tr("description"),
    ogTitle: tr("title"),
    ogDescription: tr("ogDescription"),
    twitterTitle: tr("title"),
    twitterDescription: tr("twitterDescription", tr("description")),
    cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${citySearchLabel} hidden gems`,
    )}`,
  };
}

function resolveDisplayLabel(cityConfig, requestedLabel, lang) {
  if (requestedLabel) {
    return requestedLabel;
  }

  if (normalizeLanguage(lang) === "en") {
    return getCitySearchLabel(cityConfig);
  }

  return cityConfig?.label || "Staden";
}

function buildStaticShellI18nReplacements(lang) {
  const tr = (key, fallback = "") => escapeHtml(translate(lang, key, {}, fallback));

  return {
    "__PARRANDA_I18N_PLANNER_EYEBROW__": tr("shell.plannerEyebrow"),
    "__PARRANDA_I18N_MARKER_BASE__": tr("shell.markerBase"),
    "__PARRANDA_I18N_MARKER_TEMPO__": tr("shell.markerTempo"),
    "__PARRANDA_I18N_MARKER_MOOD__": tr("shell.markerMood"),
    "__PARRANDA_I18N_MANUAL_BUTTON__": tr("shell.manualButton"),
    "__PARRANDA_I18N_RESTORE_LABEL__": tr("shell.restoreLabel"),
    "__PARRANDA_I18N_RESTORE_BUTTON__": tr("shell.restoreButton"),
    "__PARRANDA_I18N_RESTORE_DISMISS__": tr("shell.restoreDismiss"),
    "__PARRANDA_I18N_BLITZ_ARIA__": tr("shell.blitzAria"),
    "__PARRANDA_I18N_SELECTED_PLACE__": tr("shell.originSelected"),
    "__PARRANDA_I18N_MY_LOCATION__": tr("shell.originCurrent"),
    "__PARRANDA_I18N_BLITZ_APPLY__": tr("shell.blitzApply"),
    "__PARRANDA_I18N_BLITZ_SHUFFLE__": tr("shell.blitzShuffle"),
    "__PARRANDA_I18N_INSTALL_APP__": tr("shell.installApp"),
    "__PARRANDA_I18N_TAB_NAV_ARIA__": tr("shell.tabNavAria"),
    "__PARRANDA_I18N_TAB_DISTRICTS__": tr("shell.tabDistricts"),
    "__PARRANDA_I18N_TAB_MAP__": tr("shell.tabMap"),
    "__PARRANDA_I18N_PULSE_TEASER_LIVE__": tr("shell.pulseTeaserLive"),
    "__PARRANDA_I18N_PULSE_TEASER_LABEL__": tr("shell.pulseTeaserLabel"),
    "__PARRANDA_I18N_PULSE_TEASER_TITLE__": tr("shell.pulseTeaserTitle"),
    "__PARRANDA_I18N_PULSE_TEASER_SUMMARY__": tr("shell.pulseTeaserSummary"),
    "__PARRANDA_I18N_PULSE_TEASER_BUTTON__": tr("shell.pulseTeaserButton"),
    "__PARRANDA_I18N_PLANNER_MODAL_EYEBROW__": tr("planner.modalEyebrow"),
    "__PARRANDA_I18N_PLANNER_MODAL_TITLE__": tr("planner.modalTitle"),
    "__PARRANDA_I18N_PLANNER_MODAL_LEAD__": tr("planner.modalLead"),
    "__PARRANDA_I18N_PLANNER_MODE_ARIA__": tr("planner.modeAria"),
    "__PARRANDA_I18N_PLANNER_MODE_AUTO__": tr("planner.modeAutoButton"),
    "__PARRANDA_I18N_PLANNER_MODE_MANUAL__": tr("planner.modeManualButton"),
    "__PARRANDA_I18N_PLANNER_MODE_LEAD__": tr("planner.modeAutoLead"),
    "__PARRANDA_I18N_CLOSE__": tr("planner.close"),
    "__PARRANDA_I18N_ESSENTIALS_EYEBROW__": tr("planner.essentialsEyebrow"),
    "__PARRANDA_I18N_AUTO_CHIP__": tr("planner.autoChip"),
    "__PARRANDA_I18N_ESSENTIALS_COPY__": tr("planner.essentialsCopy"),
    "__PARRANDA_I18N_DAY_CHOICE_EYEBROW__": tr("planner.dayChoiceEyebrow"),
    "__PARRANDA_I18N_DAY_CHOICE_TITLE__": tr("planner.dayChoiceTitle"),
    "__PARRANDA_I18N_DAY_CHOICE_ARIA__": tr("planner.dayChoiceAria"),
    "__PARRANDA_I18N_DAY_PRESET_TODAY__": tr("planner.dayPresetToday"),
    "__PARRANDA_I18N_DAY_PRESET_TOMORROW__": tr("planner.dayPresetTomorrow"),
    "__PARRANDA_I18N_DAY_PICK_DATE__": tr("planner.dayPickDate"),
    "__PARRANDA_I18N_ADD_ANOTHER_DAY__": tr("planner.addAnotherDay"),
    "__PARRANDA_I18N_BACK_TO_ONE_DAY__": tr("planner.backToOneDay"),
    "__PARRANDA_I18N_FROM_DATE__": tr("planner.fromDate"),
    "__PARRANDA_I18N_TO_DATE__": tr("planner.toDate"),
    "__PARRANDA_I18N_DISTANCE__": tr("planner.distance"),
    "__PARRANDA_I18N_DISTANCE_APPROX__": tr("planner.distanceApprox"),
    "__PARRANDA_I18N_DISTANCE_FLEXIBLE__": tr("planner.distanceFlexible"),
    "__PARRANDA_I18N_WALKING_KM__": tr("planner.walkingKm"),
    "__PARRANDA_I18N_WALKING_KM_HELP__": tr("planner.walkingKmHelp"),
    "__PARRANDA_I18N_PREFERENCES_LABEL__": tr("planner.preferencesLabel"),
    "__PARRANDA_I18N_INTENT_FOOD_DRINK__": tr("planner.intent.food_drink"),
    "__PARRANDA_I18N_INTENT_CULTURE__": tr("planner.intent.culture"),
    "__PARRANDA_I18N_INTENT_SECOND_HAND__": tr("planner.intent.second_hand"),
    "__PARRANDA_I18N_INTENT_HIDDEN_GEMS__": tr("planner.intent.hidden_gems"),
    "__PARRANDA_I18N_INTENT_VIEWS__": tr("planner.intent.views"),
    "__PARRANDA_I18N_INTENT_NIGHTLIFE__": tr("planner.intent.nightlife"),
    "__PARRANDA_I18N_INTENT_HISTORY__": tr("planner.intent.history"),
    "__PARRANDA_I18N_INTENT_GREEN_WALK__": tr("planner.intent.green_walk"),
    "__PARRANDA_I18N_ADD_HOME_BASE__": tr("planner.addHomeBase"),
    "__PARRANDA_I18N_START_CONTEXT_EYEBROW__": tr("planner.startContextEyebrow"),
    "__PARRANDA_I18N_START_CONTEXT_TITLE__": tr("planner.startContextTitle"),
    "__PARRANDA_I18N_START_CONTEXT_COPY__": tr("planner.startContextCopy"),
    "__PARRANDA_I18N_START_CONTEXT_NOTE__": tr("planner.startContextNote"),
    "__PARRANDA_I18N_START_CONTEXT_ARIA__": tr("planner.startContextAria"),
    "__PARRANDA_I18N_START_CONTEXT_NEAR_ME__": tr("planner.startContextNearMe"),
    "__PARRANDA_I18N_START_CONTEXT_NEAR_ME_COPY__": tr("planner.startContextNearMeCopy"),
    "__PARRANDA_I18N_START_CONTEXT_STAYING__": tr("planner.startContextStaying"),
    "__PARRANDA_I18N_START_CONTEXT_STAYING_COPY__": tr("planner.startContextStayingCopy"),
    "__PARRANDA_I18N_START_CONTEXT_AUTO__": tr("planner.startContextAuto"),
    "__PARRANDA_I18N_START_CONTEXT_AUTO_COPY__": tr("planner.startContextAutoCopy"),
    "__PARRANDA_I18N_START_CONTEXT_FALLBACK__": tr("planner.startContextFallback"),
    "__PARRANDA_I18N_START_CONTEXT_MORE__": tr("planner.startContextMore"),
    "__PARRANDA_I18N_WHERE_STAYING_EYEBROW__": tr("planner.whereStayingEyebrow"),
    "__PARRANDA_I18N_WHERE_STAYING_COPY__": tr("planner.whereStayingCopy"),
    "__PARRANDA_I18N_OPTIONAL__": tr("planner.optional"),
    "__PARRANDA_I18N_HOTEL_OR_AREA__": tr("planner.hotelOrArea"),
    "__PARRANDA_I18N_CHOOSE__": tr("planner.choose"),
    "__PARRANDA_I18N_CHOOSE_AREA__": tr("planner.chooseArea"),
    "__PARRANDA_I18N_HOTEL_ADDRESS__": tr("planner.hotelAddress"),
    "__PARRANDA_I18N_HOME_BASE_AUTO_HINT__": tr("planner.homeBaseAutoHint"),
    "__PARRANDA_I18N_ENTER_HOTEL_ADDRESS_AREA__": tr("planner.enterHotelAddressArea"),
    "__PARRANDA_I18N_HOME_CUSTOM_PLACEHOLDER__": tr("planner.homeCustomPlaceholder"),
    "__PARRANDA_I18N_USE_MAP_PLACE__": tr("planner.useMapPlace"),
    "__PARRANDA_I18N_USE_MY_LOCATION__": tr("planner.useMyLocation"),
    "__PARRANDA_I18N_MANUAL_SECTION_EYEBROW__": tr("planner.manualSectionEyebrow"),
    "__PARRANDA_I18N_MANUAL_SECTION_COPY__": tr("planner.manualSectionCopy"),
    "__PARRANDA_I18N_ADVANCED_SUMMARY_AUTO__": tr("planner.advancedSummaryAuto"),
    "__PARRANDA_I18N_START_HERE__": tr("planner.startHere"),
    "__PARRANDA_I18N_END_HERE__": tr("planner.endHere"),
    "__PARRANDA_I18N_START_POINT__": tr("planner.startPoint"),
    "__PARRANDA_I18N_END_POINT__": tr("planner.endPoint"),
    "__PARRANDA_I18N_CUSTOM_PLACE__": tr("planner.customPlace"),
    "__PARRANDA_I18N_START_AUTO_HINT__": tr("planner.startAutoHint"),
    "__PARRANDA_I18N_END_AUTO_HINT__": tr("planner.endAutoHint"),
    "__PARRANDA_I18N_CHOOSE_START_AREA__": tr("planner.chooseStartArea"),
    "__PARRANDA_I18N_CHOOSE_END_AREA__": tr("planner.chooseEndArea"),
    "__PARRANDA_I18N_ENTER_START_PLACE__": tr("planner.enterStartPlace"),
    "__PARRANDA_I18N_ENTER_END_PLACE__": tr("planner.enterEndPlace"),
    "__PARRANDA_I18N_START_PLACEHOLDER__": tr("planner.startPlaceholder"),
    "__PARRANDA_I18N_END_PLACEHOLDER__": tr("planner.endPlaceholder"),
    "__PARRANDA_I18N_SET_MAP_PLACE_AS_END__": tr("planner.setMapPlaceAsEnd"),
    "__PARRANDA_I18N_PRICE_LEVEL__": tr("planner.priceLevel"),
    "__PARRANDA_I18N_BUDGET_STANDARD__": tr("planner.budgetStandard"),
    "__PARRANDA_I18N_BUDGET_SMART__": tr("planner.budgetSmart"),
    "__PARRANDA_I18N_BUDGET_PREMIUM__": tr("planner.budgetPremium"),
    "__PARRANDA_I18N_MAX_WALK__": tr("planner.maxWalkBetweenStops"),
    "__PARRANDA_I18N_LEG_SHORT__": tr("planner.legShort"),
    "__PARRANDA_I18N_LEG_BALANCED__": tr("planner.legBalanced"),
    "__PARRANDA_I18N_LEG_FLEXIBLE__": tr("planner.legFlexible"),
    "__PARRANDA_I18N_LEG_BALANCED_HINT__": tr("planner.legBalancedHint"),
    "__PARRANDA_I18N_PLAN_MY_DAY__": tr("planner.planMyDay"),
    "__PARRANDA_I18N_RESET_CHOICES__": tr("planner.resetChoices"),
    "__PARRANDA_I18N_FALLBACK_NOTE__": tr("shell.routeFallbackNote"),
    "__PARRANDA_I18N_PULSE_NOW__": tr("pulse.firstPaintNow"),
    "__PARRANDA_I18N_PULSE_CURRENT__": tr("pulse.firstPaintCurrent"),
    "__PARRANDA_I18N_PULSE_TITLE__": tr("pulse.firstPaintTitle"),
    "__PARRANDA_I18N_PULSE_SUMMARY__": tr("pulse.firstPaintSummary"),
    "__PARRANDA_I18N_PULSE_EDITION__": tr("pulse.firstPaintEdition"),
    "__PARRANDA_I18N_PULSE_DATE__": tr("pulse.firstPaintDate"),
    "__PARRANDA_I18N_PULSE_SIGNALS__": tr("pulse.firstPaintSignals"),
    "__PARRANDA_I18N_PULSE_WEATHER__": tr("pulse.firstPaintWeather"),
    "__PARRANDA_I18N_PULSE_WEATHER_LOADING__": tr("pulse.firstPaintWeatherLoading"),
    "__PARRANDA_I18N_PULSE_CLOTHING__": tr("pulse.firstPaintClothing"),
    "__PARRANDA_I18N_PULSE_CLOTHING_COPY__": tr("pulse.firstPaintClothingCopy"),
    "__PARRANDA_I18N_PULSE_WHERE__": tr("pulse.firstPaintWhere"),
    "__PARRANDA_I18N_PULSE_WHEN__": tr("pulse.firstPaintWhen"),
    "__PARRANDA_I18N_PULSE_LEVEL__": tr("pulse.firstPaintLevel"),
    "__PARRANDA_I18N_PULSE_TIMELINE__": tr("pulse.firstPaintTimeline"),
    "__PARRANDA_I18N_PULSE_TIMELINE_LOADING__": tr("pulse.firstPaintTimelineLoading"),
    "__PARRANDA_I18N_PULSE_UTILITY__": tr("pulse.firstPaintUtility"),
    "__PARRANDA_I18N_PULSE_SOURCE_STATUS_FALLBACK__": tr("pulse.sourceStatusFallback"),
    "__PARRANDA_I18N_ROUTE_MAIN_BADGE__": tr("route.mainBadge"),
    "__PARRANDA_I18N_ROUTE_ORDER__": tr("route.routeOrder"),
    "__PARRANDA_I18N_ROUTE_LIVE_THAT_FITS__": tr("route.liveThatFits"),
    "__PARRANDA_I18N_ROUTE_SHOW_ALTERNATIVES__": tr("route.showAlternatives"),
    "__PARRANDA_I18N_ROUTE_OTHER_WAYS__": tr("route.otherWays"),
    "__PARRANDA_I18N_ROUTE_YOUR_DAY__": tr("route.yourDay"),
    "__PARRANDA_I18N_ROUTE_HIDDEN_MENTIONS__": tr("route.hiddenMentions"),
    "__PARRANDA_I18N_ROUTE_BAR_MENTIONS__": tr("route.barMentions"),
    "__PARRANDA_I18N_ROUTE_SEE_GUIDE__": tr("route.seeGuide"),
    "__PARRANDA_I18N_ROUTE_SHOW_IN_APP__": tr("route.showInApp"),
    "__PARRANDA_I18N_ROUTE_CLEAN_GUIDE__": tr("route.cleanGuide"),
    "__PARRANDA_I18N_ROUTE_OPEN_TODAY__": tr("route.openToday"),
    "__PARRANDA_I18N_ROUTE_GUIDE__": tr("route.guide"),
    "__PARRANDA_I18N_ROUTE_WHY_CHOSEN__": tr("route.whyChosen"),
    "__PARRANDA_I18N_ROUTE_MAIN__": tr("route.main"),
    "__PARRANDA_I18N_ROUTE_SAVE_PDF__": tr("route.savePdf"),
    "__PARRANDA_I18N_ROUTE_SHARE_GUIDE__": tr("route.shareGuide"),
    "__PARRANDA_I18N_ROUTE_OPEN_WALKING__": tr("route.openWalking"),
    "__PARRANDA_I18N_PLACE_INFO__": tr("place.info"),
    "__PARRANDA_I18N_PLACE_SHOW_ON_MAP__": tr("place.showOnMap"),
    "__PARRANDA_I18N_PLACE_SET_START__": tr("place.setStart"),
    "__PARRANDA_I18N_PLACE_SET_END__": tr("place.setEnd"),
    "__PARRANDA_I18N_PLACE_PLAN_FROM_HERE__": tr("place.planFromHere"),
    "__PARRANDA_I18N_PLACE_GOOGLE_INFO__": tr("place.googleInfo"),
    "__PARRANDA_I18N_PLACE_EXTRA_LINK__": tr("place.extraLink"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL1_EYEBROW__": tr("overview.manifesto.col1.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL1_TITLE__": tr("overview.manifesto.col1.title"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL1_BODY__": tr("overview.manifesto.col1.body"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL2_EYEBROW__": tr("overview.manifesto.col2.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL2_TITLE__": tr("overview.manifesto.col2.title"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL2_BODY__": tr("overview.manifesto.col2.body"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL3_EYEBROW__": tr("overview.manifesto.col3.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL3_TITLE__": tr("overview.manifesto.col3.title"),
    "__PARRANDA_I18N_OVERVIEW_MANIFESTO_COL3_BODY__": tr("overview.manifesto.col3.body"),
    "__PARRANDA_I18N_OVERVIEW_SPOTLIGHT_EYEBROW__": tr("overview.spotlight.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_SPOTLIGHT_TITLE__": tr("overview.spotlight.title"),
    "__PARRANDA_I18N_OVERVIEW_SPOTLIGHT_NOTE__": tr("overview.spotlight.note"),
    "__PARRANDA_I18N_OVERVIEW_FAVORITES_EYEBROW__": tr("overview.favorites.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_FAVORITES_TITLE__": tr("overview.favorites.title"),
    "__PARRANDA_I18N_OVERVIEW_FAVORITES_BODY__": tr("overview.favorites.body"),
    "__PARRANDA_I18N_OVERVIEW_FAVORITES_SHOW_SAVED__": tr("overview.favorites.showSaved"),
    "__PARRANDA_I18N_OVERVIEW_FAVORITES_SHOW_ALL__": tr("overview.favorites.showAll"),
    "__PARRANDA_I18N_OVERVIEW_MAP_EYEBROW__": tr("overview.map.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_MAP_TITLE__": tr("overview.map.title"),
    "__PARRANDA_I18N_OVERVIEW_MAP_NOTE__": tr("overview.map.note"),
    "__PARRANDA_I18N_OVERVIEW_MAP_ARIA_LABEL__": tr("overview.map.ariaLabel"),
    "__PARRANDA_I18N_OVERVIEW_MAP_SAVED_COUNT__": tr("overview.map.savedCount"),
    "__PARRANDA_I18N_OVERVIEW_MAP_PLACEHOLDER_NAME__": tr("overview.map.placeholderName"),
    "__PARRANDA_I18N_OVERVIEW_MAP_PLACEHOLDER_META__": tr("overview.map.placeholderMeta"),
    "__PARRANDA_I18N_OVERVIEW_MAP_PLACEHOLDER_DESCRIPTION__": tr("overview.map.placeholderDescription"),
    "__PARRANDA_I18N_OVERVIEW_MAP_PLACEHOLDER_NOTE__": tr("overview.map.placeholderNote"),
    "__PARRANDA_I18N_OVERVIEW_MAP_SAVE_BUTTON__": tr("overview.map.saveButton"),
    "__PARRANDA_I18N_OVERVIEW_MAP_OPEN_IN_MAPS__": tr("overview.map.openInMaps"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_ALL__": tr("overview.filters.all"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_HIDDEN_GEMS__": tr("overview.filters.hiddenGems"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_DISTRICTS__": tr("overview.filters.districts"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_FOOD__": tr("overview.filters.food"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_VIEWS__": tr("overview.filters.views"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_NIGHTLIFE__": tr("overview.filters.nightlife"),
    "__PARRANDA_I18N_OVERVIEW_FILTERS_CLASSICS__": tr("overview.filters.classics"),
    "__PARRANDA_I18N_OVERVIEW_PLACES_EYEBROW__": tr("overview.places.eyebrow"),
    "__PARRANDA_I18N_OVERVIEW_PLACES_TITLE__": tr("overview.places.title"),
    "__PARRANDA_I18N_OVERVIEW_PLACES_SEARCH_LABEL__": tr("overview.places.searchLabel"),
    "__PARRANDA_I18N_OVERVIEW_PLACES_SEARCH_PLACEHOLDER__": tr("overview.places.searchPlaceholder"),
    "__PARRANDA_I18N_DISTRICT_HERO_EYEBROW__": tr("district.hero.eyebrow"),
    "__PARRANDA_I18N_DISTRICT_HERO_TITLE__": tr("district.hero.title"),
    "__PARRANDA_I18N_DISTRICT_HERO_DESCRIPTION__": tr("district.hero.description"),
    "__PARRANDA_I18N_DISTRICT_SELECTOR_EYEBROW__": tr("district.selector.eyebrow"),
    "__PARRANDA_I18N_DISTRICT_SELECTOR_TITLE__": tr("district.selector.title"),
    "__PARRANDA_I18N_DISTRICT_SELECTOR_NOTE__": tr("district.selector.note"),
    "__PARRANDA_I18N_DISTRICT_STOPS_EYEBROW__": tr("district.stops.eyebrow"),
    "__PARRANDA_I18N_DISTRICT_STOPS_TITLE__": tr("district.stops.title"),
    "__PARRANDA_I18N_DISTRICT_STOPS_NOTE__": tr("district.stops.note"),
    "__PARRANDA_I18N_DISTRICT_DAY_EYEBROW__": tr("district.day.eyebrow"),
    "__PARRANDA_I18N_DISTRICT_DAY_TITLE__": tr("district.day.title"),
    "__PARRANDA_I18N_DISTRICT_DAY_NOTE__": tr("district.day.note"),
    "__PARRANDA_I18N_DISTRICT_CTA_EYEBROW__": tr("district.cta.eyebrow"),
    "__PARRANDA_I18N_DISTRICT_CTA_TITLE__": tr("district.cta.title"),
    "__PARRANDA_I18N_DISTRICT_CTA_BODY__": tr("district.cta.body"),
    "__PARRANDA_I18N_DISTRICT_CTA_SET_START__": tr("district.cta.setStart"),
    "__PARRANDA_I18N_DISTRICT_CTA_SET_END__": tr("district.cta.setEnd"),
    "__PARRANDA_I18N_DISTRICT_CTA_PLAN_FROM_HERE__": tr("district.cta.planFromHere"),
    "__PARRANDA_I18N_DISTRICT_CTA_SHOW_ON_MAP__": tr("district.cta.showOnMap"),
    "__PARRANDA_I18N_TEMPLATE_PLACECARD_MAPLINK__": tr("template.placeCard.mapLink"),
    "__PARRANDA_I18N_PLANNER_ARIA_HOTEL_OR_AREA__": tr("planner.ariaHotelOrArea"),
    "__PARRANDA_I18N_PLANNER_ARIA_START_AREA__": tr("planner.ariaStartArea"),
    "__PARRANDA_I18N_PLANNER_ARIA_END_AREA__": tr("planner.ariaEndArea"),
  };
}

const LANDING_PUBLIC_VISIBILITIES = ["public", "preview", "beta"];

function getLandingSearchCities() {
  return Object.values(cityConfigs).filter((cityConfig) => {
    const visibility = cityConfig.visibility || "public";
    return LANDING_PUBLIC_VISIBILITIES.includes(visibility);
  });
}

function buildLandingCityRegistry() {
  const entries = {};
  getLandingSearchCities().forEach((cityConfig) => {
    const entry = {
      key: cityConfig.key,
      label: cityConfig.label,
      status: cityConfig.visibility || "public",
      center: { lat: cityConfig.center.lat, lng: cityConfig.center.lng },
    };
    entries[cityConfig.key] = entry;
    entries[cityConfig.label.toLowerCase()] = entry;
    if (cityConfig.key === "rome") {
      entries["rome"] = entry;
      entries["roma"] = entry;
    }
    if (cityConfig.key === "barcelona") {
      entries["barcelone"] = entry;
    }
  });
  return entries;
}

function renderAnywhereV2Shell(html, { lang = "en" } = {}) {
  const uiLang = normalizeLanguage(lang);
  return String(html || "").replace(/<html\b([^>]*)>/i, (_match, attrs = "") => {
    const nextAttrs = /\blang\s*=/.test(attrs)
      ? attrs.replace(/\blang\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/i, `lang="${uiLang}"`)
      : `${attrs} lang="${uiLang}"`;
    return `<html${nextAttrs}>`;
  });
}

function isDogfoodUiEnabled(env) {
  const flag = String((env && env.PARRANDA_DOGFOOD_UI) ?? "").trim().toLowerCase();
  return flag === "enabled" || flag === "1" || flag === "true";
}

// RETIRED (2026-07-17, docs/FRONTEND_MIGRATION_CONTRACT.md "Retired surfaces"):
// the old server-rendered landing and the /labs/anywhere alpha shell are
// deleted after the promoted default (#350) soaked through #351–#370. The new
// frontend is the ONLY owner of GET / and /anywhere; the opt-out env flags
// (PARRANDA_NEW_LANDING / PARRANDA_NEW_ANYWHERE) are gone with the fallback
// they selected. Rollback is now `git revert`, not an env var. The committed
// frontend/dist makes the build always present; a deployment that somehow
// lacks it gets a loud 503, never a silently wrong page.

// Serve-time mutation of the prebuilt landing HTML: the request-time <html lang>
// (static output cannot read query params) and the CITY REGISTRY injected by
// replacing the QUOTED token (a city is data, never baked into the static build).
function renderLandingV2Shell(html, { lang, registryJson } = {}) {
  const uiLang = normalizeLanguage(lang);
  return String(html)
    .replace('<html lang="en">', `<html lang="${escapeHtml(uiLang)}">`)
    .split('"__PARRANDA_LANDING_REGISTRY__"')
    .join(registryJson || "{}");
}

function renderDogfoodShell({ lang = "en" } = {}) {
  const uiLang = normalizeLanguage(lang);
  const i18nBootstrap = buildClientI18nPayload();
  const tr = (key, fallback = "") => translate(uiLang, key, {}, fallback);
  const replacements = {
    "__PARRANDA_LANG__": escapeHtml(uiLang),
    "__PARRANDA_UI_LANG__": escapeHtml(uiLang),
    "__PARRANDA_I18N_BOOTSTRAP__": serializeInlineJson(i18nBootstrap),
    "__PARRANDA_DOGFOOD_TITLE__": escapeHtml(tr("dogfood.shellTitle", "Parranda · Agnostic route dogfood")),
    "__PARRANDA_DOGFOOD_BANNER_LABEL__": escapeHtml(tr("dogfood.banner.label", "Experimental")),
    "__PARRANDA_DOGFOOD_BANNER_TITLE__": escapeHtml(
      tr("dogfood.banner.title", "Experimental any-place route — not a finalized Parranda Planner day.")
    ),
    "__PARRANDA_DOGFOOD_BANNER_DETAIL__": escapeHtml(
      tr(
        "dogfood.banner.detail",
        "This page exercises the experimental agnostic route engine and uses trusted source-backed candidates. Results may fail closed; honest blockers will be shown."
      )
    ),
    "__PARRANDA_DOGFOOD_FORM_TITLE__": escapeHtml(tr("dogfood.form.title", "Try an any-place route")),
    "__PARRANDA_DOGFOOD_DISCLOSURE__": escapeHtml(
      tr(
        "dogfood.form.disclosure",
        "This dogfood uses trusted source-backed candidates and the experimental route engine. Provide a place name (if a resolver is configured) or explicit coordinates."
      )
    ),
    "__PARRANDA_DOGFOOD_INTAKE_LEGEND__": escapeHtml(tr("dogfood.form.intakeLegend", "Place or coordinates")),
    "__PARRANDA_DOGFOOD_PLACE_LABEL__": escapeHtml(tr("dogfood.form.placeLabel", "Place name (freeform)")),
    "__PARRANDA_DOGFOOD_PLACE_HINT__": escapeHtml(
      tr(
        "dogfood.form.placeHint",
        "Only used if the deploy has PARRANDA_PLACE_RESOLVER enabled; otherwise the request fails closed with place_resolver_unavailable."
      )
    ),
    "__PARRANDA_DOGFOOD_LAT_LABEL__": escapeHtml(tr("dogfood.form.latLabel", "Latitude")),
    "__PARRANDA_DOGFOOD_LNG_LABEL__": escapeHtml(tr("dogfood.form.lngLabel", "Longitude")),
    "__PARRANDA_DOGFOOD_DAY_LEGEND__": escapeHtml(tr("dogfood.form.dayLegend", "Day & intent")),
    "__PARRANDA_DOGFOOD_DATE_LABEL__": escapeHtml(tr("dogfood.form.dateLabel", "Date")),
    "__PARRANDA_DOGFOOD_PREFS_LABEL__": escapeHtml(tr("dogfood.form.prefsLabel", "Preferences")),
    "__PARRANDA_DOGFOOD_PREFS_HINT__": escapeHtml(
      tr("dogfood.form.prefsHint", "Comma-separated tokens, e.g. food, coffee, scenic.")
    ),
    "__PARRANDA_DOGFOOD_SUBMIT_LABEL__": escapeHtml(tr("dogfood.form.submitLabel", "Run experimental request")),
    "__PARRANDA_DOGFOOD_RESULT_TITLE__": escapeHtml(tr("dogfood.result.title", "Honest experimental result")),
    "__PARRANDA_DOGFOOD_FEEDBACK_LINK_LABEL__": escapeHtml(
      tr("dogfood.feedback.linkLabel", "Send feedback (ALPHA_FEEDBACK.md on GitHub)")
    ),
  };
  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.split(token).join(value),
    dogfoodShellTemplate,
  );
}

function renderAppShell({ cityConfig, requestedCity, cityFallbackUsed, lang = "en", plannerEntryRoute = false }) {
  const uiLang = normalizeLanguage(lang);
  const requestedLabel = cityFallbackUsed ? humanizeCityKey(requestedCity) : "";
  const displayLabel = resolveDisplayLabel(cityConfig, requestedLabel, uiLang);
  const searchLabel = requestedLabel || getCitySearchLabel(cityConfig);
  const shellMode = resolveShellMode(cityConfig, cityFallbackUsed);
  const shellCopy = buildShellCopy(shellMode, {
    cityConfig,
    displayLabel,
    lang: uiLang,
  });
  const meta = buildShellMeta(cityConfig, {
    displayLabel,
    searchLabel,
    shellMode,
    lang: uiLang,
  });
  const bootstrap = {
    key: cityConfig.key,
    label: cityConfig.label,
    displayLabel,
    visibility: cityConfig.visibility || "public",
    timezone: cityConfig.timezone,
    locale: cityConfig.locale,
    currency: cityConfig.currency,
    searchLabel,
    center: cityConfig.center || null,
    plannerAreas: buildPlannerAreas(cityConfig),
    requestedKey: requestedCity,
    fallbackUsed: cityFallbackUsed,
    plannerEntryRoute,
    lang: uiLang,
    previewSurface: cityConfig.previewSurface || null,
  };
  const i18nBootstrap = buildClientI18nPayload();

  const replacements = {
    "__PARRANDA_LANG__": escapeHtml(uiLang),
    "__PARRANDA_UI_LANG__": escapeHtml(uiLang),
    "__PARRANDA_I18N_BOOTSTRAP__": serializeInlineJson(i18nBootstrap),
    "__PARRANDA_OG_LOCALE__": uiLang === "en" ? "en_US" : "sv_SE",
    "__PARRANDA_TITLE__": escapeHtml(meta.title),
    "__PARRANDA_META_DESCRIPTION__": escapeHtml(meta.metaDescription),
    "__PARRANDA_OG_TITLE__": escapeHtml(meta.ogTitle),
    "__PARRANDA_OG_DESCRIPTION__": escapeHtml(meta.ogDescription),
    "__PARRANDA_TWITTER_TITLE__": escapeHtml(meta.twitterTitle),
    "__PARRANDA_TWITTER_DESCRIPTION__": escapeHtml(meta.twitterDescription),
    "__PARRANDA_CITY_KEY__": escapeHtml(cityConfig.key),
    "__PARRANDA_CITY_LABEL__": escapeHtml(displayLabel),
    "__PARRANDA_CITY_MAP_URL__": escapeHtml(meta.cityMapUrl),
    "__PARRANDA_BRAND_SUBTITLE__": escapeHtml(shellCopy.brandSubtitle),
    "__PARRANDA_CITY_EYEBROW__": escapeHtml(shellCopy.eyebrow),
    "__PARRANDA_HERO_HEADLINE__": escapeHtml(shellCopy.heroHeadline),
    "__PARRANDA_HERO_LEAD__": escapeHtml(shellCopy.heroLead),
    "__PARRANDA_HERO_LIVE_LABEL__": escapeHtml(shellCopy.heroLiveLabel),
    "__PARRANDA_PLANNER_TITLE__": escapeHtml(shellCopy.plannerTitle),
    "__PARRANDA_PLANNER_SUMMARY__": escapeHtml(shellCopy.plannerSummary),
    "__PARRANDA_PLANNER_CTA_LABEL__": escapeHtml(shellCopy.plannerCtaLabel),
    "__PARRANDA_PLANNER_MICROCOPY__": escapeHtml(shellCopy.plannerMicrocopy),
    "__PARRANDA_WILDCARD_LABEL__": escapeHtml(shellCopy.wildcardLabel),
    "__PARRANDA_WILDCARD_TITLE__": escapeHtml(shellCopy.wildcardTitle),
    "__PARRANDA_WILDCARD_SUMMARY__": escapeHtml(shellCopy.wildcardSummary),
    "__PARRANDA_WILDCARD_META__": escapeHtml(shellCopy.wildcardMeta),
    "__PARRANDA_WILDCARD_TAG_1__": escapeHtml(shellCopy.wildcardTag1),
    "__PARRANDA_WILDCARD_TAG_2__": escapeHtml(shellCopy.wildcardTag2),
    "__PARRANDA_WILDCARD_TAG_3__": escapeHtml(shellCopy.wildcardTag3),
    "__PARRANDA_WILDCARD_ACTIONS_HIDDEN__": shellCopy.wildcardActionsHidden,
    "__PARRANDA_CITY_BOOTSTRAP__": serializeInlineJson(bootstrap),
    ...buildStaticShellI18nReplacements(uiLang),
  };

  const renderedShell = Object.entries(replacements).reduce(
    (html, [token, replacement]) => html.split(token).join(replacement),
    appShellTemplate,
  );

  return renderedShell;
}

function servePublicRootAsset(request, response, next) {
  const assetName = path.basename(request.path);

  if (!publicRootFiles.has(assetName) || request.path !== `/${assetName}`) {
    next();
    return;
  }

  // Use an explicit root instead of an absolute path. Express 5 treats any
  // dot-prefixed parent segment as a hidden file, so an otherwise valid
  // checkout such as ~/.parranda would make every allowlisted asset 404.
  response.sendFile(assetName, { root: appRoot });
}

function blockPrivateRepoPaths(request, response, next) {
  if (
    blockedPublicRootFiles.has(request.path) ||
    blockedPublicPrefixes.some((prefix) => request.path.startsWith(prefix))
  ) {
    response.status(404).send("Not found");
    return;
  }

  next();
}

/**
 * @param {object} [options]
 * @param {Function|null} [options.openDataLoader]  Trusted server-side loader
 *   from createOpenDataLoader (#237). Injectable in tests. Defaults to the
 *   env-gated loader (`PARRANDA_OPEN_DATA_LOADER=enabled`) so production opts
 *   in explicitly and tests stay deterministic. NEVER reachable from the
 *   public request payload.
 */
function buildApp({
  openDataLoader = resolveDefaultOpenDataLoader(),
  placeResolver = resolveDefaultPlaceResolver(),
  eventSupply,
  sourceCatalog,
  walkingRouter = null,
  walkingConfig = null,
  weatherProvider = null,
  clock = null,
  // NEW-frontend /anywhere takeover (contract-gated): the flag decides serving,
  // the dir is injectable for deterministic tests. Both default to production
  // values (env flag + the frontend workspace's build output).
  anywhereV2Dir = path.join(appRoot, "frontend", "dist"),
} = {}) {
  // Event venue recovery reuses the same trusted, rate-limited server resolver
  // as freeform place intake. Explicit test injections still win, including
  // `null`; no public payload can provide either seam.
  if (eventSupply === undefined) {
    if (sourceCatalog === undefined) {
      sourceCatalog = resolveDefaultSourceProfileCatalog(process.env);
    }
    eventSupply = resolveDefaultEventSupply(process.env, {
      venueResolver: placeResolver,
      sourceCatalog,
    });
  }
  const app = express();

  app.use(express.json());
  // Inbound half of the politeness contract Parranda already keeps outbound.
  // On a public URL an unbounded inbound side would turn one crawler into
  // thousands of distinct upstream lookups and get the operator's IP banned
  // from the open data the whole app depends on. On by default, generous
  // enough that a person planning days never notices it.
  app.use(createPublicAccessGuard({ env: process.env }));
  // GET / — the new frontend IS the landing (sole owner since the old shell was
  // retired). The committed frontend/dist makes the build always present; if a
  // deployment somehow lacks it, fail LOUDLY — never a silently wrong page.
  const landingV2Html = path.join(anywhereV2Dir, "index.html");
  app.get(["/", "/index.html"], (request, response) => {
    if (!fs.existsSync(landingV2Html)) {
      response.status(503).type("text/plain").send("Frontend build missing (frontend/dist). Run: npm --prefix frontend run build");
      return;
    }
    response.type("html").send(
      renderLandingV2Shell(fs.readFileSync(landingV2Html, "utf8"), {
        lang: request.query?.lang,
        registryJson: serializeInlineJson(buildLandingCityRegistry()),
      }),
    );
  });

  // #264 — env-gated dogfood UI for the agnostic route experiment. Off by
  // default (any value other than enabled/1/true → 404); when on it serves an
  // experimental page that exercises POST /api/route-recommendations behind the
  // existing experiment flag. The page does NOT change /api/* behavior in any
  // way; it only adds a UI for the existing experimental output.
  app.get("/dogfood", (request, response) => {
    if (!isDogfoodUiEnabled(process.env)) {
      response.status(404).type("text/plain").send("Not found");
      return;
    }
    response.type("html").send(
      renderDogfoodShell({ lang: normalizeLanguage(request.query?.lang) })
    );
  });

  // /anywhere — the new frontend's any-city planner, sole owner since the alpha
  // shell was retired. Missing build → loud 503 (never the city-shell catch-all
  // masquerading as the planner).
  const anywhereV2Html = path.join(anywhereV2Dir, "anywhere", "index.html");

  // /labs/anywhere — the retired alpha doorway's URL. Old links keep working:
  // one canonical surface, unconditional redirect with the inputs preserved.
  app.get("/labs/anywhere", (request, response) => {
    const place = typeof request.query?.place === "string" ? request.query.place : "";
    const params = new URLSearchParams();
    if (place) params.set("place", place);
    if (String(request.query?.planner || "") === "open") params.set("planner", "open");
    params.set("lang", normalizeLanguage(request.query?.lang));
    response.redirect(302, `/anywhere?${params.toString()}`);
  });
  app.get("/anywhere", (request, response) => {
    if (!fs.existsSync(anywhereV2Html)) {
      response.status(503).type("text/plain").send("Frontend build missing (frontend/dist). Run: npm --prefix frontend run build");
      return;
    }
    response.type("html").send(
      renderAnywhereV2Shell(fs.readFileSync(anywhereV2Html, "utf8"), {
        lang: request.query?.lang,
      }),
    );
  });
  app.use("/_astro", express.static(path.join(anywhereV2Dir, "_astro"), { index: false, dotfiles: "ignore" }));

  app.get([...publicRootFiles].map((assetName) => `/${assetName}`), servePublicRootAsset);
  app.use("/assets", express.static(path.join(appRoot, "assets"), { index: false, dotfiles: "ignore" }));
  app.use("/vendor", express.static(path.join(appRoot, "vendor"), { index: false, dotfiles: "ignore" }));

  app.get("/api/health", (_request, response) => {
    const rawBuildSha = process.env.PARRANDA_BUILD_SHA || process.env.RENDER_GIT_COMMIT || "";
    const buildSha = /^[0-9a-f]{7,40}$/i.test(String(rawBuildSha).trim())
      ? String(rawBuildSha).trim()
      : null;
    response.json({
      ok: true,
      runtime_profile: process.env.PARRANDA_RUNTIME_PROFILE || "default",
      build_sha: buildSha,
    });
  });

  // A shared link is public infrastructure the moment it exists. Crawlers that
  // index it would fan out into distinct upstream lookups on every request —
  // exactly the traffic Nominatim/Overpass ask clients not to generate.
  app.get("/robots.txt", (_request, response) => {
    response.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  // Candidate Intelligence Spine — read-only inspect/debug projection.
  // Runs the spine (evidence → reducer → gates → fit shape) over the city's
  // existing place candidates. Debug-only; changes no user-facing output.
  // Gated like /dogfood: it exposes internal engine shape and raw error detail,
  // which a shared public link has no business serving to strangers.
  app.get("/api/candidate-inspect", (request, response) => {
    if (!isDogfoodUiEnabled(process.env)) {
      response.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
      const now = String(request.query.date || "").trim() || cityConfig.todayIsoDate();
      const limitRaw = Number.parseInt(request.query.limit, 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;
      response.json({
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        ...buildCandidateIntelligenceInspect(cityConfig, { now, limit }),
      });
    } catch (error) {
      response.status(500).json({
        error: "Candidate inspect failed",
        detail: error.message,
      });
    }
  });

  app.get("/api/places/search", (request, response) => {
    const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
    const { allItems } = cityConfig.catalog;
    const query = String(request.query.q || "").trim().toLowerCase();
    const items = allItems
      .filter((item) => !item.structuralRouteAnchor)
      .filter((item) => {
        if (!query) {
          return true;
        }

        return (
          item.name.toLowerCase().includes(query) ||
          item.searchTerms.some((term) => term.toLowerCase().includes(query)) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      })
      .slice(0, query ? 20 : 30)
      .map((item) => ({
        id: item.id,
        label: item.name,
        type: item.kind,
        area: item.area,
        lat: item.lat,
        lng: item.lng,
        tags: item.tags,
        vibe: item.vibe,
        price_level: item.priceLevel,
      }));

    response.json({
      city: cityConfig.key,
      requested_city: requestedCity,
      city_fallback_used: cityFallbackUsed,
      items,
    });
  });

  app.get("/api/place-details", (request, response) => {
    const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
    const { allItems, findItemByName } = cityConfig.catalog;
    const query = String(request.query.q || request.query.id || "").trim();

    if (!query) {
      response.status(400).json({ error: "Missing query" });
      return;
    }

    const found =
      findItemByName(query) ||
      allItems.find((item) => item.name.toLowerCase().includes(query.toLowerCase()));

    if (!found) {
      response.json({
        city: cityConfig.key,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        item: {
          id: `editorial-${query.toLowerCase().replace(/\s+/g, "-")}`,
          label: query,
          type: "editorial mention",
          area: cityConfig.editorialAreaLabel || cityConfig.label || "Rom",
          summary:
            "Det här är just nu en redaktionell mention i appen. Intern fullprofil saknas ännu, men du kan hoppa vidare till Google eller kartan.",
          vibe: "redaktionell bonusnotis",
          price_level: null,
          best_time: null,
          group_size: null,
          booking_required: false,
          opening_summary: null,
          long_description:
            "Vi har ännu inte byggt en full intern profil för den här mentionen, men den är med för att den hjälper dig att göra dagen bättre.",
          perfect_for: [],
          feature_notes: [],
          happy_hour_note: null,
          tags: [],
          external_search_url: buildExternalSearchUrl(query, cityConfig),
          external_map_url: buildExternalMapUrl(query, cityConfig),
        },
      });
      return;
    }

    response.json({
      city: cityConfig.key,
      requested_city: requestedCity,
      city_fallback_used: cityFallbackUsed,
      item: {
        id: found.id,
        label: found.name,
        type: found.kind,
        area: found.area,
        lat: found.lat,
        lng: found.lng,
        summary: found.vibe,
        vibe: found.vibe,
        price_level: found.priceLevel,
        best_time: found.bestTime,
        group_size: found.groupSize,
        booking_required: found.bookingRequired,
        opening_summary: found.openingSummary,
        long_description: found.longDescription,
        perfect_for: found.perfectFor,
        feature_notes: found.featureNotes,
        happy_hour_note: found.happyHourNote,
        tags: found.tags,
        external_search_url: buildExternalSearchUrl(found.name, cityConfig),
        external_map_url: buildExternalMapUrl(found.name, cityConfig),
      },
    });
  });

  app.get("/api/city-pulse", async (request, response) => {
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
      const uiLang = normalizeLanguage(request.query?.lang);
      const date = String(request.query.date || "").trim() || cityConfig.todayIsoDate();
      const inspectSources = String(request.query.inspect || "").trim() === "sources";

      // The engine produces the normalized signals[] stream + fetches
      // weather/events itself. We still call the city's legacy
      // getCityPulse to assemble the surface shell (headline, subhead,
      // moments, wildcards, items[]) so the existing UI keeps working
      // unchanged through one release. Frontend will prefer signals[]
      // when present and fall back to items[] otherwise.
      const [engineResult, legacyPulse] = await Promise.all([
        buildCityPulse(cityConfig, { date, lang: uiLang, inspectSources }),
        Promise.resolve()
          .then(() => cityConfig.services.getCityPulse(date, { lang: uiLang }))
          .catch(() => null),
      ]);

      const events = Array.isArray(engineResult.events) ? engineResult.events : [];
      const officialEvents = events.slice(0, 2);
      const legacyItems = Array.isArray(legacyPulse?.items) ? legacyPulse.items : [];

      // Append live-event items into the legacy items[] for compat: old
      // frontends read items[]; new frontends read signals[]. Both paths
      // stay populated for this release.
      const officialCompatItems = officialEvents
        .slice(0, 1)
        .map((event) => buildOfficialPulseItem(event, date, cityConfig, uiLang))
        .filter((item) => item.signal_quality?.displayable === true);

      // When the engine returns 0 signals, choose the right empty-state copy:
      // - Hard empty: noop city that is NOT a registered preview/active city.
      //   These are internal placeholders with no local layer at all.
      //   Use the headline/subhead from the noop getCityPulse.
      // - Soft empty: any city that has sources (catalog, live events, computed
      //   signals) but nothing stood out today — including preview cities like
      //   Barcelona that use noop editorial only because they lack city-specific
      //   editorial copy, not because they lack infrastructure.
      const isNoop = legacyPulse?._noop === true;
      const hasNoSignals = engineResult.signals.length === 0;
      const hasLocalInfrastructure = ["preview", "beta", "public"].includes(cityConfig?.visibility);
      const isHardEmpty = hasNoSignals && isNoop && !hasLocalInfrastructure;

      const emptyFallback =
        hasNoSignals && !isHardEmpty
          ? {
              headline: translate(uiLang, "pulse.emptySoftHeadline", { city: cityConfig.label }, cityConfig.label),
              subhead: translate(uiLang, "pulse.emptySoftSubhead", { city: cityConfig.label }, ""),
            }
          : {
              headline: legacyPulse?.headline || "",
              subhead: legacyPulse?.subhead || "",
            };

      const masthead = buildMasthead({
        signals: engineResult.signals,
        fallback: emptyFallback,
        lang: uiLang,
      });

      const softCopy = isNoop && hasLocalInfrastructure
        ? {
            headline: masthead.headline || translate(uiLang, "pulse.emptySoftHeadline", { city: cityConfig.label }, cityConfig.label),
            subhead: masthead.subhead || translate(uiLang, "pulse.emptySoftSubhead", { city: cityConfig.label }, ""),
          }
        : {};

      response.json({
        city: cityConfig.key,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        ...(legacyPulse || {}),
        ...softCopy,
        date,
        requested_at: engineResult.requested_at,
        timezone: engineResult.timezone,
        signals: engineResult.signals,
        masthead,
        items: [...legacyItems, ...officialCompatItems],
        official_events: officialEvents,
        weather: engineResult.weather || null,
        source_status: engineResult.source_status || [],
        source_status_summary: engineResult.source_status_summary || null,
        ...(inspectSources ? { source_provider_inspect: engineResult.source_provider_inspect || null } : {}),
      });
    } catch (error) {
      response.status(500).json({
        error: "City pulse failed",
        detail: error.message,
      });
    }
  });

  // Live exploration is an events-only query. Public coordinates define the
  // requested event scope, never a trusted place identity or a new day anchor.
  // Provider selection, normalization, fusion, gates and cache behavior remain
  // inside the trusted eventSupply seam used by route composition.
  app.post("/api/live-events", async (request, response) => {
    const eventsNow = clock && typeof clock.now === "function" ? clock.now() : new Date().toISOString();
    const result = await executeLiveEventQuery({ payload: request.body, eventSupply, now: eventsNow });
    response.status(result.status).json(result.body);
  });

  app.post("/api/geocode", async (request, response) => {
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const candidates = await cityConfig.services.geocodeQuery(request.body?.query || "");
      response.json({
        city: cityConfig.key,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        candidates,
      });
    } catch (error) {
      response.status(502).json({
        error: "Geocoding failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/route-recommendations", async (request, response) => {
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const city = cityConfig.key;
      const lang = normalizeLanguage(request.query?.lang);
      const preferences = Array.isArray(request.body?.preferences)
        ? request.body.preferences
        : [];
      const payload = {
        city,
        dates: Array.isArray(request.body?.dates) ? request.body.dates : [],
        homeBase: request.body?.home_base,
        start: request.body?.start,
        end: request.body?.end,
        walkingKmTarget: Number(request.body?.walking_km_target || 8),
        legPacing: request.body?.leg_pacing || "balanced",
        preferences,
        optimizerMode: request.body?.optimizer_mode || null,
        distanceMode: request.body?.distance_mode || "soft_target",
        budgetTier: request.body?.budget_tier || "standard",
        modifier: request.body?.modifier || null,
        lang,
        includeLiveEvents: Boolean(request.body?.include_live_events),
      };

      // #259 — the explicit experiment flag is the ONLY thing that may mutate or
      // synthesize route output. It is parsed independently of `inspect`. The
      // agnostic gate mirrors /api/blitz for ROUTE REPLACEMENT: valid coords +
      // no recognized citypack (unknown/fallback city, or no city sent at all).
      // Recognized citypacks do not enter the any-place replacement path; thin
      // registered cities may only receive source-backed supplemental fill below
      // when the explicit engine/external flags are present.
      const experimentRequested = isAgnosticRouteOutputExperimentRequested(request);
      const experimentCoords = parseBlitzCoordinates(request);
      // #260 — freeform place query, from the public `place` / `place_query` /
      // `location_query` fields ONLY. `city` is never treated as the place query.
      const placeQuery = parsePlaceQuery(request);
      const noRecognizedCity = !requestedCity || cityFallbackUsed;
      // The experiment engages on the flag + a non-citypack context. The trusted
      // coordinate anchor (explicit coords, else a resolved freeform place) is
      // determined below; failure to anchor returns honest blockers.
      const useAgnosticRouteExperiment = experimentRequested && noRecognizedCity;

      // Build the would-be BASELINE response as a value (not sent yet) so the
      // experiment can preserve it for comparison. When the flag is absent this
      // is returned verbatim — identical behavior to before #259.
      let baselineBody;
      if (cityFallbackUsed) {
        baselineBody = {
          city: requestedCity,
          days: [],
          resolved_home_base: null,
          resolved_start: null,
          resolved_end: null,
          requested_city: requestedCity,
          city_fallback_used: true,
          readiness: buildUnsupportedCityReadiness(requestedCity),
        };
      } else if (shouldReturnPreviewRouteNoop(cityConfig)) {
        baselineBody = {
          city,
          days: [],
          resolved_home_base: null,
          resolved_start: null,
          resolved_end: null,
          requested_city: requestedCity,
          city_fallback_used: cityFallbackUsed,
          readiness: classifyRuntimeReadiness(cityConfig, {
            requestedKey: requestedCity || city,
            fallbackUsed: cityFallbackUsed,
          }, { routedDayCount: 0 }),
        };
      } else {
        // Preview-beta engine activation. A PREVIEW citypack that is curated-THIN
        // auto-activates the engine-backed registered-city candidate fill WITHOUT
        // any manual query flags, so opening its planner is visibly richer when a
        // trusted loader has supply. Generic by construction — it keys on
        // visibility:"preview" + thin density, never a city name; Athens is just
        // the only preview city today. Rich citypacks (Rome / Barcelona-beta —
        // not preview, not thin) never qualify; other registered cities keep the
        // explicit-flag gate. The fill itself stays trust-safe: curated candidates
        // remain the higher-trust spine, source-backed records are supplemental
        // fill only, and the public payload can never inject candidates (the
        // loader is the server-injected `openDataLoader`).
        // The explicit-flag registered-city fill (#294 contract): gap-only fill
        // for any thin registered city when the three diagnostic flags are set.
        const flagGatedFill =
          experimentRequested &&
          isAgnosticEngineComposeRequested(request) &&
          isExternalCandidatesRequested(request);
        // Preview-beta auto-activation: a PREVIEW citypack that is curated-THIN
        // turns the registered-city fill ON with NO manual flags, and in DEPTH
        // mode (source-backed variety across roles, not just role gaps), so the
        // planner is visibly fuller. Generic — keys on visibility:"preview" +
        // thin density, never a city name (Athens is the only preview city
        // today). Excludes the flag path so #294's gap-only contract is
        // unchanged when the diagnostic flags are explicitly set. Rich citypacks
        // (Rome / Barcelona-beta) never qualify. Curated stays the higher-trust
        // spine; source-backed stops stay provisional; the public payload can
        // never inject candidates (the loader is server-injected).
        const previewBetaEngine =
          isPreviewCityConfig(cityConfig) &&
          !noRecognizedCity &&
          curatedDensityOf(cityConfig) === "thin" &&
          !flagGatedFill;
        const registeredCityFillEligible =
          !noRecognizedCity &&
          curatedDensityOf(cityConfig) === "thin" &&
          (previewBetaEngine || flagGatedFill);
        let generationCityConfig = cityConfig;
        let registeredCityFillSidecar = null;
        let previewBetaActive = false;
        let previewPreferenceCoverage = null;
        if (registeredCityFillEligible) {
          const roleOrigin = resolvePlannerRoleOrigin(cityConfig, request.body || {});
          const rolePayload = buildPlannerRolePayload(cityConfig, request, payload, roleOrigin);
          // Preview-beta auto-activation IMPLIES the source-backed reservoir, but
          // the request carries no explicit `include_external_candidates` flag — so
          // signal the external opt-in to the role selector here, otherwise the
          // trusted loader's candidates never reach the planner roles and the
          // loader fill is silently inert (only the citypack's own provisional
          // candidates would surface). The explicit-flag path already carries its
          // own opt-in. The loader is still the server-injected `openDataLoader`;
          // the public payload can never inject candidates.
          if (previewBetaEngine) {
            rolePayload.include_external_candidates = 1;
            rolePayload.candidate_sources = rolePayload.candidate_sources || "open";
          }
          const { helpers, sourceStatus } = await resolvePlannerRoleHelpers({
            externalRequested: true,
            openDataLoader,
            anchor: roleOrigin,
          });
          const fill = buildRegisteredCityCandidateFill({
            cityConfig,
            rolePayload,
            roleOrigin,
            helpers,
            sourceStatus,
            catalogDensity: "thin",
            // Preview-beta pulls source-backed DEPTH (variety across roles), not
            // only role-gap fill, so a thin preview city is visibly fuller.
            depth: previewBetaEngine,
          });
          generationCityConfig = fill.cityConfig || cityConfig;
          registeredCityFillSidecar = { registered_city_candidate_fill: fill.sidecar };
          previewBetaActive = previewBetaEngine;
          // Preference-driven composition: ask the shared candidate reservoir
          // which catalogue/source-backed candidates actually satisfy each
          // requested preference, and hand the route engine a per-id fit map so
          // stop SELECTION is preference-shaped (different preferences →
          // different `primary_route.main_stops`) instead of recycling the same
          // near-anchor cluster. Generic to preview-thin cities; source-fit is
          // the reservoir's verdict, not re-implemented here. Coverage surfaces
          // any preference nothing could satisfy, honestly, on the response.
          if (isPreviewCityConfig(generationCityConfig)) {
            const prefFit = buildPreviewPreferenceFit(generationCityConfig, {
              preferences: Array.isArray(payload.preferences) ? payload.preferences : [],
              origin: roleOrigin,
              date: Array.isArray(payload.dates) ? payload.dates[0] : payload.date || null,
            });
            if (prefFit.fitMap) {
              generationCityConfig = { ...generationCityConfig, __previewPreferenceFit: prefFit.fitMap };
            }
            if (Array.isArray(prefFit.coverage) && prefFit.coverage.length) {
              previewPreferenceCoverage = prefFit.coverage;
            }
          }
        }
        const result = diversifyRecommendationDays(await generateRecommendations({
          ...payload,
          ...(generationCityConfig !== cityConfig ? { cityConfigOverride: generationCityConfig } : {}),
        }));
        // Legacy inspect helpers operate on the selected city config and route
        // result. For a freeform/no-city request those values are only fallback
        // scaffolding, not evidence about the requested place. Never serialize
        // fallback-city diagnostics as if they described the agnostic anchor.
        const plannerInspectSidecar = !noRecognizedCity && isPlannerCandidateInspectRequested(request)
          ? await buildPlannerCandidateInspectSidecar({
              cityConfig: generationCityConfig,
              request,
              routePayload: payload,
              routeResult: result,
              openDataLoader,
            })
          : null;
        const routeOutputDiagnosticsSidecar = !noRecognizedCity && isRouteOutputInspectRequested(request)
          ? {
              route_output_diagnostics: buildRouteOutputDiagnostics({
                city,
                routeResult: result,
                includeAlternatives: true,
              }),
            }
          : null;
        const agnosticRouteCandidateSidecar = !noRecognizedCity && isAgnosticRouteCandidateInspectRequested(request)
          ? await buildAgnosticRouteCandidateSidecar({
              cityConfig: generationCityConfig,
              request,
              routePayload: payload,
              routeResult: result,
              openDataLoader,
            })
          : null;
        // Compact, honest preview-beta status on the route response. `active`
        // reflects whether source-backed stops actually reached the day (from the
        // loader fill OR the citypack's own provisional candidates the preview
        // engine now composes) — never a silent thin day. The field-test status
        // also names the remaining thin edges and keeps Pulse/Blitz boundaries
        // explicit until those lanes deliberately feed route composition.
        let previewEngineStatus = null;
        if (previewBetaActive) {
          previewEngineStatus = buildPreviewBetaEngineStatus({
            cityConfig,
            routeResult: result,
            fillSidecar: registeredCityFillSidecar,
          });
        }
        const previewPreferenceSidecar = previewPreferenceCoverage
          ? {
              preference_coverage: {
                entries: previewPreferenceCoverage,
                covered: previewPreferenceCoverage.filter((c) => c.status === "covered").map((c) => c.preference),
                partial: previewPreferenceCoverage.filter((c) => c.status === "partial").map((c) => c.preference),
                missing: previewPreferenceCoverage.filter((c) => c.status === "missing").map((c) => c.preference),
              },
            }
          : null;
        // Agnostic place STRUCTURE: derive the place's districts from the
        // candidate pool the route already has (curated catalog + loaded
        // source-backed), and compose a day ACROSS them for the requested
        // intents. Additive + fail-soft: a new `place_structure` field, never a
        // mutation of the route. Generic — any city with a candidate pool; pure
        // geometry + tag tallies, no citypack, no extra fetch. (Rendering this in
        // the UI + the unknown-city agnostic path are follow-ups; this surfaces
        // the intelligence on the response without touching default behaviour.)
        let placeStructureSidecar = null;
        try {
          const structureCandidates = [
            ...((generationCityConfig.catalog && generationCityConfig.catalog.allItems) || []),
            ...(generationCityConfig.sourceCandidates || []),
          ].filter((c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng));
          // Only a GENUINELY recognized city emits structure here. An unknown city
          // that fell back must NOT present the fallback city's catalogue as the
          // typed place — the agnostic path supplies the real anchor-derived
          // structure (or honest absence). Without this gate, a cold agnostic
          // loader leaks the fallback city's districts as if they were the place.
          if (!noRecognizedCity && structureCandidates.length >= 3) {
            const { composeDistrictDay } = require("./candidates/district-composition");
            const day = composeDistrictDay(structureCandidates, {
              intents: Array.isArray(payload.preferences) ? payload.preferences : [],
              maxAreas: 3,
            });
            if (day.structure.area_count > 0) {
              placeStructureSidecar = {
                place_structure: {
                  provenance: "recognized_city",
                  area_count: day.structure.area_count,
                  scattered_count: day.structure.scattered_count,
                  areas: day.structure.areas,
                  district_day: {
                    areas: day.areas,
                    legs: day.legs,
                    covered_intents: day.covered_intents,
                    missing_intents: day.missing_intents,
                  },
                },
              };
            }
          }
        } catch (_error) {
          placeStructureSidecar = null; // fail soft: structure never blocks a route
        }
        baselineBody = {
          ...result,
          requested_city: requestedCity,
          city_fallback_used: cityFallbackUsed,
          ...(previewEngineStatus ? { preview_engine: previewEngineStatus } : {}),
          ...(placeStructureSidecar || {}),
          ...(previewPreferenceSidecar || {}),
          ...(registeredCityFillSidecar || {}),
          ...(plannerInspectSidecar || {}),
          ...(routeOutputDiagnosticsSidecar || {}),
          ...(agnosticRouteCandidateSidecar || {}),
        };
      }

      if (!useAgnosticRouteExperiment) {
        response.json(baselineBody);
        return;
      }

      // #260 — resolve the TRUSTED coordinate anchor. Explicit valid coords win
      // (the resolver is never called); otherwise a freeform `place` query is
      // resolved through the server-injected `placeResolver`. The public payload
      // can supply only the query string — resolved coordinates/confidence/
      // provenance come solely from the trusted resolver. Any missing/invalid/
      // ambiguous/low-confidence outcome fails closed with an explicit blocker.
      const { anchor, intake, placeContext, spatialScope } = await resolveAgnosticIntake({
        coords: experimentCoords,
        placeQuery,
        placeResolver,
        placeLanguage: lang,
      });

      if (!anchor) {
        // No trusted anchor → no route. Place resolution alone never produces a
        // route; the baseline is returned unchanged with the intake blocker.
        const blockedExperiment = buildBlockedAgnosticRouteOutputExperiment({
          baselineResult: baselineBody,
          blocker: intake.blockers[0] || "missing_or_invalid_coordinates",
          sourceStatus: {
            status: "no_anchor",
            external_candidates_requested: isExternalCandidatesRequested(request),
            anchor: null,
          },
        });
        blockedExperiment.intake = intake;
        const publicResult = buildAgnosticPublicResult({
          result: baselineBody,
          routeApplied: false,
          requestedCity,
          cityFallbackUsed,
        });
        response.json({ ...publicResult, agnostic_route_output_experiment: blockedExperiment });
        return;
      }

      // ANY-CITY place STRUCTURE: for an unknown, citypack-less place, derive the
      // place's districts + compose a day across them from the SAME source-backed
      // candidates the agnostic route loads around the trusted anchor. This is the
      // generic arc — type any city → its real areas, a smart cross-district day,
      // honest about what it can't cover — with no citypack and no city-specific
      // code. Same `place_structure` field/shape as the recognized-city path, so a
      // UI renders one thing regardless of path. The loader is cache-backed (#312)
      // so this is a hit, not a second fetch. Additive + fail-soft: it never
      // mutates the route or the experiment verdict, and the promotion gate is
      // untouched (structure surfaces even while the synthesized route stays in the
      // diagnostic block, so the intelligence is visible before any deploy flip).
      let agnosticPlaceStructure = null;
      if (isExternalCandidatesRequested(request) && typeof openDataLoader === "function") {
        try {
          const records = await openDataLoader({
            ...anchor,
            requestedIntents: Array.isArray(preferences) ? preferences : [],
            anchorMode: intake.mode,
            spatialScope,
            walkingTargetBand: resolveAgnosticWalkingTargetBand(payload.walkingKmTarget),
          });
          const structureCandidates = (Array.isArray(records) ? records : []).filter(
            (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng),
          );
          if (structureCandidates.length >= 3) {
            const { composeDistrictDay } = require("./candidates/district-composition");
            const day = composeDistrictDay(structureCandidates, {
              intents: Array.isArray(preferences) ? preferences : [],
              maxAreas: 3,
            });
            if (day.structure.area_count > 0) {
              agnosticPlaceStructure = {
                // Provenance: this structure was derived for the TRUSTED resolved
                // anchor of the freeform place — NOT a recognized-city baseline. The
                // any-place surface trusts only `agnostic_anchor` structure, so a
                // fallback city's structure can never be shown as the typed place.
                provenance: "agnostic_anchor",
                area_count: day.structure.area_count,
                scattered_count: day.structure.scattered_count,
                areas: day.structure.areas,
                district_day: {
                  areas: day.areas,
                  legs: day.legs,
                  covered_intents: day.covered_intents,
                  missing_intents: day.missing_intents,
                },
              };
            }
          }
        } catch (_error) {
          agnosticPlaceStructure = null; // fail soft: structure never blocks the route
        }
      }
      // (the place_structure sidecar is built below, AFTER live events are
      // collected, so a genuine tonight-event can be woven into the day)

      // ANY-PLACE LIVE EVENTS: what is happening near the trusted anchor tonight /
      // this week, from a bounded set of approved source families. Env-gated +
      // injectable (resolveDefaultEventSupply / buildApp). Additive + fail-soft +
      // NEVER required: an uncovered anchor returns honest absence and the route is
      // unaffected. Same generic shape regardless of place; the engine works
      // without any event provider.
      let liveEvents = null;
      if (typeof eventSupply === "function" && anchor) {
        try {
          const eventsNow = clock && typeof clock.now === "function" ? clock.now() : new Date().toISOString();
          const collected = await eventSupply({
            anchor,
            // Resolver-attested administrative identity is server-owned input
            // for future regional source discovery. Public payload context is
            // never read or forwarded.
            placeContext,
            placeLabel: intake?.resolved?.label || null,
            spatialScope,
            now: eventsNow,
            // Preferences may reorder only the already trusted, normalized
            // event pool. They never become event evidence or relax time/geo
            // gates inside the supply.
            preferences,
          });
          liveEvents = shapeCollectedLiveEvents(collected);
        } catch (_error) {
          liveEvents = null; // fail soft: live events never block the route
        }
      }
      const liveEventsSidecar = liveEvents ? { live_events: liveEvents } : {};

      // EVENTS INTO THE DAY: materialize and weave the top genuine event for the
      // SELECTED route date into the composed day as an honest EVENING ANCHOR.
      // Pulse remains free to show broader live discovery; route composition may
      // use only a verified selected-day occurrence with real time + coordinates.
      // Additive + fail-soft: no suitable event → the day is unchanged.
      let wovenPlaceStructure = agnosticPlaceStructure;
      try {
        const { weaveEveningEvent } = require("./candidates/evening-event-weave");
        const selectedRouteDate = resolveSelectedRouteDate(payload, baselineBody, cityConfig);
        wovenPlaceStructure = weaveEveningEvent(agnosticPlaceStructure, liveEvents, {
          selectedDate: selectedRouteDate,
        });
      } catch (_error) {
        wovenPlaceStructure = agnosticPlaceStructure;
      }
      const agnosticPlaceStructureSidecar = wovenPlaceStructure
        ? { place_structure: wovenPlaceStructure }
        : {};

      // Trusted anchor in hand → existing #259 route-output path. Place
      // resolution does NOT satisfy route eligibility on its own: external
      // candidate opt-in + the trusted server openDataLoader are still required
      // inside composeAgnosticRouteOutput. Public payload never becomes trusted.
      const useEngineCompose = isAgnosticEngineComposeRequested(request);
      const { result: experimentResult, experiment } = await composeAgnosticRouteOutput({
        coords: anchor,
        baselineResult: baselineBody,
        externalRequested: isExternalCandidatesRequested(request),
        openDataLoader,
        preferences,
        lens: request.body?.lens || request.query?.lens || null,
        // #262 — payload weather is NOT trusted; trusted weather/time come only
        // from the server-injected seams. `trustedTimezone` is taken from the
        // trusted resolver when present; otherwise agnostic context may derive a
        // lower-trust timezone from trusted weather-provider auto metadata.
        date: payload.dates[0] || null,
        todayIsoDate: cityConfig.todayIsoDate,
        timezone: cityConfig.timezone || "UTC",
        lang,
        walkingRouter,
        walkingConfig,
        walkingKmTarget: payload.walkingKmTarget,
        weatherProvider,
        clock,
        trustedTimezone: intake.resolved?.timezone || null,
        // ONLY the resolver-attested label may drive route prose. The raw public
        // placeQuery must never attest a place in Parranda's own voice — an
        // unresolved place (or explicit coords with no trusted label) falls back
        // to neutral "this place"/"platsen" inside the prose builder.
        placeLabel: intake.resolved?.label || null,
        anchorMode: intake.mode,
        spatialScope,
        synthesizeVia: useEngineCompose ? "engine" : "legacy",
      });
      experiment.intake = intake;

      // Promotion gate (engine-compose path only). The legacy path keeps its
      // prior behavior — the experiment route is always returned. On the engine
      // path, the synthesized route only REPLACES the baseline when calibration
      // clears the honest thin_usable/low bar with promotable caps and the anchor
      // resolved strongly (the intake already fails closed on weak resolves, so
      // this is a defensive re-check). Otherwise the baseline is returned and the
      // route stays in the diagnostic experiment block.
      if (useEngineCompose) {
        const strongAnchor =
          intake.resolved?.confidence === "explicit" ||
          ["high", "medium"].includes(String(intake.resolved?.confidence ?? "").toLowerCase());
        // Grading needs two things the calibration score cannot express: which
        // roles went unresolved, and which intents the user actually asked for.
        // A role nobody requested is breadth we did not reach; a requested one
        // is a question the day fails to answer.
        const promotion = classifyPromotionReadiness({
          calibration: experiment.readiness_calibration,
          strongAnchor,
          unresolvedRoles: experiment.experimental_route?.unresolved_roles,
          requestedIntents: normalizeUserIntents(preferences).intents,
          preferenceCoverage: experiment.constraint_negotiation?.preference_coverage,
        });
        experiment.promotion = promotion;
        // Retirement-readiness observability: a consolidated, honest verdict on
        // whether the engine path is ready to become the default synthesizer,
        // and if not, exactly what remains. Read-only; promotes nothing.
        experiment.engine_readiness = buildEngineReadinessVerdict(experiment);
        const publicResult = buildAgnosticPublicResult({
          result: promotion.promote ? experimentResult : baselineBody,
          routeApplied: promotion.promote,
          requestedCity,
          cityFallbackUsed,
        });
        const engineWoven = await weaveEventStopFailSoft({
          result: publicResult,
          placeStructure: wovenPlaceStructure,
          walkingRouter,
          walkingConfig,
        });
        reconcileConstraintAfterEventWeave({
          experiment,
          woven: engineWoven,
          walkingKmTarget: payload.walkingKmTarget,
        });
        response.json({
          ...engineWoven.result,
          ...(engineWoven.placeStructure ? { place_structure: engineWoven.placeStructure } : {}),
          ...(engineWoven.interrupt ? { pulse_route_interrupt: engineWoven.interrupt } : {}),
          ...liveEventsSidecar,
          agnostic_route_output_experiment: experiment,
        });
        return;
      }

      // Legacy path: surface the same verdict so a tester can see they are NOT
      // on the engine path (engine_path_active: false) — no behavior change.
      experiment.engine_readiness = buildEngineReadinessVerdict(experiment);
      const publicResult = buildAgnosticPublicResult({
        result: experimentResult,
        routeApplied: experiment.route_mutation === true,
        requestedCity,
        cityFallbackUsed,
      });
      const legacyWoven = await weaveEventStopFailSoft({
        result: publicResult,
        placeStructure: wovenPlaceStructure,
        walkingRouter,
        walkingConfig,
      });
      reconcileConstraintAfterEventWeave({
        experiment,
        woven: legacyWoven,
        walkingKmTarget: payload.walkingKmTarget,
      });
      response.json({
        ...legacyWoven.result,
        ...(legacyWoven.placeStructure ? { place_structure: legacyWoven.placeStructure } : {}),
        ...(legacyWoven.interrupt ? { pulse_route_interrupt: legacyWoven.interrupt } : {}),
        ...liveEventsSidecar,
        agnostic_route_output_experiment: experiment,
      });
    } catch (error) {
      response.status(500).json({
        error: "Route recommendation failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/blitz", async (request, response) => {
    try {
      const anywhereBlitzRaw =
        request.query?.anywhere_blitz ??
        request.query?.anywhereBlitz ??
        request.body?.anywhere_blitz ??
        request.body?.anywhereBlitz;
      const anywhereBlitzRequested = TRUTHY_INSPECT_FLAGS.has(anywhereBlitzRaw);
      if (anywhereBlitzRequested) {
        const lang = normalizeLanguage(request.query?.lang || request.body?.lang);
        const result = await buildAnywhereBlitzDecision({
          coords: parseBlitzCoordinates(request),
          placeQuery: parsePlaceQuery(request),
          placeResolver,
          openDataLoader,
          eventSupply,
          weatherProvider,
          clock,
          preferences: Array.isArray(request.body?.preferences) ? request.body.preferences : [],
          intentKeys: Array.isArray(request.body?.intent_keys) ? request.body.intent_keys : [],
          memory: request.body?.memory,
          lang,
        });
        response.json(result);
        return;
      }

      const { cityConfig: resolvedCity, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const lang = normalizeLanguage(request.query?.lang || request.body?.lang);

      // Agnostic coordinate intake (#236):
      //   When candidate_mode is on, valid coords are supplied, AND no
      //   recognized city was requested (no city sent OR an unknown city
      //   triggered fallback), synthesize a coordinates-only agnostic context
      //   so the candidate-spine path can run with curation_density="absent".
      //   Recognized cities keep their config; coords still feed `origin` for
      //   proximity. The agnostic context has an empty curated catalog, so
      //   without a trusted external loader (which the public payload cannot
      //   inject — see #234) this fails closed honestly.
      const candidateModeRaw =
        request.query?.candidate_mode ??
        request.query?.candidateMode ??
        request.body?.candidate_mode ??
        request.body?.candidateMode;
      const candidateModeRequested =
        String(candidateModeRaw ?? "").trim() !== "" ||
        candidateModeRaw === true ||
        candidateModeRaw === 1;
      const coords = parseBlitzCoordinates(request);
      const noRecognizedCity = !requestedCity || cityFallbackUsed;
      const useAgnostic = candidateModeRequested && coords && noRecognizedCity;
      const cityConfig = useAgnostic
        ? buildAgnosticCityContext({
            lat: coords.lat,
            lng: coords.lng,
            todayIsoDate: resolvedCity.todayIsoDate,
            timezone: resolvedCity.timezone || "UTC",
          })
        : resolvedCity;

      // When agnostic, surface coords as the origin so proximity/inspect remain
      // honest. Existing `origin` payload still wins if explicitly provided.
      const explicitOrigin = request.body?.origin || request.body?.selected_origin || request.body?.start || null;
      const effectiveOrigin = explicitOrigin || (useAgnostic ? { lat: coords.lat, lng: coords.lng } : null);

      const externalEnabled = isExternalCandidatesRequested(request);

      // Thin recognized-city augmentation (#241): a RECOGNIZED city (not the
      // agnostic path) that is curated-THIN may also pull trusted open-data
      // records to fill catalog gaps. Rich citypacks (Rome/Barcelona) are NOT
      // thin → they never auto-augment and stay curated-first. The records flow
      // through the same trusted external_provider channel; #235 keeps curated
      // ahead on comparable fit and #238/#239 dedupe+reconcile any twins.
      const recognizedCity = candidateModeRequested && externalEnabled && !useAgnostic && Boolean(requestedCity) && !cityFallbackUsed;
      // Preview/thin recognized city (e.g. Athens) WITHOUT manual flags: route the
      // editorial Blitz decision through the shared candidate spine (source-fit
      // ranking) and pull trusted source-backed supply, so source-backed
      // candidates can win when they better satisfy the intent — while the output
      // stays the editorial format the frontend renders. The candidate_mode flag
      // path is left to the candidate-spine output (unchanged); rich citypacks
      // never qualify.
      const previewSpineBlitz =
        !useAgnostic &&
        !candidateModeRequested &&
        Boolean(requestedCity) &&
        !cityFallbackUsed &&
        (isPreviewCityConfig(cityConfig) || curatedDensityOf(cityConfig) === "thin");
      const cityDensity = recognizedCity || previewSpineBlitz ? curatedDensityOf(cityConfig) : null;
      const augmentRecognized = (recognizedCity && cityDensity === "thin") || previewSpineBlitz;
      // Anchor the open-data query at the request coords if given, else the
      // recognized city's center.
      const cityCenter =
        cityConfig.center && Number.isFinite(cityConfig.center.lat) && Number.isFinite(cityConfig.center.lng)
          ? { lat: cityConfig.center.lat, lng: cityConfig.center.lng }
          : null;
      const loaderAnchor = useAgnostic ? coords : augmentRecognized ? coords || cityCenter : null;

      // Real open-data loader (#237/#241): fetch when EITHER the agnostic path
      // or a thin recognized-city augmentation applies, external candidates are
      // enabled, the server was built with a loader, and we have an anchor. The
      // public payload never reaches this; any fetch error fails closed.
      const shouldLoad = (useAgnostic || augmentRecognized) && (externalEnabled || previewSpineBlitz);
      let externalProviderExtras = null;
      let openDataLoaderStatus = "skipped";
      let openDataLoaderError = null;
      if (shouldLoad && typeof openDataLoader === "function" && loaderAnchor) {
        try {
          const records = await openDataLoader(loaderAnchor);
          const loaderStatus = typeof records?.loader_status === "string" ? records.loader_status : null;
          openDataLoaderError = records?.loader_error || null;
          if (Array.isArray(records) && records.length > 0 && loaderStatus !== "error_failed_closed") {
            externalProviderExtras = { external_provider: { dataset: records } };
            openDataLoaderStatus = `loaded:${records.length}`;
          } else if (loaderStatus === "error_failed_closed") {
            openDataLoaderStatus = "error_failed_closed";
          } else {
            openDataLoaderStatus = "loaded:0";
          }
        } catch (_error) {
          openDataLoaderStatus = "error_failed_closed";
          openDataLoaderError = "fetch_error";
        }
      } else if (shouldLoad) {
        openDataLoaderStatus = "no_loader_configured";
      }

      const result = await buildBlitzDecision(cityConfig, {
        date: request.body?.date,
        now: request.body?.now,
        origin: effectiveOrigin,
        mode: request.body?.mode || "auto",
        intent_keys: Array.isArray(request.body?.intent_keys) ? request.body.intent_keys : [],
        preferences: Array.isArray(request.body?.preferences) ? request.body.preferences : [],
        memory: request.body?.memory,
        previous_route: request.body?.previous_route,
        // Experimental, opt-in candidate-spine path (default Blitz unchanged
        // unless this flag is set). Accepts ?candidate_mode=1 / ?candidateMode=1
        // or the equivalent body fields (snake_case and camelCase both work).
        candidate_mode: candidateModeRaw,
        // Preview/thin recognized city: route the editorial Blitz decision
        // through the candidate spine (source-fit), no manual flag. Implies the
        // source-backed opt-in below so the spine sees the trusted supply.
        spine_ranking: previewSpineBlitz,
        // Nested opt-in: source-backed external/open candidates (consulted when
        // candidate_mode OR spine_ranking is on). ?include_external_candidates=1
        // or ?candidate_sources=open, or the equivalent body fields. snake_case
        // and camelCase are both accepted at the HTTP edge for parity with the
        // engine's isExternalCandidatesEnabled().
        include_external_candidates:
          request.query?.include_external_candidates ??
          request.query?.includeExternalCandidates ??
          request.body?.include_external_candidates ??
          request.body?.includeExternalCandidates ??
          (previewSpineBlitz ? 1 : undefined),
        candidate_sources:
          request.query?.candidate_sources ??
          request.query?.candidateSources ??
          request.body?.candidate_sources ??
          request.body?.candidateSources ??
          (previewSpineBlitz ? "open" : undefined),
        weather: request.body?.weather,
        lens: request.query?.lens ?? request.body?.lens,
        lang,
      },
      // Trusted server-side extras: pre-fetched open-data records (if any) reach
      // the candidate spine ONLY through this third argument — never the public
      // payload. Null when the loader was off/empty/errored (→ fails closed).
      externalProviderExtras || {});

      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        agnostic_context: useAgnostic
          ? {
              used: true,
              lat: coords.lat,
              lng: coords.lng,
              reason: requestedCity ? "city_fallback" : "no_city_requested",
              open_data_loader: openDataLoaderStatus,
              open_data_loader_error: openDataLoaderError,
            }
          : { used: false },
        // Thin recognized-city open-data augmentation status (#241). `used` is
        // true only when a recognized city was curated-thin and the loader path
        // ran; rich citypacks report used:false with reason "rich_citypack".
        open_data_augmentation: augmentRecognized
          ? {
              used: true,
              reason: "thin_recognized_city",
              catalog_density: cityDensity,
              anchor: loaderAnchor,
              open_data_loader: openDataLoaderStatus,
              open_data_loader_error: openDataLoaderError,
            }
          : { used: false, reason: recognizedCity ? `not_thin:${cityDensity}` : "not_applicable" },
      });
    } catch (error) {
      response.status(500).json({
        error: "Blitz failed",
        detail: error.message,
      });
    }
  });

  app.use(blockPrivateRepoPaths);

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    const pathSegments = String(request.path || "").split("/").filter(Boolean);
    const pathCityKey = pathSegments[0] || null;
    const cityResolution = resolveCityConfig(pathCityKey, { allowFallback: false });

    const isCityRoot = pathSegments.length === 1;
    const isPlannerEntry = pathSegments.length === 2 && pathSegments[1] === "plan";

    // The city-shell catch-all is only for explicitly supported registered
    // city routes. Unknown nested paths must never borrow a valid city shell
    // and masquerade as product pages or assets.
    if (!cityResolution.found || !cityResolution.cityConfig) {
      response.status(404).type("text/plain").send("Not found");
      return;
    }
    if (!isCityRoot && !isPlannerEntry) {
      response.status(404).type("text/plain").send("Not found");
      return;
    }

    const shellResolution = {
      cityConfig: cityResolution.cityConfig,
      requestedCity: cityResolution.requestedKey,
      cityFallbackUsed: false,
      lang: normalizeLanguage(request.query?.lang),
      plannerEntryRoute: isPlannerEntry,
    };
    response.type("html").send(renderAppShell(shellResolution));
  });

  return app;
}

module.exports = {
  buildApp,
  buildPlannerAreas,
  isDogfoodUiEnabled,
  resolveSelectedRouteDate,
};
