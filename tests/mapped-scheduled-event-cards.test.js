"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { extractScheduledEventCards } = require("../server/pulse-sources/scheduled-event-card-normalizer");
const { createScheduledEventCardProvider } = require("../server/pulse-sources/scheduled-event-card-provider");
const { inspectEventSourcePage } = require("../server/pulse-sources/local-event-source-scout");
const { boundedDocument, hasClass, ownedBy } = require("../server/pulse-sources/scheduled-event-document");

// Synthetic facts; structural grammar from retained server-rendered calendar.
// Deliberately not the observed publisher, locality or route hierarchy.
const endpoint = "https://publisher.example/calendar";
const specs = [
  { slug: "lecture", title: "Lecture du port", label: "Le 05/11/2026", address: "12 rue du Canal - 75000 Ville", lat: 48.1, lng: 2.1 },
  { slug: "veillee", title: "Veillée du canal", label: "Le 06/11/2026", address: "7 rue du Pont - 75000 Ville", lat: 48.2, lng: 2.2 },
];
function card(item) {
  return `<div><div class="flip-container"><div class="front">
<h2><a href="/events/${item.slug}">${item.title}</a></h2><p class="text-sm">${item.label}</p>
</div><div class="back"><p>${item.title}</p><address>${item.address}</address>
<a href="/events/${item.slug}">Détails</a></div></div></div>`;
}
function page(items = specs, markers = items.map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng }))) {
  return `<html lang="fr-FR"><main>${items.map(card).join("")}</main>
<script>function calendar() { return { mapConfig: ${JSON.stringify({ latLng: false, zoom: 0, markers })}, map: null }; }</script></html>`;
}
function response(body, url) {
  return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => body };
}
async function collect(html, overrides = {}) {
  const calls = [];
  const provider = createScheduledEventCardProvider({ endpoint, timezone: "Europe/Paris", sourceLanguage: "fr", ...overrides,
    fetcher: async url => {
      calls.push(url);
      if (url === "https://publisher.example/robots.txt") return response("User-agent: *\nAllow: /\n", url);
      if (url === endpoint) return response(html, url);
      assert.fail(`complete listing facts must not trigger an unplanned detail lookup: ${url}`);
    },
  });
  return { result: await provider.create({ key: "anywhere" }).collect({ now: "2026-11-05T09:00:00Z" }), calls };
}

function drupal(item, labels = ["2026-11-05"]) {
  return `<article class="node--type-event"><h2 class="node--title"><a href="/events/${item.slug}">${item.title}</a></h2>
${labels.map(label => `<div class="field--name-field-schedule">${label}</div>`).join("")}</article>`;
}

// These regressions exercise the shared output, not only one format reader.
test("a mapped veto survives the parallel Drupal positive lane", () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert", label: "Le 07/11/2026" };
  const conflicting = card({ ...specs[0], title: "Conflicting event" }).replace(
    '<p class="text-sm">Le 05/11/2026</p>', '<p class="text-sm">Le 09/11/2026</p><p class="text-sm">Le 10/11/2026</p>');
  const html = page([...specs, third]).replace("</main>", `${conflicting}${drupal(specs[0])}</main>`);
  const parsed = extractScheduledEventCards(html, { sourceUrl: endpoint });
  assert.ok(!parsed.cards.some(row => row.url.endsWith("/lecture")), "a vetoed URL cannot reappear through another positive reader");
  assert.deepEqual(parsed.cards.map(row => row.title), [specs[1].title, third.title]);
});

test("unsupported Drupal claims still veto a contradictory mapped positive", () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert", label: "Le 07/11/2026" };
  const conflicting = drupal({ ...specs[0], title: "Conflicting event" }, ["2026-11-09", "2026-11-10"]);
  const parsed = extractScheduledEventCards(page([...specs, third]).replace("</main>", `${conflicting}</main>`), { sourceUrl: endpoint });
  assert.ok(!parsed.cards.some(row => row.url.endsWith("/lecture")), "unsupported schedule cardinality must not erase cross-reader negative identity");
  assert.deepEqual(parsed.cards.map(row => row.title), [specs[1].title, third.title]);
});

test("nested mapped owners cannot supply an outer card's address", async () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert", label: "Le 07/11/2026" };
  const html = page([...specs, third]).replace(specs[0].address, '<div class="flip-container"><p>99 Other Street</p></div>');
  const { result } = await collect(html);
  assert.ok(!result.time_sensitive_events.some(row => row.source_url.endsWith("/lecture")), "a nested card's aggregate text is not the parent's address");
  assert.deepEqual(result.time_sensitive_events.map(row => row.title), [specs[1].title, third.title]);
});

