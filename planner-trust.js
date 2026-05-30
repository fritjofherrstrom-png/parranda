(function createPlannerTrustModule(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.ParrandaPlannerTrust = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function plannerTrustFactory() {
  "use strict";

  const LATEST_PLANNER_PLAN_SCHEMA_VERSION = 2;
  const DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeToken(value = "") {
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function buildPlannerLoadingMessages(dayCount = 1) {
    const normalizedDayCount = Number.isFinite(dayCount) ? Math.max(1, Math.round(dayCount)) : 1;

    if (normalizedDayCount > 1) {
      return [
        `Bygger ${normalizedDayCount} dagar...`,
        "Sätter ihop första dagen...",
        "Väger in nästa dag...",
        "Sätter ihop rutten...",
      ];
    }

    return [
      "Bygger dagen...",
      "Sätter ihop rutten...",
      "Väger in dagens signaler...",
      "Finjusterar flödet...",
    ];
  }

  function createLatestPlannerPlanRecord({
    cityKey,
    cityLabel,
    timestamp = Date.now(),
    plannerSnapshot,
    intentKeys = [],
    preferences = [],
    plannerResponse,
    activePlannedDate = null,
  }) {
    return {
      schemaVersion: LATEST_PLANNER_PLAN_SCHEMA_VERSION,
      cityKey: cityKey || "",
      cityLabel: cityLabel || "",
      timestamp,
      plannerSnapshot,
      intentKeys: [...intentKeys],
      preferences: [...preferences],
      activePlannedDate: activePlannedDate || null,
      plannerResponse,
    };
  }

  function normalizeLatestPlannerPlanRecord(rawRecord, options = {}) {
    const {
      cityKey = "",
      schemaVersion = LATEST_PLANNER_PLAN_SCHEMA_VERSION,
      maxAgeMs = DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
      now = Date.now(),
    } = options;

    if (!isPlainObject(rawRecord)) {
      return null;
    }

    if (rawRecord.schemaVersion !== schemaVersion) {
      return null;
    }

    if (rawRecord.cityKey !== cityKey) {
      return null;
    }

    if (!Number.isFinite(rawRecord.timestamp)) {
      return null;
    }

    if (now - rawRecord.timestamp > maxAgeMs) {
      return null;
    }

    if (!isPlainObject(rawRecord.plannerSnapshot)) {
      return null;
    }

    if (!isPlainObject(rawRecord.plannerResponse) || !Array.isArray(rawRecord.plannerResponse.days)) {
      return null;
    }

    return {
      schemaVersion: rawRecord.schemaVersion,
      cityKey: rawRecord.cityKey,
      cityLabel: rawRecord.cityLabel || "",
      timestamp: rawRecord.timestamp,
      plannerSnapshot: rawRecord.plannerSnapshot,
      intentKeys: Array.isArray(rawRecord.intentKeys) ? [...rawRecord.intentKeys] : [],
      preferences: Array.isArray(rawRecord.preferences) ? [...rawRecord.preferences] : [],
      activePlannedDate: rawRecord.activePlannedDate || null,
      plannerResponse: rawRecord.plannerResponse,
    };
  }

  function buildLatestPlannerPlanDismissSignature(record) {
    if (!record) {
      return "";
    }

    return [record.cityKey || "", record.timestamp || "", record.activePlannedDate || ""].join(":");
  }

  function collectSelectedIntentVisibility({
    selectedIntentKeys = [],
    days = [],
    intentDefinitions = [],
  } = {}) {
    const intentDefinitionMap = new Map(
      intentDefinitions
        .filter((definition) => definition && definition.key)
        .map((definition) => [
          definition.key,
          {
            key: definition.key,
            label: definition.label || definition.key,
            coverageSet: new Set(
              [
                ...(definition.coverageTags || []),
                ...(definition.payloadSignals || []),
                ...(definition.aliases || []),
              ].map(normalizeToken),
            ),
          },
        ]),
    );

    const selectedDefinitions = selectedIntentKeys
      .map((intentKey) => intentDefinitionMap.get(intentKey))
      .filter(Boolean);

    const firstDayIndexByKey = {};

    const perDay = (days || []).map((day, dayIndex) => {
      const routeStops = Array.isArray(day?.primary_route?.main_stops) ? day.primary_route.main_stops : [];
      const normalizedTags = new Set(
        routeStops.flatMap((stop) => (Array.isArray(stop?.tags) ? stop.tags : [])).map(normalizeToken),
      );

      const matchedIntents = selectedDefinitions
        .map((definition) => {
          let hitCount = 0;
          definition.coverageSet.forEach((tag) => {
            if (normalizedTags.has(tag)) {
              hitCount += 1;
            }
          });

          return {
            key: definition.key,
            label: definition.label,
            hitCount,
          };
        })
        .filter((entry) => entry.hitCount > 0)
        .sort((left, right) => right.hitCount - left.hitCount || left.label.localeCompare(right.label, "sv"));

      matchedIntents.forEach((intent) => {
        if (!Number.isInteger(firstDayIndexByKey[intent.key])) {
          firstDayIndexByKey[intent.key] = dayIndex;
        }
      });

      return {
        date: day?.date || null,
        intentKeys: matchedIntents.map((intent) => intent.key),
        labels: matchedIntents.map((intent) => intent.label).slice(0, 2),
        matches: matchedIntents,
      };
    });

    const missingIntentKeys = selectedIntentKeys.filter(
      (intentKey) => !Number.isInteger(firstDayIndexByKey[intentKey]),
    );
    const laterIntentKeys = selectedIntentKeys.filter(
      (intentKey) =>
        Number.isInteger(firstDayIndexByKey[intentKey]) && firstDayIndexByKey[intentKey] > 0,
    );

    return {
      perDay,
      firstDayIndexByKey,
      missingIntentKeys,
      laterIntentKeys,
    };
  }

  // --- Route credibility display arbitration ---------------------------------
  //
  // A thin presentation helper, NOT a second source of truth. It reads the two
  // engine signals that already exist and decides how the route should read:
  //
  //   - route.credibility_tier (#206): "are these stops trustworthy?"
  //     (high / medium / low, derived from the per-stop trust mix).
  //   - route.confidence: "is this a full/mature route composition?"
  //     ("low" marks a thin-city / simple-compose route).
  //
  // These can disagree: a thin city like Athens can land a route on curated,
  // verified stops (credibility_tier "high") while still being a thin-city
  // route (confidence "low"). Showing "Curated route · verified local picks"
  // there over-claims maturity the coverage does not have. The view below keeps
  // the chip honest while letting a genuinely mature high route stay subtle.

  // Per-stop trust: curated stops must NOT get a badge; only provisional
  // (unverified, honest-fill) stops are marked.
  function buildStopTrustView(stop = {}) {
    const showProvisionalBadge = Boolean(stop) && stop.provisional === true;
    return {
      showProvisionalBadge,
      badgeKey: showProvisionalBadge ? "credibility.provisional" : null,
      hint: showProvisionalBadge
        ? stop.provisional_hint || stop.provisionalHint || null
        : null,
    };
  }

  function resolveSimpleNoteKey(route) {
    // Preserve the low-credibility honesty sub-distinction: how much the thin
    // compose had to lean on provisional (unverified) sources.
    const provisionalStops = Number(route.provisional_stop_count) || 0;
    const totalStops = Array.isArray(route.main_stops) ? route.main_stops.length : 0;
    const mostlyProvisional = provisionalStops > 0 && provisionalStops * 2 >= totalStops;
    if (route.uses_provisional_sources && mostlyProvisional) {
      return "credibility.routeSimpleMostly";
    }
    if (route.uses_provisional_sources) {
      return "credibility.routeSimpleSome";
    }
    return "credibility.routeSimpleThin";
  }

  function buildRouteCredibilityView(route = {}) {
    // credibility_tier owns the decision; the legacy confidence === "low"
    // fallback keeps routes that predate the trust layer rendering a signal.
    const tier = route.credibility_tier || (route.confidence === "low" ? "low" : null);
    if (!tier) {
      return { mode: "none", chipKey: null, curatedChip: false, showNote: false, noteKey: null };
    }

    // A thin-city / simple-compose route. Curated/verified stops do not erase
    // the fact that coverage here is not a full citypack.
    const isThinRoute = route.confidence === "low";

    if (tier === "high") {
      if (!isThinRoute) {
        // Mature high route — one subtle positive chip, no explanation note.
        return {
          mode: "curated",
          chipKey: "credibility.routeCurated",
          curatedChip: true,
          showNote: false,
          noteKey: null,
        };
      }
      // Thin-but-verified (the Athens case): the stops are verified, but the
      // route is a simple thin-city walk. Be honest about coverage; do NOT
      // claim "Curated route".
      return {
        mode: "verifiedSimple",
        chipKey: "credibility.routeVerifiedSimple",
        curatedChip: false,
        showNote: true,
        noteKey: "credibility.routeVerifiedSimpleNote",
      };
    }

    if (tier === "medium") {
      return {
        mode: "mixed",
        chipKey: "credibility.routeMixed",
        curatedChip: false,
        showNote: true,
        noteKey: "credibility.routeMixedNote",
      };
    }

    // tier === "low": the existing Simple route honest-preview explanation.
    return {
      mode: "simple",
      chipKey: "credibility.routeSimple",
      curatedChip: false,
      showNote: true,
      noteKey: resolveSimpleNoteKey(route),
    };
  }

  return {
    LATEST_PLANNER_PLAN_SCHEMA_VERSION,
    DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
    buildPlannerLoadingMessages,
    createLatestPlannerPlanRecord,
    normalizeLatestPlannerPlanRecord,
    buildLatestPlannerPlanDismissSignature,
    collectSelectedIntentVisibility,
    buildStopTrustView,
    buildRouteCredibilityView,
  };
});
