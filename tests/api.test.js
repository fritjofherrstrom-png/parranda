const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildApp } = require("../server/app");
const { resetLiveEventsCache } = require("../server/live-events");

const originalFetch = global.fetch;

function mockJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    },
  };
}

async function requestJson(server, { method = "GET", path = "/", body } = {}) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        });
      },
    );

    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

test("GET /api/places/search returnerar kuraterade träffar", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during places/search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?q=trastevere",
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.items.some((item) => item.label === "Trastevere"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/city-pulse returnerar stadspuls, wildcard och officiella tips", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return `
            <div class="views-row views-row-1">
              <div class="news_info">
                <div class="news_titolo_container">
                  <div class="news_titolo">
                    <div class="field-content">
                      <a href="/en/events/roma-birthday-street-show">Roma Birthday Street Show</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;21-04-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;21-04-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/trastevere">Trastevere</a></div>
                </div>
                <div class="news_indirizzo">Piazza Trilussa</div>
                <div class="news_text">
                  <div class="field-content"><p>Small open-air music moment for the city birthday.</p></div>
                </div>
              </div>
            </div>
          `;
        },
      };
    }

    throw new Error(`Unexpected fetch during city-pulse test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/city-pulse?date=2026-04-21",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.date, "2026-04-21");
    assert.ok(response.body.moments.some((item) => item.title === "Natale di Roma"));
    assert.ok(Array.isArray(response.body.items));
    assert.ok(response.body.items.some((item) => item.level === "city"));
    assert.ok(response.body.items.some((item) => item.level === "neighborhood"));
    assert.ok(response.body.items.some((item) => item.level === "venue"));
    assert.ok(response.body.wildcards.length >= 1);
    assert.ok(Array.isArray(response.body.official_events));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/geocode använder lokal katalog när det går", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected remote geocode fetch: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/geocode",
      body: {
        query: "Monti",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.candidates[0].label, "Monti");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/geocode prioriterar exakt stadsdelsmatch före venue-sökterm", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected remote geocode fetch: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/geocode",
      body: {
        query: "Testaccio",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.candidates[0].label, "Testaccio");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations fungerar även när vädret saknas", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      throw new Error("Weather provider unavailable");
    }

    throw new Error(`Unexpected fetch during route-recommendations test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-20"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Trastevere" },
        walking_km_target: 9,
        preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.days.length, 1);
    assert.ok(response.body.days[0].primary_route.title);
    assert.ok(Array.isArray(response.body.days[0].date_signals));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations accepterar budget tier och modifier", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-04-20"],
          weathercode: [0],
          temperature_2m_max: [21],
        },
      });
    }

    throw new Error(`Unexpected fetch during style-layer test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-20"],
        start: { type: "preset", label: "Monti" },
        end: { type: "preset", label: "Monti" },
        walking_km_target: 7,
        preferences: ["vin", "cocktail", "hidden gems", "nattliv"],
        budget_tier: "dolce-vita",
        modifier: "party",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.days.length, 1);
    assert.ok(response.body.days[0].primary_route.budget_note);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations prioriterar rätt sida av stan i södra Rom", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-04-21"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    throw new Error(`Unexpected fetch during south-side routing test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-21"],
        start: { type: "preset", label: "Garbatella" },
        end: { type: "preset", label: "Testaccio" },
        walking_km_target: 6,
        preferences: ["öl", "vin", "mat", "hidden gems", "low-key"],
        optimizer_mode: "bar-hop",
        modifier: "low_key",
      },
    });

    assert.equal(response.status, 200);
    assert.ok(
      response.body.days[0].primary_route.main_stops.some((stop) => stop.area === "Garbatella"),
    );
    assert.ok(
      response.body.days[0].primary_route.main_stops.some(
        (stop) => stop.area === "Testaccio" || stop.area === "Ostiense",
      ),
    );
    assert.ok(
      !response.body.days[0].primary_route.main_stops.some(
        (stop) => stop.area === "Trastevere",
      ),
    );
    assert.ok(response.body.days[0].primary_route.area_note);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/place-details returnerar rik metadata för känd plats", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during place-details test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/place-details?q=Bar%20San%20Calisto",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.item.label, "Bar San Calisto");
    assert.ok(response.body.item.price_level);
    assert.ok(response.body.item.long_description);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/geocode returnerar 502 när extern geocoding fallerar", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "nominatim.openstreetmap.org") {
      throw new Error("Nominatim offline");
    }

    return mockJsonResponse({});
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/geocode",
      body: {
        query: "Roma Termini",
      },
    });

    assert.equal(response.status, 502);
    assert.equal(response.body.error, "Geocoding failed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations returnerar officiella live-events när provider svarar", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-04-16"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return `
            <div class="views-row views-row-1">
              <div class="news_info">
                <div class="news_titolo_container">
                  <div class="news_titolo">
                    <div class="field-content">
                      <a href="/en/events/show-visits-india-theater">Show visits at the India Theater</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;15-03-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;24-05-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/teatro-di-roma-teatro-india">Teatro di Roma - Teatro India</a></div>
                </div>
                <div class="news_indirizzo">Lungotevere Vittorio Gassman, 1</div>
                <div class="news_text">
                  <div class="field-content"><p>Guided show visits for a cultural evening in Rome.</p></div>
                </div>
                <a class="news_button_acquista" href="https://tickets.example.com/india" target="_blank">
                  Buy
                </a>
              </div>
            </div>
          `;
        },
      };
    }

    if (parsed.hostname === "nominatim.openstreetmap.org") {
      return mockJsonResponse([
        {
          display_name: "Teatro di Roma - Teatro India, Rome, Italy",
          lat: "41.8704",
          lon: "12.4674",
          type: "theatre",
        },
      ]);
    }

    throw new Error(`Unexpected fetch during route-recommendations integration test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-16"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Trastevere" },
        walking_km_target: 8,
        preferences: ["kultur", "kyrkor"],
        optimizer_mode: "church-crawl",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.days[0].live_events.length, 1);
    assert.equal(response.body.days[0].live_events[0].venue, "Teatro di Roma - Teatro India");
    assert.ok(typeof response.body.days[0].live_events[0].lat === "number");
    assert.ok(response.body.days[0].live_events[0].route_fit_note);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
