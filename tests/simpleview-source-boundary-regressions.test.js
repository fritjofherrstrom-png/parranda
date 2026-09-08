"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const { Readable } = require("node:stream");
const test = require("node:test");

const {
  SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
  SIMPLEVIEW_EUROPE_PLACE_CONTRACT,
  SIMPLEVIEW_EUROPE_PLACE_LIMITS,
  collectSimpleviewEuropePlaceFeed,
  extractDetailRecord,
  extractSimpleviewEuropeListItems,
} = require("../server/place-candidates/simpleview-europe-place-detail-source");
const {
  buildProfileReviewRevision,
} = require("../server/pulse-sources/source-profile-catalog");
const {
  runApprovedPlaceSourceRefresh,
} = require("../scripts/run-source-scout-worker");

const ENDPOINT = "https://guide.example/places/attractions";
const DETAIL = "https://guide.example/places/museum-p123";
const NAME = "Example Museum";
const ITEM = Object.freeze({
  product_id: "123",
  name: NAME,
  category: "Museum",
  type: "museum",
  detail_url: DETAIL,
});

function feed() {
  return {
    id: "reviewed-example-guide",
    label: "Example official guide",
    endpoint: ENDPOINT,
    adapter: SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
    adapter_contract_revision: SIMPLEVIEW_EUROPE_PLACE_CONTRACT,
    source_identity: "guide.example",
    evidence_family: "official",
    source_tier: "official",
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "bounded_refresh",
    bbox: [-4.3, 50.2, -3.9, 50.5],
    ...SIMPLEVIEW_EUROPE_PLACE_LIMITS,
  };
}

function list(category = "Museum") {
  return `<ol class="productList"><li class="Item prodTypeATTR p123">
    <h2 class="ProductName"><a class="ProductDetail" href="${DETAIL}">${NAME}</a></h2>
    <div class="type"><p>${category}</p></div>
  </li></ol>`;
}

function facts() {
  return `<h1 itemprop="name">${NAME}</h1>
    <meta itemprop="url" content="${DETAIL}">
    <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
      <meta itemprop="streetAddress" content="One Street">
      <meta itemprop="addressLocality" content="One Town">
    </div>`;
}

function detail(content = facts()) {
  return `<html itemscope itemtype="http://schema.org/LocalBusiness">
    <head><meta property="og:latitude" content="50.32345">
    <meta property="og:longitude" content="-4.12345"></head>
    <body><main>${content}</main></body></html>`;
}

function locationScript(properties) {
  return `<script>NewMind.registerNameSpace("NewMind.ETWP.ProductDetails.Location")["123"] = { ${properties} };</script>`;
}

test("Simpleview boundary fixtures contain one accepted real list and detail entity", () => {
  assert.deepEqual(extractSimpleviewEuropeListItems(list(), feed()), [ITEM]);
  const record = extractDetailRecord(detail(), ITEM, feed());
  assert.equal(record?.name, NAME);
  assert.equal(record?.type, "museum");
  assert.equal(record?.website, DETAIL);
});

test("commented or inert Simpleview lists never become acquisition links", () => {
  for (const html of [
    `<!-- ${list()} -->`,
    `<script type="text/plain">${list()}</script>`,
    `<template>${list()}</template>`,
  ]) {
    assert.deepEqual(extractSimpleviewEuropeListItems(html, feed()), []);
  }
});

test("commented or inert detail facts cannot create a source-backed place", () => {
  for (const content of [
    `<!-- ${facts()} -->`,
    `<script type="text/plain">${facts()}</script>`,
    `<template>${facts()}</template>`,
  ]) {
    assert.equal(extractDetailRecord(detail(content), ITEM, feed()), null);
  }
});

test("nested Organization facts are not owned by the enclosing LocalBusiness", () => {
  const nested = `<section itemscope itemtype="https://schema.org/Organization">${facts()}</section>`;
  assert.equal(extractDetailRecord(detail(nested), ITEM, feed()), null);
});

test("an unrelated nested entity cannot lend only its address to a place", () => {
  const split = `<h1 itemprop="name">${NAME}</h1><meta itemprop="url" content="${DETAIL}">
    <section itemscope itemtype="https://schema.org/Organization">
      <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="Unrelated Street">
        <meta itemprop="addressLocality" content="Unrelated Town">
      </div>
    </section>`;
  assert.equal(extractDetailRecord(detail(split), ITEM, feed()), null);
});

test("a nested place cannot borrow page-level coordinates from its parent entity", () => {
  const html = detail(`<section itemscope itemtype="https://schema.org/Museum">${facts()}</section>`)
    .replace('itemtype="http://schema.org/LocalBusiness"', 'itemtype="https://schema.org/Organization"');
  assert.equal(extractDetailRecord(html, ITEM, feed()), null);
});

test("encoded path separators cannot expand the reviewed detail subtree", () => {
  for (const path of ["%2foutside", "%5coutside", "%252foutside", "%2e%2e%2foutside"]) {
    assert.deepEqual(extractSimpleviewEuropeListItems(list().replace(DETAIL,
      `https://guide.example/places/${path}/museum-p123`), feed()), []);
  }
});

