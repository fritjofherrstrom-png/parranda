"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIVE_PROFILES_FOR_ANCHOR_SQL,
  QUALIFIED_PROFILES_FOR_ANCHOR_SQL,
  CLAIM_SCOUT_TARGET_SQL,
  COMPLETE_SCOUT_TARGET_SQL,
  DISCOVERY_HEALTH_FOR_ANCHOR_SQL,
  FAIL_SCOUT_TARGET_SQL,
  MAX_SCOUT_TARGETS,
  MAX_QUALIFICATION_BYTES,
  SCOUT_REFRESH_MS,
  SCOUT_REPROBE_MIN_MS,
  SOURCE_QUALIFICATION_SQL,
  UPSERT_SCOUT_TARGET_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  boundedScoutRefreshAt,
  createSourceProfileCatalog,
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");
const {
  collectAnchorEvents,
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
    terms_status: "open_license",
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

function qualifiedSourceProfile() {
  const profile = sourceProfile();
  profile.source_qualification = {
    schema_version: 1,
    status: "qualified_for_review",
    updated_at: NOW.toISOString(),
    qualified_candidate_count: 1,
    candidate_count: 1,
    activation_performed: false,
    candidates: [{
      candidate_id: "regional-events",
      endpoint: "https://events.example/api/events",
      adapter: "linked_events",
      source_identity: "events.example",
      status: "qualified_for_review",
      healthy_probe_count: 2,
      event_bearing_probe_count: 1,
      activation_performed: false,
      observations: [
        {
          candidate_id: "regional-events",
          endpoint: "https://events.example/api/events",
          adapter: "linked_events",
          source_identity: "events.example",
          observed_at: "2026-07-30T10:00:00.000Z",
          status: "healthy",
          accepted_event_count: 1,
        },
        {
          candidate_id: "regional-events",
          endpoint: "https://events.example/api/events",
          adapter: "linked_events",
          source_identity: "events.example",
          observed_at: "2026-07-28T10:00:00.000Z",
          status: "healthy",
          accepted_event_count: 1,
        },
      ],
      runtime_candidate: {
        id: "regional-events",
        label: "Regional Events",
        endpoint: "https://events.example/api/events",
        adapter: "linked_events",
        bbox: [12.8, 55.4, 13.3, 55.8],
        source_language: "sv",
        source_tier: "official",
        confidence: "low",
        source_family: "official_municipal_calendar",
        source_identity: "events.example",
        status: "active",
        runtime_policy: "bounded_refresh",
        terms_status: "open_license",
      },
    }],
  };
  return profile;
}

function placeSourceProfile() {
  const profile = sourceProfile({ approved: true });
  const candidate = profile.source_families[0].candidates[0];
  candidate.id = "regional-places";
  candidate.source_label = "Regional places";
  candidate.url = "https://guide.example/places";
  candidate.status = "viable_place_provider_probe";
  candidate.adapter = "schema_org_place_html";
  candidate.source_identity = "guide.example";
  profile.runtime_review.feeds = [];
  profile.runtime_review.place_sources = [{
    candidate_id: candidate.id,
    id: "regional-place-feed",
    label: candidate.source_label,
    endpoint: candidate.url,
    adapter: candidate.adapter,
    evidence_family: "official",
    source_tier: "official",
    source_identity: candidate.source_identity,
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "bounded_refresh",
  }];
  return profile;
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
    place_sources: [],
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

test("place-only profiles can be approved and geo-read through the same catalog boundary", async () => {
  const calls = [];
  const profile = placeSourceProfile();
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql === ACTIVE_PROFILES_FOR_ANCHOR_SQL) return { rows: [{ profile }] };
      return { rows: [{ profile_key: values[0], catalog_status: values[1] }] };
    },
  });

  const approved = await catalog.recordApprovedProfile(profile);
  assert.equal(approved.status, "recorded");
  const feeds = await catalog.listApprovedPlaceFeedsForAnchor({
    anchor: { lat: 55.6, lng: 13 },
    now: NOW,
  });
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].id, "regional-place-feed");
  assert.equal(calls[1].sql, ACTIVE_PROFILES_FOR_ANCHOR_SQL);
  assert.deepEqual(calls[1].values, [55.6, 13, NOW.toISOString()]);
});

