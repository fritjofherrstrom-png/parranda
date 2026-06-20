const assert = require("node:assert/strict");
const test = require("node:test");

const athens = require("../server/cities/athens");
const { buildCityPulse } = require("../server/pulse-engine");
const { collectPulseSourcesForCity } = require("../server/pulse-sources");

const NOW = new Date("2026-06-19T15:30:00.000Z");
const DATE = "2026-06-19";

function nonWeatherProviders() {
  return athens.services.pulseSourceProviders.filter(
    (spec) => spec?.descriptor?.role !== "weather_context",
  );
}

function cityOfAthensEvent(overrides = {}) {
  return {
    id: 226719,
    title: { rendered: "Καλοκαιρινή αγορά στην Αθήνα" },
    start_date: "2026-06-19T18:00:00+03:00",
    end_date: "2026-06-19T22:00:00+03:00",
    url: "https://www.cityofathens.gr/data/summer-market-athens/",
    venue: {
      venue: "Plateia Test",
      city: "Athens",
      geo_lat: "37.976",
      geo_lng: "23.726",
    },
    categories: [{ name: "market" }, { name: "culture" }],
    language: "el",
    translation_status: "needed",
    translation_confidence: "none",
    ...overrides,
  };
}

function megaronListingHtml() {
  return `
    <div class="date-container">
      <h2 class="h1 uppercase">Friday 19.6</h2>
      <ul>
        <li>
          <div class="tease tease--event-calendar" data-date="19 06 2026,">
            <a href="https://www.megaron.gr/en/event/test-garden-concert/" title="Garden concert link"></a>
            <div class="col-1">
              <a href="https://www.megaron.gr/en/event/test-garden-concert/">
                <h2>Garden concert</h2>
              </a>
            </div>
            <div class="category-title">Music</div>
            <h2 class="h3 uppercase">ORGANISER</h2>
            <h2 class="h3">Megaron the Athens Concert Hall</h2>
          </div>
        </li>
      </ul>
    </div>
  `;
}

function megaronDetailHtml() {
  return `
    <div class="block-intro">
      <h1>Garden concert</h1>
      <h2 class="h1">19.6.2026, 21:00</h2>
    </div>
  `;
}

function jsonResponse(body) {
  return {
    ok: true,
    headers: { get: () => "application/json; charset=UTF-8" },
    text: async () => JSON.stringify(body),
  };
}

function textResponse(body) {
  return {
    ok: true,
    headers: { get: () => "text/html; charset=UTF-8" },
    text: async () => body,
  };
}

function withMockFetch(fn) {
  return async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("https://www.cityofathens.gr/wp-json/tribe/events/v1/events")) {
        return jsonResponse({ events: [cityOfAthensEvent()] });
      }
      if (String(url) === "https://www.megaron.gr/en/events-2/calendar/") {
        return textResponse(megaronListingHtml());
      }
      if (String(url) === "https://www.megaron.gr/en/event/test-garden-concert/") {
        return textResponse(megaronDetailHtml());
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      return await fn(calls);
    } finally {
      global.fetch = originalFetch;
    }
  };
}

test("Athens config includes at least two non-weather Pulse event source providers/candidates", () => {
  const providers = nonWeatherProviders();

  assert.ok(providers.length >= 2);
  assert.deepEqual(
    providers.map((spec) => spec.descriptor.id),
    ["athens-city-events-calendar", "athens-megaron-calendar"],
  );
  assert.equal(providers[0].descriptor.status, "active");
  assert.equal(providers[0].descriptor.sourceType, "official_api");
  assert.equal(providers[1].descriptor.status, "active");
  assert.equal(providers[1].descriptor.sourceType, "venue_feed");
});

test("Athens venue source is active while City of Athens remains the official probe", async () => {
  await withMockFetch(async () => {
    const result = await collectPulseSourcesForCity(athens, {
      providerSpecs: nonWeatherProviders(),
      context: { now: NOW, date: DATE },
    });

    const citySource = result.source_status.find((status) => status.id === "athens-city-events-calendar");
    const megaron = result.source_status.find((status) => status.id === "athens-megaron-calendar");
    assert.equal(citySource.status, "ok");
    assert.equal(citySource.time_sensitive_events, 1);
    assert.equal(megaron.status, "ok");
    assert.equal(megaron.time_sensitive_events, 1);
    assert.equal(result.time_sensitive_events.length, 2);
  })();
});

test("active City of Athens source normalizes fixture events into time_sensitive_events", async () => {
  await withMockFetch(async (calls) => {
    const result = await collectPulseSourcesForCity(athens, {
      providerSpecs: nonWeatherProviders().filter((spec) => spec.descriptor.id === "athens-city-events-calendar"),
      context: { now: NOW, date: DATE },
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0], /cityofathens\.gr\/wp-json\/tribe\/events\/v1\/events/);
    const event = result.time_sensitive_events[0];
    assert.equal(event.id, "226719");
    assert.equal(event.city, "athens");
    assert.equal(event.candidate_kind, "source_event");
    assert.equal(event.timing_relevance, "now");
    assert.equal(event.source_label, "City of Athens events calendar");
    assert.equal(event.source_url, "https://www.cityofathens.gr/data/summer-market-athens/");
    assert.equal(event.source_language, "el");
    assert.equal(event.translation_status, "needed");
    assert.equal(event.lat, 37.976);
    assert.equal(event.lng, 23.726);
  })();
});

