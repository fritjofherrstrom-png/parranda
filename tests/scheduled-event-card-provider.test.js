"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractScheduledEventCards, extractScheduledEventContact } = require("../server/pulse-sources/scheduled-event-card-normalizer");
const { createScheduledEventCardProvider, matchesRobotsPath } = require("../server/pulse-sources/scheduled-event-card-provider");
const { inspectEventSourcePage } = require("../server/pulse-sources/local-event-source-scout");
const { qualifyDiscoveredSourceProfile, eventFeedsFromQualifiedSourceProfiles } = require("../server/pulse-sources/source-qualification");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { buildEventVenueQuery } = require("../server/place-candidates/event-venue-resolution");

const cards = fs.readFileSync(path.join(__dirname, "fixtures/drupal-scheduled-event-cards.html"), "utf8");
const contact = fs.readFileSync(path.join(__dirname, "fixtures/drupal-scheduled-event-contact.html"), "utf8");
const endpoint = "https://destination.example/nl/agenda/evenementen";
const options = { endpoint, timezone: "Europe/Brussels", sourceLanguage: "nl" };
const card = { title: "Bloemenmarkt", date: "2026-10-04", url: "https://destination.example/nl/agenda/bloemenmarkt" };
const detail = contact.replaceAll("https://visit.gent.be", "https://destination.example");
const secondDetail = detail.replaceAll("bloemenmarkt", "biomarkt").replaceAll("Bloe\u00admen\u00admarkt", "Bio\u00admarkt");
function response(body, url, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, url, headers: { get: (name) => headers[name] || null }, text: async () => body };
}
function fetchPages({ listing = cards, first = detail, second = secondDetail, robots = "User-agent: *\nAllow: /\n", calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    if (url.endsWith("/robots.txt")) return response(robots, url);
    if (url === endpoint) return response(listing, url);
    if (url === card.url) return response(first, url);
    if (url.endsWith("/biomarkt")) return response(second, url);
    assert.fail(`unexpected fetch: ${url}`);
  };
}
function collect(overrides = {}, context = { now: "2026-10-04T09:00:00Z" }) {
  return createScheduledEventCardProvider({ ...options, fetcher: fetchPages(), ...overrides }).create({ key: "anywhere" }).collect(context);
}

function eventField(html, field) {
  return html.replace('<article class="node node--type-event node--view-mode-full">',
    `<article class="node node--type-event node--view-mode-full">${field}`);
}
function withCountry(html, country) {
  return html.replace('typeof="PostalAddress">', `typeof="PostalAddress"><span property="addressCountry">${country}</span>`);
}

test("review: an event article cannot borrow matching page-shell identity for another event", async () => {
  for (const identity of [
    '<h2 class="node--title"><a href="/nl/agenda/biomarkt">Biomarkt</a></h2>',
    '<h2 class="node--title"><a href="/nl/agenda/biomarkt">Bloemenmarkt</a></h2>',
    '<h2 class="node--title">Biomarkt</h2>',
    '<a rel="bookmark" href="/nl/agenda/biomarkt">Details</a>',
  ]) {
    const html = eventField(detail, identity);
    assert.equal(extractScheduledEventContact(html, card), null);
    assert.equal((await collect({ detailLimit: 1, fetcher: fetchPages({ first: html }) })).time_sensitive_events.length, 0);
  }
  assert.ok(extractScheduledEventContact(eventField(detail,
    '<h2 class="node--title"><a href="/nl/agenda/bloemenmarkt">Bloe<em>men</em>markt</a></h2>'), card));
});

test("review: an explicit detail date must agree with its listing occurrence", async () => {
  const html = eventField(detail, '<div class="field--name-field-schedule">5 oktober 2026</div>');
  assert.equal(extractScheduledEventContact(html, card), null);
  assert.equal((await collect({ detailLimit: 1, fetcher: fetchPages({ first: html }) })).time_sensitive_events.length, 0);
  assert.ok(extractScheduledEventContact(eventField(detail, '<div class="field--name-field-schedule">4 oktober 2026</div>'), card));
  assert.ok(extractScheduledEventContact(detail, card), "absence of a detail occurrence is supported");
});

