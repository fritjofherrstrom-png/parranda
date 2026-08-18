"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createOfficialProgramArticleProvider,
  extractOfficialProgramArticle,
  hasOfficialProgramArticleSignature,
} = require("../server/pulse-sources/official-program-article-provider");

function civicProgramHtml() {
  return [
    '<html lang="ca"><body>',
    "<h1>Festes del Port 2026</h1>",
    "<p>Editorial introduction that must not become event copy.</p>",
    "<h2><strong>PROGRAMACIÓ AL PARC CENTRAL</strong></h2>",
    "<p><strong>Divendres 21 d’agost (23.30h): Concert de la banda local</strong></p>",
    "<p><strong>Dissabte 22 d’agost (21.00h): Nit de dansa</strong></p>",
    "<p><strong>Diumenge 23 d’agost (20.00h): Mercat nocturn</strong></p>",
    "<p><strong>Dilluns 24 d’agost: Trobada comunitària</strong></p>",
    "<h2>Contacte</h2>",
    "<p>Call the council office at 10.00.</p>",
    "</body></html>",
  ].join("");
}

function response(body, { status = 200, url = "https://civic.example/news/summer-program", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    text: async () => body,
  };
}

function providerOptions(overrides = {}) {
  return {
    endpoint: "https://civic.example/news/summer-program",
    timezone: "Europe/Madrid",
    sourceLanguage: "ca",
    label: "Reviewed civic program",
    sourceTier: "official",
    confidence: "medium",
    ...overrides,
  };
}

test("official program articles expose only explicit factual atoms from a shared venue section", () => {
  const html = civicProgramHtml();
  assert.equal(hasOfficialProgramArticleSignature(html), true);

  const result = extractOfficialProgramArticle(html, {
    sourceUrl: "https://civic.example/news/summer-program",
    timezone: "Europe/Madrid",
    sourceLanguage: "ca",
    referenceDate: "2026-08-05",
  });

  assert.equal(result.recognized, true);
  assert.equal(result.timed_event_count, 3);
  assert.equal(result.all_day_event_count, 1);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[0], {
    id: result.events[0].id,
    title: "Concert de la banda local",
    name: "Concert de la banda local",
    starts_at: "2026-08-21T21:30:00.000Z",
    starts_on: "2026-08-21",
    ends_on: "2026-08-21",
    time_window: {
      kind: "continuous",
      starts_at: "2026-08-21T21:30:00.000Z",
    },
    source_url: "https://civic.example/news/summer-program",
    place_context: "PARC CENTRAL",
    area: "PARC CENTRAL",
    source_language: "ca",
    event_language: "ca",
    translation_status: "not_required",
    tags: ["festival", "music"],
    local_significance: {
      source_prominence: "dedicated_programme",
      programme_event_count: 4,
      programme_day_count: 4,
      current_year_evidence: true,
    },
    provenance: {
      source_url: "https://civic.example/news/summer-program",
      source_page: "https://civic.example/news/summer-program",
      source_record_id: result.events[0].id,
    },
  });
  assert.equal(result.events[3].time_window.kind, "all_day");
  assert.ok(!JSON.stringify(result).includes("Editorial introduction"));
  assert.ok(!JSON.stringify(result).includes("council office"));
  assert.ok(result.events.every((event) => event.lat == null && event.lng == null));
});

test("article introductions and ticket sections do not become all-day events", () => {
  const html = [
    '<html lang="ca"><body>',
    "<h1>La ciutat presenta la programació de les festes 2026</h1>",
    "<p>Les festes tendran lloc del 21 al 31 d'agost al centre.</p>",
    "<p><strong>PROGRAMACIÓ AL PARC CENTRAL</strong></p>",
    "<p>21 d'agost (20.00 h) — Concert inaugural</p>",
    "<p>22 d'agost (21.00 h) — Nit de ball</p>",
    "<p>23 d'agost — Mercat comunitari</p>",
    "<p><strong>VENDA D'ENTRADES</strong></p>",
    "<p>Les entrades dels dies 21 al 31 d'agost es venen en línia.</p>",
    "</body></html>",
  ].join("");

  const parsed = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/news/festival-program",
    timezone: "Europe/Madrid",
    sourceLanguage: "ca",
  });

  assert.deepEqual(parsed.events.map((event) => event.title), [
    "Concert inaugural",
    "Nit de ball",
    "Mercat comunitari",
  ]);
});

