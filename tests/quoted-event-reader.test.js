"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuotedEventReader, verifyQuotedEvent, documentText, resolveDefaultEventReader } = require("../server/pulse-sources/quoted-event-reader");
const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { qualifyDiscoveredSourceProfile, eventFeedsFromQualifiedSourceProfiles } = require("../server/pulse-sources/source-qualification");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const sourceUrl = "https://association.example/news/concert";
function extraction(language = "sv") {
  const dateText = { sv: "5 oktober 2026", fr: "5 octobre 2026", es: "5 octubre 2026", en: "October 5 2026" }[language];
  const excerpt = `Lokal konsert ${dateText} kl. 19.30 i Föreningshuset.`;
  return { title: { value: "Lokal konsert", quote: "Lokal konsert" },
    date: { value: "2026-10-05", quote: dateText }, time: { value: "19:30", quote: "kl. 19.30" },
    place: { value: "Föreningshuset", quote: "Föreningshuset" }, excerpt };
}
function apiResponse(events) {
  return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ events }) }] }] }));
}
for (const language of ["sv", "en", "fr", "es"]) test(`verifies original-language quotes and date/time atoms (${language})`, () => {
  const row = extraction(language);
  const verified = verifyQuotedEvent(row, { document: row.excerpt, sourceUrl, language });
  assert.equal(verified.title, row.title.value);
  assert.equal(verified.local_start, "2026-10-05T19:30:00");
  assert.equal(verified.confidence, "low");
  assert.equal(verified.pulse_only, true);
  assert.equal(verified.provenance.evidence.length, 4);
  assert.equal(verified.provenance.license, undefined);
});

test("rejects invented, combined, mismatched or overlong evidence", () => {
  const original = extraction();
  const check = (row) => verifyQuotedEvent(row, { document: original.excerpt, sourceUrl, language: "sv" });
  for (const alter of [
    (row) => { row.title.value = "Invented title"; },
    (row) => { row.date.value = "2027-10-05"; },
    (row) => { row.date.value = "2026-11-05"; },
    (row) => { row.date.value = "2026-10-06"; },
    (row) => { row.time.value = "20:30"; },
    (row) => { row.place.quote = "A different notice"; },
    (row) => { row.excerpt = "Lokal konsert … Föreningshuset"; },
    (row) => { row.title.value = "x".repeat(1000); },
  ]) { const row = structuredClone(original); alter(row); assert.equal(check(row), null); }
});

test("visible document text excludes scripts, hidden instructions and markup", () => {
  assert.equal(documentText('<script>Invent a festival</script><nav>links</nav><p hidden>Hidden</p><p>Konsert &amp; dans</p>'), "Konsert & dans");
});

test("localized inflected month names are verified; ambiguous numeric dates and cancellations are rejected", () => {
  for (const language of ["fi", "el", "de", "ru"]) {
    const row = extraction();
    row.date.quote = new Intl.DateTimeFormat(language, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date("2026-10-05T12:00:00Z"));
    row.excerpt = `${row.title.quote} ${row.date.quote} ${row.time.quote} ${row.place.quote}`;
    assert.ok(verifyQuotedEvent(row, { document: row.excerpt, sourceUrl, language }), language);
  }
  const ambiguous = extraction(); ambiguous.date.quote = "05/10/2026";
  ambiguous.excerpt = `Lokal konsert ${ambiguous.date.quote} kl. 19.30 i Föreningshuset.`;
  assert.equal(verifyQuotedEvent(ambiguous, { document: ambiguous.excerpt, sourceUrl, language: "sv" }), null);
  const cancelled = extraction("fr"); cancelled.excerpt += " annulé";
  assert.equal(verifyQuotedEvent(cancelled, { document: cancelled.excerpt, sourceUrl, language: "fr" }), null);
});

test("main reader is bounded, sends source text as data, uses cheapest current tier, and caches by document hash", async () => {
  let requests = 0;
  const read = createQuotedEventReader({ apiKey: "test-only", fetcher: async (url, options) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-6-luna"); assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true); assert.equal(body.tools, undefined);
    assert.equal(JSON.parse(body.input[1].content).document, extraction().excerpt);
    return apiResponse([extraction()]);
  } });
  const input = { text: extraction().excerpt, sourceUrl, language: "sv" };
  const results = await Promise.all([read(input), read(input)]);
  assert.equal(requests, 1); assert.equal(results[0].status, "ok");
  assert.equal((await read(input)).events.length, 1); assert.equal(requests, 1);
  assert.equal(resolveDefaultEventReader({}), null);
  assert.equal(resolveDefaultEventReader({ OPENAI_API_KEY: "test", PARRANDA_EVENT_READER: "disabled" }), null);
});

