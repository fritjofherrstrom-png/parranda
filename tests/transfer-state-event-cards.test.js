"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractScheduledEventCards } = require("../server/pulse-sources/scheduled-event-card-normalizer");
const { createScheduledEventCardProvider } = require("../server/pulse-sources/scheduled-event-card-provider");

const endpoint = "https://calendar.example/it/eventi";
const htmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const stateEscape = value => JSON.stringify(value).replace(/[&<>"']/g, char => ({ "&": "&a;", "<": "&l;", ">": "&g;", '"': "&q;", "'": "&s;" }[char]));
const rows = () => [
  { titolo: "First concert", url: "https://calendar.example/it/eventi/first", dtInizioValidita: "2026-11-10", dtFineValidita: "2026-11-10", latitudine: "44.4", longitudine: "11.3" },
  { titolo: "Second concert", url: "https://calendar.example/it/eventi/second", dtInizioValidita: "2026-11-12", dtFineValidita: "2026-11-12", latitudine: "44.5", longitudine: "11.4" },
];
const dates = ["10 Novembre 2026", "12 Novembre 2026"];
function card(row, date) {
  return `<div class="card event-card"><app-card><a href="${htmlEscape(row.url)}"><span class="title">${htmlEscape(row.titolo)}</span><span class="meta">${date}</span></a></app-card></div>`;
}
function listing({ records = rows(), cards = records.slice(0, 2).map((row, i) => card(row, dates[i])).join(""), state = { response: { rows: records } } } = {}) {
  return `${cards}<script id="serverApp-state" type="application/json">${stateEscape(state)}</script>`;
}
const parse = html => extractScheduledEventCards(html, { sourceUrl: endpoint });

test("closed SSR cards join exact owned title, URL, single date and publisher point", () => {
  const result = parse(listing());
  assert.equal(result.recognized, true, "the coherent captured template family must be read");
  assert.deepEqual(result.cards.map(c => ({ title: c.title, date: c.date, url: c.url, contact: c.contact })), rows().map(row => ({
    title: row.titolo, date: row.dtInizioValidita, url: row.url,
    contact: { lat: Number(row.latitudine), lng: Number(row.longitudine) },
  })));
});

test("ranges, differing titles and dates cannot become daily occurrences", () => {
  for (const change of [
    record => { record.dtFineValidita = "2026-11-15"; },
    record => { record.dtInizioValidita = record.dtFineValidita = "2026-11-11"; },
    record => { record.titolo = "Different title"; },
    record => { record.url = "https://other.example/it/eventi/first"; },
  ]) {
    const records = rows(); const cards = records.map((row, i) => card(row, dates[i])).join("");
    change(records[0]);
    assert.equal(parse(listing({ records, cards })).recognized, false);
  }
});

test("null, blank, boolean, array, partial and out-of-range points are not coordinates", () => {
  for (const value of [null, "", true, [], "91", "not a coordinate"]) {
    const records = rows(); records[0].latitudine = value;
    assert.equal(parse(listing({ records })).recognized, false, JSON.stringify(value));
  }
  const records = rows(); delete records[0].longitudine;
  assert.equal(parse(listing({ records })).recognized, false);
});

test("real zero coordinates remain supported", () => {
  const records = rows(); records[0].latitudine = 0; records[0].longitudine = "0";
  const result = parse(listing({ records }));
  assert.equal(result.recognized, true);
  assert.deepEqual(result.cards[0].contact, { lat: 0, lng: 0 });
});

test("conflicting and invalid duplicate state records withdraw that detail identity", () => {
  for (const duplicate of [
    { ...rows()[0], latitudine: "45" },
    { ...rows()[0], latitudine: null },
    { ...rows()[0], dtFineValidita: "2026-12-01" },
    { ...rows()[0], titolo: "Conflicting name" },
  ]) assert.equal(parse(listing({ records: [...rows(), duplicate] })).recognized, false);
});

test("title and schedule facts cannot come from nested cards or hidden/inert content", () => {
  for (const wrap of [body => `<template>${body}</template>`, body => `<div hidden>${body}</div>`, body => `<div aria-hidden="true">${body}</div>`]) {
    assert.equal(parse(listing({ cards: wrap(rows().map((row, i) => card(row, dates[i])).join("")) })).recognized, false);
  }
  const nested = rows().map((row, i) => card(row, `<div class="card event-card">${dates[i]}</div>`)).join("");
  assert.equal(parse(listing({ cards: nested })).recognized, false);
  const leaked = rows().map(row => card(row, "")).join("") + "<span class=meta>10 Novembre 2026</span>";
  assert.equal(parse(listing({ cards: leaked })).recognized, false);
});

test("external, executable, duplicated or malformed state scripts never supply facts", () => {
  const html = listing();
  for (const body of [
    html.replace('type="application/json"', 'type="text/javascript"'),
    html.replace('type="application/json"', 'src="https://other.example/data.js" type="application/json"'),
    html + html.slice(html.indexOf("<script")),
    html.replace("&q;response&q;", "INVALID_JSON"),
    html.replace('id="serverApp-state"', 'id="unrelated-data"'),
  ]) assert.equal(parse(body).recognized, false);
});

test("state escaping is decoded once without rewriting literal entity-looking text", () => {
  const records = rows(); records[0].titolo = "Music &q; & notes";
  const result = parse(listing({ records }));
  assert.equal(result.recognized, true);
  assert.equal(result.cards[0].title, records[0].titolo);
});

test("node, depth, state-byte and card limits fail closed, including oversized tails", () => {
  const html = listing();
  assert.equal(parse(html + "<i></i>".repeat(21000)).recognized, false);
  assert.equal(parse(html + "<div>".repeat(300) + "x" + "</div>".repeat(300)).recognized, false);
  assert.equal(parse(listing({ state: { response: { rows: rows() }, padding: "x".repeat(512 * 1024) } })).recognized, false);
  assert.equal(parse(listing({ cards: Array.from({ length: 201 }, (_, i) => card(rows()[i % 2], dates[i % 2])).join("") })).recognized, false);
});

test("existing collector admits exact dates without new detail requests, hours or midnight times", async () => {
  const calls = [];
  const provider = createScheduledEventCardProvider({ endpoint, timezone: "Europe/Rome", sourceLanguage: "it", fetcher: async url => {
    calls.push(url);
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => url.endsWith("robots.txt") ? "User-agent: *\nAllow: /\n" : listing() };
  } });
  const result = await provider.create({ key: "generic" }).collect({ date: "2026-11-06" });
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events.length, 2);
  assert.deepEqual(calls, ["https://calendar.example/robots.txt", endpoint]);
  for (const event of result.time_sensitive_events) {
    assert.equal(event.starts_at, undefined);
    assert.equal(event.time_window.kind, "occurrences");
    assert.deepEqual(event.time_window.dates, [event.starts_on]);
    assert.equal(event.place, undefined, "geometry must not invent a venue label");
  }
});

test("unchanged robots gate still blocks an empty policy before the listing request", async () => {
  const calls = [];
  const provider = createScheduledEventCardProvider({ endpoint, timezone: "Europe/Rome", sourceLanguage: "it", fetcher: async url => {
    calls.push(url); return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "" };
  } });
  const result = await provider.create({ key: "generic" }).collect({ date: "2026-11-06" });
  assert.equal(result.time_sensitive_events.length, 0);
  assert.equal(result.collection_status.reason, "source_robots_unavailable");
  assert.deepEqual(calls, ["https://calendar.example/robots.txt"]);
});
