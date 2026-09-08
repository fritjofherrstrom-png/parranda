"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");

const { createSourceProfileCatalog } = require("../server/pulse-sources/source-profile-catalog");
const { runApprovedPlaceSourceRefresh } = require("../scripts/run-source-scout-worker");
const {
  SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
  SIMPLEVIEW_EUROPE_PLACE_CONTRACT,
  SIMPLEVIEW_EUROPE_PLACE_LIMITS,
} = require("../server/place-candidates/simpleview-europe-place-detail-source");

// This is a real SQL/persistence integration test with synthetic, in-memory
// source pages. It is NOT licensed-source, provider, browser, or Pi acceptance.
// Never fall back to PARRANDA_SOURCE_CATALOG_DATABASE_URL or another app DB.
const DATABASE_URL = process.env.PARRANDA_TEST_DATABASE_URL?.trim();
const NOW = new Date("2026-09-08T10:00:00.000Z");
const ANCHOR = Object.freeze({ lat: 50.32345, lng: -4.12345 });
const ENDPOINT = "https://guide.example/places/attractions";
const DETAIL = "https://guide.example/places/museum-p123";
const SOURCE_ID = "synthetic-reviewed-guide";

function discovery(suffix = "approved-fixture") {
  return {
    profile_key: `place-source-profile-v1:postgres-${suffix}`,
    place_context: {
      label: "Synthetic Region",
      ...ANCHOR,
      bounds: { west: -4.3, south: 50.2, east: -3.9, north: 50.5 },
    },
    runtime_review: { status: "unreviewed", reviewed_at: null, expires_at: null, feeds: [], place_sources: [] },
    place_source_candidates: [{
      id: "synthetic-list",
      source_label: "Synthetic Official Guide",
      url: ENDPOINT,
      status: "viable_place_provider_probe",
      adapter: SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
      maps_to_existing_provider: true,
      trust_tier: "official",
      source_identity: "guide.example",
      terms_status: "open_license",
      candidate_kind: "place_list",
    }],
  };
}

function listHtml() {
  return `<ol class="productList"><li class="prodTypeATTR p123">
    <h2 class="ProductName"><a class="ProductDetail" href="${DETAIL}">Synthetic Museum</a></h2>
    <div class="type"><p>Museum</p></div>
  </li></ol>`;
}

function detailHtml() {
  return `<html itemscope itemtype="http://schema.org/LocalBusiness">
    <head><meta property="og:latitude" content="50.32345">
      <meta property="og:longitude" content="-4.12345"></head>
    <body><h1 itemprop="name">Synthetic Museum</h1>
      <meta itemprop="url" content="${DETAIL}">
      <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="1 Fixture Street">
        <meta itemprop="addressLocality" content="Synthetic Town">
      </div>
    </body></html>`;
}

