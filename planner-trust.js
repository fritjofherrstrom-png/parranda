(function createPlannerTrustModule(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.ParrandaPlannerTrust = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function plannerTrustFactory() {
  "use strict";

  const LATEST_PLANNER_PLAN_SCHEMA_VERSION = 1;
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

  return {
    LATEST_PLANNER_PLAN_SCHEMA_VERSION,
    DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
    buildPlannerLoadingMessages,
    createLatestPlannerPlanRecord,
    normalizeLatestPlannerPlanRecord,
    buildLatestPlannerPlanDismissSignature,
    collectSelectedIntentVisibility,
  };
});
