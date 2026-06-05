const fs = require("node:fs");
const express = require("express");
const path = require("path");
const { resolveCityConfig, cityConfigs } = require("./cities");
const { buildBlitzDecision } = require("./blitz-engine");
const { generateRecommendations } = require("./route-engine");
const {
  classifyRuntimeReadiness,
  buildUnsupportedCityReadiness,
} = require("./city-readiness/runtime-readiness");
const { diversifyRecommendationDays } = require("./route-diversity");
const { buildClientI18nPayload, normalizeLanguage, translate } = require("./ui-i18n");
const { buildCityPulse } = require("./pulse-engine");
const { buildCandidateIntelligenceInspect } = require("./candidates");
const { buildAgnosticCityContext } = require("./candidates/agnostic-context");
const { isExternalCandidatesEnabled } = require("./candidates/blitz-candidate-mode");
const { classifyCatalogDensity } = require("./candidates/source-calibration");
const { selectPlannerRoleCandidates } = require("./planner/role-selector");
const { summarizeDayflowHonesty } = require("./planner/dayflow-honesty");
const { buildCandidateCombinationInspect } = require("./planner/candidate-combination-inspect");
const { collectPlaceCandidatesForCity } = require("./place-candidates/provider-registry");
const { resolveDefaultOpenDataLoader } = require("./place-candidates/open-data-loader");
const { EXTERNAL_OPEN_PROVIDER_META } = require("./place-candidates/external-open-provider");
const { buildMasthead } = require("./pulse-engine/masthead");
const { classifySignalQuality } = require("./pulse-engine/signal-quality");
const {
  buildLiveEventEditorialPitch,
} = require("./pulse-engine/generators/live-events");

