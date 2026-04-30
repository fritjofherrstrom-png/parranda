const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildApp } = require("../server/app");
const { routeTemplates, allItems } = require("../server/catalog");
const { resetLiveEventsCache } = require("../server/live-events");
const { buildRouteFromTemplate, routeSimilarity } = require("../server/route-engine");

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

test("katalogen har geo-bredd nog för flera olika Rom-dagar", () => {
  assert.ok(routeTemplates.length >= 35);
  assert.ok(allItems.length >= 100);
});

test("buildRouteFromTemplate skapar en riktig loop utan upprepade stopp", () => {
  const template = routeTemplates.find((entry) => entry.id === "monti-market-aperitivo-loop");
  const anchor = { label: "Monti", lat: 41.8946, lng: 12.4951 };
  const route = buildRouteFromTemplate(
    template,
    anchor,
    anchor,
    7,
    ["vin", "hidden gems", "nattliv"],
    "wine-crawl",
    "low_key",
    "soft_target",
  );

  assert.equal(route.route_shape, "loop");
  assert.equal(route.start_label, "Monti");
  assert.equal(route.end_label, "Monti");
  assert.equal(new Set(route.main_stops.map((stop) => stop.id)).size, route.main_stops.length);
  assert.ok(route.legs.length >= 1);
});