test("nested mapped nodes cannot supply a Drupal owner's title or schedule", () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert", label: "Le 07/11/2026" };
  const borrowed = `<article class="node--type-event"><div class="flip-container">
<h2 class="node--title"><a href="/events/lecture">${specs[0].title}</a></h2><div class="field--name-field-schedule">2026-11-05</div>
</div></article>`;
  const html = page([specs[1], third]).replace("</main>", `${borrowed}</main>`);
  const parsed = extractScheduledEventCards(html, { sourceUrl: endpoint });
  assert.ok(!parsed.cards.some(row => row.url.endsWith("/lecture")), "a Drupal owner cannot borrow another card owner's nodes");
  const ordinary = html.replace('class="flip-container">\n<h2 class="node--title"', 'class="ordinary-wrapper">\n<h2 class="node--title"');
  assert.ok(extractScheduledEventCards(ordinary, { sourceUrl: endpoint }).cards.some(row => row.url.endsWith("/lecture")), "ordinary wrappers still supply their event's own fields");
});

test("consistent cross-reader dates and ordinary inline fields preserve their supported lanes", () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert", label: "Le 07/11/2026" };
  const items = [...specs, third];
  const markers = items.slice(1).map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng }));
  const html = page(items, markers).replace("</main>", `${drupal(specs[0])}</main>`);
  const consistent = extractScheduledEventCards(html, { sourceUrl: endpoint });
  const supportedDetail = consistent.cards.find(row => row.url.endsWith("/lecture"));
  assert.ok(supportedDetail, "French and ISO spellings of the same source-owned date are not a conflict");
  assert.equal(supportedDetail.contact, undefined, "missing mapped geometry still uses the unchanged detail lane, not borrowed coordinates");
  const foreign = drupal({ ...specs[0], title: "Other source's event" }, ["2026-11-09", "2026-11-10"])
    .replace('href="/events/lecture"', 'href="https://other.example/events/lecture"');
  assert.ok(extractScheduledEventCards(page(items).replace("</main>", `${foreign}</main>`), { sourceUrl: endpoint }).cards.some(row => row.url.endsWith("/lecture")));
  const inline = page(items).replace(specs[0].address, `<span>${specs[0].address}</span>`);
  assert.equal(extractScheduledEventCards(inline, { sourceUrl: endpoint }).cards.length, 3);
  const fragments = page(items).replace("Le 05/11/2026", 'Le 05/11/20<div class="flip-container">foreign</div>26');
  assert.ok(!extractScheduledEventCards(fragments, { sourceUrl: endpoint }).cards.some(row => row.url.endsWith("/lecture")), "foreign owners cannot disappear and join date fragments");
});

test("mapped-reader exhaustion cannot become healthy through a parallel positive lane", () => {
  const exhausted = page().replace("</main>", `${'<div class="flip-container"></div>'.repeat(201)}${drupal(specs[0])}${drupal(specs[1], ["2026-11-06"])}</main>`);
  assert.equal(extractScheduledEventCards(exhausted, { sourceUrl: endpoint }).recognized, false, "a reader's card-budget exhaustion must invalidate the mixed interface");
});

test("a mapped owner's root node is not a field owned by the enclosing article", () => {
  const doc = boundedDocument('<article><div class="flip-container field--name-field-schedule">2026-11-05</div></article>');
  const article = doc.nodes.find(node => node.tagName === "article");
  const owner = doc.nodes.find(node => hasClass(node, "flip-container"));
  assert.equal(doc.articleOwners.get(owner), null, "the boundary node itself must not inherit the outer article owner");
  assert.equal(ownedBy(owner, article), false, "ownedBy must apply the same ownership boundary to its starting node");
});

test("an owner root with a schedule class cannot mint a Drupal occurrence", () => {
  const third = { ...specs[1], slug: "independent", title: "Another concert" };
  const ordinary = page([]).replace("</main>", `${drupal(specs[0])}${drupal(specs[1], ["2026-11-06"])}${drupal(third, ["2026-11-07"])}</main>`);
  assert.equal(extractScheduledEventCards(ordinary, { sourceUrl: endpoint }).cards.length, 3);
  const boundary = ordinary.replace('class="field--name-field-schedule"', 'class="flip-container field--name-field-schedule"');
  const parsed = extractScheduledEventCards(boundary, { sourceUrl: endpoint });
  assert.ok(!parsed.cards.some(row => row.url.endsWith("/lecture")), "a mapped owner root must not supply the enclosing Drupal event's schedule");
  assert.deepEqual(parsed.cards.map(row => row.title), [specs[1].title, third.title]);
});

test("division followed by regexp documentation cannot supply geometry", async () => {
  const config = JSON.stringify({ markers: specs.map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng })) });
  const script = `const ratio = 8 / 2; const documentation = /{mapConfig: ${config.replaceAll("/", "\\/")}}/; const ratio2 = 8 / 2;`;
  // Compile the synthetic counterexample without executing it.
  assert.doesNotThrow(() => new (require("node:vm").Script)(script));
  const html = page().replace(/<script>[\s\S]*?<\/script>/, `<script>${script}</script>`);
  const { result } = await collect(html);
  assert.equal(result.time_sensitive_events.length, 0, "regexp text is not static map geometry");
});

