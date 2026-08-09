"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIVE_PROFILES_FOR_ANCHOR_SQL,
  CLAIM_SCOUT_TARGET_SQL,
  COMPLETE_SCOUT_TARGET_SQL,
  FAIL_SCOUT_TARGET_SQL,
  MAX_SCOUT_TARGETS,
  MAX_QUALIFICATION_BYTES,
  SOURCE_QUALIFICATION_SQL,
  UPSERT_SCOUT_TARGET_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  createSourceProfileCatalog,
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");
const {
  resolveDefaultEventSupply,
} = require("../server/place-candidates/agnostic-event-supply");
const { migrateSourceCatalog } = require("../scripts/migrate-source-catalog");

const NOW = new Date("2026-07-30T10:00:00.000Z");

function scoutDemand() {
  return {
    anchor: { lat: 55.6, lng: 13 },
    placeLabel: "Test Region, Test Country",
    placeContext: {
      region: "Test Region",
      country: "Test Country",
      country_code: "TC",
    },
    spatialScope: {
      source: "resolver_bounds",
      kind: "region",
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
    },
  };
}

function sourceProfile({ approved = false, expiresAt = "2026-08-20T00:00:00.000Z" } = {}) {
  const candidate = {
    id: "regional-events",
    source_label: "Regional Events",
    url: "https://events.example/api/events",
    status: "viable_provider_probe",
    adapter: "linked_events",
    maps_to_existing_provider: true,
    trust_tier: "official",
    source_identity: "events.example",
    source_language: "sv",
  };
  return {
    profile_key: "place-source-profile-v1:test-region",
    runtime_review: approved
      ? {
          status: "approved",
          reviewed_at: "2026-07-20T00:00:00.000Z",
          expires_at: expiresAt,
          feeds: [
            {
              candidate_id: candidate.id,
              id: "regional-events-feed",
              label: "Regional Events",
              endpoint: candidate.url,
              adapter: "linked_events",
              source_tier: "official",
              confidence: "medium",
              source_family: "official_municipal_calendar",
              source_identity: candidate.source_identity,
              source_language: "sv",
              terms_status: "open_license",
              source_health: "healthy",
              runtime_policy: "bounded_refresh",
            },
          ],
        }
      : {
          status: "unreviewed",
          reviewed_at: null,
          expires_at: null,
          feeds: [],
        },
    place_context: {
      label: "Test Region",
      lat: 55.6,
      lng: 13,
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
    },
    source_families: [
      {
        family: "official_municipal_calendar",
        candidates: [candidate],
      },
    ],
  };
}

test("discovery writes only review-needed profiles and strips attempted activation", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ profile_key: values[0], catalog_status: values[1] }] };
    },
  });
  const discovered = sourceProfile({ approved: true });
  discovered.source_qualification = {
    schema_version: 1,
    status: "observing",
    candidates: [],
    activation_performed: false,
  };
  const result = await catalog.recordDiscovery(discovered);

  assert.equal(result.status, "recorded");
  assert.equal(result.catalog_status, "review_needed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[1], "review_needed");
  const stored = JSON.parse(calls[0].values[9]);
  assert.deepEqual(stored.runtime_review, {
    status: "unreviewed",
    reviewed_at: null,
    expires_at: null,
    feeds: [],
  });
  assert.deepEqual(stored.source_qualification, discovered.source_qualification);
  assert.match(calls[0].sql, /catalog_status = 'review_needed'/);
  assert.match(calls[0].sql, /ELSE pulse_source_profiles\.profile/);
});

test("only an already-valid reviewed profile can be stored as approved", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ profile_key: values[0], catalog_status: values[1] }] };
    },
  });

  assert.deepEqual(await catalog.recordApprovedProfile(sourceProfile()), {
    status: "rejected",
    reason: "invalid_reviewed_source_profile",
  });
  const approved = await catalog.recordApprovedProfile(sourceProfile({ approved: true }));
  assert.equal(approved.status, "recorded");
  assert.equal(approved.catalog_status, "approved");
  assert.equal(calls.length, 1);
});

test("geo reads return only profiles that still pass the shared review contract", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return {
        rows: [
          { profile: sourceProfile({ approved: true }) },
          { profile: sourceProfile({ approved: true, expiresAt: "2026-07-29T00:00:00.000Z" }) },
        ],
      };
    },
  });

  const feeds = await catalog.listApprovedEventFeedsForAnchor({
    anchor: { lat: 55.6, lng: 13 },
    now: NOW,
  });

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].id, "regional-events-feed");
  assert.equal(calls[0].sql, ACTIVE_PROFILES_FOR_ANCHOR_SQL);
  assert.deepEqual(calls[0].values, [55.6, 13, NOW.toISOString()]);
});