test("a present malformed NewMind coordinate cannot pass an agreement check", () => {
  for (const properties of [
    "Latitude: nope, Longitude: nope",
    "Latitude: 50.32345",
    "Latitude: NaN, Longitude: -4.12345",
  ]) {
    assert.equal(extractDetailRecord(detail(facts() + locationScript(properties)), ITEM, feed()), null);
  }
});

test("all published NewMind tuples for the same product must agree", () => {
  const matching = locationScript("Latitude: 50.32345, Longitude: -4.12345");
  const conflicting = locationScript("Latitude: 51.32345, Longitude: -3.12345");
  assert.equal(extractDetailRecord(detail(facts() + matching + conflicting), ITEM, feed()), null);
  assert.equal(extractDetailRecord(detail(facts() + conflicting + matching), ITEM, feed()), null);
});

test("broad activity labels do not manufacture a precise park or landmark category", () => {
  for (const category of ["Outdoors", "Family Fun Activities"]) {
    assert.deepEqual(extractSimpleviewEuropeListItems(list(category), feed()), []);
  }
});

test("expanded and mixed private DNS answers fail before any fetch", async () => {
  for (const addresses of [
    [{ address: "0:0:0:0:0:0:0:1", family: 6 }],
    [{ address: "0:0:0:0:0:ffff:7f00:1", family: 6 }],
    [{ address: "0:0:0:0:0:ffff:a00:1", family: 6 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "0:0:0:0:0:0:0:1", family: 6 }],
  ]) {
    let fetched = false;
    const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
      resolveHost: async () => addresses,
      fetcher: async () => { fetched = true; throw new Error("network must not be reached"); },
    });
    assert.equal(outcome.status, "failed");
    assert.equal(fetched, false, JSON.stringify(addresses));
  }
});

test("worker default Simpleview transport uses the validated DNS address, never global fetch", async (t) => {
  const requests = [];
  let globalFetchCalls = 0;
  const dnsCalls = [];
  const persisted = [];
  t.mock.method(globalThis, "fetch", async () => {
    globalFetchCalls += 1;
    throw new Error("unvalidated global transport forbidden");
  });
  t.mock.method(https, "request", (url, options, onResponse) => {
    const address = String(url);
    assert.ok([ENDPOINT, DETAIL].includes(address));
    assert.equal(typeof options.lookup, "function");
    options.lookup("guide.example", {}, (error, ip, family) => {
      assert.equal(error, null);
      assert.equal(ip, "8.8.8.8");
      assert.equal(family, 4);
    });
    requests.push(address);
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([Buffer.from(address === ENDPOINT ? list() : detail())]);
      response.statusCode = 200;
      response.headers = { "content-type": "text/html; charset=utf-8" };
      onResponse(response);
    };
    return request;
  });
  const result = await runApprovedPlaceSourceRefresh({
    target: {
      profile_key: "place-source-profile-v1:boundary-fixture",
      profile_revision: `sha256:${"a".repeat(64)}`,
      approval_key: "source-profile-approval-v1:boundary-fixture",
      source_id: feed().id,
      feed: feed(),
      approved_feed: feed(),
      lease_token: "fixture-lease",
    },
    runtime: {
      now: () => new Date("2026-08-20T00:00:00Z"),
      fetcher: globalThis.fetch,
      resolveHost: async (hostname) => {
        dnsCalls.push(hostname);
        return [{ address: "8.8.8.8", family: 4 }];
      },
    },
    catalog: {
      recordApprovedPlaceSourceOutcome: async (_target, outcome) => {
        persisted.push(outcome);
        return { status: "completed", candidate_count: outcome.records.length };
      },
    },
  });
  assert.equal(globalFetchCalls, 0);
  assert.deepEqual(requests, [ENDPOINT, DETAIL]);
  assert.deepEqual(dnsCalls, ["guide.example", "guide.example"]);
  assert.equal(result.status, "completed");
  assert.equal(persisted[0].status, "ok");
  assert.equal(persisted[0].records.length, 1);
});

test("adding Simpleview does not revise an unchanged PR 494 experience-card profile", () => {
  const profile = {
    profile_key: "place-source-profile-v1:example",
    place_context: { lat: 50.3, lng: -4.1, bounds: { west: -4.3, south: 50.2, east: -3.9, north: 50.5 } },
    place_source_candidates: [{
      id: "candidate-one",
      source_label: "Guide",
      url: "https://guide.example/places",
      status: "viable_place_provider_probe",
      adapter: "experience_card_place_list_detail_html",
      maps_to_existing_provider: true,
      trust_tier: "official",
      source_identity: "guide.example",
      terms_status: "open_license",
      candidate_kind: "place_list",
    }],
  };
  // Captured by evaluating the identical fixture with #494's catalog module
  // from merge 141f96946415997dfb42d22f5a5ed908848f254b, not from new code.
  assert.equal(buildProfileReviewRevision(profile),
    "sha256:36850798910afc3a5d8bf050cf9e02a341a7fffcef0ffccf976f7ab6022d8d0b");
});
