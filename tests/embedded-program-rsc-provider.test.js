"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEmbeddedProgramRscProvider,
  extractEmbeddedProgramRsc,
  hasEmbeddedProgramRscSignature,
} = require("../server/pulse-sources/embedded-program-rsc-provider");

function flightHtml({ stages = [], bookings = [] } = {}) {
  const payload = JSON.stringify({
    page: { title: "Public program" },
    stages,
    bookings,
  });
  return [
    "<!doctype html><html><body>",
    `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`,
    "</body></html>",
  ].join("");
}

function fixture(overrides = {}) {
  return {
    stages: [
      {
        id: 10,
        title: "Harbour stage",
        address: "10 Harbour Road",
        gpsCoordinates: { lat: 57.7, lng: 11.9 },
      },
      {
        id: 20,
        title: "Library courtyard",
        address: "4 Library Lane",
        gpsCoordinates: { lat: 45.4, lng: 6.4 },
      },
    ],
    bookings: [
      {
        id: 101,
        title: "Local night orchestra",
        description: "Editorial copy must never enter Parranda output",
        image: { url: "https://program.example/editorial.jpg" },
        tags: [{ name: "Music" }, { name: "Night" }],
        dates: [{
          scene: { id: 10, title: "Harbour stage" },
          startDate: "2026-08-11T17:00:00.000Z",
          endDate: "2026-08-11T18:30:00.000Z",
        }],
      },
      {
        id: 202,
        title: "Independent makers market",
        tags: [{ name: "Market" }],
        dates: [{
          scene: { id: 20, title: "Library courtyard" },
          startDate: "2026-08-12T08:00:00+00:00",
          endDate: "2026-08-12T12:00:00+00:00",
        }],
      },
    ],
    ...overrides,
  };
}

function response(body, { status = 200, url = "https://program.example/program", headers = {} } = {}) {
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
    endpoint: "https://program.example/program",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    label: "Reviewed public program",
    sourceTier: "official",
    confidence: "medium",
    ...overrides,
  };
}

test("server-rendered program atoms normalize generically with stage geometry and source truth", async () => {
  const html = flightHtml(fixture());
  assert.equal(hasEmbeddedProgramRscSignature(html), true);

  const parsed = extractEmbeddedProgramRsc(html, {
    sourceUrl: "https://program.example/program",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.stage_count, 2);
  assert.equal(parsed.booking_count, 2);
  assert.equal(parsed.events.length, 2);
  assert.deepEqual(parsed.events[0], {
    id: "101:2026-08-11T17:00:00.000Z",
    title: "Local night orchestra",
    name: "Local night orchestra",
    starts_at: "2026-08-11T17:00:00.000Z",
    ends_at: "2026-08-11T18:30:00.000Z",
    time_window: {
      kind: "continuous",
      starts_at: "2026-08-11T17:00:00.000Z",
      ends_at: "2026-08-11T18:30:00.000Z",
    },
    source_url: "https://program.example/program/101",
    place_context: "Harbour stage",
    address: "10 Harbour Road",
    area: "Harbour stage",
    lat: 57.7,
    lng: 11.9,
    source_language: "sv",
    event_language: "sv",
    translation_status: "not_required",
    tags: ["Music", "Night"],
    provenance: {
      source_url: "https://program.example/program/101",
      source_page: "https://program.example/program",
      source_record_id: "101",
    },
  });
  assert.ok(!JSON.stringify(parsed).includes("Editorial copy"));
  assert.ok(!JSON.stringify(parsed).includes("editorial.jpg"));

  const provider = createEmbeddedProgramRscProvider(providerOptions({
    fetcher: async () => response(html),
  }));
  const result = await provider.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events.length, 2);
  assert.equal(provider.descriptor.trust.confidence, "medium");
});

test("bounded collection skips stale and malformed rows before applying its output limit", async () => {
  const data = fixture({
    bookings: [
      {
        id: 1,
        title: "Old listing",
        dates: [{ scene: { id: 10 }, startDate: "2026-07-01T10:00:00Z", endDate: "2026-07-01T11:00:00Z" }],
      },
      {
        id: 2,
        title: "Malformed listing",
        dates: [{ scene: { id: 10 }, startDate: "2026-08-11T19:00:00Z", endDate: "2026-08-11T18:00:00Z" }],
      },
      {
        id: 3,
        title: "Current local workshop",
        dates: [{ scene: { id: 10 }, startDate: "2026-08-11T17:00:00Z", endDate: "2026-08-11T18:00:00Z" }],
      },
      {
        id: 4,
        title: "Tomorrow's neighbourhood walk",
        dates: [{ scene: { id: 10 }, startDate: "2026-08-12T08:00:00Z", endDate: "2026-08-12T09:00:00Z" }],
      },
    ],
  });
  const provider = createEmbeddedProgramRscProvider(providerOptions({
    limit: 1,
    fetcher: async () => response(flightHtml(data)),
  }));
  const result = await provider.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(result.collection_status.status, "ok");
  assert.deepEqual(result.time_sensitive_events.map((event) => event.title), [
    "Current local workshop",
  ]);
});

test("invalid program shape and unresolved runtime prerequisites fail soft", async () => {
  const missingTimezone = createEmbeddedProgramRscProvider(providerOptions({
    timezone: null,
    fetcher: async () => response(flightHtml(fixture())),
  }));
  const unavailable = await missingTimezone.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(unavailable.collection_status.status, "unavailable");
  assert.equal(unavailable.collection_status.reason, "source_timezone_unavailable");

  const malformed = createEmbeddedProgramRscProvider(providerOptions({
    fetcher: async () => response("<html><p>ordinary page</p></html>"),
  }));
  const failed = await malformed.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(failed.collection_status.status, "failed");
  assert.equal(failed.collection_status.reason, "source_payload_invalid");
});

test("redirects remain same-origin and body parsing stays inside the timeout", async () => {
  const crossOrigin = createEmbeddedProgramRscProvider(providerOptions({
    fetcher: async () => response("", {
      status: 302,
      headers: { location: "https://collector.invalid/program" },
    }),
  }));
  const redirected = await crossOrigin.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(redirected.collection_status.status, "failed");
  assert.equal(redirected.collection_status.reason, "source_redirect_cross_origin");

  const hanging = createEmbeddedProgramRscProvider(providerOptions({
    timeoutMs: 50,
    fetcher: async (_url, options) => ({
      ...response(""),
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
  }));
  const timedOut = await hanging.create({ key: "generic" }).collect({ date: "2026-08-11" });
  assert.equal(timedOut.collection_status.status, "failed");
  assert.equal(timedOut.collection_status.reason, "source_timeout");
});