test("review: published address and directions countries must agree", async () => {
  for (const country of ["US", "NL"]) {
    const html = withCountry(detail, "BE").replace("destination=Kouter+9000+Gent+BE", `destination=Kouter+9000+Gent+${country}`);
    assert.equal(extractScheduledEventContact(html, card), null);
    assert.equal((await collect({ detailLimit: 1, fetcher: fetchPages({ first: html }) })).time_sensitive_events.length, 0);
  }
});

test("review: the source country survives normalization and overrides unrelated lookup context", async () => {
  const result = await collect({ detailLimit: 1, fetcher: fetchPages({ first: withCountry(detail, "BE") }) });
  assert.equal(result.collection_status.status, "ok");
  const event = normalizeTimeSensitiveSourceEvent(result.time_sensitive_events[0], { timezone: options.timezone, now: "2026-10-04T09:00:00Z" });
  assert.equal(event.country, "BE");
  const query = buildEventVenueQuery(event, { placeContext: { country: "France", region: "Île-de-France" } });
  assert.match(query, /\bBE\b/);
  assert.doesNotMatch(query, /France/);
  const input = discovery();
  const queries = [];
  const supplied = await collectAnchorEvents({ anchor: input.anchor, now: "2026-10-04T09:00:00Z",
    registry: [{ ...input.manifests[0], status: "active", runtime_policy: "bounded_refresh", terms_status: "open_license", source_scoped_pulse: true }],
    placeContext: { country: "France", region: "Île-de-France" }, fetcher: fetchPages(),
    venueResolver: async (value) => { queries.push(value); return []; } });
  assert.ok(queries.length > 0);
  assert.ok(queries.every((value) => /\bBE\b/.test(value) && !/France/.test(value)));
  const suppliedEvents = [...supplied.tonight, ...supplied.this_week];
  assert.equal(suppliedEvents.length, 2);
  assert.ok(suppliedEvents.every((value) => value.address.endsWith(", BE")));
});

test("published countries are optional facts, with names compared only in the page's language", () => {
  assert.equal(extractScheduledEventContact(`<html lang="nl">${withCountry(detail, "België")}</html>`, card).country, "BE");
  assert.equal(extractScheduledEventContact(withCountry(detail, "Netherlands"), card), null);
  assert.equal(extractScheduledEventContact(withCountry(withCountry(detail, "BE"), "NL"), card), null);
  const noRouteCountry = detail.replace("destination=Kouter+9000+Gent+BE", "destination=Kouter+9000+Gent");
  assert.equal(extractScheduledEventContact(noRouteCountry, card).country, undefined, "country is never inferred from the host or timezone");
  assert.equal(extractScheduledEventContact(withCountry(noRouteCountry, "BE"), card).country, "BE");
});

test("review: a directly hidden route link is not venue evidence", async () => {
  for (const hidden of ["hidden", 'aria-hidden="true"']) {
    const html = detail.replace('class="button--map-route-link"', `${hidden} class="button--map-route-link"`);
    assert.equal(extractScheduledEventContact(html, card), null);
    assert.equal((await collect({ detailLimit: 1, fetcher: fetchPages({ first: html }) })).time_sensitive_events.length, 0);
  }
});

test("review: line and block boundaries cannot manufacture an explicit year", async () => {
  for (const label of ["4 oktober 20<br>26", "4 oktober <div>20</div><div>26</div>"]) {
    const listing = cards.replaceAll("4 oktober 2026", label);
    assert.equal(extractScheduledEventCards(listing, { sourceUrl: endpoint }).recognized, false);
    assert.equal((await collect({ fetcher: fetchPages({ listing }) })).time_sensitive_events.length, 0);
  }
  assert.equal(extractScheduledEventCards(cards.replaceAll("4 oktober 2026", "<em>4</em> oktober <strong>2026</strong>"), { sourceUrl: endpoint }).recognized, true);
});