test("the same adapter recognizes an unrelated heading-date plus timed-row program grammar", () => {
  const html = [
    "<h1>River City Festival 2026</h1>",
    "<h2>Harbour stage 5 June</h2>",
    "<h3>Program Harbour stage</h3>",
    "<p>16.00 Opening ceremony</p>",
    "<p>18.00 - Local orchestra</p>",
    "<p>19.30 Evening concert</p>",
    "<h2>Practical information</h2>",
  ].join("");

  assert.equal(hasOfficialProgramArticleSignature(html), true);
  const parsed = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/festival",
    timezone: "Europe/Stockholm",
    sourceLanguage: "en",
  });
  assert.deepEqual(parsed.events.map((event) => event.title), [
    "Opening ceremony",
    "Local orchestra",
    "Evening concert",
  ]);
  assert.ok(parsed.events.every((event) => event.place_context === "Harbour stage"));
});

test("multi-day daily windows stay daily and all-day rows never consume the timed quota", async () => {
  const html = [
    "<h1>Summer programme 2026</h1>",
    "<h2>Programme at Civic Garden</h2>",
    "<ul>",
    "<li>10-12 July 10:00-17:00 Makers market</li>",
    "<li>13 July Community picnic</li>",
    "<li>14 July 18:00 Neighbourhood concert</li>",
    "<li>15 July 19:00 Outdoor cinema</li>",
    "</ul>",
  ].join("");
  const parsed = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/program",
    timezone: "Europe/Paris",
    sourceLanguage: "en",
  });
  assert.deepEqual(parsed.events[0].time_window, {
    kind: "daily",
    starts_on: "2026-07-10",
    ends_on: "2026-07-12",
    local_start: "10:00",
    local_end: "17:00",
    timezone: "Europe/Paris",
  });

  const provider = createOfficialProgramArticleProvider(providerOptions({
    endpoint: "https://city.example/program",
    timezone: "Europe/Paris",
    sourceLanguage: "en",
    limit: 1,
    fetcher: async () => response(html, { url: "https://city.example/program" }),
  }));
  const collected = await provider.create({ key: "generic" }).collect({ date: "2026-07-10" });
  assert.equal(collected.collection_status.status, "ok");
  assert.deepEqual(collected.time_sensitive_events.map((event) => event.title), [
    "Makers market",
    "Community picnic",
  ]);
  assert.equal(collected.time_sensitive_events[0].time_window.kind, "daily");
  assert.equal(collected.time_sensitive_events[1].time_window.kind, "all_day");
});

test("weak prose, missing runtime trust prerequisites, and cross-origin redirects fail closed", async () => {
  const prose = "<h1>News 2026</h1><p>We meet at 18:00 and may publish a programme later.</p>";
  assert.equal(hasOfficialProgramArticleSignature(prose), false);

  const missingTimezone = createOfficialProgramArticleProvider(providerOptions({
    timezone: null,
    fetcher: async () => response(civicProgramHtml()),
  }));
  const unavailable = await missingTimezone.create({ key: "generic" }).collect({ date: "2026-08-21" });
  assert.equal(unavailable.collection_status.status, "unavailable");
  assert.equal(unavailable.collection_status.reason, "source_timezone_unavailable");

  const redirected = createOfficialProgramArticleProvider(providerOptions({
    fetcher: async () => response("", {
      status: 302,
      headers: { location: "https://collector.invalid/program" },
    }),
  }));
  const failed = await redirected.create({ key: "generic" }).collect({ date: "2026-08-21" });
  assert.equal(failed.collection_status.status, "failed");
  assert.equal(failed.collection_status.reason, "source_redirect_cross_origin");
});

