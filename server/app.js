const fs = require("node:fs");
const express = require("express");
const path = require("path");
const { resolveCityConfig, cityConfigs } = require("./cities");
const { buildBlitzDecision } = require("./blitz-engine");
const { generateRecommendations } = require("./route-engine");
const { diversifyRecommendationDays } = require("./route-diversity");
const { buildClientI18nPayload, normalizeLanguage, translate } = require("./ui-i18n");

const appRoot = path.resolve(__dirname, "..");
const appShellTemplate = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const landingShellTemplate = fs.readFileSync(path.join(appRoot, "landing.html"), "utf8");

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

  const sourceLabel = event.source_label || (isEnglish ? "an official source" : "en officiell källa");
  return isEnglish
    ? `${kindLabel} from ${sourceLabel} in ${cityLabel || "the city"}.`
    : `${kindLabel} från ${sourceLabel} i ${cityLabel || "staden"}.`;
}

function buildOfficialPulseWhy(event, lang = "sv") {
  const isEnglish = normalizeLanguage(lang) === "en";
  const sourceLabel = event.source_label || (isEnglish ? "an official source" : "en officiell källa");

  return isEnglish
    ? `Official source signal from ${sourceLabel}. Useful when you want today’s plan to include something actually happening now.`
    : `Officiell källsignal från ${sourceLabel}. Bra när du vill att dagens plan ska kunna fånga något som faktiskt händer nu.`;
}