for (const tag of ["figure", "address", "fieldset"]) {
  const listing = cards.replaceAll("4 oktober 2026", `4 oktober <${tag}>20</${tag}><${tag}>26</${tag}>`);
  test(`review #5: ${tag} boundaries cannot manufacture a parser year`, () => {
    const parsed = extractScheduledEventCards(listing, { sourceUrl: endpoint });
    assert.equal(parsed.recognized, false);
    assert.deepEqual(parsed.cards, []);
  });
  test(`review #5: ${tag} boundaries cannot supply fabricated provider occurrences`, async () => {
    const calls = [];
    const result = await collect({ fetcher: fetchPages({ listing, calls }) });
    assert.equal(result.collection_status.status, "failed");
    assert.equal(result.collection_status.reason, "source_payload_invalid");
    assert.deepEqual(result.time_sensitive_events, []);
    assert.deepEqual(calls, ["https://destination.example/robots.txt", endpoint], "no fabricated date can trigger detail requests");
  });
}

test("non-phrasing and unknown containers separate year fragments conservatively", () => {
  for (const tag of ["figcaption", "details", "custom-container"]) {
    const listing = cards.replaceAll("4 oktober 2026", `4 oktober <${tag}>20</${tag}><${tag}>26</${tag}>`);
    assert.equal(extractScheduledEventCards(listing, { sourceUrl: endpoint }).recognized, false, tag);
  }
});

test("legitimate inline emphasis retains complete dates through the actual provider", async () => {
  for (const label of ["<em>4</em> oktober <strong>2026</strong>", "4 oktober <span>20<strong>26</strong></span>"]) {
    const listing = cards.replaceAll("4 oktober 2026", label);
    assert.equal(extractScheduledEventCards(listing, { sourceUrl: endpoint }).recognized, true);
    const result = await collect({ fetcher: fetchPages({ listing }) });
    assert.equal(result.collection_status.status, "ok");
    assert.equal(result.time_sensitive_events.length, 2);
    for (const event of result.time_sensitive_events) {
      assert.equal(event.starts_on, "2026-10-04");
      assert.equal(event.country, "BE");
      assert.equal(event.starts_at, undefined);
      assert.equal(event.lat, undefined);
    }
  }
});

test("review: a detail DOM-budget error invalidates partial rows and qualification evidence", async () => {
  const second = secondDetail + "<i></i>".repeat(25000);
  for (const tail of ["<i></i>".repeat(25000), "<i hidden></i>".repeat(25000),
    "<div>".repeat(1000) + "x" + "</div>".repeat(1000), "x".repeat(1100000)]) {
    const result = await collect({ fetcher: fetchPages({ second: secondDetail + tail }) });
    assert.equal(result.collection_status.status, "failed");
    assert.equal(result.collection_status.reason, "source_payload_invalid");
    assert.equal(result.time_sensitive_events.length, 0);
  }
  const qualified = await qualifyDiscoveredSourceProfile({ ...discovery(), now: "2026-10-04T09:00:00Z", fetcher: fetchPages({ second }),
    venueResolver: () => assert.fail("an invalid collection cannot reach geocoding") });
  const observation = qualified.qualification.candidates[0].observations[0];
  assert.notEqual(observation.status, "healthy", "existing aggregate health may label a failed sole source unavailable");
  assert.ok(observation.reasons.includes("source_failures_present"));
  assert.equal(observation.normalized_event_count, 0);
  assert.equal(observation.accepted_event_count, 0);
  assert.equal(qualified.qualification.candidates[0].healthy_probe_count, 0);
  assert.equal(qualified.qualification.candidates[0].event_bearing_probe_count, 0);
});