const appRoot = path.resolve(__dirname, "..");
const appShellTemplate = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const landingShellTemplate = fs.readFileSync(path.join(appRoot, "landing.html"), "utf8");
const publicRootFiles = new Set([
  "styles.css",
  "script.js",
  "ux-pass1.js",
  "planner-trust.js",
  "landing.js",
  "manifest.webmanifest",
  "sw.js",
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
    return classifyCatalogDensity(curatedRealPlaces);
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

function inspectListHas(value, token) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(token);
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

async function buildPlannerCandidateInspectSidecar({ cityConfig, request, routePayload, routeResult, openDataLoader }) {
  const roleOrigin = resolvePlannerRoleOrigin(cityConfig, request.body || {});
  const externalRequested = isExternalCandidatesRequested(request);
  const rolePayload = {
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

  const { helpers, sourceStatus } = await resolvePlannerRoleHelpers({
    externalRequested,
    openDataLoader,
    anchor: roleOrigin,
  });
  const plannerRoles = selectPlannerRoleCandidates(cityConfig, rolePayload, helpers);
  const dayflowHonesty = summarizeDayflowHonesty(plannerRoles);
  const candidateCombination = isCandidateCombinationInspectRequested(request)
    ? buildCandidateCombinationInspect({
        plannerRoles,
        dayflowHonesty,
        route: routeResult?.days?.[0]?.primary_route || null,
        options: { origin: roleOrigin },
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
    ...(candidateCombination ? { candidate_combination: candidateCombination } : {}),
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
    if (!Array.isArray(records) || records.length === 0) {
      return { helpers: {}, sourceStatus: { ...baseStatus, status: "loaded:0" } };
    }
    return {
      helpers: { external_provider: { dataset: records } },
      sourceStatus: { ...baseStatus, status: `loaded:${records.length}` },
    };
  } catch (_error) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "error_failed_closed" } };
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

function buildShellCopy(shellMode, options = {}) {
  const cityLabel = options.displayLabel || "Staden";
  const lang = normalizeLanguage(options.lang);
  const cityUpper = cityLabel.toLocaleUpperCase(lang === "en" ? "en-US" : "sv-SE");
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

  return {
    brandSubtitle: tr("brandSubtitle"),
    eyebrow: scope === "shell.curated" ? "" : tr("eyebrow"),
    heroHeadline: tr("heroHeadline"),
    heroLead: tr("heroLead"),
    heroLiveLabel: tr("heroLiveLabel"),
    plannerTitle: tr("plannerTitle"),
    plannerSummary: tr("plannerSummary"),
    plannerCtaLabel: tr("plannerCtaLabel"),
    plannerMicrocopy: tr("plannerMicrocopy"),
    wildcardLabel: tr("wildcardLabel"),
    wildcardTitle: tr("wildcardTitle"),
    wildcardSummary: tr("wildcardSummary"),
    wildcardMeta: tr("wildcardMeta"),
    wildcardTag1: tr("wildcardTag1"),
    wildcardTag2: tr("wildcardTag2"),
    wildcardTag3: tr("wildcardTag3"),
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

function renderLandingShell({ lang = "en" } = {}) {
  const uiLang = normalizeLanguage(lang);
  const ogLocale = uiLang === "en" ? "en_US" : "sv_SE";
  const tr = (key) => translate(uiLang, key);
  const langSuffix = `?lang=${uiLang}`;
  const tagsHtml = (key) =>
    tr(key).split(",").map((t) => `<span class="lp-tag">${escapeHtml(t.trim())}</span>`).join("\n              ");
  const replacements = {
    "__PARRANDA_LANG__": escapeHtml(uiLang),
    "__PARRANDA_UI_LANG__": escapeHtml(uiLang),
    "__PARRANDA_OG_LOCALE__": ogLocale,
    "__PARRANDA_LANDING_TITLE__": escapeHtml(tr("landing.title")),
    "__PARRANDA_LANDING_META_DESC__": escapeHtml(tr("landing.meta.description")),
    "__PARRANDA_LANDING_HEADLINE__": escapeHtml(tr("landing.hero.headline")),
    "__PARRANDA_LANDING_SUBCOPY__": escapeHtml(tr("landing.hero.subcopy")),
    "__PARRANDA_LANDING_SEARCH_PLACEHOLDER__": escapeHtml(tr("landing.search.placeholder")),
    "__PARRANDA_LANDING_SEARCH_SUBMIT__": escapeHtml(tr("landing.search.submit")),
    "__PARRANDA_LANDING_SEARCH_SUBMIT_DISABLED__": escapeHtml(tr("landing.search.submitDisabled")),
    "__PARRANDA_LANDING_SEARCH_UNSUPPORTED__": escapeHtml(tr("landing.search.unsupported")),
    "__PARRANDA_LANDING_SEARCH_LABEL__": escapeHtml(tr("landing.search.label")),
    "__PARRANDA_LANDING_SKIP_LINK__": escapeHtml(tr("landing.search.skipLink")),
    "__PARRANDA_LANDING_CITY_REGISTRY__": serializeInlineJson(buildLandingCityRegistry()),
    "__PARRANDA_LANDING_NAV_ROME__": escapeHtml(tr("landing.nav.rome")),
    "__PARRANDA_LANDING_NAV_LAYOUTS__": escapeHtml(tr("landing.nav.layouts")),
    "__PARRANDA_LANDING_LINK_BCN__": `/barcelona${langSuffix}`,
    "__PARRANDA_LANDING_LINK_ROME__": `/rome${langSuffix}`,
    "__PARRANDA_LANDING_BLITZ_BUTTON__": escapeHtml(tr("landing.blitz.button")),
    "__PARRANDA_LANDING_BLITZ_SUBTITLE__": escapeHtml(tr("landing.blitz.subtitle")),
    "__PARRANDA_LANDING_BLITZ_USE__": escapeHtml(tr("landing.blitz.use")),
    "__PARRANDA_LANDING_BLITZ_REBLITZ__": escapeHtml(tr("landing.blitz.reblitz")),
    "__PARRANDA_LANDING_BLITZ_PLAN__": escapeHtml(tr("landing.blitz.plan")),
    "__PARRANDA_LANDING_BLITZ_CLOSE__": escapeHtml(tr("landing.blitz.close")),
    "__PARRANDA_LANDING_BLITZ_LOADING__": escapeHtml(tr("landing.blitz.loading")),
    "__PARRANDA_LANDING_BLITZ_GEO_FALLBACK__": escapeHtml(tr("landing.blitz.geoFallback")),
    "__PARRANDA_LANDING_BLITZ_NO_CITY__": escapeHtml(tr("landing.blitz.noCity")),
    "__PARRANDA_LANDING_BLITZ_ERROR__": escapeHtml(tr("landing.blitz.error")),
    "__PARRANDA_LANDING_BLITZ_INFO__": escapeHtml(tr("landing.blitz.info")),
    "__PARRANDA_LANDING_BLITZ_EYEBROW__": escapeHtml(tr("landing.blitz.eyebrow")),
    "__PARRANDA_LANDING_BLITZ_SECTION_TITLE__": escapeHtml(tr("landing.blitz.sectionTitle")),
    "__PARRANDA_LANDING_BLITZ_SHUFFLE__": escapeHtml(tr("landing.blitz.shuffle")),
    "__PARRANDA_LANDING_BLITZ_CARD1_TIME__": escapeHtml(tr("landing.blitz.card1.time")),
    "__PARRANDA_LANDING_BLITZ_CARD1_META__": escapeHtml(tr("landing.blitz.card1.meta")),
    "__PARRANDA_LANDING_BLITZ_CARD1_TITLE__": escapeHtml(tr("landing.blitz.card1.title")),
    "__PARRANDA_LANDING_BLITZ_CARD1_DESC__": escapeHtml(tr("landing.blitz.card1.desc")),
    "__PARRANDA_LANDING_BLITZ_CARD1_TAGS__": tagsHtml("landing.blitz.card1.tags"),
    "__PARRANDA_LANDING_BLITZ_CARD2_TIME__": escapeHtml(tr("landing.blitz.card2.time")),
    "__PARRANDA_LANDING_BLITZ_CARD2_META__": escapeHtml(tr("landing.blitz.card2.meta")),
    "__PARRANDA_LANDING_BLITZ_CARD2_TITLE__": escapeHtml(tr("landing.blitz.card2.title")),
    "__PARRANDA_LANDING_BLITZ_CARD2_DESC__": escapeHtml(tr("landing.blitz.card2.desc")),
    "__PARRANDA_LANDING_BLITZ_CARD2_TAGS__": tagsHtml("landing.blitz.card2.tags"),
    "__PARRANDA_LANDING_BLITZ_CARD3_TIME__": escapeHtml(tr("landing.blitz.card3.time")),
    "__PARRANDA_LANDING_BLITZ_CARD3_META__": escapeHtml(tr("landing.blitz.card3.meta")),
    "__PARRANDA_LANDING_BLITZ_CARD3_TITLE__": escapeHtml(tr("landing.blitz.card3.title")),
    "__PARRANDA_LANDING_BLITZ_CARD3_DESC__": escapeHtml(tr("landing.blitz.card3.desc")),
    "__PARRANDA_LANDING_BLITZ_CARD3_TAGS__": tagsHtml("landing.blitz.card3.tags"),
    "__PARRANDA_LANDING_BLITZ_USE_ONE__": escapeHtml(tr("landing.blitz.useOne")),
    "__PARRANDA_LANDING_BLITZ_SHUFFLE_ALL__": escapeHtml(tr("landing.blitz.shuffleAll")),
    "__PARRANDA_LANDING_PULSE_HEADLINE__": escapeHtml(tr("landing.pulse.headline")),
    "__PARRANDA_LANDING_PULSE_SHOW_ALL__": escapeHtml(tr("landing.pulse.showAll")),
    "__PARRANDA_LANDING_PULSE_BCN_BORN__": escapeHtml(tr("landing.pulse.bcnBorn")),
    "__PARRANDA_LANDING_PULSE_ROME_MONTI__": escapeHtml(tr("landing.pulse.romeMonti")),
    "__PARRANDA_LANDING_PULSE_BCN_BARCELONETA__": escapeHtml(tr("landing.pulse.bcnBarceloneta")),
    "__PARRANDA_LANDING_JOURNEYS_EYEBROW__": escapeHtml(tr("landing.journeys.eyebrow")),
    "__PARRANDA_LANDING_JOURNEYS_TITLE__": escapeHtml(tr("landing.journeys.title")),
    "__PARRANDA_LANDING_JOURNEYS_DESC__": escapeHtml(tr("landing.journeys.desc")),
    "__PARRANDA_LANDING_JOURNEYS_BCN_EYEBROW__": escapeHtml(tr("landing.journeys.bcnEyebrow")),
    "__PARRANDA_LANDING_JOURNEYS_BCN_LABEL__": escapeHtml(tr("landing.journeys.bcnLabel")),
    "__PARRANDA_LANDING_JOURNEYS_BCN_STATUS__": escapeHtml(tr("landing.journeys.bcnStatus")),
    "__PARRANDA_LANDING_JOURNEYS_ROME_EYEBROW__": escapeHtml(tr("landing.journeys.romeEyebrow")),
    "__PARRANDA_LANDING_JOURNEYS_ROME_LABEL__": escapeHtml(tr("landing.journeys.romeLabel")),
    "__PARRANDA_LANDING_JOURNEYS_ROME_STATUS__": escapeHtml(tr("landing.journeys.romeStatus")),
    "__PARRANDA_LANDING_FOOTER_TAGLINE__": escapeHtml(tr("landing.footer.tagline")),
    "__PARRANDA_LANDING_FOOTER_PHILOSOPHY__": escapeHtml(tr("landing.footer.philosophy")),
    "__PARRANDA_LANDING_FOOTER_CONTACT__": escapeHtml(tr("landing.footer.contact")),
  };
  return Object.entries(replacements).reduce(
    (h, [token, value]) => h.split(token).join(value),
    landingShellTemplate,
  );
}

function renderAppShell({ cityConfig, requestedCity, cityFallbackUsed, lang = "en", plannerEntryRoute = false }) {
  const uiLang = normalizeLanguage(lang);
  const requestedLabel = cityFallbackUsed ? humanizeCityKey(requestedCity) : "";
  const displayLabel = resolveDisplayLabel(cityConfig, requestedLabel, uiLang);
  const searchLabel = requestedLabel || getCitySearchLabel(cityConfig);
  const shellMode = resolveShellMode(cityConfig, cityFallbackUsed);
  const shellCopy = buildShellCopy(shellMode, {
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

function inferShellCity(request) {
  const pathSegments = String(request.path || "")
    .split("/")
    .filter(Boolean);
  const pathKey = pathSegments[0] && !pathSegments[0].includes(".") ? pathSegments[0] : null;

  return request.query?.city || pathKey || null;
}

function servePublicRootAsset(request, response, next) {
  const assetName = path.basename(request.path);

  if (!publicRootFiles.has(assetName) || request.path !== `/${assetName}`) {
    next();
    return;
  }

  response.sendFile(path.join(appRoot, assetName));
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
function buildApp({ openDataLoader = resolveDefaultOpenDataLoader() } = {}) {
  const app = express();

  app.use(express.json());
  app.get(["/", "/index.html"], (request, response) => {
    response.type("html").send(
      renderLandingShell({ lang: normalizeLanguage(request.query?.lang) })
    );
  });

  app.get([...publicRootFiles].map((assetName) => `/${assetName}`), servePublicRootAsset);
  app.use("/assets", express.static(path.join(appRoot, "assets"), { index: false, dotfiles: "ignore" }));
  app.use("/vendor", express.static(path.join(appRoot, "vendor"), { index: false, dotfiles: "ignore" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  // Candidate Intelligence Spine — read-only inspect/debug projection.
  // Runs the spine (evidence → reducer → gates → fit shape) over the city's
  // existing place candidates. Debug-only; changes no user-facing output.
  app.get("/api/candidate-inspect", (request, response) => {
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
        ...(inspectSources ? { source_provider_inspect: engineResult.source_provider_inspect || null } : {}),
      });
    } catch (error) {
      response.status(500).json({
        error: "City pulse failed",
        detail: error.message,
      });
    }
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

      if (cityFallbackUsed) {
        response.json({
          city: requestedCity,
          days: [],
          resolved_home_base: null,
          resolved_start: null,
          resolved_end: null,
          requested_city: requestedCity,
          city_fallback_used: true,
          readiness: buildUnsupportedCityReadiness(requestedCity),
        });
        return;
      }

      if (shouldReturnPreviewRouteNoop(cityConfig)) {
        response.json({
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
        });
        return;
      }

      const result = diversifyRecommendationDays(await generateRecommendations(payload));
      const plannerInspectSidecar = isPlannerCandidateInspectRequested(request)
        ? await buildPlannerCandidateInspectSidecar({
            cityConfig,
            request,
            routePayload: payload,
            routeResult: result,
            openDataLoader,
          })
        : null;
      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        ...(plannerInspectSidecar || {}),
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
      const cityDensity = recognizedCity ? curatedDensityOf(cityConfig) : null;
      const augmentRecognized = recognizedCity && cityDensity === "thin";
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
      const shouldLoad = (useAgnostic || augmentRecognized) && externalEnabled;
      let externalProviderExtras = null;
      let openDataLoaderStatus = "skipped";
      if (shouldLoad && typeof openDataLoader === "function" && loaderAnchor) {
        try {
          const records = await openDataLoader(loaderAnchor);
          if (Array.isArray(records) && records.length > 0) {
            externalProviderExtras = { external_provider: { dataset: records } };
            openDataLoaderStatus = `loaded:${records.length}`;
          } else {
            openDataLoaderStatus = "loaded:0";
          }
        } catch (_error) {
          openDataLoaderStatus = "error_failed_closed";
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
        // Nested opt-in: source-backed external/open candidates (only consulted
        // when candidate_mode is also on). ?include_external_candidates=1 or
        // ?candidate_sources=open, or the equivalent body fields. snake_case
        // and camelCase are both accepted at the HTTP edge for parity with the
        // engine's isExternalCandidatesEnabled().
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
            }
          : { used: false },
        // Thin recognized-city open-data augmentation status (#241). `used` is
        // true only when a recognized city was curated-thin and the loader path
        // ran; rich citypacks report used:false with reason "rich_citypack".
        open_data_augmentation: augmentRecognized
          ? { used: true, reason: "thin_recognized_city", catalog_density: cityDensity, anchor: loaderAnchor, open_data_loader: openDataLoaderStatus }
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
    const isPlannerEntry = pathSegments[1] === "plan";
    const cityResolution = {
      ...resolveRequestCity(inferShellCity(request)),
      lang: normalizeLanguage(request.query?.lang),
      plannerEntryRoute: isPlannerEntry,
    };
    response.type("html").send(renderAppShell(cityResolution));
  });

  return app;
}

module.exports = {
  buildApp,
  buildPlannerAreas,
};
