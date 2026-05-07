const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LATEST_PLANNER_PLAN_SCHEMA_VERSION,
  DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
  buildPlannerLoadingMessages,
  createLatestPlannerPlanRecord,
  normalizeLatestPlannerPlanRecord,
  buildLatestPlannerPlanDismissSignature,
  collectSelectedIntentVisibility,
} = require("../planner-trust");

test("buildPlannerLoadingMessages blir dag-aware utan att lova completion", () => {
  const messages = buildPlannerLoadingMessages(2);

  assert.deepEqual(messages, [
    "Bygger 2 dagar...",
    "Sätter ihop första dagen...",
    "Väger in nästa dag...",
    "Sätter ihop rutten...",
  ]);
  assert.ok(messages.every((message) => !/klar/i.test(message)));
});

test("latest planner record normaliseras när schema, city och ålder matchar", () => {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  const record = createLatestPlannerPlanRecord({
    cityKey: "rome",
    cityLabel: "Rom",
    timestamp: now,
    plannerSnapshot: {
      plannerMode: "auto",
      dateFrom: "2026-05-14",
      dateTo: "2026-05-15",
      dates: ["2026-05-14", "2026-05-15"],
      preferences: ["second_hand", "vin"],
    },
    intentKeys: ["second_hand"],
    preferences: ["second_hand", "vin"],
    plannerResponse: {
      days: [{ date: "2026-05-14", primary_route: { main_stops: [] } }],
      resolved_home_base: { label: "Monti" },
      resolved_start: null,
      resolved_end: null,
    },
    activePlannedDate: "2026-05-14",
  });

  const normalized = normalizeLatestPlannerPlanRecord(record, {
    cityKey: "rome",
    schemaVersion: LATEST_PLANNER_PLAN_SCHEMA_VERSION,
    maxAgeMs: DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
    now,
  });

  assert.ok(normalized);
  assert.equal(normalized.cityKey, "rome");
  assert.equal(normalized.plannerResponse.days.length, 1);
  assert.equal(buildLatestPlannerPlanDismissSignature(normalized), "rome:1778155200000:2026-05-14");
});

test("latest planner record underkänns när schema, city eller ålder inte matchar", () => {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  const validRecord = createLatestPlannerPlanRecord({
    cityKey: "rome",
    cityLabel: "Rom",
    timestamp: now - DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS - 1,
    plannerSnapshot: { plannerMode: "auto" },
    intentKeys: [],
    preferences: [],
    plannerResponse: {
      days: [{ date: "2026-05-14", primary_route: { main_stops: [] } }],
    },
  });

  assert.equal(
    normalizeLatestPlannerPlanRecord(validRecord, {
      cityKey: "rome",
      now,
      maxAgeMs: DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS,
    }),
    null,
  );
  assert.equal(
    normalizeLatestPlannerPlanRecord(
      { ...validRecord, timestamp: now, schemaVersion: 999 },
      {
        cityKey: "rome",
        now,
      },
    ),
    null,
  );
  assert.equal(
    normalizeLatestPlannerPlanRecord(
      { ...validRecord, timestamp: now, schemaVersion: LATEST_PLANNER_PLAN_SCHEMA_VERSION },
      {
        cityKey: "barcelona",
        now,
      },
    ),
    null,
  );
});

test("collectSelectedIntentVisibility gör mixed second_hand synligt på senare dag och markerar saknade intent", () => {
  const visibility = collectSelectedIntentVisibility({
    selectedIntentKeys: ["second_hand", "culture", "views"],
    intentDefinitions: [
      {
        key: "second_hand",
        label: "Second hand",
        payloadSignals: ["second_hand"],
        coverageTags: ["second_hand", "vintage", "shopping", "market"],
      },
      {
        key: "culture",
        label: "Kultur",
        payloadSignals: ["kultur"],
        coverageTags: ["kultur", "kyrkor"],
      },
      {
        key: "views",
        label: "Utsikt",
        payloadSignals: ["utsikt"],
        coverageTags: ["utsikt", "golden hour"],
      },
    ],
    days: [
      {
        date: "2026-05-14",
        primary_route: {
          main_stops: [{ tags: ["kultur", "kyrkor"] }],
        },
      },
      {
        date: "2026-05-15",
        primary_route: {
          main_stops: [{ tags: ["shopping", "vintage"] }],
        },
      },
    ],
  });

  assert.deepEqual(visibility.perDay[0].intentKeys, ["culture"]);
  assert.deepEqual(visibility.perDay[1].intentKeys, ["second_hand"]);
  assert.deepEqual(visibility.laterIntentKeys, ["second_hand"]);
  assert.deepEqual(visibility.missingIntentKeys, ["views"]);
});