test("catalog read/write failures fail soft with compact outcomes", async () => {
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async () => {
      throw new Error("postgresql://user:secret@private-host/catalog");
    },
  });

  assert.deepEqual(await catalog.recordDiscovery(sourceProfile()), {
    status: "failed",
    reason: "source_catalog_write_failed",
  });
  assert.deepEqual(
    await catalog.listApprovedEventFeedsForAnchor({ anchor: { lat: 55.6, lng: 13 }, now: NOW }),
    [],
  );
  assert.equal(await catalog.loadSourceQualification(sourceProfile().profile_key), null);
});

test("qualification history is read only from review-needed profiles and stays bounded", async () => {
  const qualification = {
    schema_version: 1,
    status: "observing",
    candidates: [],
    activation_performed: false,
  };
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ source_qualification: qualification }] };
    },
  });

  assert.deepEqual(await catalog.loadSourceQualification(sourceProfile().profile_key), qualification);
  assert.equal(calls[0].sql, SOURCE_QUALIFICATION_SQL);
  assert.deepEqual(calls[0].values, [sourceProfile().profile_key]);
  assert.match(SOURCE_QUALIFICATION_SQL, /catalog_status = 'review_needed'/);
  assert.equal(await catalog.loadSourceQualification("not-a-profile-key"), null);
  assert.equal(calls.length, 1);

  const rejectedCatalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (_sql, values) => ({
      rows: [{
        source_qualification: values[0].endsWith("activation")
          ? { ...qualification, activation_performed: true }
          : values[0].endsWith("oversize")
            ? { ...qualification, padding: "x".repeat(MAX_QUALIFICATION_BYTES) }
            : { ...qualification, schema_version: 2 },
      }],
    }),
  });
  assert.equal(await rejectedCatalog.loadSourceQualification("place-source-profile-v1:schema"), null);
  assert.equal(await rejectedCatalog.loadSourceQualification("place-source-profile-v1:activation"), null);
  assert.equal(await rejectedCatalog.loadSourceQualification("place-source-profile-v1:oversize"), null);
});

test("only resolver-attested bounded place demand enters the scout queue", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ target_key: values[0], status: "pending", observation_count: 1 }] };
    },
  });

  assert.equal((await catalog.recordScoutDemand({ anchor: { lat: 55.6, lng: 13 } })).status, "ignored");
  assert.equal((await catalog.recordScoutDemand({
    ...scoutDemand(),
    spatialScope: {
      source: "resolver_bounds",
      kind: "region",
      bounds: { west: 5, south: 45, east: 25, north: 65 },
    },
  })).status, "ignored", "broad scopes never become crawl targets");
  assert.equal(calls.length, 0);
  const first = await catalog.recordScoutDemand(scoutDemand());
  const second = await catalog.recordScoutDemand(scoutDemand());

  assert.equal(first.status, "recorded");
  assert.equal(first.target_key, second.target_key, "the same trusted scope deduplicates deterministically");
  assert.equal(calls[0].sql, UPSERT_SCOUT_TARGET_SQL);
  assert.equal(calls[0].values[11], MAX_SCOUT_TARGETS);
  assert.deepEqual(JSON.parse(calls[0].values[8]), {
    region: "Test Region",
    country: "Test Country",
    country_code: "tc",
  });
});

test("scout claims use leases and completion/failure cannot expose raw errors", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql === CLAIM_SCOUT_TARGET_SQL) {
        return {
          rows: [{
            target_key: "source-scout-target-v1:test",
            place_label: "Test Region",
            anchor_lat: 55.6,
            anchor_lng: 13,
            place_context: scoutDemand().placeContext,
            spatial_scope: scoutDemand().spatialScope,
            attempt_count: 2,
          }],
        };
      }
      return { rows: [{ target_key: values[0], status: sql === COMPLETE_SCOUT_TARGET_SQL ? "completed" : "retry_wait" }] };
    },
  });

  const target = await catalog.claimScoutTarget();
  assert.equal(target.target_key, "source-scout-target-v1:test");
  assert.equal(target.attempt_count, 2);
  assert.match(target.lease_token, /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].sql, CLAIM_SCOUT_TARGET_SQL);

  const completed = await catalog.completeScoutTarget(target, "bounded_source_scout_complete");
  assert.equal(completed.status, "completed");
  assert.equal(calls[1].sql, COMPLETE_SCOUT_TARGET_SQL);

  const failed = await catalog.failScoutTarget(target, "postgresql://secret@private-host/db");
  assert.equal(failed.status, "retry_wait");
  assert.equal(calls[2].sql, FAIL_SCOUT_TARGET_SQL);
  assert.equal(calls[2].values[3], "source_scout_failed");
});

