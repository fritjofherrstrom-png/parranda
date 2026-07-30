"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIVE_PROFILES_FOR_ANCHOR_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  createSourceProfileCatalog,
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");
const {
  resolveDefaultEventSupply,
} = require("../server/place-candidates/agnostic-event-supply");
const { migrateSourceCatalog } = require("../scripts/migrate-source-catalog");

const NOW = new Date("2026-07-30T10:00:00.000Z");

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
  const result = await catalog.recordDiscovery(sourceProfile({ approved: true }));

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
  assert.deepEqual(calls[2], ["end"]);
});

test("discovery upsert cannot overwrite an approved, rejected or disabled row", () => {
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /WHEN pulse_source_profiles\.catalog_status = 'review_needed'/);
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /ELSE pulse_source_profiles\.catalog_status/);
});