test("buildRouteFromTemplate håller ett smalt kyrkoval tydligt kyrkoburet", () => {
  const template = routeTemplates.find((entry) => entry.id === "centro-church-salon");
  const anchor = { label: "Centro Storico", lat: 41.8984, lng: 12.4768 };
  const route = buildRouteFromTemplate(
    template,
    anchor,
    anchor,
    6,
    ["kyrkor"],
    null,
    null,
    "soft_target",
  );

  assert.ok(route.main_stops.length >= 2);
  assert.ok(route.main_stops.every((stop) => stop.tags.includes("kyrkor")));
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
    assert.equal(response.body.city, "rome");
    assert.ok(response.body.items.some((item) => item.label === "Trastevere"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search markerar när en okänd city fallbackar till rome", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during city fallback test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=unknown-city&q=vin",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.requested_city, "unknown-city");
    assert.equal(response.body.city_fallback_used, true);
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

    if (parsed.hostname === "api.open-meteo.com") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            daily: {
              time: ["2026-04-21"],
              weathercode: [1],
              temperature_2m_max: [24],
              temperature_2m_min: [14],
            },
            current: {
              temperature_2m: 19.6,
              weather_code: 1,
              is_day: 1,
            },
          };
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
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.date, "2026-04-21");
    assert.ok(response.body.moments.some((item) => item.title === "Natale di Roma"));
    assert.ok(Array.isArray(response.body.items));
    assert.ok(response.body.items.some((item) => item.level === "city"));
    assert.ok(response.body.items.some((item) => item.level === "neighborhood"));
    assert.ok(response.body.items.some((item) => item.level === "venue"));
    assert.ok(response.body.wildcards.length >= 1);
    assert.ok(Array.isArray(response.body.official_events));
    assert.equal(response.body.weather?.maxTemp, 24);
    assert.equal(response.body.weather?.currentTemp, 19.6);
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

test("POST /api/route-recommendations markerar när en okänd city fallbackar till rome", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-04-20"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    throw new Error(`Unexpected fetch during route city fallback test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        city: "unknown-city",
        dates: ["2026-04-20"],
        walking_km_target: 8,
        preferences: ["vin", "mat", "kultur"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.requested_city, "unknown-city");
    assert.equal(response.body.city_fallback_used, true);
    assert.equal(response.body.days.length, 1);
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

test("POST /api/route-recommendations accepterar home base i auto-läget", async () => {
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

    throw new Error(`Unexpected fetch during home-base route test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-21"],
        home_base: { type: "preset", label: "Monti" },
        start: { type: "auto" },
        end: { type: "auto" },
        walking_km_target: 7,
        preferences: ["vin", "mat", "kultur", "hidden gems"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.resolved_home_base.label, "Monti");
    assert.ok(Array.isArray(response.body.days));
    assert.ok(response.body.days.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations håller Monti -> Monti i rätt zon", async () => {
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

    throw new Error(`Unexpected fetch during Monti anchor test: ${url}`);
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
        optimizer_mode: "wine-crawl",
        modifier: "low_key",
        budget_tier: "dolce-vita",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.days[0].primary_route.route_shape, "loop");
    assert.equal(response.body.days[0].primary_route.routing_source, "heuristic");
    assert.match(response.body.days[0].primary_route.anchor_zone, /Monti/);
    assert.ok(
      !response.body.days[0].primary_route.main_stops.some((stop) =>
        ["Prati", "Borgo"].includes(stop.area),
      ),
    );
    assert.ok(response.body.days[0].primary_route.geo_fit_note);
    assert.ok(response.body.days[0].primary_route.legs.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations gör ett ensamt kyrkoval mycket striktare", async () => {
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

    throw new Error(`Unexpected fetch during strict church route test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-20"],
        start: { type: "preset", label: "Centro Storico" },
        end: { type: "preset", label: "Centro Storico" },
        walking_km_target: 6,
        preferences: ["kyrkor"],
      },
    });

    const primaryStops = response.body.days[0].primary_route.main_stops;

    assert.equal(response.status, 200);
    assert.ok(primaryStops.length >= 2);
    assert.ok(primaryStops.every((stop) => stop.tags.includes("kyrkor")));
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

test("POST /api/route-recommendations bygger en tydlig båge mellan Trastevere och Monti", async () => {
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

    throw new Error(`Unexpected fetch during arc routing test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-04-21"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Monti" },
        walking_km_target: 8,
        preferences: ["öl", "vin", "nattliv", "hidden gems"],
        optimizer_mode: "bar-hop",
        modifier: "party",
      },
    });

    const primaryRoute = response.body.days[0].primary_route;

    assert.equal(response.status, 200);
    assert.equal(primaryRoute.route_shape, "arc");
    assert.equal(primaryRoute.start_label, "Trastevere");
    assert.equal(primaryRoute.end_label, "Monti");
    assert.ok(primaryRoute.anchor_zone.includes("Trastevere"));
    assert.ok(
      primaryRoute.main_stops.some(
        (stop) => stop.area.includes("Monti") || stop.area.includes("Centro"),
      ),
    );
    assert.ok(primaryRoute.geo_fit_note);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations returnerar gångben och låter leg pacing påverka rutten", async () => {
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

    throw new Error(`Unexpected fetch during leg pacing test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const [shortResponse, flexibleResponse] = await Promise.all([
      requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations",
        body: {
          dates: ["2026-04-21"],
          start: { type: "preset", label: "Trastevere" },
          end: { type: "preset", label: "San Lorenzo" },
          walking_km_target: 9,
          leg_pacing: "short",
          preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
          optimizer_mode: "bar-hop",
        },
      }),
      requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations",
        body: {
          dates: ["2026-04-21"],
          start: { type: "preset", label: "Trastevere" },
          end: { type: "preset", label: "San Lorenzo" },
          walking_km_target: 9,
          leg_pacing: "flexible",
          preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
          optimizer_mode: "bar-hop",
        },
      }),
    ]);

    const shortRoute = shortResponse.body.days[0].primary_route;
    const flexibleRoute = flexibleResponse.body.days[0].primary_route;

    assert.equal(shortResponse.status, 200);
    assert.equal(flexibleResponse.status, 200);
    assert.ok(shortRoute.legs.length >= 1);
    assert.ok(shortRoute.legs.every((leg) => Number.isFinite(leg.estimated_walk_minutes)));
    assert.ok(Number.isFinite(shortRoute.longest_leg_km));
    assert.ok(Number.isFinite(shortRoute.longest_leg_minutes));
    assert.ok(typeof shortRoute.leg_fit_note === "string" || shortRoute.leg_fit_note === null);
    assert.ok(Number.isFinite(flexibleRoute.longest_leg_km));
    assert.ok(shortRoute.longest_leg_km <= flexibleRoute.longest_leg_km);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations ger alternativ som skiljer sig tydligt från huvudrutten", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-04-20"],
          weathercode: [0],
          temperature_2m_max: [20],
        },
      });
    }

    throw new Error(`Unexpected fetch during dedupe test: ${url}`);
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
        walking_km_target: 8,
        preferences: ["vin", "mat", "hidden gems", "nattliv"],
        optimizer_mode: "bar-hop",
      },
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.days[0].alternatives.length >= 1);
    assert.ok(routeSimilarity(response.body.days[0].primary_route, response.body.days[0].alternatives[0]) < 10);
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
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.item.label, "Bar San Calisto");
    assert.ok(response.body.item.price_level);
    assert.ok(response.body.item.long_description);
    assert.match(response.body.item.external_search_url, /Rome/);
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

test("POST /api/route-recommendations kan väva in ett live-event som faktiskt ruttstopp", async () => {
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
                      <a href="/en/events/teatro-india-night">Teatro India Night</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;16-04-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;16-04-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/teatro-india">Teatro di Roma - Teatro India</a></div>
                </div>
                <div class="news_indirizzo">Lungotevere Vittorio Gassman</div>
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

    throw new Error(`Unexpected fetch during live route stop integration test: ${url}`);
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
        preferences: ["kultur", "nattliv"],
        optimizer_mode: "bar-hop",
        modifier: "evening",
      },
    });

    assert.equal(response.status, 200);
    assert.ok(
      response.body.days[0].primary_route.main_stops.some(
        (stop) => stop.is_live_event && stop.label === "Teatro India Night",
      ),
    );
    assert.match(
      response.body.days[0].primary_route.live_event_fit_note || "",
      /ligger inne i själva rutten/i,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