test("geo reads expose only fresh qualified profiles as Pulse-only probation feeds", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ profile: qualifiedSourceProfile() }] };
    },
  });

  const feeds = await catalog.listQualifiedEventFeedsForAnchor({
    anchor: { lat: 55.6, lng: 13 },
    now: NOW,
  });

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].status, "probationary");
  assert.equal(feeds[0].confidence, "low");
  assert.equal(feeds[0].pulse_only, true);
  assert.equal(feeds[0].runtime_trust, "qualified_probationary");
  assert.equal(calls[0].sql, QUALIFIED_PROFILES_FOR_ANCHOR_SQL);
  assert.deepEqual(calls[0].values, [55.6, 13]);
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
  assert.deepEqual(
    await catalog.listQualifiedEventFeedsForAnchor({ anchor: { lat: 55.6, lng: 13 }, now: NOW }),
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

test("only resolver-attested demand enters the queue and broad scopes become local apertures", async () => {
  const calls = [];
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ target_key: values[0], status: "pending", observation_count: 1 }] };
    },
  });

  assert.equal((await catalog.recordScoutDemand({ anchor: { lat: 55.6, lng: 13 } })).status, "ignored");
  const broad = await catalog.recordScoutDemand({
    ...scoutDemand(),
    spatialScope: {
      source: "resolver_bounds",
      kind: "region",
      bounds: { west: 5, south: 45, east: 25, north: 65 },
    },
  });
  assert.equal(broad.status, "recorded");
  const broadScope = JSON.parse(calls[0].values[9]);
  assert.equal(broadScope.collection_mode, "local_anchor");
  assert.equal(broadScope.source, "resolver_anchor_aperture");
  assert.ok(broadScope.diagonal_km <= 15, "the original broad bounds never become a crawl target");
  const first = await catalog.recordScoutDemand(scoutDemand());
  const second = await catalog.recordScoutDemand(scoutDemand());

  assert.equal(first.status, "recorded");
  assert.equal(first.target_key, second.target_key, "the same trusted scope deduplicates deterministically");
  assert.equal(calls[1].sql, UPSERT_SCOUT_TARGET_SQL);
  assert.equal(calls[1].values[11], MAX_SCOUT_TARGETS);
  assert.deepEqual(JSON.parse(calls[1].values[8]), {
    region: "Test Region",
    country: "Test Country",
    country_code: "tc",
  });
});

test("catalog returns persisted discovery health and preserves pending queue truth", async () => {
  const persisted = {
    contract: "source_discovery_health_v1",
    status: "search_failed",
    search: {
      status: "failed",
      queried_count: 6,
      responding_query_count: 0,
      failed_query_count: 6,
      result_count: 0,
      seed_count: 0,
    },
    scout: { status: "not_run" },
    qualification: { status: "not_run" },
    reasons: ["source_discovery_search_failed"],
  };
  const catalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async (sql, values) => {
      assert.equal(sql, DISCOVERY_HEALTH_FOR_ANCHOR_SQL);
      assert.deepEqual(values, [55.6, 13]);
      return { rows: [{ status: "retry_wait", discovery_health: persisted }] };
    },
  });
  const health = await catalog.getDiscoveryHealthForAnchor({ anchor: { lat: 55.6, lng: 13 } });
  assert.equal(health.status, "search_failed");
  assert.equal(health.search.failed_query_count, 6);

  const pendingCatalog = createSourceProfileCatalog({
    now: () => NOW,
    query: async () => ({ rows: [{ status: "pending", discovery_health: null }] }),
  });
  const pending = await pendingCatalog.getDiscoveryHealthForAnchor({ anchor: { lat: 55.6, lng: 13 } });
  assert.equal(pending.status, "pending");
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
  assert.equal(calls[1].values[3], new Date(NOW.getTime() + SCOUT_REFRESH_MS).toISOString());

  const failed = await catalog.failScoutTarget(target, "postgresql://secret@private-host/db");
  assert.equal(failed.status, "retry_wait");
  assert.equal(calls[2].sql, FAIL_SCOUT_TARGET_SQL);
  assert.equal(calls[2].values[3], "source_scout_failed");
});