test("a JSON prefix followed by an expression is not a static mapConfig value", async () => {
  for (const suffix of [" + []", " ?? {}", ".markers", " ? {} : {}"] ) {
    const html = page().replace(", map: null", `${suffix}, map: null`);
    const { result } = await collect(html);
    assert.equal(result.time_sensitive_events.length, 0, `complete static JSON value required: ${suffix}`);
  }
});

test("an unsupported duplicate date count cannot erase a conflicting identity before admission", async () => {
  const third = { ...specs[1], slug: "independent", title: "Un autre concert", label: "Le 07/11/2026" };
  const items = [...specs, third];
  const duplicate = card({ ...specs[0], title: "Conflicting event" }).replace(
    '<p class="text-sm">Le 05/11/2026</p>', '<p class="text-sm">Le 09/11/2026</p><p class="text-sm">Le 10/11/2026</p>');
  const html = page(items).replace("</main>", `${duplicate}</main>`);
  const { result } = await collect(html);
  assert.ok(!result.time_sensitive_events.some(row => row.source_url.endsWith("/lecture")), "date-count rejection must not discard a source-owned URL/title conflict");
  assert.deepEqual(result.time_sensitive_events.map(row => row.title), [specs[1].title, third.title]);
});

test("syntax-tree extraction preserves closed static values and refuses dynamic overrides", async () => {
  const config = JSON.stringify({ markers: specs.map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng })) });
  const forms = [
    `function calendar(){return {mapConfig:${config}, ...unknown};}`,
    `function calendar(){return {...unknown, mapConfig:${config}};}`,
    `function calendar(){return {mapConfig:${config}, ["map" + "Config"]:{markers:[]}};}`,
    `function calendar(){return {"mapConfig":${config}, "mapConfig":${config}};}`,
    `function calendar(){return {get mapConfig(){return ${config};}};}`,
    `function calendar(){return {mapConfig:(${config})};}`,
  ];
  for (const script of forms) {
    assert.doesNotThrow(() => new (require("node:vm").Script)(script));
    const { result } = await collect(page().replace(/<script>[\s\S]*?<\/script>/, `<script>${script}</script>`));
    assert.equal(result.time_sensitive_events.length, 0);
  }
  const quoted = await collect(page().replace("mapConfig:", '"mapConfig":'));
  assert.equal(quoted.result.time_sensitive_events.length, 2, "quoted static key remains supported");
  const exhausted = page().replace("</script>", `const noise = [${"0,".repeat(21000)}0];</script>`);
  assert.equal(extractScheduledEventCards(exhausted, { sourceUrl: endpoint }).recognized, false, "AST budget is whole-document fail closed");
});

test("a contradictory card title cannot disappear before the URL-to-marker join", () => {
  const markers = specs.map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng }));
  const html = page([...specs, { ...specs[0], title: "Another event with the same detail identity" }], markers);
  const parsed = extractScheduledEventCards(html, { sourceUrl: endpoint });
  assert.ok(!parsed.cards.some(item => item.url.endsWith("/lecture")), "conflicting card claims must withdraw the URL, not vanish before the marker join");
});

