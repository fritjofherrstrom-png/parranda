"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractNextData,
  extractNuxtData,
  findStateObjects,
  hydrateDevalue,
} = require("../server/pulse-sources/embedded-page-state");
const { encodeDevalue, nuxtPage } = require("./helpers/devalue-fixture");

test("devalue payloads hydrate with wrappers, shared references and reserved constants", () => {
  const shared = { title: "Liseberg", slug: "liseberg" };
  const flat = encodeDevalue({ list: [{ place: shared }, { place: shared }], missing: undefined, count: 3 });
  const state = hydrateDevalue(flat);
  assert.equal(state.list[0].place.title, "Liseberg");
  assert.equal(state.list[0].place, state.list[1].place, "a shared index is one object");
  assert.equal(state.missing, undefined);
  assert.equal(state.count, 3);
});

test("cyclic devalue references resolve without looping", () => {
  const state = hydrateDevalue([{ self: 0, name: 1 }, "loop"]);
  assert.equal(state.self, state);
  assert.equal(state.name, "loop");
});

test("malformed devalue payloads fail closed", () => {
  assert.equal(hydrateDevalue([{ child: 99 }]), null, "an index outside the payload");
  assert.equal(hydrateDevalue([]), null);
  assert.equal(hydrateDevalue("not an array"), null);
});

test("Nuxt and Next page state is read from the page's own script tags only", () => {
  const html = nuxtPage({ events: [{ id: 1, type: "event" }] });
  assert.equal(extractNuxtData(html).events[0].id, 1);
  assert.equal(extractNuxtData("<html><body>no state</body></html>"), null);
  assert.equal(extractNuxtData('<script id="__NUXT_DATA__" type="application/json">{broken</script>'), null);
  const next = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"events":[{"title":"Avismorgen"}]}}}</script>';
  assert.equal(extractNextData(next).props.pageProps.events[0].title, "Avismorgen");
});

test("state search visits each object once and returns matches in document order", () => {
  const shared = { type: "event", id: 2 };
  const state = { a: { type: "event", id: 1 }, b: [shared, shared], c: { nested: { type: "event", id: 3 } } };
  const found = findStateObjects(state, (node) => node.type === "event");
  assert.deepEqual(found.map((node) => node.id), [1, 2, 3]);
});