test("active Megaron venue source normalizes reachable HTML events into time_sensitive_events", async () => {
  await withMockFetch(async (calls) => {
    const result = await collectPulseSourcesForCity(athens, {
      providerSpecs: nonWeatherProviders().filter((spec) => spec.descriptor.id === "athens-megaron-calendar"),
      context: { now: NOW, date: DATE },
    });

    assert.deepEqual(calls, [
      "https://www.megaron.gr/en/events-2/calendar/",
      "https://www.megaron.gr/en/event/test-garden-concert/",
    ]);
    const event = result.time_sensitive_events[0];
    assert.equal(event.id, "https://www.megaron.gr/en/event/test-garden-concert/");
    assert.equal(event.city, "athens");
    assert.equal(event.candidate_kind, "source_event");
    assert.equal(event.timing_relevance, "tonight");
    assert.equal(event.confidence, "medium");
    assert.equal(event.source_label, "Megaron Athens events calendar");
    assert.equal(event.source_url, "https://www.megaron.gr/en/event/test-garden-concert/");
    assert.equal(event.place_context, "Megaron the Athens Concert Hall");
    assert.equal(event.route_role_hint, "evening_anchor");
  })();
});

test("Athens source inspect exposes configured event sources and capped time-sensitive rows", async () => {
  await withMockFetch(async () => {
    const pulse = await buildCityPulse(
      {
        ...athens,
        services: {
          ...athens.services,
          fetchWeatherForDates: async () => ({ [DATE]: null }),
          pulseSourceProviders: nonWeatherProviders(),
        },
      },
      { date: DATE, now: NOW, inspectSources: true },
    );

    const inspect = pulse.source_provider_inspect;
    assert.ok(inspect);
    assert.ok(inspect.provider_ids.includes("athens-city-events-calendar"));
    assert.ok(inspect.provider_ids.includes("athens-megaron-calendar"));
    assert.equal(inspect.normalized_time_sensitive_event_count, 2);
    assert.equal(inspect.time_sensitive_event_rows[0].source.label, "City of Athens events calendar");
    assert.equal(inspect.time_sensitive_event_rows[0].timing_relevance, "now");
    assert.equal(inspect.time_sensitive_event_rows[1].source.label, "Megaron Athens events calendar");
    assert.equal(inspect.time_sensitive_event_rows[1].timing_relevance, "tonight");
  })();
});

test("Athens City event source failures fail soft without breaking source collection", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("source temporarily unavailable");
  };
  try {
    const result = await collectPulseSourcesForCity(athens, {
      providerSpecs: nonWeatherProviders().filter((spec) => spec.descriptor.id === "athens-city-events-calendar"),
      context: { now: NOW, date: DATE },
    });

    assert.deepEqual(result.time_sensitive_events, []);
    const citySource = result.source_status.find((status) => status.id === "athens-city-events-calendar");
    assert.equal(citySource.status, "failed");
    assert.equal(citySource.reason, "source temporarily unavailable");
    assert.equal(citySource.time_sensitive_events, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Athens still has live venue events when City of Athens endpoint is blocked", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith("https://www.cityofathens.gr/wp-json/tribe/events/v1/events")) {
      return { ok: false, status: 403, headers: { get: () => "text/html" }, text: async () => "blocked" };
    }
    if (String(url) === "https://www.megaron.gr/en/events-2/calendar/") {
      return textResponse(megaronListingHtml());
    }
    if (String(url) === "https://www.megaron.gr/en/event/test-garden-concert/") {
      return textResponse(megaronDetailHtml());
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const result = await collectPulseSourcesForCity(athens, {
      providerSpecs: nonWeatherProviders(),
      context: { now: NOW, date: DATE },
    });

    const citySource = result.source_status.find((status) => status.id === "athens-city-events-calendar");
    const megaron = result.source_status.find((status) => status.id === "athens-megaron-calendar");
    assert.equal(citySource.status, "failed");
    assert.equal(citySource.reason, "source_http_403");
    assert.equal(megaron.status, "ok");
    assert.equal(megaron.time_sensitive_events, 1);
    assert.equal(result.time_sensitive_events.length, 1);
    assert.equal(result.time_sensitive_events[0].source_label, "Megaron Athens events calendar");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Athens Pulse API summarizes visible live source health without hiding blocked official source", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith("https://www.cityofathens.gr/wp-json/tribe/events/v1/events")) {
      return { ok: false, status: 403, headers: { get: () => "text/html" }, text: async () => "blocked" };
    }
    if (String(url) === "https://www.megaron.gr/en/events-2/calendar/") {
      return textResponse(megaronListingHtml());
    }
    if (String(url) === "https://www.megaron.gr/en/event/test-garden-concert/") {
      return textResponse(megaronDetailHtml());
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const pulse = await buildCityPulse(
      {
        ...athens,
        services: {
          ...athens.services,
          fetchWeatherForDates: async () => ({ [DATE]: null }),
          pulseSourceProviders: nonWeatherProviders(),
        },
      },
      { date: DATE, now: NOW, lang: "en", inspectSources: true },
    );

    assert.deepEqual(pulse.source_status_summary.ok.map((source) => source.label), [
      "Megaron Athens events calendar",
    ]);
    assert.deepEqual(pulse.source_status_summary.blocked.map((source) => source.label), [
      "City of Athens events calendar",
    ]);
    assert.equal(
      pulse.source_status_summary.text,
      "Live sources: Megaron Athens events calendar ok; City of Athens events calendar blocked",
    );
    assert.ok(
      pulse.source_provider_inspect.source_status.some(
        (status) => status.id === "athens-city-events-calendar" && status.reason === "source_http_403",
      ),
    );
  } finally {
    global.fetch = originalFetch;
  }
});