test("negative article corpus cannot masquerade as a current factual programme", async () => {
  const negativeCorpus = [
    {
      name: "historical festival recap",
      html: [
        "<h1>Festival history and 2024 recap</h1>",
        "<h2>Programme at Old Square</h2>",
        "<p>5 July 18:00 Opening concert</p>",
        "<p>6 July 20:00 Closing concert</p>",
      ].join(""),
    },
    {
      name: "municipal news with incidental dates",
      html: [
        "<h1>Council news 2026</h1>",
        "<p>The committee met 5 July at 18:00.</p>",
        "<p>The next report is due 6 July at 20:00.</p>",
      ].join(""),
    },
    {
      name: "ticket and practical information",
      html: [
        "<h1>Summer festival 2026</h1>",
        "<h2>Programme at Civic Hall</h2>",
        "<h3>Tickets</h3>",
        "<p>5 July 18:00 Box office opens</p>",
        "<p>6 July 20:00 Telephone service</p>",
      ].join(""),
    },
    {
      name: "yearly history page",
      html: [
        "<h1>Previous editions and history 2026</h1>",
        "<h2>Program at Town Hall</h2>",
        "<p>5 July 18:00 The 2019 edition began</p>",
        "<p>6 July 20:00 The 2020 edition ended</p>",
      ].join(""),
    },
    {
      name: "ordinary opening-hours page",
      html: [
        "<h1>Museum visitor information 2026</h1>",
        "<h2>Opening hours</h2>",
        "<p>5 July 10:00-17:00</p>",
        "<p>6 July 10:00-17:00</p>",
      ].join(""),
    },
  ];

  for (const fixture of negativeCorpus) {
    assert.equal(hasOfficialProgramArticleSignature(fixture.html), false, fixture.name);
    const provider = createOfficialProgramArticleProvider(providerOptions({
      fetcher: async () => response(fixture.html),
    }));
    const collected = await provider.create({ key: "generic" }).collect({ date: "2026-07-05" });
    assert.equal(collected.collection_status.status, "failed", fixture.name);
    assert.equal(collected.collection_status.reason, "source_payload_invalid", fixture.name);
    assert.deepEqual(collected.time_sensitive_events, [], fixture.name);
  }
});

test("a current-year programme is not displaced by an incidental previous-year mention", () => {
  const html = [
    "<h1>Harbour festival programme 2026</h1>",
    "<p>The first edition was held in 2006.</p>",
    "<h2>Programme at Harbour Square</h2>",
    "<p>5 July 18:00 Opening concert</p>",
    "<p>6 July 20:00 Night market</p>",
  ].join("");
  const parsed = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/current-program",
    timezone: "Europe/Stockholm",
    sourceLanguage: "en",
    referenceDate: "2026-07-05",
  });
  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.events.map((event) => event.starts_on), ["2026-07-05", "2026-07-06"]);
  assert.equal(parsed.events[0].local_significance.current_year_evidence, true);

  const staleReference = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/current-program",
    timezone: "Europe/Stockholm",
    sourceLanguage: "en",
    referenceDate: "2027-07-05",
  });
  assert.equal(staleReference.events[0].local_significance.current_year_evidence, false);
});

test("the timeout remains active while a response body is being read", async () => {
  const provider = createOfficialProgramArticleProvider(providerOptions({
    timeoutMs: 50,
    fetcher: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      url: "https://civic.example/news/summer-program",
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            read() {
              return new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                }, { once: true });
              });
            },
            cancel: async () => {},
          };
        },
      },
    }),
  }));

  const collected = await provider.create({ key: "generic" }).collect({ date: "2026-08-21" });
  assert.equal(collected.collection_status.status, "failed");
  assert.equal(collected.collection_status.reason, "source_timeout");
});

test("floating local times fail closed in an ambiguous DST fold", () => {
  const html = [
    "<h1>Autumn programme 2026</h1>",
    "<h2>Programme at Civic Hall</h2>",
    "<p>25 October 02:30 First night session</p>",
    "<p>25 October 02:45 Second night session</p>",
  ].join("");
  const parsed = extractOfficialProgramArticle(html, {
    sourceUrl: "https://city.example/autumn",
    timezone: "Europe/Stockholm",
    sourceLanguage: "en",
  });
  assert.equal(parsed.recognized, false);
  assert.equal(parsed.events.length, 0);
});