test("an inspected but unsupported detail remains distinct from a failed inspection", async () => {
  const result = await collect({ fetcher: fetchPages({ second: secondDetail.replaceAll("PostalAddress", "Organization") }) });
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events.length, 1);
});

test("real dated cards and their event-owned contact address yield factual occurrences on an unrelated host", async () => {
  const calls = [];
  const result = await collect({ fetcher: fetchPages({ calls }) });
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events.length, 2);
  assert.equal(calls.length, 4, "robots, list, and two explicitly identified details only");
  const event = result.time_sensitive_events[0];
  assert.equal(event.title, "Bloemenmarkt");
  assert.equal(event.address, "Kouter, 9000, Gent, BE");
  assert.equal(event.country, "BE", "directions publish the country even without a separate addressCountry field");
  assert.equal(event.source_url, card.url);
  assert.equal(event.provenance.source_page, endpoint);
  assert.deepEqual(event.time_window.dates, ["2026-10-04"]);
  assert.equal(event.starts_at, undefined);
  assert.equal(event.ends_at, undefined);
  assert.equal(event.lat, undefined);
  assert.equal(event.recurrence, undefined);
  const normalized = normalizeTimeSensitiveSourceEvent(event, { timezone: options.timezone, now: "2026-10-04T09:00:00Z" });
  assert.equal(normalized.timing_relevance, "unknown", "unknown hours cannot imply currently open");
});

test("exact dates are multilingual facts; invalid dates, prose, ranges and recurrence remain unsupported", () => {
  for (const label of ["4 October 2026", "4 octobre 2026", "4 Oktober 2026", "4 octubre 2026", "2026-10-04"]) {
    assert.equal(extractScheduledEventCards(cards.replaceAll("4 oktober 2026", label), { sourceUrl: endpoint }).recognized, true, label);
  }
  for (const label of ["31 februari 2026", "4 oktober", "Every Sunday", "4 oktober 2026 tot 5 oktober 2026", "Cancelled 4 oktober 2026", "4 oktober 2026 09:00", "04/10/2026"]) {
    assert.equal(extractScheduledEventCards(cards.replaceAll("4 oktober 2026", label), { sourceUrl: endpoint }).recognized, false, label);
  }
  const conflict = cards + cards.replaceAll("4 oktober 2026", "5 oktober 2026");
  assert.equal(extractScheduledEventCards(conflict, { sourceUrl: endpoint }).recognized, false);
});

test("detail identity and semantic ownership prevent unrelated contacts and map markers becoming a venue", () => {
  const variants = [
    detail.replaceAll('href="https://destination.example/nl/agenda/bloemenmarkt"', 'href="https://other.example/wrong"'),
    detail.replaceAll("Bloe\u00admen\u00admarkt", "Another event"),
    detail.replaceAll("field--name-field-contact", "field--name-field-related"),
    detail.replaceAll("node--type-event", "node--type-poi"),
    detail.replaceAll("PostalAddress", "Organization"),
    detail.replaceAll('property="streetAddress"', 'property="description"'),
    detail.replaceAll('property="addressLocality"', 'property="description"'),
    detail.replaceAll("field--name-field-geofield", "field--name-field-related"),
    detail.replaceAll("destination=Kouter+9000+Gent+BE", "destination=Other+Office+9000+Gent+BE"),
    detail.replace('</article>\n</div>', '</article><article class="node--type-contact"><h4>Other</h4></article>\n</div>'),
    `<template>${detail}</template>`,
    `<!-- ${detail.replace(/<!--[\s\S]*?-->/g, "")} -->`,
  ];
  for (const html of variants) assert.equal(extractScheduledEventContact(html, card), null);
  const geometry = '<script type="application/json">{"leaflet":{"features":[{"lat":51.05,"lon":3.72,"entity_id":"other"}]}}</script>';
  assert.deepEqual(extractScheduledEventContact(detail + geometry, card), { address: "Kouter, 9000, Gent, BE", city: "Gent", country: "BE", place_context: "Bloemenmarkt Kouter" });
});