function buildOfficialPulseItem(event, date, cityConfig, lang = "sv") {
  const cityLabel = resolveDisplayLabel(cityConfig, null, lang);
  const where =
    [event.venue, event.address].filter(Boolean).join(" • ") ||
    cityConfig?.editorialAreaLabel ||
    cityLabel ||
    "Rom";
  const matchesVibes = [...new Set((event.match_tags || []).map((tag) => pulseVibeByTag[tag]).filter(Boolean))];

  return {
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
    why_it_matters: buildOfficialPulseWhy(event, lang),
    matches_vibes: matchesVibes,
    official_event_id: event.id,
    lat: typeof event.lat === "number" ? event.lat : null,
    lng: typeof event.lng === "number" ? event.lng : null,
    priority: 6,
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

  return "curated-public";
}

function isPreviewCityConfig(cityConfig) {
  return cityConfig?.visibility === "preview";
}

function shouldReturnPreviewRouteNoop(cityConfig) {
  return (
    isPreviewCityConfig(cityConfig) &&
    (!cityConfig.catalog?.routeTemplates?.length || !cityConfig.catalog?.allItems?.length)
  );
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

const LANDING_PUBLIC_VISIBILITIES = ["public", "preview"];

function getLandingSearchCities() {
  return Object.values(cityConfigs).filter((cityConfig) => {
    const visibility = cityConfig.visibility || "public";
    return LANDING_PUBLIC_VISIBILITIES.includes(visibility);
  });
}

function buildLandingCityOptions(lang) {
  const tr = (key) => translate(lang, key);
  return getLandingSearchCities()
    .map((cityConfig) => {
      const label = escapeHtml(cityConfig.label);
      const isPreview = cityConfig.visibility === "preview";
      const previewLabel = escapeHtml(tr("shell.preview.eyebrow") || "Preview");
      const suffix = isPreview ? ` — ${previewLabel}` : "";
      return `<option value="${label}">${label}${suffix}</option>`;
    })
    .join("");
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

function renderLandingShell({ lang = "sv" } = {}) {
  const uiLang = normalizeLanguage(lang);
  const ogLocale = uiLang === "en" ? "en_US" : "sv_SE";
  const tr = (key) => translate(uiLang, key);
  const replacements = {
    "__PARRANDA_LANG__": escapeHtml(uiLang),
    "__PARRANDA_UI_LANG__": escapeHtml(uiLang),
    "__PARRANDA_OG_LOCALE__": ogLocale,
    "__PARRANDA_LANDING_HEADLINE__": escapeHtml(tr("landing.hero.headline")),
    "__PARRANDA_LANDING_SUBCOPY__": escapeHtml(tr("landing.hero.subcopy")),
    "__PARRANDA_LANDING_SEARCH_PLACEHOLDER__": escapeHtml(tr("landing.search.placeholder")),
    "__PARRANDA_LANDING_SEARCH_SUBMIT__": escapeHtml(tr("landing.search.submit")),
    "__PARRANDA_LANDING_SEARCH_SUBMIT_DISABLED__": escapeHtml(tr("landing.search.submitDisabled")),
    "__PARRANDA_LANDING_SEARCH_UNSUPPORTED__": escapeHtml(tr("landing.search.unsupported")),
    "__PARRANDA_LANDING_SEARCH_LABEL__": escapeHtml(tr("landing.search.label")),
    "__PARRANDA_LANDING_SKIP_LINK__": escapeHtml(tr("landing.search.skipLink")),
    "__PARRANDA_LANDING_CITY_OPTIONS__": buildLandingCityOptions(uiLang),
    "__PARRANDA_LANDING_CITY_REGISTRY__": serializeInlineJson(buildLandingCityRegistry()),
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
    "__PARRANDA_LANDING_BLITZ_STREET_VIEW__": escapeHtml(tr("landing.blitz.streetView")),
    "__PARRANDA_LANDING_BLITZ_OPEN_IN_MAPS__": escapeHtml(tr("landing.blitz.openInMaps")),
    "__PARRANDA_MAPS_EMBED_KEY__": process.env.GOOGLE_MAPS_EMBED_KEY || "",
  };
  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.split(token).join(value),
    landingShellTemplate,
  );
}

function renderAppShell({ cityConfig, requestedCity, cityFallbackUsed, lang = "sv" }) {
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
    requestedKey: requestedCity,
    fallbackUsed: cityFallbackUsed,
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

function buildApp() {
  const app = express();

  app.use(express.json());
  app.get(["/", "/index.html"], (request, response) => {
    response.type("html").send(
      renderLandingShell({ lang: normalizeLanguage(request.query?.lang) })
    );
  });

  app.use(express.static(appRoot, { index: false }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
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
      const pulse = cityConfig.services.getCityPulse(date, { lang: uiLang });
      const [liveEventsByDate, weatherByDate] = await Promise.all([
        cityConfig.services.fetchLiveEventsForDates([pulse.date], {}),
        cityConfig.services.fetchWeatherForDates([pulse.date], cityConfig.center).catch(() => ({})),
      ]);
      const officialEvents = (liveEventsByDate[pulse.date] || []).slice(0, 2);
      const officialPulseItems = officialEvents
        .slice(0, 1)
        .map((event) => buildOfficialPulseItem(event, pulse.date, cityConfig, uiLang));

      response.json({
        city: cityConfig.key,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        ...pulse,
        items: [...(pulse.items || []), ...officialPulseItems],
        official_events: officialEvents,
        weather: weatherByDate[pulse.date] || null,
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

      if (shouldReturnPreviewRouteNoop(cityConfig)) {
        response.json({
          city,
          days: [],
          resolved_home_base: null,
          resolved_start: null,
          resolved_end: null,
          requested_city: requestedCity,
          city_fallback_used: cityFallbackUsed,
        });
        return;
      }

      const result = diversifyRecommendationDays(await generateRecommendations(payload));
      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
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
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const lang = normalizeLanguage(request.query?.lang || request.body?.lang);
      const result = await buildBlitzDecision(cityConfig, {
        date: request.body?.date,
        now: request.body?.now,
        origin: request.body?.origin || request.body?.selected_origin || request.body?.start || null,
        mode: request.body?.mode || "auto",
        intent_keys: Array.isArray(request.body?.intent_keys) ? request.body.intent_keys : [],
        preferences: Array.isArray(request.body?.preferences) ? request.body.preferences : [],
        memory: request.body?.memory,
        previous_route: request.body?.previous_route,
        lang,
      });

      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
      });
    } catch (error) {
      response.status(500).json({
        error: "Blitz failed",
        detail: error.message,
      });
    }
  });

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    const cityResolution = {
      ...resolveRequestCity(inferShellCity(request)),
      lang: normalizeLanguage(request.query?.lang),
    };
    response.type("html").send(renderAppShell(cityResolution));
  });

  return app;
}

module.exports = {
  buildApp,
};
