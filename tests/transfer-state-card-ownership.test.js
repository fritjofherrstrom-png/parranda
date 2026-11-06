"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractScheduledEventCards } = require("../server/pulse-sources/scheduled-event-card-normalizer");

// A newly supported card boundary cannot lend fields to a different enclosing
// supported family. The outer identity and the inner date are unrelated facts.
test("transfer-card fields cannot supply an enclosing Drupal occurrence", () => {
  const html = ["one", "two"].map(id =>
    `<article class="node--type-event"><h3 class="node--title"><a href="/outer-${id}">Outer ${id}</a></h3>` +
    `<div class="card event-card"><app-card><a href="/inner-${id}"><span class="title">Inner ${id}</span>` +
    `<span class="meta"><span class="field--name-field-schedule">10 Novembre 2026</span></span></a></app-card></div></article>`
  ).join("");
  const parsed = extractScheduledEventCards(html, { sourceUrl: "https://calendar.example/events" });
  assert.equal(parsed.recognized, false, "a nested independent card must not donate its schedule to the outer identity");
  assert.deepEqual(parsed.cards, []);
});