test("stale cards and unknown recurrence are not expanded into this week", async () => {
  const calls = [];
  const result = await collect({ fetcher: fetchPages({ calls }) }, { now: "2026-10-05T09:00:00Z" });
  assert.equal(result.collection_status.status, "empty");
  assert.equal(result.time_sensitive_events.length, 0);
  assert.equal(calls.length, 2);
});

test("timezone, language and collection date are required before network collection", async () => {
  for (const missing of [{ timezone: null }, { sourceLanguage: null }]) {
    const result = await collect({ ...missing, fetcher: () => assert.fail("no fetch") });
    assert.equal(result.collection_status.status, "unavailable");
  }
  assert.equal((await collect({ fetcher: () => assert.fail("no fetch") }, {})).collection_status.reason, "collection_context_unavailable");
});

test("robots allowance is checked on followed paths, including wildcard and end rules", async () => {
  for (const rule of ["/nl/agenda/bloemenmarkt", "/*/agenda/bloemenmarkt$"]) {
    const calls = [];
    const result = await collect({ fetcher: fetchPages({ calls, robots: `User-agent: *\nDisallow: ${rule}\n` }) });
    assert.equal(result.collection_status.reason, "source_robots_disallowed");
    assert.ok(!calls.includes(card.url));
    assert.equal(result.time_sensitive_events.length, 0);
  }
  assert.equal(matchesRobotsPath("/a/*/c$", "/a/b/c"), true);
  assert.equal(matchesRobotsPath("/a/*/c$", "/a/b/c/d"), false);
});

test("off-origin, credential and fragment detail identities cannot be followed", () => {
  for (const prefix of ["https://other.example/nl/agenda/", "https://user:pass@destination.example/nl/agenda/", "#"]) {
    const parsed = extractScheduledEventCards(cards.replaceAll("/nl/agenda/", prefix), { sourceUrl: endpoint });
    assert.equal(parsed.recognized, false);
  }
});

test("a cross-origin redirect fails before the target is fetched; partial rows do not count as a healthy probe", async () => {
  const calls = [];
  const base = fetchPages({ calls });
  const result = await collect({ fetcher: async (url, init) => {
    if (url.endsWith("/biomarkt")) return response("", url, 302, { location: "https://private.example/detail" });
    return base(url, init);
  } });
  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.reason, "source_redirect_cross_origin");
  assert.equal(result.time_sensitive_events.length, 0);
  assert.ok(!calls.some((url) => url.includes("private.example")));
});

test("a redirect to a disallowed same-origin path fails before that path is fetched", async () => {
  const calls = [];
  const base = fetchPages({ calls, robots: "User-agent: *\nDisallow: /admin/\n" });
  const result = await collect({ fetcher: async (url, init) => url === card.url
    ? response("", url, 302, { location: "/admin/event" }) : base(url, init) });
  assert.equal(result.collection_status.reason, "source_robots_disallowed");
  assert.ok(!calls.some((url) => url.includes("/admin/")));
});

test("collection respects detail, payload and total time budgets", async () => {
  const calls = [];
  const one = await collect({ detailLimit: 1, fetcher: fetchPages({ calls }) });
  assert.equal(one.time_sensitive_events.length, 1);
  assert.equal(calls.length, 3);
  const oversized = await collect({ fetcher: async (url) => response("x".repeat(2 * 1024 * 1024 + 1), url) });
  assert.equal(oversized.collection_status.reason, "source_payload_invalid");
  const timeout = await collect({ timeoutMs: 50, fetcher: async () => new Promise(() => {}) });
  assert.equal(timeout.collection_status.reason, "source_timeout");
});