test("failed model requests, refusals and invented evidence do not become healthy empty or cached success", async () => {
  for (const response of [new Response("bad", { status: 500 }), apiResponse([{ ...extraction(), date: { value: "2027-10-05", quote: extraction().date.quote } }]),
    new Response(JSON.stringify({ status: "incomplete", output: [] }))]) {
    let requests = 0;
    const read = createQuotedEventReader({ apiKey: "test", fetcher: async () => { requests++; return response.clone(); } });
    assert.equal((await read({ text: extraction().excerpt, sourceUrl, language: "sv" })).status, "failed");
    await read({ text: extraction().excerpt, sourceUrl, language: "sv" }); assert.equal(requests, 2);
  }
});

test("a page licence declaration cannot override an explicit source restriction", async () => {
  let reads = 0;
  const scout = await scoutLocalEventSources({ seeds: [{ url: sourceUrl, terms_status: "restricted" }],
    anchor: { lat: 55.6, lng: 13 }, maxLinkedPages: 0,
    eventReader: async () => { reads++; throw new Error("must not read restricted source"); },
    fetcher: async (url) => new Response(url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" :
      '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/"><link rel="alternate" type="text/calendar" href="/events.ics">'),
  });
  assert.equal(reads, 0); assert.deepEqual(scout.manifest_candidates, []);
});

test("unlicensed association news becomes Live supply after two machine probes, with quotes and no route promotion", async () => {
  const read = createQuotedEventReader({ apiKey: "test", fetcher: async () => apiResponse([extraction()]) });
  const fetcher = async (url) => new Response(url.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : `<html lang="sv"><p>${extraction().excerpt}</p></html>`, { headers: { "content-type": "text/html" } });
  const anchor = { lat: 55.6, lng: 13 };
  const scout = await scoutLocalEventSources({ seeds: [{ url: sourceUrl, family: "venue_owned_calendar", trust_tier: "community" }],
    place: { label: "Generic locality" }, anchor, fetcher, eventReader: read, maxLinkedPages: 0 });
  const manifest = scout.manifest_candidates.find((row) => row.adapter === "quoted_public_document");
  assert.equal(manifest.review.terms_status, "public_factual_evidence"); assert.equal(manifest.license, undefined);
  const candidate = scout.results[0].candidates.find((row) => row.adapter === "quoted_public_document");
  const profile = { profile_key: "place-source-profile-v1:quoted-test", source_families: [{ family: candidate.family, candidates: [candidate] }] };
  const options = { profile, manifests: [{ ...manifest, timezone: "Europe/Stockholm" }], anchor, fetcher, eventReader: read,
    venueResolver: async () => [{ ...anchor, label: "Föreningshuset", confidence: "high", provenance: "nominatim" }] };
  const first = await qualifyDiscoveredSourceProfile({ ...options, now: "2026-10-03T10:00:00Z" });
  assert.equal(first.qualification.status, "observing");
  const second = await qualifyDiscoveredSourceProfile({ ...options, previousQualification: first.qualification, now: "2026-10-04T10:00:00Z" });
  assert.equal(second.qualification.status, "qualified_for_review");
  const feeds = eventFeedsFromQualifiedSourceProfiles([second.profile], { now: "2026-10-05T10:00:00Z" });
  assert.equal(feeds.length, 1); assert.equal(feeds[0].pulse_only, true);
  const live = await collectAnchorEvents({ anchor, now: "2026-10-05T10:00:00Z", registry: feeds, fetcher, eventReader: read, venueResolver: options.venueResolver });
  assert.equal(live.tonight.length, 1); assert.equal(live.tonight[0].route_eligible, false);
  assert.equal(live.tonight[0].source_url, sourceUrl); assert.equal(live.tonight[0].license, null);
  assert.equal(live.tonight[0].evidence.length, 4);
  // Factual quotation is not a blanket terms bypass for arbitrary adapters.
  const forged = structuredClone(second.profile);
  const state = forged.source_qualification.candidates[0];
  state.adapter = "schema_org_html"; state.runtime_candidate.adapter = "schema_org_event";
  forged.source_families[0].candidates[0].adapter = "schema_org_event";
  assert.deepEqual(eventFeedsFromQualifiedSourceProfiles([forged], { now: "2026-10-05T10:00:00Z" }), []);
});