test("scout completion accepts only a bounded early re-probe", async () => {
  const earliest = new Date(NOW.getTime() + SCOUT_REPROBE_MIN_MS);
  const defaultRefresh = new Date(NOW.getTime() + SCOUT_REFRESH_MS);
  const nextDay = new Date("2026-07-31T00:05:00.000Z");

  assert.equal(boundedScoutRefreshAt(NOW, nextDay).toISOString(), nextDay.toISOString());
  assert.equal(boundedScoutRefreshAt(NOW, NOW).toISOString(), earliest.toISOString());
  assert.equal(
    boundedScoutRefreshAt(NOW, new Date("2026-09-01T00:00:00.000Z")).toISOString(),
    defaultRefresh.toISOString(),
  );
  assert.equal(boundedScoutRefreshAt(NOW, "not-a-date").toISOString(), defaultRefresh.toISOString());
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
  assert.equal(typeof catalog.listQualifiedEventFeedsForAnchor, "function");
  await catalog.close();
});

test("qualified-source runtime is one global opt-in and stays Pulse-only", async () => {
  let qualifiedReads = 0;
  let warmed = 0;
  const qualifiedFeed = {
    id: "qualified-feed",
    label: "Qualified Feed",
    endpoint: "https://events.example/api/events",
    adapter: "linked_events",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_tier: "official",
    confidence: "low",
    source_family: "official_municipal_calendar",
    source_identity: "events.example",
    terms_status: "open_license",
    status: "probationary",
    runtime_policy: "bounded_refresh",
    runtime_trust: "qualified_probationary",
    source_health: "qualified_probationary",
    pulse_only: true,
    profile_key: "place-source-profile-v1:test-region",
    profile_qualified_at: "2026-08-08T10:00:00.000Z",
    profile_expires_at: "2026-08-18T10:00:00.000Z",
  };
  const sourceCatalog = {
    listApprovedEventFeedsForAnchor: async () => [],
    listQualifiedEventFeedsForAnchor: async () => {
      qualifiedReads += 1;
      return [qualifiedFeed];
    },
  };
  const eventCache = { peek: () => null, warm: () => { warmed += 1; } };

  const disabled = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog,
    eventCache,
  });
  assert.equal((await disabled({ anchor: { lat: 55.6, lng: 13 }, now: NOW })).coverage, "uncovered");
  assert.equal(qualifiedReads, 0);

  const enabled = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
  }, { sourceCatalog, eventCache });
  const result = await enabled({ anchor: { lat: 55.6, lng: 13 }, now: NOW });
  assert.equal(result.coverage, "covered");
  assert.equal(result.pending, true);
  assert.equal(result.feeds[0].id, "qualified-feed");
  assert.equal(result.feeds[0].pulse_only, true);
  assert.equal(result.feeds[0].runtime_trust, "qualified_probationary");
  assert.equal(result.feeds[0].qualified_source_health, "qualified_probationary");
  assert.equal("reviewed_source_health" in result.feeds[0], false);
  assert.equal(qualifiedReads, 1);
  assert.equal(warmed, 1);
});

test("an approved source wins exact identity dedupe over probationary evidence", async () => {
  const approvedFeed = {
    id: "approved-feed",
    label: "Approved Feed",
    endpoint: "https://events.example/api/events",
    adapter: "linked_events",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_tier: "official",
    confidence: "medium",
    source_family: "official_municipal_calendar",
    source_identity: "events.example",
    terms_status: "open_license",
    source_health: "healthy",
    status: "active",
    runtime_policy: "bounded_refresh",
  };
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
  }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [approvedFeed],
      listQualifiedEventFeedsForAnchor: async () => [{
        ...approvedFeed,
        id: "probationary-feed",
        confidence: "low",
        status: "probationary",
        runtime_trust: "qualified_probationary",
        pulse_only: true,
      }],
    },
    eventCache: { peek: () => null, warm: () => {} },
  });

  const result = await supply({ anchor: { lat: 55.6, lng: 13 }, now: NOW });
  assert.deepEqual(result.feeds.map((feed) => feed.id), ["approved-feed"]);
  assert.notEqual(result.feeds[0].pulse_only, true);
  assert.equal(result.feeds[0].reviewed_source_health, "healthy");
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