test("invalid, unbound or conflicting geometry never becomes a card location", () => {
  for (const bad of [null, false, "", [], {}, "Infinity", 91]) {
    const html = page(specs, specs.map(item => ({ url: `/events/${item.slug}`, name: item.title, lat: bad, lng: item.lng })));
    assert.equal(extractScheduledEventCards(html, { sourceUrl: endpoint }).recognized, false, JSON.stringify(bad));
  }
  for (const markers of [
    [],
    specs.map(item => ({ url: `/elsewhere/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng })),
    specs.map(item => ({ url: `/events/${item.slug}`, name: "Another title", lat: item.lat, lng: item.lng })),
    specs.flatMap(item => [{ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng },
      { url: `/events/${item.slug}`, name: item.title, lat: null, lng: item.lng }]),
    specs.flatMap(item => [{ url: `/events/${item.slug}`, name: item.title, lat: item.lat, lng: item.lng },
      { url: `/events/${item.slug}`, name: item.title, lat: item.lat + 1, lng: item.lng }]),
  ]) assert.equal(extractScheduledEventCards(page(specs, markers), { sourceUrl: endpoint }).recognized, false);
  const zeros = specs.map(item => ({ ...item, lat: "0", lng: 0 }));
  const zeroCards = extractScheduledEventCards(page(zeros), { sourceUrl: endpoint });
  assert.equal(zeroCards.recognized, true);
  assert.equal(zeroCards.cards.length, 2);
  assert.ok(zeroCards.cards.every(item => item.contact.lat === 0 && item.contact.lng === 0));
});

test("inert facts, unknown date order, ranges and incomplete card ownership cannot produce events", async () => {
  const html = page();
  const variants = [
    `<template>${html}</template>`,
    html.replace("<main>", "<main hidden>"),
    html.replace("<main>", '<main aria-hidden="true">'),
    html.replace("<script>", '<script type="text/plain">'),
    html.replace("<script>", "<script hidden>"),
    html.replace("<script>", "<script>/*").replace("</script>", "*/</script>"),
    html.replace(/<script>([\s\S]*?)<\/script>/, (_, text) => `<script>${JSON.stringify(text)}</script>`),
    html.replace(/<script>([\s\S]*?)<\/script>/, (_, text) => `<script>\`${text}\`</script>`),
    html.replace('lang="fr-FR"', 'lang="en"'),
    html.replace(/Le \d{2}\/11\/2026/g, "Du 05/11/2026 au 06/11/2026"),
    html.replace(/Le \d{2}\/11\/2026/g, "Le 31/02/2026"),
    html.replace(/Le \d{2}\/11\/2026/g, "Le 05/11"),
    html.replace(/<address>[\s\S]*?<\/address>/g, ""),
    html.replaceAll('href="/events/', 'href="https://other.example/events/'),
    html.replaceAll('class="back"', 'class="back" hidden'),
    html.replaceAll("</script>", '</script><script>function other() {return {mapConfig: {"markers": []}};}</script>'),
    html + "<i></i>".repeat(21000),
  ];
  for (const [index, value] of variants.entries()) {
    assert.equal(extractScheduledEventCards(value, { sourceUrl: endpoint }).recognized, false, `variant ${index}`);
    const { result } = await collect(value);
    assert.equal(result.time_sensitive_events.length, 0, `provider variant ${index}`);
  }
  const iso = html.replace('lang="fr-FR"', 'lang="en"').replace("Le 05/11/2026", "2026-11-05").replace("Le 06/11/2026", "2026-11-06");
  assert.equal(extractScheduledEventCards(iso, { sourceUrl: endpoint }).recognized, true);
});

test("date filtering, row cap and robots remain enforced for complete listings", async () => {
  const items = [
    { ...specs[0], slug: "stale", label: "Le 04/11/2026" },
    { ...specs[0], slug: "later", label: "Le 10/11/2026" },
    ...specs,
    { ...specs[0], slug: "distant-future", label: "Le 20/11/2026" },
  ];
  const { result } = await collect(page(items), { detailLimit: 1 });
  assert.equal(result.time_sensitive_events.length, 1);
  assert.ok(result.time_sensitive_events[0].source_url.endsWith("/lecture"));
  const urls = [];
  const blocked = await createScheduledEventCardProvider({ endpoint, timezone: "Europe/Paris", sourceLanguage: "fr",
    fetcher: async url => { urls.push(url); return response("User-agent: *\nDisallow: /calendar\n", url); },
  }).create({ key: "anywhere" }).collect({ now: "2026-11-05T09:00:00Z" });
  assert.equal(blocked.collection_status.reason, "source_robots_disallowed");
  assert.deepEqual(urls, ["https://publisher.example/robots.txt"]);
});

test("URL-bound mapped date cards reach the existing scout and provider without invented times or detail requests", async () => {
  const html = page();
  const parsed = extractScheduledEventCards(html, { sourceUrl: endpoint });
  assert.equal(parsed.recognized, true, "source-owned dated cards with exact URL/title-bound markers must reach the existing adapter");
  assert.equal(parsed.cards.length, 2);
  const inspected = inspectEventSourcePage({ seed: { url: endpoint, family: "official_tourism_calendar" }, html,
    context: { anchor: { lat: 48.1, lng: 2.1 } } });
  assert.ok(inspected.manifest_candidates.some(item => item.adapter === "scheduled_event_cards"));
  assert.ok(inspected.candidates.every(item => item.terms_status === "unknown"), "format recognition is not a license grant");
  const { result, calls } = await collect(html);
  assert.equal(result.collection_status.status, "ok");
  assert.deepEqual(calls, ["https://publisher.example/robots.txt", endpoint]);
  assert.deepEqual(result.time_sensitive_events.map(row => [row.title, row.starts_on, row.address, row.lat, row.lng, row.source_url]),
    specs.map((item, index) => [item.title, `2026-11-0${index + 5}`, item.address, item.lat, item.lng, `https://publisher.example/events/${item.slug}`]));
  for (const row of result.time_sensitive_events) {
    assert.equal(row.starts_at, undefined);
    assert.equal(row.ends_at, undefined);
    assert.equal(row.time_window.kind, "occurrences");
    assert.deepEqual(row.time_window.dates, [row.starts_on]);
  }
});