test("Simpleview real PostgreSQL approval, worker persistence, restart read and fail-closed bindings", {
  skip: !DATABASE_URL && "set PARRANDA_TEST_DATABASE_URL explicitly for a disposable test database",
  timeout: 60_000,
}, async (t) => {
  const schema = `parranda_test_simpleview_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^parranda_test_simpleview_[a-f0-9]{32}$/);
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await client.connect();
  let schemaCreated = false;
  const extraClients = [];
  t.after(async () => {
    for (const connection of extraClients) await connection.end();
    try {
      // The only dropped object is this test's freshly created random schema.
      if (schemaCreated) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  });
  await client.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await client.query(`SET search_path TO "${schema}"`);
  const migrationDir = path.resolve(__dirname, "../migrations");
  const migrations = fs.readdirSync(migrationDir).filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort();
  assert.ok(migrations.includes("004-trusted-place-source-lifecycle.sql"));
  for (const name of migrations) await client.query(fs.readFileSync(path.join(migrationDir, name), "utf8"));

  // Production deliberately catches SQL failures; make them explicit test
  // failures with the actual PostgreSQL error instead of misleading nulls.
  const sqlErrors = [];
  function makeCatalog(connection) {
    return createSourceProfileCatalog({
      now: () => new Date(NOW),
      query: async (sql, values) => {
        try { return await connection.query(sql, values); }
        catch (error) { sqlErrors.push(error); throw error; }
      },
    });
  }
  async function checked(promise) {
    const result = await promise;
    if (sqlErrors.length) throw new AggregateError(sqlErrors.splice(0), "real PostgreSQL catalog query failed");
    return result;
  }
  const catalog = makeCatalog(client);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("provider network forbidden in SQL fixture test"); });

  const profile = discovery();
  const negative = discovery("review-needed-control");
  for (const candidate of [profile, negative]) {
    const recorded = await checked(catalog.recordDiscovery(candidate));
    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.catalog_status, "review_needed");
  }
  assert.equal(await checked(catalog.claimApprovedPlaceSourceRefresh()), null);
  assert.equal((await checked(catalog.listFreshApprovedPlaceCandidatesForAnchor({ anchor: ANCHOR }))).length, 0);
  const inspection = await checked(catalog.inspectProfileForReview(profile.profile_key));
  assert.equal(inspection.status, "reviewable");
  const decision = {
    schema_version: 1,
    profile_key: profile.profile_key,
    expected_profile_revision: inspection.profile_revision,
    expires_at: "2026-10-01T00:00:00.000Z",
    place_sources: [{
      candidate_id: "synthetic-list",
      id: SOURCE_ID,
      label: "Synthetic Official Guide",
      evidence_family: "official",
      source_tier: "official",
      terms_status: "open_license",
      source_health: "healthy",
      runtime_policy: "bounded_refresh",
    }],
  };
  const staleDecision = { ...decision, expected_profile_revision: `sha256:${"0".repeat(64)}` };
  assert.equal((await checked(catalog.approveProfile(staleDecision, { operatorId: "sql-fixture-operator" }))).status, "rejected");
  const approved = await checked(catalog.approveProfile(decision, { operatorId: "sql-fixture-operator" }));
  assert.equal(approved.status, "recorded");
  assert.equal(approved.idempotent, false);
  assert.equal(approved.refresh_target_count, 1);
  const repeated = await checked(catalog.approveProfile(decision, { operatorId: "sql-fixture-operator" }));
  assert.equal(repeated.status, "recorded");
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.approval_key, approved.approval_key);
  const audits = await client.query("SELECT decision FROM pulse_source_profile_approvals WHERE profile_key = $1", [profile.profile_key]);
  assert.equal(audits.rowCount, 1);
  const targets = await client.query("SELECT feed FROM pulse_source_place_refresh_targets WHERE profile_key = $1", [profile.profile_key]);
  assert.equal(targets.rowCount, 1);
  const originalFeed = targets.rows[0].feed;
  assert.equal(originalFeed.adapter_contract_revision, SIMPLEVIEW_EUROPE_PLACE_CONTRACT);
  assert.equal(SIMPLEVIEW_EUROPE_PLACE_CONTRACT, "simpleview-europe-product-detail-html-v2");
  const { profile_reviewed_at: _reviewedAt, ...feedBinding } = originalFeed;
  assert.deepEqual(audits.rows[0].decision.place_feed_bindings[SOURCE_ID], feedBinding);
  for (const [key, value] of Object.entries(SIMPLEVIEW_EUROPE_PLACE_LIMITS)) assert.equal(originalFeed[key], value);

  const targetMutations = [
    ["endpoint", { ...originalFeed, endpoint: "https://guide.example/other/attractions" }],
    ["bbox", { ...originalFeed, bbox: [-180, -90, 180, 90] }],
    ["terms", { ...originalFeed, terms_status: "api_terms_compatible" }],
    ["limits", { ...originalFeed, max_details: originalFeed.max_details - 1 }],
    ["old v1", { ...originalFeed, adapter_contract_revision: "simpleview-europe-product-detail-html-v1" }],
    ["adapter downgrade", { ...originalFeed, adapter: "schema_org_place_html", adapter_contract_revision: "schema-org-place-html-v1" }],
  ];
  for (const [label, tampered] of targetMutations) {
    await client.query("UPDATE pulse_source_place_refresh_targets SET feed = $2::jsonb WHERE profile_key = $1", [profile.profile_key, JSON.stringify(tampered)]);
    assert.equal(await checked(catalog.claimApprovedPlaceSourceRefresh()), null, `${label} target must not be claimable`);
    const state = await client.query("SELECT status FROM pulse_source_place_refresh_targets WHERE profile_key = $1", [profile.profile_key]);
    assert.equal(state.rows[0].status, "pending", `${label} must fail in real SQL before leasing`);
  }
  await client.query("UPDATE pulse_source_place_refresh_targets SET feed = $2::jsonb WHERE profile_key = $1", [profile.profile_key, JSON.stringify(originalFeed)]);
  const substitutedId = "synthetic-unapproved-source";
  const substitutedFeed = {
    ...originalFeed,
    id: substitutedId,
    adapter: "schema_org_place_html",
    adapter_contract_revision: "schema-org-place-html-v1",
  };
  await client.query("UPDATE pulse_source_place_refresh_targets SET source_id = $2, feed = $3::jsonb WHERE profile_key = $1", [profile.profile_key, substitutedId, JSON.stringify(substitutedFeed)]);
  assert.equal(await checked(catalog.claimApprovedPlaceSourceRefresh()), null, "changing source id plus adapter cannot remove an immutable binding requirement");
  const substitutedState = await client.query("SELECT source_id, status FROM pulse_source_place_refresh_targets WHERE profile_key = $1", [profile.profile_key]);
  assert.equal(substitutedState.rows[0].source_id, substitutedId);
  assert.equal(substitutedState.rows[0].status, "pending");
  await client.query("UPDATE pulse_source_place_refresh_targets SET source_id = $2, feed = $3::jsonb WHERE profile_key = $1", [profile.profile_key, SOURCE_ID, JSON.stringify(originalFeed)]);
  const target = await checked(catalog.claimApprovedPlaceSourceRefresh());
  assert.ok(target, "approved intact target must be claimable");
  assert.deepEqual(target.approved_feed, audits.rows[0].decision.place_feed_bindings[SOURCE_ID]);
  assert.equal(target.profile_revision, approved.profile_revision);
  assert.equal(target.approval_key, approved.approval_key);
  // Mutating the database target after its intact lease must not let the
  // original worker complete against a different, unapproved parser contract.
  const downgradedFeed = { ...originalFeed, adapter: "schema_org_place_html", adapter_contract_revision: "schema-org-place-html-v1" };
  await client.query("UPDATE pulse_source_place_refresh_targets SET feed = $2::jsonb WHERE profile_key = $1", [profile.profile_key, JSON.stringify(downgradedFeed)]);
  const deniedCompletion = await checked(catalog.recordApprovedPlaceSourceOutcome(target, {
    status: "ok",
    observed_at: NOW.toISOString(),
    records: [{
      id: "reviewed-place:synthetic-downgrade-attempt",
      name: "Must Not Persist",
      type: "museum",
      ...ANCHOR,
      operator_reviewed_source: true,
      source_policy: "reviewed_profile_bounded_refresh",
    }],
  }));
  assert.equal(deniedCompletion.status, "ignored", "completion must check the immutable adapter binding too");
  assert.equal((await client.query("SELECT 1 FROM pulse_source_place_candidates WHERE profile_key = $1", [profile.profile_key])).rowCount, 0);
  assert.equal((await client.query("SELECT status FROM pulse_source_place_refresh_targets WHERE profile_key = $1", [profile.profile_key])).rows[0].status, "leased");
  await client.query("UPDATE pulse_source_place_refresh_targets SET feed = $2::jsonb WHERE profile_key = $1", [profile.profile_key, JSON.stringify(originalFeed)]);
  const requested = [];
  const result = await checked(runApprovedPlaceSourceRefresh({
    catalog,
    target,
    runtime: {
      now: () => new Date(NOW),
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
      fetcher: async () => { throw new Error("generic fetcher must not override Simpleview pinned transport"); },
      simpleviewFetcher: async (url) => {
        assert.ok([ENDPOINT, DETAIL].includes(url));
        requested.push(url);
        return new Response(url === ENDPOINT ? listHtml() : detailHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      },
    },
  }));
  assert.equal(result.status, "completed");
  assert.equal(result.candidate_count, 1);
  assert.deepEqual(requested, [ENDPOINT, DETAIL]);

  // A different DB connection and catalog instance prove the read is persisted,
  // not the originating worker's in-memory return value or cache.
  const restartedClient = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await restartedClient.connect();
  extraClients.push(restartedClient);
  await restartedClient.query(`SET search_path TO "${schema}"`);
  const restarted = makeCatalog(restartedClient);
  const rows = await checked(restarted.listFreshApprovedPlaceCandidatesForAnchor({ anchor: ANCHOR }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Synthetic Museum");
  assert.equal(rows[0].source_approval_key, approved.approval_key);
  assert.equal(rows[0].source_profile_revision, approved.profile_revision);
  assert.equal(rows[0].source_adapter_contract_revision, SIMPLEVIEW_EUROPE_PLACE_CONTRACT);
  assert.deepEqual(rows[0].source_provenance, { list_source_id: SOURCE_ID, list_url: ENDPOINT, detail_url: DETAIL });
  const controls = await client.query("SELECT catalog_status, approval_key FROM pulse_source_profiles WHERE profile_key = $1", [negative.profile_key]);
  assert.equal(controls.rows[0].catalog_status, "review_needed");
  assert.equal(controls.rows[0].approval_key, null);
  assert.equal((await client.query("SELECT 1 FROM pulse_source_place_refresh_targets WHERE profile_key = $1", [negative.profile_key])).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM pulse_source_place_candidates WHERE profile_key = $1", [negative.profile_key])).rowCount, 0);

  await client.query("UPDATE pulse_source_place_candidates SET record = jsonb_set(record, '{source_adapter_contract_revision}', to_jsonb($2::text)) WHERE profile_key = $1", [profile.profile_key, "simpleview-europe-product-detail-html-v1"]);
  assert.equal((await checked(restarted.listFreshApprovedPlaceCandidatesForAnchor({ anchor: ANCHOR }))).length, 0, "old v1 persisted rows fail closed");
  await client.query("UPDATE pulse_source_place_candidates SET record = jsonb_set(record, '{source_adapter_contract_revision}', to_jsonb($2::text)) WHERE profile_key = $1", [profile.profile_key, SIMPLEVIEW_EUROPE_PLACE_CONTRACT]);
  assert.equal((await checked(restarted.listFreshApprovedPlaceCandidatesForAnchor({ anchor: ANCHOR }))).length, 1);
  const changed = structuredClone(profile);
  changed.place_source_candidates[0].url = "https://guide.example/places/new-attractions";
  const rediscovered = await checked(catalog.recordDiscovery(changed));
  assert.equal(rediscovered.catalog_status, "review_needed");
  assert.notEqual(rediscovered.profile_revision, approved.profile_revision);
  assert.equal((await checked(restarted.listFreshApprovedPlaceCandidatesForAnchor({ anchor: ANCHOR }))).length, 0, "rediscovery cannot retain prior approved supply");
  assert.equal(await checked(restarted.claimApprovedPlaceSourceRefresh()), null);
  assert.equal(sqlErrors.length, 0);
  t.diagnostic("Real PostgreSQL lifecycle verified with synthetic pages only; no provider or production acceptance claimed.");
});