test("unknown robots and unsafe initial endpoints stop before HTML is fetched", async () => {
  const calls = [];
  const unknown = await collect({ fetcher: fetchPages({ calls, robots: "User-agent: some-other-bot\nAllow: /\n" }) });
  assert.equal(unknown.collection_status.reason, "source_robots_unavailable");
  assert.equal(calls.length, 1);
  for (const endpoint of ["https://127.0.0.1/calendar", "https://localhost/calendar", "https://user:pass@destination.example/calendar", "http://destination.example/calendar"]) {
    const result = await collect({ endpoint, fetcher: () => assert.fail("unsafe fetch") });
    assert.equal(result.collection_status.reason, "source_endpoint_unavailable");
  }
});

test("streaming and declared payload limits cancel/refuse oversized bodies", async () => {
  let read = false;
  const declared = await collect({ fetcher: async (url) => ({ ...response("", url, 200, { "content-length": String(2 * 1024 * 1024 + 1) }), text: async () => { read = true; return ""; } }) });
  assert.equal(declared.collection_status.reason, "source_payload_invalid");
  assert.equal(read, false);
  let cancelled = false;
  const streamed = await collect({ fetcher: async (url) => ({ ...response("", url), body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(2 * 1024 * 1024 + 1) }), cancel: async () => { cancelled = true; },
  }) } }) });
  assert.equal(streamed.collection_status.reason, "source_payload_invalid");
  assert.equal(cancelled, true);
});

test("DOM budget exhaustion and inert/nested facts reject the entire interface", () => {
  for (const tail of ["<i></i>".repeat(25000), "<div>".repeat(1000) + "x" + "</div>".repeat(1000), "x".repeat(1100000)]) {
    assert.equal(extractScheduledEventCards(cards + tail, { sourceUrl: endpoint }).recognized, false);
  }
  for (const tag of ["article", "script", "style", "template", "noscript"]) {
    assert.equal(extractScheduledEventCards(cards.replaceAll("4 oktober 2026", `<${tag}>4 oktober 2026</${tag}>`), { sourceUrl: endpoint }).recognized, false);
  }
});

function discovery(terms = "open_license") {
  const seed = { url: endpoint, family: "official_tourism_calendar", trust_tier: "official", source_language: "nl", timezone: "Europe/Brussels", terms_status: terms };
  const context = { anchor: { lat: 51.05, lng: 3.72 }, bounds: [3.5, 50.9, 3.9, 51.2] };
  const inspected = inspectEventSourcePage({ seed, html: cards, context });
  const profile = { profile_key: "place-source-profile-v1:calendar-contract", place_context: context, source_families: [{ family: seed.family, candidates: inspected.candidates }] };
  const manifests = inspected.manifest_candidates.map((manifest) => ({ ...manifest, review: { ...manifest.review, robots_status: "allowed" } }));
  return { inspected, profile, manifests, anchor: context.anchor };
}

test("discovery probes through the real provider, trusted address resolver and qualification gates", async () => {
  const input = discovery();
  assert.deepEqual(input.inspected.detected, ["scheduled_event_cards"]);
  assert.equal(input.inspected.candidates[0].maps_to_existing_provider, true);
  assert.equal(input.manifests[0].status, "review-needed");
  const queries = [];
  const result = await qualifyDiscoveredSourceProfile({ ...input, now: "2026-10-04T09:00:00Z", fetcher: fetchPages(), venueResolver: async (query) => {
    queries.push(query);
    return [{ lat: 51.05, lng: 3.72, confidence: "medium", provenance: { source: "trusted_fixture" } }];
  } });
  const observation = result.qualification.candidates[0].observations[0];
  assert.equal(observation.status, "healthy");
  assert.equal(observation.normalized_event_count, 2);
  assert.equal(observation.accepted_event_count, 2);
  assert.ok(queries.every((query) => query.includes("Kouter, 9000, Gent")));
  assert.equal(result.qualification.status, "observing");
  assert.equal(result.qualification.activation_performed, false);
  assert.deepEqual(eventFeedsFromQualifiedSourceProfiles([result.profile], { now: "2026-10-04T09:00:00Z" }), []);
});