test("an uncovered trusted place confirms demand before reporting discovery pending", async () => {
  let demand = null;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      recordScoutDemand: async (value) => {
        demand = value;
        return { status: "recorded", target_status: "pending" };
      },
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
  assert.equal(result.coverage, "uncovered");
  assert.equal(result.acquisition.discovery_health.status, "pending");
  assert.ok(result.acquisition.source_health.reasons.includes("source_discovery_pending"));
  assert.deepEqual(demand, input);
});

test("an unaccepted scout demand is unavailable rather than falsely pending", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      recordScoutDemand: async () => ({
        status: "ignored",
        reason: "untrusted_or_unbounded_scout_demand",
      }),
    },
    eventCache: { peek: () => null, warm: () => {} },
  });
  const input = scoutDemand();
  const result = await supply({ ...input, now: NOW });

  assert.equal(result.acquisition.discovery_health.status, "unavailable");
  assert.deepEqual(result.acquisition.discovery_health.reasons, ["source_discovery_demand_rejected"]);
});

test("uncovered Live preserves a stored observing discovery state", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      getDiscoveryHealthForAnchor: async () => ({
        contract: "source_discovery_health_v1",
        status: "observing",
        search: { status: "complete", queried_count: 6, responding_query_count: 6 },
        scout: { status: "complete", inspected_source_count: 2 },
        qualification: { status: "observing", candidate_count: 1 },
        reasons: ["source_discovery_observing"],
      }),
      recordScoutDemand: async () => ({ status: "recorded" }),
    },
    eventCache: { peek: () => null, warm: () => {} },
  });
  const input = scoutDemand();
  const result = await supply({ anchor: input.anchor, ...input, now: NOW });

  assert.equal(result.coverage, "uncovered");
  assert.equal(result.acquisition.discovery_health.status, "observing");
  assert.equal(result.acquisition.discovery_health.qualification.candidate_count, 1);
  assert.ok(result.acquisition.source_health.reasons.includes("source_discovery_observing"));
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
  assert.match(calls[3][1], /ADD COLUMN IF NOT EXISTS discovery_health JSONB/);
  assert.deepEqual(calls[4], ["end"]);
});

test("discovery upsert cannot overwrite an approved, rejected or disabled row", () => {
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /WHEN pulse_source_profiles\.catalog_status = 'review_needed'/);
  assert.match(UPSERT_DISCOVERY_PROFILE_SQL, /ELSE pulse_source_profiles\.catalog_status/);
});

// --------------------------------------------------------------------------
// Qualification expiry is evaluated against the SAME clock as the rest of the
// request. `now` reaching the supply is server-owned and injected (app.js takes
// it from the deployment clock, never from request payload), so a real-clock
// read here made this one gate disagree with every other time decision — and
// made the boundary untestable, since the verdict drifted with the wall clock.
//
// Both directions are pinned relative to the injected clock, so this cannot rot
// with the calendar the way the fixed-date case did.
// --------------------------------------------------------------------------

function qualifiedFeedExpiring(expiresAt) {
  return {
    id: "qualified-feed",
    label: "Qualified Feed",
    endpoint: "https://events.example/api/events",
    adapter: "linked_events",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_tier: "official",
    confidence: "low",
    source_family: "official_municipal_calendar",
    source_identity: "events.example",
    terms_status: "open_license",
    status: "probationary",
    runtime_policy: "bounded_refresh",
    runtime_trust: "qualified_probationary",
    source_health: "qualified_probationary",
    pulse_only: true,
    profile_key: "place-source-profile-v1:test-region",
    profile_qualified_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    profile_expires_at: expiresAt.toISOString(),
  };
}

async function qualifiedCoverageAt(expiresAt) {
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
  }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      listQualifiedEventFeedsForAnchor: async () => [qualifiedFeedExpiring(expiresAt)],
    },
    eventCache: { peek: () => null, warm: () => {} },
  });
  return supply({ anchor: { lat: 55.6, lng: 13 }, now: NOW });
}

