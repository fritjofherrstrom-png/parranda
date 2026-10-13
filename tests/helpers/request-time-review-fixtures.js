"use strict";
const assert = require("node:assert/strict");
const { scoutLocalEventSources } = require("../../server/pulse-sources/local-event-source-scout");
// Only transport, cache and time are injected. Scout, binding, search provider,
// collector, adapter, normalization and completion are the production modules.
function memoryCache() {
  const values = new Map();
  return {
    peek: key => values.get(key) || null,
    async get(key, producer, { shouldStore = () => true } = {}) {
      if (values.has(key)) return values.get(key);
      const value = await producer();
      if (shouldStore(value)) values.set(key, value);
      return value;
    },
    warm(key, producer, options) { return this.get(key, producer, options); },
  };
}
function response(url, body, status = 200, contentType = "text/html") {
  return { url, status, ok: status >= 200 && status < 300,
    headers: { get: key => key.toLowerCase() === "content-type" ? contentType : null },
    text: async () => body };
}
const anchor = { lat: 65.84, lng: 24.13 };
const place = { label: "Fixture Region", language_hints: ["en"] };
const bounds = [24, 65.75, 24.3, 65.95];
const input = { anchor, placeLabel: "Fixture Region", placeContext: { locality: "Fixture Region", country_code: "FI" } };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function scoutHtml(html, fetcher) {
  return scoutLocalEventSources({ place, anchor, bounds, seeds: [{ url: "https://venue.example/calendar" }],
    fetcher: async url => url === "https://venue.example/calendar" ? response(url, html) : fetcher(url),
    maxLinkedPages: 0, maxLinkedPagesPerSeed: 0, cache: memoryCache(), eventReader: null });
}


module.exports = { memoryCache, response, anchor, place, bounds, input, tick, scoutHtml };