test("default catalog is explicit server config and never connects while disabled", async () => {
  let poolCreated = 0;
  class FakePool {
    constructor() {
      poolCreated += 1;
    }
  }
  assert.equal(resolveDefaultSourceProfileCatalog({}, { pg: { Pool: FakePool } }), null);
  assert.equal(resolveDefaultSourceProfileCatalog({ PARRANDA_SOURCE_CATALOG: "enabled" }, { pg: { Pool: FakePool } }), null);
  assert.equal(poolCreated, 0);

  const catalog = resolveDefaultSourceProfileCatalog({
    PARRANDA_SOURCE_CATALOG: "enabled",
    PARRANDA_SOURCE_CATALOG_DATABASE_URL: "postgresql://catalog.invalid/parranda",
  }, {
    pg: {
      Pool: class {
        query() {
          return Promise.resolve({ rows: [] });
        }
        end() {
          return Promise.resolve();
        }
      },
    },
    now: () => NOW,
  });
  assert.equal(typeof catalog.listApprovedEventFeedsForAnchor, "function");
  await catalog.close();
});

test("approved catalog feeds supplement runtime acquisition without changing static feed trust", async () => {
  let warmed = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [
        {
          id: "catalog-feed",
          label: "Catalog Feed",
          endpoint: "https://events.example/api/events",
          adapter: "linked_events",
          bbox: [12.8, 55.4, 13.3, 55.8],
          source_tier: "official",
          confidence: "medium",
          source_family: "official_municipal_calendar",
          source_identity: "events.example",
          status: "active",
          runtime_policy: "bounded_refresh",
        },
      ],
    },
    eventCache: {
      peek: () => null,
      warm: () => {
        warmed += 1;
      },
    },
  });

  const result = await supply({ anchor: { lat: 55.6, lng: 13 }, now: NOW });
  assert.equal(result.coverage, "covered");
  assert.equal(result.pending, true);
  assert.equal(result.feeds[0].id, "catalog-feed");
  assert.equal(warmed, 1);
});

test("an uncovered trusted place records demand without delaying or mutating Live output", async () => {
  let demand = null;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      recordScoutDemand: async (value) => { demand = value; },
    },
    eventCache: { peek: () => null, warm: () => {} },
  });
  const input = scoutDemand();
  const result = await supply({
    anchor: input.anchor,
    placeLabel: input.placeLabel,
    placeContext: input.placeContext,
    spatialScope: input.spatialScope,
    now: NOW,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.coverage, "uncovered");
  assert.deepEqual(demand, input);
});

test("an approved local source suppresses redundant scout demand", async () => {
  let demandCount = 0;
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_EVENT_FEEDS: JSON.stringify([{
      id: "existing-feed",
      label: "Existing Feed",
      endpoint: "https://events.example/api/events",
      adapter: "linked_events",
      bbox: [12.8, 55.4, 13.3, 55.8],
      status: "active",
    }]),
  }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      recordScoutDemand: async () => { demandCount += 1; },
    },
    eventCache: { peek: () => null, warm: () => {} },
  });
  const input = scoutDemand();
  const result = await supply({ anchor: input.anchor, ...input, now: NOW });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.coverage, "covered");
  assert.equal(demandCount, 0);
});

test("catalog outage preserves trusted static feed behavior", async () => {
  const staticFeed = {
    id: "static-feed",
    label: "Static Feed",
    endpoint: "https://static.example/events",
    adapter: "linked_events",
    bbox: [12.8, 55.4, 13.3, 55.8],
    status: "active",
  };
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_EVENT_FEEDS: JSON.stringify([staticFeed]),
  }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => {
        throw new Error("database unavailable");
      },
    },
    eventCache: { peek: () => null, warm: () => {} },
  });

  const result = await supply({ anchor: { lat: 55.6, lng: 13 }, now: NOW });
  assert.equal(result.coverage, "covered");
  assert.equal(result.feeds[0].id, "static-feed");
});

test("migration runs the versioned SQL and always closes its pool", async () => {
  const calls = [];
  class FakePool {
    constructor(options) {
      calls.push(["constructor", options.connectionString]);
    }
    async query(sql) {
      calls.push(["query", sql]);
    }
    async end() {
      calls.push(["end"]);
    }
  }
  await migrateSourceCatalog({
    connectionString: "postgresql://catalog.invalid/parranda",
    PoolClass: FakePool,
  });
  assert.equal(calls[0][1], "postgresql://catalog.invalid/parranda");
  assert.match(calls[1][1], /CREATE TABLE IF NOT EXISTS pulse_source_profiles/);
  assert.match(calls[2][1], /CREATE TABLE IF NOT EXISTS pulse_source_scout_targets/);
  assert.deepEqual(calls[3], ["end"]);
});

test("discovery upsert cannot overwrite an approved, rejected or disabled row", () => {
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /WHEN pulse_source_profiles\.catalog_status = 'review_needed'/);
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /ELSE pulse_source_profiles\.catalog_status/);
});