test("one probe, unresolved venue and identity drift cannot supply qualified runtime feeds", async () => {
  for (const { terms, resolver } of [
    { terms: "unknown", resolver: async () => [{ lat: 51.05, lng: 3.72, confidence: "medium" }] },
    { terms: "open_license", resolver: async () => [] },
    { terms: "open_license", resolver: async () => [{ lat: 51.05, lng: 3.72, confidence: "medium" }, { lat: 51.051, lng: 3.72, confidence: "medium" }] },
  ]) {
    const input = discovery(terms);
    const result = await qualifyDiscoveredSourceProfile({ ...input, now: "2026-10-04T09:00:00Z", fetcher: fetchPages(), venueResolver: resolver });
    assert.equal(result.qualification.activation_performed, false);
    assert.deepEqual(eventFeedsFromQualifiedSourceProfiles([result.profile], { now: "2026-10-04T09:00:00Z" }), []);
  }
  const drift = discovery();
  drift.manifests[0].endpoint = "https://other.example/calendar";
  const result = await qualifyDiscoveredSourceProfile({ ...drift, now: "2026-10-04T09:00:00Z", fetcher: () => assert.fail("identity mismatch") });
  assert.deepEqual(result.qualification.reasons, ["no_probeable_source_candidates"]);
});

test("unresolved and ambiguous addresses stay mapless and are excluded from near-me results", async () => {
  for (const resolver of [async () => [], async () => [{ lat: 51.05, lng: 3.72, confidence: "medium" }, { lat: 51.051, lng: 3.72, confidence: "medium" }]]) {
    const input = discovery();
    const registry = [{ ...input.manifests[0], status: "active", runtime_policy: "bounded_refresh", terms_status: "open_license", source_scoped_pulse: true }];
    const args = { anchor: input.anchor, registry, now: "2026-10-04T09:00:00Z", fetcher: fetchPages(), venueResolver: resolver };
    const sourceScoped = await collectAnchorEvents(args);
    const events = [...sourceScoped.tonight, ...sourceScoped.this_week];
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.lat === null && event.lng === null && event.geometry_status === "unresolved" && event.route_eligible === false));
    const nearby = await collectAnchorEvents({ ...args, scope: { kind: "near_me", anchor: input.anchor, radius_m: 2000 } });
    assert.equal(nearby.tonight.length + nearby.this_week.length, 0);
  }
});

test("two fixture-provider observations allow factual publication with unknown rights while explicit restrictions block", async () => {
  for (const terms of ["open_license", "unknown", "restricted", "permission_required"]) {
    const input = discovery(terms);
    const venueResolver = async () => [{ lat: 51.05, lng: 3.72, confidence: "medium" }];
    const first = await qualifyDiscoveredSourceProfile({ ...input, now: "2026-10-04T09:00:00Z", fetcher: fetchPages(), venueResolver });
    const second = await qualifyDiscoveredSourceProfile({ ...input, now: "2026-10-05T09:00:00Z", previousQualification: first.qualification,
      fetcher: fetchPages({ listing: cards.replaceAll("4 oktober 2026", "5 oktober 2026") }), venueResolver });
    assert.equal(second.qualification.activation_performed, false);
    const feeds = eventFeedsFromQualifiedSourceProfiles([second.profile], { now: "2026-10-05T10:00:00Z" });
    if (["restricted", "permission_required"].includes(terms)) assert.deepEqual(feeds, []);
    else {
      assert.equal(feeds.length, 1);
      assert.equal(feeds[0].adapter, "scheduled_event_cards");
      assert.equal(feeds[0].confidence, "low");
      assert.equal(feeds[0].pulse_only, true);
      assert.equal(feeds[0].status, "probationary");
      if (terms === "unknown") {
        assert.equal(feeds[0].terms_status, "unknown");
        assert.equal(feeds[0].license == null, true, "do not invent an open licence");
        assert.equal(feeds[0].source_scoped_pulse, false, "unknown rights require actual venue geometry");
      }
    }
  }
});