test("a qualification expiring after the injected now is still runtime eligible", async () => {
  const result = await qualifiedCoverageAt(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));

  assert.equal(result.coverage, "covered");
  assert.equal(result.feeds[0].id, "qualified-feed");
});

test("a qualification expiring before the injected now is refused, not resurrected", async () => {
  const result = await qualifiedCoverageAt(new Date(NOW.getTime() - 60 * 1000));

  assert.equal(result.coverage, "uncovered");
  assert.deepEqual(result.feeds, []);
});

test("expiry does not drift with the real wall clock", async () => {
  // The whole failure mode: a fixture minted long before the run stayed valid
  // relative to its own injected clock, yet the gate consulted the real one.
  // Anchoring far in the real past must not change the verdict.
  const longPast = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const first = await qualifiedCoverageAt(longPast);
  const second = await qualifiedCoverageAt(longPast);

  assert.equal(first.coverage, "covered");
  assert.equal(second.coverage, first.coverage);
});

// --------------------------------------------------------------------------
// The warm/background collection path plans its own sources. It must expire
// qualifications against the SAME server-owned instant the request used, or one
// request holds two time bases and the warm result can contradict the first
// purely because the wall clock moved.
//
// These drive collectAnchorEvents directly — the function whose source plan was
// the leak — instead of stubbing eventCache.warm, which never reached it.
// --------------------------------------------------------------------------

const WARM_ANCHOR = { lat: 55.6, lng: 13 };

function warmQualifiedRegistry(expiresAt) {
  return [{
    id: "qualified-warm-feed",
    label: "Qualified Warm Feed",
    endpoint: "https://events.example/api/events",
    base: "https://events.example/api/events",
    adapter: "linked_events",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_tier: "official",
    terms_status: "open_license",
    status: "probationary",
    runtime_policy: "bounded_refresh",
    pulse_only: true,
    profile_key: "place-source-profile-v1:test-region",
    profile_qualified_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    profile_expires_at: expiresAt.toISOString(),
  }];
}

async function warmPlanFor(expiresAt) {
  return collectAnchorEvents({
    anchor: WARM_ANCHOR,
    now: NOW,
    registry: warmQualifiedRegistry(expiresAt),
    fetcher: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
}

test("warm collection keeps a qualification that expires after the injected now", async () => {
  const out = await warmPlanFor(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));

  // The plan was built, so the source survived the runtime gate. Before the
  // fix this expired against the real clock and the plan came back empty.
  assert.notEqual(out.coverage, "uncovered");
  assert.equal(out.feeds.some((feed) => feed.id === "qualified-warm-feed"), true);
});

test("warm collection excludes a qualification that expired before the injected now", async () => {
  const out = await warmPlanFor(new Date(NOW.getTime() - 60 * 1000));

  assert.equal(out.coverage, "uncovered");
  assert.deepEqual(out.feeds, []);
});

test("warm collection treats expiry exactly at the injected now as expired", async () => {
  // Matches the existing `expiresAt <= now` contract — the boundary is closed.
  const out = await warmPlanFor(new Date(NOW.getTime()));

  assert.equal(out.coverage, "uncovered");
  assert.deepEqual(out.feeds, []);
});

test("warm collection cannot disagree with the request plan over wall-clock drift", async () => {
  // NOW is fixed in the real past, so a qualification valid relative to it is
  // already expired in real time. Both entry points must still agree, because
  // both reason from the same injected instant.
  const expiresAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.ok(expiresAt.getTime() < Date.now(), "fixture must be real-clock expired for this to prove anything");

  const requestSide = await resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
  }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      listQualifiedEventFeedsForAnchor: async () => warmQualifiedRegistry(expiresAt),
    },
    eventCache: { peek: () => null, warm: () => {} },
  })({ anchor: WARM_ANCHOR, now: NOW });

  const warmSide = await warmPlanFor(expiresAt);

  assert.equal(requestSide.coverage, "covered");
  assert.notEqual(warmSide.coverage, "uncovered");
  assert.equal(
    warmSide.feeds.some((feed) => feed.id === "qualified-warm-feed"),
    requestSide.feeds.some((feed) => feed.id === "qualified-warm-feed"),
    "the two plans must reach the same verdict",
  );
});
