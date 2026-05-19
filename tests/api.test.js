const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { buildApp } = require("../server/app");
const { routeTemplates, allItems } = require("../server/catalog");
const { resetBarcelonaLiveEventsCache } = require("../server/cities/barcelona/live");
const { resetLiveEventsCache } = require("../server/live-events");
const { buildRouteFromTemplate, routeSimilarity } = require("../server/route-engine");

const originalFetch = global.fetch;

function assertLocalTruthShape(localTruth) {
  assert.ok(localTruth && typeof localTruth === "object");
  assert.ok(Array.isArray(localTruth.score_adjustments));
  assert.ok(Array.isArray(localTruth.caution_notes));
  assert.ok(Array.isArray(localTruth.verify_opening_hours));
  assert.ok(Array.isArray(localTruth.route_context_notes));
  assert.ok(Array.isArray(localTruth.live_context_notes));
  assert.ok(Array.isArray(localTruth.prefer_tags));
  assert.ok(Array.isArray(localTruth.avoid_tags));
  assert.ok(Number.isFinite(localTruth.score_delta));
}

function assertNeutralLocalTruth(localTruth) {
  assertLocalTruthShape(localTruth);
  assert.deepEqual(localTruth.score_adjustments, []);
  assert.deepEqual(localTruth.caution_notes, []);
  assert.deepEqual(localTruth.verify_opening_hours, []);
  assert.deepEqual(localTruth.route_context_notes, []);
  assert.deepEqual(localTruth.live_context_notes, []);
  assert.deepEqual(localTruth.prefer_tags, []);
  assert.deepEqual(localTruth.avoid_tags, []);
  assert.equal(localTruth.score_delta, 0);
}

const secondHandFamilyTags = new Set([
  "second_hand",
  "vintage",
  "shopping",
  "market",
  "event_market",
  "antique",
  "antiques",
]);

function isSecondHandFamilyStop(stop) {
  return (stop?.tags || []).some((tag) => secondHandFamilyTags.has(tag));
}

function secondHandFamilyStopCount(route) {
  return (route?.main_stops || []).filter((stop) => isSecondHandFamilyStop(stop)).length;
}

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

async function requestText(server, { method = "GET", path = "/" } = {}) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
      },
      (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: data,
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function assertPlannerIntentFirstPaint(html) {
  assert.match(html, /value="food_drink"\s+checked\s*\/>\s*<span>Mat &amp; dryck<\/span>/);
  assert.match(html, /value="culture"\s+checked\s*\/>\s*<span>Kultur<\/span>/);
  assert.match(html, /value="second_hand"\s*\/>\s*<span>Second hand<\/span>/);
  assert.match(html, /value="hidden_gems"\s+checked\s*\/>\s*<span>Hidden gems<\/span>/);
  assert.match(html, /value="views"\s*\/>\s*<span>Utsikt<\/span>/);
  assert.match(html, /value="nightlife"\s+checked\s*\/>\s*<span>Kvällsliv<\/span>/);
  assert.match(html, /value="history"\s*\/>\s*<span>Historia<\/span>/);
  assert.match(html, /value="green_walk"\s*\/>\s*<span>Grönt &amp; promenad<\/span>/);
  assert.doesNotMatch(html, /value="öl"\s+checked/);
  assert.doesNotMatch(html, /value="vin"\s+checked/);
  assert.doesNotMatch(html, /value="cocktail"/);
  assert.doesNotMatch(html, /value="kyrkor"/);
  assert.doesNotMatch(html, /value="nattliv"\s+checked/);
  assert.doesNotMatch(html, /value="party"/);
}

test("server/app.js uses keyed shell i18n instead of post-render replacement", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "app.js"), "utf8");
  const removedSymbols = [
    ["shell", "Html", "Translations"].join(""),
    ["apply", "Shell", "Html", "Translations"].join(""),
  ];

  removedSymbols.forEach((symbolName) => {
    assert.equal(source.includes(symbolName), false);
  });
  assert.match(source, /buildStaticShellI18nReplacements/);
  assert.match(source, /__PARRANDA_I18N_BOOTSTRAP__/);
});

test("shell has full i18n coverage for English mode without Swedish leakage", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during shell i18n coverage test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const enResponse = await requestText(server, {
      path: "/barcelona?lang=en",
    });

    assert.equal(enResponse.status, 200);
    assert.match(enResponse.body, /<body data-city-key="barcelona"[^>]+data-lang="en">/);

    // The client-side i18n bootstrap legitimately contains every language for
    // runtime language switching. Strip it so leakage checks only inspect what
    // the user actually sees rendered.
    const visibleHtml = enResponse.body.replace(
      /window\.__PARRANDA_I18N__\s*=\s*\{[\s\S]*?\};/,
      "window.__PARRANDA_I18N__ = {};",
    );

    // No previously-hardcoded Swedish strings may leak into the English shell.
    const swedishSentinels = [
      "Välj kvarter före checklista",
      "Bästa timmarna",
      "Bygg en personlig liten lista",
      "Visa sparade",
      "Visa alla igen",
      "Se ställena på kartan",
      "Karta över platser i staden",
      "0 sparade",
      "Välj en plats i listan eller på kartan",
      "Spara vald plats",
      "Öppna i Google Maps",
      "Klassiker rätt gjort",
      "Sök plats eller känsla",
      "STADSDELSMODE",
      "STOPP DU INTE SKA MISSA",
      "PERFEKTA DAGEN",
      "GÖR NÅGOT AV DET",
      "Sätt som start",
      "Sätt som mål",
      "Planera dag härifrån",
      "Visa kvarteret på karta",
      "Hotell eller område",
      "Startkvarter",
      "Slutkvarter",
      "Visa på karta",
    ];
    swedishSentinels.forEach((swedish) => {
      assert.equal(
        visibleHtml.includes(swedish),
        false,
        `English shell must not contain Swedish string: "${swedish}"`,
      );
    });

    // No unresolved __PARRANDA_I18N_*__ tokens may remain.
    assert.doesNotMatch(visibleHtml, /__PARRANDA_I18N_[A-Z0-9_]+__/);

    // English equivalents should be present.
    const englishExpected = [
      "Choose a neighborhood before a checklist",
      "Build a personal little list",
      "Show saved",
      "See the places on the map",
      "Map of places in the city",
      "0 saved",
      "Choose a place from the list",
      "Save selected place",
      "Open in Google Maps",
      "Classics done right",
      "NEIGHBORHOOD MODE",
      "STOPS NOT TO MISS",
      "THE PERFECT DAY",
      "Set as start",
      "Set as end",
    ];
    englishExpected.forEach((english) => {
      assert.equal(
        visibleHtml.includes(english),
        true,
        `English shell must contain: "${english}"`,
      );
    });

    // Swedish shell still works.
    const svResponse = await requestText(server, {
      path: "/barcelona?lang=sv",
    });
    assert.equal(svResponse.status, 200);
    const visibleSvHtml = svResponse.body.replace(
      /window\.__PARRANDA_I18N__\s*=\s*\{[\s\S]*?\};/,
      "window.__PARRANDA_I18N__ = {};",
    );
    assert.ok(visibleSvHtml.includes("Välj kvarteret som ska bära dagen"));
    assert.ok(visibleSvHtml.includes("Klassiker rätt gjort"));
    assert.doesNotMatch(visibleSvHtml, /__PARRANDA_I18N_[A-Z0-9_]+__/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("shared shell template carries no Rome-specific DOM identifiers", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  // Issue #58: classes/template ids previously hard-coded Rome content into the
  // shared shell. They are now city-neutral.
  assert.doesNotMatch(html, /class="[^"]*trastevere-bars-grid/);
  assert.doesNotMatch(html, /class="[^"]*trastevere-day/);
  assert.doesNotMatch(html, /id="trastevereBarTemplate"/);
  assert.doesNotMatch(html, /id="romeRouteTemplate"/);
});

test("place card JS render uses i18n for map link instead of hardcoded Swedish", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  // PR #65 audit (Q5): the template tokenization of `.map-link` in
  // placeCardTemplate is undone if JS rebinds `.textContent` to a hardcoded
  // Swedish string when cloning. The place-card path must go through the i18n
  // helper so EN users see "Show on map".
  assert.match(
    source,
    /mapLink\.textContent\s*=\s*t\("template\.placeCard\.mapLink"/,
  );
  // The exact regression sentinel that was present before the fix.
  assert.doesNotMatch(
    source,
    /mapLink\.textContent\s*=\s*"Visa på karta";/,
  );
});

test("planner modal title uses city-time framing instead of trip framing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

  assert.match(source, /Plan your time in \$\{plannerDisplayCityLabel\}/);
  assert.match(source, /Planera din tid i \$\{plannerDisplayCityLabel\}/);
  assert.doesNotMatch(source, /Your trip to \$\{plannerDisplayCityLabel\}/);
  assert.doesNotMatch(source, /Din resa till \$\{plannerDisplayCityLabel\}/);
});

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
  resetBarcelonaLiveEventsCache();
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

test("GET /api/places/search hittar Rome second hand-träffar via Rome-specifika söktermer", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during second hand search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?q=seconda%20mano",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.ok(response.body.items.some((item) => item.id === "humana-vintage-monti"));
    assert.ok(response.body.items.some((item) => item.id === "ciao-vintage"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search hittar Rome-marknader via mercatino utan global alias-läcka", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during market search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?q=mercatino",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.ok(response.body.items.some((item) => item.id === "porta-portese-market"));
    assert.ok(response.body.items.some((item) => item.id === "borghetto-flaminio-market"));
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

test("GET /api/places/search för barcelona lånar inte Rome-platser", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Barcelona search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=barcelona&q=monti",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.requested_city, "barcelona");
    assert.equal(response.body.city_fallback_used, false);
    assert.deepEqual(response.body.items, []);
    assert.doesNotMatch(JSON.stringify(response.body), /Trastevere|Monti|Testaccio|Centro Storico/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search hittar Bandini's i Barcelona pilotkatalog", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Barcelona Bandini search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=barcelona&q=bandini",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.requested_city, "barcelona");
    assert.equal(response.body.city_fallback_used, false);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].id, "bandinis-barcelona");
    assert.equal(response.body.items[0].label, "Bandini's");
    assert.equal(response.body.items[0].area, "sant-antoni");
    assert.doesNotMatch(JSON.stringify(response.body), /Trastevere|Monti|Testaccio|Centro Storico/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search för barcelona visar inte strukturella route anchors som platser", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Barcelona route-anchor search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=barcelona&q=gracia",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.city_fallback_used, false);
    assert.ok(response.body.items.length > 0);
    assert.ok(
      response.body.items.every((item) => item.type !== "district" && item.type !== "district-group"),
      "structural Barcelona route anchors should not appear as ordinary place search results",
    );
    assert.ok(!response.body.items.some((item) => item.id === "gracia-route-anchor"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET / renderar global landing page (inte city-shell)", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during landing page test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, { path: "/" });

    assert.equal(response.status, 200);
    // Landing page — no city bootstrap or city-specific tokens
    assert.ok(!response.body.includes("__PARRANDA_CITY_BOOTSTRAP__"));
    assert.ok(!response.body.includes("__PARRANDA_TITLE__"));
    assert.ok(!response.body.includes('data-city-key="rome"'));
    assert.ok(!response.body.includes('window.__PARRANDA_CITY__'));
    // Landing v2: locked hero headline + subcopy (SV)
    assert.match(response.body, /Nästa stopp\?/);
    assert.match(response.body, /Välj en stad\. Parranda bygger en dag/);
    assert.match(response.body, /Sök stad/);
    assert.match(response.body, /lp-hero/);
    assert.match(response.body, /<html lang="sv">/);
    // City registry server-rendered into datalist (Barcelona + Rom; aliases via JS registry)
    assert.ok(response.body.includes('value="Barcelona"'));
    assert.ok(response.body.includes('value="Rom"'));
    assert.match(response.body, /window\.__PARRANDA_CITIES__/);
    assert.match(response.body, /"roma"\s*:/);
    assert.match(response.body, /"rome"\s*:/);
    // Internal-visibility cities must never leak
    assert.ok(!response.body.toLowerCase().includes("test city"));
    assert.ok(!response.body.includes('"key":"test-city"'));
    // Stale v1 copy is gone
    assert.ok(!response.body.includes("Din stad. Din dag. Curated."));
    assert.ok(!response.body.includes("Hitta din stad"));
    assert.ok(!response.body.includes("Börja med en stad"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /?lang=en renderar landing v2 med engelsk copy", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during EN landing test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, { path: "/?lang=en" });

    assert.equal(response.status, 200);
    // EN hero copy
    assert.match(response.body, /Next stop\?/);
    assert.match(response.body, /Choose a city\. Parranda builds a day/);
    assert.match(response.body, /Search city/);
    assert.match(response.body, /<html lang="en">/);
    // Registry still rendered, internal city still filtered
    assert.match(response.body, /window\.__PARRANDA_CITIES__/);
    assert.ok(response.body.includes('value="Barcelona"'));
    assert.ok(response.body.includes('value="Rom"'));
    assert.ok(!response.body.toLowerCase().includes("test city"));
    // Hero <h1> resolves to EN, not the SV token
    assert.match(response.body, /<h1 class="lp-hero__headline">Next stop\?<\/h1>/);
    assert.ok(!/<h1 class="lp-hero__headline">Nästa stopp\?<\/h1>/.test(response.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /barcelona renderar registrerad city-core preview utan Rome-fallback", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during shell fallback test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/barcelona",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<body data-city-key="barcelona" data-city-label="Barcelona" data-lang="sv">/);
    assert.match(
      response.body,
      /window\.__PARRANDA_CITY__ = \{"key":"barcelona","label":"Barcelona","displayLabel":"Barcelona"/,
    );
    assert.match(response.body, /"displayLabel":"Barcelona"/);
    assert.match(response.body, /"requestedKey":"barcelona"/);
    assert.match(response.body, /"fallbackUsed":false/);
    assert.match(response.body, /"visibility":"preview"/);
    assert.match(response.body, /<title>Parranda \| Barcelona city-core preview<\/title>/);
    assert.match(response.body, /<meta[\s\S]*name="description"[\s\S]*content="Barcelona är registrerad i Parranda, men det kuraterade citypacket är inte redo ännu\. City-core är aktivt utan lånat Rome-innehåll\."[\s\S]*\/>/);
    assert.match(response.body, /Barcelona är registrerad som stad, men har ännu inget kuraterat citypack/);
    assert.ok(!response.body.includes('id="heroEyebrow"'));
    assert.ok(!response.body.includes('id="heroHeadline"'));
    assert.ok(!response.body.includes('id="heroLead"'));
    assert.ok(!response.body.includes("Mjukt km-mål"));
    assert.match(response.body, /<button id="routePlannerOpenButton" class="primary-button" type="button">\s*Se planner-preview\s*<\/button>/);
    assert.match(response.body, /data-budget-tier="budget">\s*Budgetsmart\s*<\/button>/);
    assert.match(response.body, /data-budget-tier="dolce-vita">\s*Premium\s*<\/button>/);
    assert.match(response.body, /<button id="heroBlitzApplyButton" class="secondary-button" type="button" hidden>/);
    assert.match(response.body, /tydligt fallback-läge/);
    assert.doesNotMatch(response.body, /"key":"rome","label":"Rom","displayLabel":"Barcelona"/);
    assert.doesNotMatch(response.body, /Din resa till Rom/);
    assert.doesNotMatch(response.body, /Just nu i Rom/);
    assert.doesNotMatch(response.body, /google\.com\/maps\/search\/Rome/i);
    assert.doesNotMatch(response.body, /Monti som kulturstart/);
    assert.doesNotMatch(response.body, /kuraterade Rom-baserade rutter/);
    assert.doesNotMatch(response.body, /de kuraterade Rom-rutterna/);
    assert.doesNotMatch(response.body, /__PARRANDA_I18N_[A-Z0-9_]+__/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /test-city renderar en egen city shell utan Rome-fallback", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during test-city shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/test-city",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<body data-city-key="test-city" data-city-label="Test City" data-lang="sv">/);
    assert.match(response.body, /window\.__PARRANDA_CITY__ = \{"key":"test-city","label":"Test City"/);
    assert.match(response.body, /"requestedKey":"test-city"/);
    assert.match(response.body, /"fallbackUsed":false/);
    assert.match(response.body, /"visibility":"internal"/);
    assert.match(response.body, /<title>Parranda \| Test City internal preview<\/title>/);
    assert.match(response.body, /<meta[\s\S]*name="description"[\s\S]*content="Test City är en intern city-core-preview för att verifiera shell, planner och fallback-beteenden utan Rome-innehåll\."[\s\S]*\/>/);
    assert.ok(!response.body.includes('id="heroEyebrow"'));
    assert.ok(!response.body.includes('id="heroHeadline"'));
    assert.ok(!response.body.includes('id="heroLead"'));
    assert.ok(!response.body.includes("Mjukt km-mål"));
    assert.match(response.body, /<button id="routePlannerOpenButton" class="primary-button" type="button">\s*Öppna preview\s*<\/button>/);
    assert.match(response.body, /data-budget-tier="budget">\s*Budgetsmart\s*<\/button>/);
    assert.match(response.body, /data-budget-tier="dolce-vita">\s*Premium\s*<\/button>/);
    assert.match(response.body, /<button id="heroBlitzApplyButton" class="secondary-button" type="button" hidden>/);
    assertPlannerIntentFirstPaint(response.body);
    assert.doesNotMatch(response.body, /data-city-label="Rom"/);
    assert.doesNotMatch(response.body, /__PARRANDA_I18N_[A-Z0-9_]+__/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /unknown-city använder fortsatt ärlig fallback-preview", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during unknown city shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/unknown-city?lang=en",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<body data-city-key="rome" data-city-label="Unknown City" data-lang="en">/);
    assert.match(response.body, /"requestedKey":"unknown-city"/);
    assert.match(response.body, /"fallbackUsed":true/);
    assert.match(response.body, /"visibility":"public"/);
    assert.match(response.body, /Unknown City is still being prepared/);
    assert.doesNotMatch(response.body, /"key":"unknown-city"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /rome?lang=en renderar engelsk shell och planner utan att byta interna keys", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during English shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/rome?lang=en",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<html lang="en">/);
    assert.match(response.body, /<body data-city-key="rome" data-city-label="Rome" data-lang="en">/);
    assert.match(response.body, /window\.__PARRANDA_LANGUAGE__ = "en"/);
    assert.match(response.body, /"lang":"en"/);
    assert.match(response.body, /<title>Parranda \| Personal City Guide for Rome<\/title>/);
    assert.ok(response.body.includes("Curated city days with more feeling than a checklist"));
    assert.ok(response.body.includes("Build your day in Rome"));
    assert.ok(response.body.includes("Choose a date and mood. Parranda builds the route."));
    assert.ok(response.body.includes("Plan the day"));
    assert.ok(response.body.includes("Let Parranda choose"));
    assert.ok(response.body.includes("Manual controls"));
    assert.ok(response.body.includes("Loading today’s Pulse..."));
    assert.ok(response.body.includes("Open Pulse"));
    assert.ok(response.body.includes("WHERE YOU’RE STAYING"));
    assert.ok(response.body.includes("Hotel or area"));
    assert.ok(response.body.includes("Optional"));
    assert.ok(response.body.includes("Plan my day"));
    assert.match(response.body, /value="food_drink"\s+checked\s*\/>\s*<span>Food &amp; drink<\/span>/);
    assert.match(response.body, /value="nightlife"\s+checked\s*\/>\s*<span>Nightlife<\/span>/);
    assert.match(response.body, /value="second_hand"\s*\/>\s*<span>Second hand<\/span>/);
    assert.match(response.body, /<span class="map-badge planner-day-badge">Main route<\/span>/);
    assert.doesNotMatch(response.body, /<button[^>]*id="routePlanButton"[^>]*>\s*Planera min dag\s*<\/button>/);
    assert.doesNotMatch(response.body, /<p class="eyebrow">DÄR DU BOR<\/p>/);
    assert.doesNotMatch(response.body, /value="food_drink"\s+checked\s*\/>\s*<span>Mat &amp; dryck<\/span>/);
    assert.doesNotMatch(response.body, /__PARRANDA_I18N_[A-Z0-9_]+__/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /rome?lang=unknown faller säkert tillbaka till svenska", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during language fallback shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/rome?lang=zz",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<html lang="sv">/);
    assert.match(response.body, /data-lang="sv"/);
    assert.ok(response.body.includes("Planera dagen"));
    assert.ok(response.body.includes("Låt Parranda välja"));
    assert.doesNotMatch(response.body, /Din resa till Rom/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /barcelona?lang=en är registrerad engelsk city-core preview", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during English fallback shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/barcelona?lang=en",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<body data-city-key="barcelona" data-city-label="Barcelona" data-lang="en">/);
    assert.match(response.body, /<title>Parranda \| Barcelona city-core preview<\/title>/);
    assert.match(response.body, /"fallbackUsed":false/);
    assert.match(response.body, /"visibility":"preview"/);
    assert.ok(response.body.includes("Barcelona is registered as a city, but does not have a curated citypack yet"));
    assert.ok(response.body.includes("Planner preview"));
    assert.ok(response.body.includes("See planner preview"));
    assert.match(
      response.body,
      /id="mapPlaceLink"[\s\S]*href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Barcelona%20hidden%20gems"/,
    );
    assert.doesNotMatch(response.body, /Din resa till Rom/);
    assert.doesNotMatch(response.body, /launched curated Barcelona/i);
    assert.doesNotMatch(response.body, /google\.com\/maps\/search\/Rome/i);
    assert.doesNotMatch(response.body, /__PARRANDA_CITY_MAP_URL__/);
    assert.doesNotMatch(response.body, /Rome-wide/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /test-city?lang=en är fortsatt intern preview på engelska", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during English internal shell test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/test-city?lang=en",
    });

    assert.equal(response.status, 200);
    assert.match(response.body, /<body data-city-key="test-city" data-city-label="Test City" data-lang="en">/);
    assert.match(response.body, /<title>Parranda \| Test City internal preview<\/title>/);
    assert.ok(response.body.includes("Test City is running in preview"));
    assert.ok(response.body.includes("Internal planner preview"));
    assert.ok(response.body.includes("Open preview"));
    assert.doesNotMatch(response.body, /Din resa till Rom/);
    assert.doesNotMatch(response.body, /data-city-label="Rom"/);
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

test("GET /api/city-pulse använder lang bara för Pulse-prosa och behåller metadata", async () => {
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
                    <span class="date-display-start">from&nbsp;14-05-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;14-05-2026</span>
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
                  <div class="field-content"><p>Pågår nu provider summary that should remain source-owned.</p></div>
                </div>
              </div>
            </div>
          `;
        },
      };
    }

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-14"],
          weathercode: [1],
          temperature_2m_max: [24],
          temperature_2m_min: [14],
        },
        current: {
          temperature_2m: 19,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during city-pulse lang test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const sv = await requestJson(server, {
      path: "/api/city-pulse?date=2026-05-14&lang=sv",
    });
    const en = await requestJson(server, {
      path: "/api/city-pulse?date=2026-05-14&lang=en",
    });

    assert.equal(sv.status, 200);
    assert.equal(en.status, 200);
    assert.equal(sv.body.city, en.body.city);
    assert.equal(sv.body.requested_city, en.body.requested_city);
    assert.equal(sv.body.city_fallback_used, en.body.city_fallback_used);
    assert.equal(sv.body.date, en.body.date);
    assert.deepEqual(
      (sv.body.items || []).map((item) => item.id),
      (en.body.items || []).map((item) => item.id),
    );
    assert.deepEqual(
      (sv.body.items || []).map((item) => item.tags || []),
      (en.body.items || []).map((item) => item.tags || []),
    );
    assert.deepEqual(
      (sv.body.items || []).map((item) => item.route_hints || null),
      (en.body.items || []).map((item) => item.route_hints || null),
    );
    assert.deepEqual(
      (sv.body.items || []).map((item) => item.official_event_id || null),
      (en.body.items || []).map((item) => item.official_event_id || null),
    );
    assert.deepEqual(
      (sv.body.official_events || []).map((event) => event.id),
      (en.body.official_events || []).map((event) => event.id),
    );

    assert.match(sv.body.headline, /kväll|Rom|puls/i);
    assert.match(en.body.headline, /strong night|tonight|neighborhood|pulse|Rome/i);
    assert.notEqual(sv.body.headline, en.body.headline);
    assert.ok((en.body.items || []).some((item) => item.title === "Thursday is gnocchi day"));
    assert.ok((en.body.items || []).some((item) => item.kind === "Venue level"));

    const parrandaOwnedEnFields = {
      headline: en.body.headline,
      subhead: en.body.subhead,
      note: en.body.note,
      footer_note: en.body.footer_note,
      moments: (en.body.moments || []).map((item) => ({
        kind: item.kind,
        kindLabel: item.kindLabel,
        title: item.title,
        note: item.note,
      })),
      items: (en.body.items || [])
        .filter((item) => !String(item.id || "").startsWith("official-"))
        .map((item) => ({
          kind: item.kind,
          kindLabel: item.kindLabel,
          title: item.title,
          where: item.where,
          when: item.when,
          blurb: item.blurb,
          why_it_matters: item.why_it_matters,
          note: item.note,
        })),
    };

    assert.doesNotMatch(
      JSON.stringify(parrandaOwnedEnFields),
      /Pågår nu|Hela Rom|Ställesnivå|Torsdag är|April och maj|Stadens rytm|Kvarterspuls/i,
    );

    const visibleOfficialPulseFields = (en.body.items || [])
      .filter((item) => String(item.id || "").startsWith("official-"))
      .map((item) => ({
        kind: item.kind,
        when: item.when,
        why_it_matters: item.why_it_matters,
      }));

    assert.doesNotMatch(
      JSON.stringify(visibleOfficialPulseFields),
      /Officiellt live|Pågår i dag|Just nu|Det här är ett kort livefönster/i,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/city-pulse kan köras för test-city med no-op services", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-01"],
          weathercode: [1],
          temperature_2m_max: [24],
          temperature_2m_min: [14],
        },
        current: {
          temperature_2m: 23,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during test-city pulse test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/city-pulse?city=test-city&date=2026-05-01",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "test-city");
    assert.equal(response.body.requested_city, "test-city");
    assert.equal(response.body.city_fallback_used, false);
    assert.equal(response.body.headline, "Test City city-core är aktivt");
    assert.match(response.body.subhead, /Kuraterad Pulse för Test City är inte redo än/);
    assert.deepEqual(response.body.official_events, []);
    assert.deepEqual(response.body.items, []);
    assert.doesNotMatch(JSON.stringify(response.body), /Trastevere|Monti|Testaccio|Centro Storico|\bRom\b|\bRome\b/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/city-pulse för barcelona visar noop-preview utan Rome Pulse", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-14"],
          weathercode: [1],
          temperature_2m_max: [23],
          temperature_2m_min: [15],
        },
        current: {
          temperature_2m: 20,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona pulse test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const en = await requestJson(server, {
      path: "/api/city-pulse?city=barcelona&date=2026-05-14&lang=en",
    });
    const sv = await requestJson(server, {
      path: "/api/city-pulse?city=barcelona&date=2026-05-14&lang=sv",
    });

    assert.equal(en.status, 200);
    assert.equal(sv.status, 200);
    assert.equal(en.body.city, "barcelona");
    assert.equal(en.body.requested_city, "barcelona");
    assert.equal(en.body.city_fallback_used, false);
    assert.equal(en.body.headline, "Barcelona city-core is active");
    assert.match(en.body.subhead, /Curated Barcelona Pulse is not ready yet/);
    assert.equal(en.body.items.length, 0);
    assert.equal(en.body.official_events.length, 0);
    assert.equal(en.body.wildcards.length, 0);
    assert.equal(en.body.weather?.maxTemp, 23);
    assert.equal(sv.body.headline, "Barcelona city-core är aktivt");
    assert.match(sv.body.subhead, /Kuraterad Pulse för Barcelona är inte redo än/);
    assert.doesNotMatch(JSON.stringify(en.body), /Natale di Roma|Trastevere|Monti|Testaccio/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/city-pulse för barcelona presenterar official events utan editorial Pulse", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "opendata-ajuntament.barcelona.cat") {
      return mockJsonResponse([
        {
          register_id: 12345,
          name: "Concert de barri a Barcelona",
          status: "published",
          core_type: "event",
          core_type_name: "Agenda",
          body: "<p>Concert gratuït amb food trucks i activitats de barri. Segona mening med extra providertext som ska hållas läsbar i kortet.</p>",
          start_date: "2026-05-14T18:00:00+02:00",
          end_date: "2026-05-14T20:00:00+02:00",
          type_name: "Puntual",
          addresses: [
            {
              place: "Centre Cívic Example",
              address_name: "C Example",
              start_street_number: 12,
              location_4326: {
                geometries: [
                  {
                    type: "Point",
                    coordinates: [41.402, 2.203],
                  },
                ],
              },
              location_4326_latlon: {
                geometries: [
                  {
                    type: "Point",
                    coordinates: [2.203, 41.402],
                  },
                ],
              },
            },
          ],
          classifications_data: [{ name: "Concerts" }],
          secondary_filters_data: [{ name: "Música" }],
        },
      ]);
    }

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-14"],
          weathercode: [1],
          temperature_2m_max: [23],
          temperature_2m_min: [15],
        },
        current: {
          temperature_2m: 20,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona official pulse test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const en = await requestJson(server, {
      path: "/api/city-pulse?city=barcelona&date=2026-05-14&lang=en",
    });
    resetBarcelonaLiveEventsCache();
    const sv = await requestJson(server, {
      path: "/api/city-pulse?city=barcelona&date=2026-05-14&lang=sv",
    });

    assert.equal(en.status, 200);
    assert.equal(sv.status, 200);
    assert.equal(en.body.city, "barcelona");
    assert.equal(en.body.city_fallback_used, false);
    assert.equal(en.body.headline, "Barcelona city-core is active");
    assert.equal(en.body.official_events.length, 1);
    assert.equal(en.body.official_events[0].source_label, "Open Data BCN");
    assert.equal(en.body.official_events[0].source_id, "barcelona-open-data-agenda");
    assert.equal(en.body.official_events[0].title, "Concert de barri a Barcelona");
    assert.equal(en.body.official_events[0].provider_category, "Concerts");
    assert.equal(en.body.official_events[0].lat, 41.402);
    assert.equal(en.body.official_events[0].lng, 2.203);
    assert.ok(en.body.official_events[0].match_tags.includes("music"));
    assert.ok(en.body.official_events[0].match_tags.includes("kultur"));
    assert.deepEqual(en.body.moments, []);
    assert.deepEqual(en.body.wildcards, []);
    assert.equal(en.body.items.length, 1);
    // Kind chip is derived from match_tags (music → Concert) so the card no
    // longer needs the Catalan title to communicate the event type.
    assert.equal(en.body.items[0].kind, "Concert · Open Data BCN");
    // Native title is preserved on the item (we don't translate provider
    // titles or local place names) AND mirrored on native_title for clarity.
    assert.equal(en.body.items[0].title, "Concert de barri a Barcelona");
    assert.equal(en.body.items[0].native_title, "Concert de barri a Barcelona");
    assert.equal(en.body.items[0].source_language, "ca");
    assert.equal(en.body.items[0].where, "Centre Cívic Example • C Example, 12");
    assert.equal(en.body.items[0].when, "Today");
    // Body is EN-framed ("Concert at {venue}.") rather than the raw Catalan
    // summary, so EN cards no longer feel like an untranslated feed dump.
    assert.equal(en.body.items[0].blurb, "Concert at Centre Cívic Example.");
    assert.doesNotMatch(en.body.items[0].blurb, /gratuït|barri|activitats/i);
    assert.match(en.body.items[0].why_it_matters, /Official source signal from Open Data BCN/);

    assert.equal(sv.body.items.length, 1);
    assert.equal(sv.body.items[0].kind, "Konsert · Open Data BCN");
    assert.equal(sv.body.items[0].when, "I dag");
    assert.equal(sv.body.items[0].native_title, "Concert de barri a Barcelona");
    assert.equal(sv.body.items[0].source_language, "ca");
    // SV body is also framed in Swedish instead of the Catalan summary leak.
    assert.equal(sv.body.items[0].blurb, "Konsert på Centre Cívic Example.");
    assert.match(sv.body.items[0].why_it_matters, /Officiell källsignal från Open Data BCN/);
    assert.equal(sv.body.official_events[0].title, "Concert de barri a Barcelona");
    assert.equal(sv.body.official_events[0].provider_category, "Concerts");

    assert.doesNotMatch(JSON.stringify(en.body), /Turismo Roma|Natale di Roma|Trastevere|Monti|Testaccio/);
    assert.doesNotMatch(JSON.stringify(sv.body), /Turismo Roma|Natale di Roma|Trastevere|Monti|Testaccio/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search kan söka i test-city utan Rome-träffar", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during test-city places/search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=test-city&q=harbor",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "test-city");
    assert.equal(response.body.requested_city, "test-city");
    assert.equal(response.body.city_fallback_used, false);
    assert.ok(response.body.items.some((item) => item.label === "Harbor Steps"));
    assert.ok(!response.body.items.some((item) =>
      ["Trastevere", "Monti", "Testaccio", "Centro Storico"].includes(item.label),
    ));
    assert.doesNotMatch(JSON.stringify(response.body.items), /\bRom\b|\bRome\b/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/places/search för test-city ärver inte Rome second hand-termer eller träffar", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during test-city second hand search test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      path: "/api/places/search?city=test-city&q=seconda%20mano",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "test-city");
    assert.equal(response.body.requested_city, "test-city");
    assert.deepEqual(response.body.items, []);
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
    assertLocalTruthShape(response.body.days[0].primary_route.local_truth);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations exponerar anchor_weight på main_stops för credibility-badges", async () => {
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

    throw new Error(`Unexpected fetch during anchor_weight test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        city: "rome",
        dates: ["2026-04-20"],
        walking_km_target: 9,
        preferences: ["vin", "mat", "kultur"],
      },
    });

    assert.equal(response.status, 200);
    const stops = response.body.days[0].primary_route.main_stops;
    assert.ok(stops.length > 0, "expected at least one main stop");

    for (const stop of stops) {
      assert.ok(
        stop.anchor_weight === null || typeof stop.anchor_weight === "number",
        `anchor_weight must be number-or-null on every stop (got ${typeof stop.anchor_weight} for ${stop.id})`,
      );
    }

    const numericAnchors = stops
      .map((stop) => stop.anchor_weight)
      .filter((value) => typeof value === "number");
    assert.ok(
      numericAnchors.length > 0,
      "expected at least one Rome stop to carry a numeric anchor_weight from the catalog",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ui-i18n.js har credibility-nycklar i både sv och en", () => {
  const { translations } = require("../server/ui-i18n");
  const requiredKeys = [
    "credibility.anchor",
    "credibility.liveEvent",
    "credibility.whyThisRoute",
    "curator.whyArea",
    "curator.whyOrder",
    "curator.whyNow",
    "curator.whoFits",
    "curator.readMore",
  ];

  for (const key of requiredKeys) {
    assert.ok(
      typeof translations.sv?.[key] === "string" && translations.sv[key].trim(),
      `Missing or empty sv translation for ${key}`,
    );
    assert.ok(
      typeof translations.en?.[key] === "string" && translations.en[key].trim(),
      `Missing or empty en translation for ${key}`,
    );
    assert.notEqual(
      translations.sv[key],
      translations.en[key],
      `sv and en for ${key} are identical — likely untranslated`,
    );
  }
});

test("POST /api/route-recommendations exponerar curator_voice när templaten har det", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-20"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    throw new Error(`Unexpected fetch during curator_voice test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    // Run multiple intents to maximize chance of hitting an authored template
    const intents = [
      ["vin", "kultur", "kyrkor", "mat", "nattliv"],
      ["mat", "vin", "öl", "hidden gems", "kultur"],
      ["vin", "kultur", "kyrkor", "mat", "low-key"],
    ];

    let foundVoice = null;
    let observedShape = null;
    for (const preferences of intents) {
      const response = await requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations",
        body: {
          city: "rome",
          dates: ["2026-05-20"],
          walking_km_target: 9,
          preferences,
        },
      });

      assert.equal(response.status, 200);
      const route = response.body.days[0].primary_route;
      assert.ok("curator_voice" in route, "curator_voice key must exist on primary_route");

      if (route.curator_voice) {
        observedShape = route.curator_voice;
        foundVoice = { templateId: route.id, voice: route.curator_voice };
        break;
      }
    }

    assert.ok(
      foundVoice,
      "Expected at least one authored Rome template (classic-loop / south-loop / centro-wine-loop) to surface curator_voice across the 3 intents tested",
    );

    for (const key of ["why_area", "why_order", "why_now", "who_fits"]) {
      assert.ok(
        key in observedShape,
        `curator_voice missing field ${key}`,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations väljer EN curator_voice när lang=en", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-20"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    throw new Error(`Unexpected fetch during curator_voice EN test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const intents = [
      ["vin", "kultur", "kyrkor", "mat", "nattliv"],
      ["mat", "vin", "öl", "hidden gems", "kultur"],
      ["vin", "kultur", "kyrkor", "mat", "low-key"],
    ];

    let voiceEn = null;
    for (const preferences of intents) {
      const response = await requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations?lang=en",
        body: {
          city: "rome",
          dates: ["2026-05-20"],
          walking_km_target: 9,
          preferences,
        },
      });

      const route = response.body.days[0].primary_route;
      if (route.curator_voice) {
        voiceEn = route.curator_voice;
        break;
      }
    }

    assert.ok(voiceEn, "Expected at least one EN curator_voice across the 3 intents tested");
    assert.ok(/[A-Za-z]/.test(voiceEn.why_area || ""), "EN why_area should contain Latin letters");
    assert.ok(
      !/[åäö]/i.test(voiceEn.why_area || ""),
      `EN why_area should not contain Swedish diacritics: got "${voiceEn.why_area}"`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("appendActiveDayCuratorVoice renders compact default (why_area visible, rest in details)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const script = fs.readFileSync(path.resolve(__dirname, "..", "script.js"), "utf8");

  const fnMatch = script.match(/function appendActiveDayCuratorVoice\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "Could not locate appendActiveDayCuratorVoice in script.js");
  const fnBody = fnMatch[0];

  // why_area must be shown as the visible summary — not gated behind a details element
  assert.ok(/voice\.why_area/.test(fnBody), "why_area must be used as the visible summary");

  // The other fields must be inside a <details> element
  assert.ok(/createElement\(['"']details['"']\)/.test(fnBody), "details element must be created for collapsed fields");
  assert.ok(/createElement\(['"']summary['"']\)/.test(fnBody), "summary toggle element must be created");

  // The toggle must use the curator.readMore i18n key
  assert.ok(/curator\.readMore/.test(fnBody), "toggle must use curator.readMore i18n key");
});

test("script.js använder t() för credibility-badges istället för hårdkodad svenska", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const script = fs.readFileSync(
    path.resolve(__dirname, "..", "script.js"),
    "utf8",
  );

  assert.ok(
    !script.includes('note.textContent = "Öppet just nu"'),
    "Stale hardcoded 'Öppet just nu' string still present — should go through t(credibility.liveEvent)",
  );
  assert.ok(
    script.includes('t("credibility.anchor"'),
    "Anchor badge must use t(credibility.anchor)",
  );
  assert.ok(
    script.includes('t("credibility.liveEvent"'),
    "Live event badge must use t(credibility.liveEvent)",
  );
  assert.ok(
    script.includes('t("credibility.whyThisRoute"'),
    "Why-this-route block must use t(credibility.whyThisRoute)",
  );
});

test("appendCredibilityBadges gates anchor badge on !isLiveEvent so a live event never reads as a neighborhood anchor", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const script = fs.readFileSync(
    path.resolve(__dirname, "..", "script.js"),
    "utf8",
  );

  const fnMatch = script.match(/function appendCredibilityBadges\([^)]*\)\s*\{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, "Could not locate appendCredibilityBadges in script.js");
  const fnBody = fnMatch[0];

  // The anchor branch must be guarded by !stopItem.isLiveEvent so that even when
  // a live-event candidate carries a high anchor_weight from the route engine,
  // the anchor badge stays suppressed. "A live event is never a neighborhood anchor."
  const anchorChunkEnd = fnBody.indexOf("credibility-badge--anchor");
  assert.ok(anchorChunkEnd > 0, "Could not locate anchor branch inside appendCredibilityBadges");
  const anchorGuardArea = fnBody.slice(0, anchorChunkEnd);
  assert.ok(
    /!stopItem\.isLiveEvent/.test(anchorGuardArea),
    "Anchor branch must include a !stopItem.isLiveEvent guard before rendering the anchor badge",
  );

  // The live-event badge must still be allowed to fire on isLiveEvent stops.
  assert.ok(
    /credibility-badge--live/.test(fnBody),
    "appendCredibilityBadges must still emit the live-event badge",
  );
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

test("POST /api/route-recommendations?lang=en suppresses Swedish local-truth prose on route output", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-18"],
          weathercode: [1],
          temperature_2m_max: [20],
        },
      });
    }
    throw new Error(`Unexpected fetch during route local-truth leak test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    // Rome with second_hand on a weekday is a strong trigger for SV-only
    // local-truth market-rhythm and shop-fallback notes. The route engine
    // must surface the same local_truth structure but with prose fields
    // blanked under lang=en, mirroring the Blitz pattern (PR #67).
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "rome",
        dates: ["2026-05-18"],
        preferences: ["mat", "kultur", "second_hand"],
        walking_km_target: 8,
      },
    });

    assert.equal(response.status, 200);

    const day = response.body.days?.[0];
    assert.ok(day, "expected at least one route day");
    const routes = [day.primary_route, ...(day.alternatives || [])].filter(Boolean);

    // Specific SV authoring known to come from server/cities/rome/local-truth.js.
    const swedishLocalTruthMarkers = [
      "Marknadsspåret ligger på en stark veckodag",
      "vintage- och second hand-butiker även när marknadsspåret",
      "bärs främst av butiker och vintage-stopp",
      "Klassiska ankare i Rom känns ofta lättare tidigt eller sent",
      "Second hand-spåret bärs av mer vardagsvänliga butiker",
      "Ferragosto kan ge helgrytm",
      "live-lagret bli extra värdefullt",
    ];

    // Walk every route's local_truth array shapes and assert every
    // .text/.reason prose field is blanked under lang=en.
    const proseArrayKeys = [
      ["score_adjustments", "reason"],
      ["caution_notes", "text"],
      ["verify_opening_hours", "reason"],
      ["route_context_notes", "text"],
      ["live_context_notes", "text"],
    ];

    routes.forEach((route, routeIndex) => {
      const lt = route.local_truth;
      if (!lt) return;
      proseArrayKeys.forEach(([arrayKey, field]) => {
        (lt[arrayKey] || []).forEach((entry, entryIndex) => {
          if (typeof entry[field] === "string") {
            assert.equal(
              entry[field],
              "",
              `routes[${routeIndex}].local_truth.${arrayKey}[${entryIndex}].${field} must be blanked under lang=en`,
            );
          }
        });
      });

      // Direct text-search inside each route's local_truth to catch leaks
      // even if a future schema adds a new prose field.
      const localTruthJson = JSON.stringify(lt);
      swedishLocalTruthMarkers.forEach((sw) => {
        assert.equal(
          localTruthJson.includes(sw),
          false,
          `route local_truth must not leak Swedish prose: "${sw}"`,
        );
      });
    });
  } finally {
    server.close();
    global.fetch = originalFetch;
    resetLiveEventsCache();
  }
});

test("POST /api/route-recommendations använder lang en bara för route-result prose", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-15"],
          weathercode: [61],
          temperature_2m_max: [19],
        },
      });
    }

    throw new Error(`Unexpected fetch during route prose language test: ${url}`);
  };

  const server = buildApp().listen(0);
  const body = {
    dates: ["2026-05-15"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Ostiense/Garbatella" },
    walking_km_target: 9,
    preferences: ["vin", "mat", "nattliv"],
    distance_mode: "no_limit",
    modifier: "evening",
  };
  const userFacingRouteText = (responseBody) => {
    const day = responseBody.days[0];
    const route = day.primary_route;
    return [
      route.title,
      route.summary,
      route.why_recommended,
      route.weather_note,
      route.pulse_note,
      route.live_event_fit_note,
      route.area_note,
      route.geo_fit_note,
      route.leg_fit_note,
      route.budget_note,
      ...(day.date_signals || []).flatMap((signal) => [signal.title, signal.note]),
    ]
      .filter(Boolean)
      .join(" ");
  };

  try {
    const [svResponse, enResponse] = await Promise.all([
      requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations?lang=sv",
        body,
      }),
      requestJson(server, {
        method: "POST",
        path: "/api/route-recommendations?lang=en",
        body,
      }),
    ]);

    assert.equal(svResponse.status, 200);
    assert.equal(enResponse.status, 200);

    const svDay = svResponse.body.days[0];
    const enDay = enResponse.body.days[0];
    const svPrimary = svDay.primary_route;
    const enPrimary = enDay.primary_route;

    assert.equal(enResponse.body.days.length, svResponse.body.days.length);
    assert.equal(enDay.alternatives.length, svDay.alternatives.length);
    assert.equal(enPrimary.main_stops.length, svPrimary.main_stops.length);
    assert.deepEqual(
      enPrimary.main_stops.map((stop) => stop.id),
      svPrimary.main_stops.map((stop) => stop.id),
    );
    assert.deepEqual(
      enPrimary.main_stops.map((stop) => stop.label),
      svPrimary.main_stops.map((stop) => stop.label),
    );
    assert.deepEqual(
      enPrimary.main_stops.map((stop) => stop.tags),
      svPrimary.main_stops.map((stop) => stop.tags),
    );

    const svText = userFacingRouteText(svResponse.body);
    const enText = userFacingRouteText(enResponse.body);

    assert.notEqual(enText, svText);
    assert.match(svText, /vin och stad|Helgpuls|En tydlig båge|Regn väntas/i);
    assert.doesNotMatch(enText, /Börja i|vin och stad|En tydlig rutt|En tydlig båge|Helgpuls|Regn väntas|Just nu i|Live i dag|Huvudrutten/i);
    assert.match(enText, /wine and city|Weekend pulse|A clear route|Rain is expected/i);
  } finally {
    server.close();
    global.fetch = originalFetch;
    resetLiveEventsCache();
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
    const shortResponse = await requestJson(server, {
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
    });
    const flexibleResponse = await requestJson(server, {
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
    });

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

test("POST /api/route-recommendations kan köras för test-city utan Rome-data", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-01"],
          weathercode: [1],
          temperature_2m_max: [24],
          temperature_2m_min: [14],
        },
        current: {
          temperature_2m: 23,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during test-city route test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        city: "test-city",
        dates: ["2026-05-01"],
        start: { type: "preset", label: "Old Town" },
        end: { type: "preset", label: "Old Town" },
        walking_km_target: 6,
        preferences: ["kultur", "mat", "vin"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "test-city");
    assert.equal(response.body.requested_city, "test-city");
    assert.equal(response.body.city_fallback_used, false);
    assert.ok(response.body.days[0].primary_route);
    assert.equal(response.body.days[0].primary_route.start_label, "Old Town");
    assert.deepEqual(response.body.days[0].live_events, []);
    assertNeutralLocalTruth(response.body.days[0].primary_route.local_truth);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Trastevere|Monti|Testaccio|Centro Storico|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations för barcelona kan nu bygga preview-rutter utan Rome-läckage", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-14"],
          weathercode: [0],
          temperature_2m_max: [24],
          temperature_2m_min: [16],
        },
        current: {
          temperature_2m: 23,
          weather_code: 0,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona route test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "barcelona",
        dates: ["2026-05-14"],
        walking_km_target: 8,
        preferences: ["food_drink", "culture"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.requested_city, "barcelona");
    assert.equal(response.body.city_fallback_used, false);
    assert.equal(response.body.days.length, 1);
    assert.ok(response.body.days[0].primary_route);
    assert.ok(response.body.days[0].primary_route.main_stops.length >= 3);
    assert.ok(
      response.body.days[0].primary_route.main_stops.every((stop) => stop.place_id !== null),
      "expected Barcelona route stops to resolve to catalog place ids",
    );
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Gràcia med kultur|Sant Antoni som tät mat- och bardag|Ett gammalstadsspår som undviker topplistan/,
    );
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations för barcelona fungerar även med preview-defaults utan valda intents", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-16"],
          weathercode: [0],
          temperature_2m_max: [24],
          temperature_2m_min: [16],
        },
        current: {
          temperature_2m: 23,
          weather_code: 0,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona default route test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "barcelona",
        dates: ["2026-05-16"],
        home_base: { type: "auto", label: "Parranda chooses" },
        start: { type: "auto", label: "Parranda chooses" },
        end: { type: "auto", label: "Parranda chooses" },
        walking_km_target: 9,
        leg_pacing: "balanced",
        preferences: [],
        distance_mode: "soft_target",
        budget_tier: "standard",
        modifier: null,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.days.length, 1);
    assert.notEqual(response.body.resolved_start.label, "Barcelona");
    assert.notEqual(response.body.resolved_end.label, "Barcelona");
    assert.ok(response.body.days[0].primary_route);
    assert.ok(
      response.body.days[0].primary_route.main_stops.every((stop) => stop.label !== "Bandini's"),
      "default Barcelona preview route should not force Bandini's into unrelated runs",
    );
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations för barcelona kraschar inte när preview-areas används som start hints", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-16"],
          weathercode: [0],
          temperature_2m_max: [24],
          temperature_2m_min: [16],
        },
        current: {
          temperature_2m: 23,
          weather_code: 0,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona preset fallback test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "barcelona",
        dates: ["2026-05-16"],
        start: { type: "preset", label: "Gràcia" },
        end: { type: "auto", label: "Parranda chooses" },
        walking_km_target: 7,
        preferences: ["culture", "nightlife"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.days.length, 1);
    assert.ok(response.body.days[0].primary_route);
    assert.ok(response.body.resolved_start?.label);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations för barcelona håller map/export-punkter city-scopade", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-16"],
          weathercode: [0],
          temperature_2m_max: [24],
          temperature_2m_min: [16],
        },
        current: {
          temperature_2m: 23,
          weather_code: 0,
          is_day: 1,
        },
      });
    }

    throw new Error(`Unexpected fetch during Barcelona route export test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "barcelona",
        dates: ["2026-05-16"],
        walking_km_target: 8,
        preferences: ["food_drink", "culture", "views"],
      },
    });
    const route = response.body.days[0].primary_route;
    const structuralAnchorLabels = new Set([
      "Gràcia",
      "Sant Antoni",
      "El Born / Santa Caterina",
      "Poble-sec / Montjuïc",
      "Poblenou / Coast",
    ]);

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.ok(Array.isArray(route.map_route_points));
    assert.ok(route.map_route_points.length >= route.main_stops.length);
    assert.ok(
      route.main_stops.every((stop) => stop.label && !structuralAnchorLabels.has(stop.label)),
      "visible Barcelona main stops should be real catalog places, not structural route anchors",
    );
    assert.doesNotMatch(
      JSON.stringify({
        points: route.map_route_points,
        stops: route.main_stops,
      }),
      /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations bär ett normaliserat local_truth-block på varje route-objekt", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-08-15"],
          weathercode: [0],
          temperature_2m_max: [31],
        },
      });
    }

    throw new Error(`Unexpected fetch during local truth api test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-08-15"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Trastevere" },
        walking_km_target: 8,
        preferences: ["vin", "mat", "kultur", "hidden gems"],
      },
    });

    assert.equal(response.status, 200);
    const day = response.body.days[0];
    const routeObjects = [day.primary_route, ...day.alternatives];

    routeObjects.forEach((route) => {
      assertLocalTruthShape(route.local_truth);
    });

    assert.ok(day.primary_route.local_truth.verify_opening_hours.length >= 1);
    assert.ok(day.primary_route.local_truth.caution_notes.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations ger market-led primary route för single second_hand på stark marknadsdag", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-10"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    throw new Error(`Unexpected fetch during strong market day api test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-05-10"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Trastevere" },
        walking_km_target: 7,
        preferences: ["second_hand"],
      },
    });

    assert.equal(response.status, 200);
    const primary = response.body.days[0].primary_route;

    assert.match(primary.title, /marknad och vintage/i);
    assert.ok(primary.main_stops[0].tags.includes("market"));
    assert.deepEqual(primary.bar_mentions, []);
    assert.deepEqual(primary.hidden_mentions, []);
    assertLocalTruthShape(primary.local_truth);
    assert.ok(
      primary.local_truth.route_context_notes.some((entry) => /stark veckodag/i.test(entry.text)) ||
        primary.local_truth.score_delta > 0,
    );
    assert.ok(
      primary.opening_hours_warnings.every(
        (warning) => !/är stängt|kommer vara stängt/i.test(warning),
      ),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations låter shop-vintage bära primary route på svag marknadsdag", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-13"],
          weathercode: [0],
          temperature_2m_max: [23],
        },
      });
    }

    throw new Error(`Unexpected fetch during weak market day api test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-05-13"],
        start: { type: "preset", label: "Trastevere" },
        end: { type: "preset", label: "Trastevere" },
        walking_km_target: 7,
        preferences: ["second_hand"],
      },
    });

    assert.equal(response.status, 200);
    const primary = response.body.days[0].primary_route;
    const marketStopIndex = primary.main_stops.findIndex((stop) => stop.tags.includes("market"));

    assert.match(primary.title, /second hand och vintage/i);
    assert.equal(primary.main_stops[0].tags.includes("market"), false);
    assert.ok(primary.main_stops[0].tags.includes("vintage"));
    assert.ok(marketStopIndex >= 1);
    assert.deepEqual(primary.bar_mentions, []);
    assert.deepEqual(primary.hidden_mentions, []);
    assertLocalTruthShape(primary.local_truth);

    const weakDayText = [
      ...primary.opening_hours_warnings,
      ...primary.local_truth.caution_notes.map((entry) => entry.text),
    ];

    assert.ok(weakDayText.some((entry) => /dubbelkolla|marknadsdelen|veckodagen/i.test(entry)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/route-recommendations kan blanda second_hand och vin utan att tappa second hand-identiteten", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return mockJsonResponse({
        daily: {
          time: ["2026-05-13"],
          weathercode: [0],
          temperature_2m_max: [23],
        },
      });
    }

    throw new Error(`Unexpected fetch during second hand blend api test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations",
      body: {
        dates: ["2026-05-13"],
        start: { type: "preset", label: "Monti" },
        end: { type: "preset", label: "Monti" },
        walking_km_target: 6,
        preferences: ["second_hand", "vin"],
      },
    });

    assert.equal(response.status, 200);
    const primary = response.body.days[0].primary_route;

    assert.match(primary.title, /second hand \+ vin/i);
    assert.ok(secondHandFamilyStopCount(primary) >= 2);
    assert.ok(primary.main_stops.some((stop) => stop.tags.includes("shopping")));
    assert.match(primary.why_recommended, /Second hand-spåret/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /script.js renderar inte interna routingmått som user-facing labels", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during script asset test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, {
      path: "/script.js",
    });

    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /Längsta ben/);
    assert.doesNotMatch(response.body, /Typiskt ben/);
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
        // Live events are now a separate layer by default. Opt in to the
        // legacy "live event can become a real route stop" capability
        // explicitly so this regression coverage stays meaningful.
        include_live_events: true,
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

test("POST /api/blitz returnerar ett kompakt nästa drag med reroll-minne", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during blitz API test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/blitz",
      body: {
        city: "rome",
        now: "2026-05-10T10:30:00+02:00",
        origin: { type: "preset", label: "Trastevere" },
        intent_keys: ["second_hand"],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.best_move.kind, "mini_route_60");
    assert.ok(Array.isArray(response.body.best_move.route.stops));
    assert.ok(response.body.best_move.route.stops.some((stop) => stop.tags.includes("second_hand")));
    assert.equal(response.body.reroll_supported, true);
    assert.ok(Array.isArray(response.body.memory.recent_stop_ids));
    assert.ok(response.body.backup_option);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz reroll använder minnet för att undvika direkt repetition", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during blitz reroll API test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const first = await requestJson(server, {
      method: "POST",
      path: "/api/blitz",
      body: {
        city: "rome",
        now: "2026-05-12T19:10:00+02:00",
        origin: { type: "preset", label: "Trastevere" },
        intent_keys: ["food_drink", "nightlife"],
      },
    });
    const second = await requestJson(server, {
      method: "POST",
      path: "/api/blitz",
      body: {
        city: "rome",
        now: "2026-05-12T19:10:00+02:00",
        origin: { type: "preset", label: "Trastevere" },
        intent_keys: ["food_drink", "nightlife"],
        memory: first.body.memory,
      },
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.notEqual(second.body.best_move.title, first.body.best_move.title);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz kan köras för barcelona utan Rome-läckage eller strukturella anchors", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Barcelona blitz API test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/blitz",
      body: {
        city: "barcelona",
        now: "2026-05-16T19:00:00+02:00",
        origin: { type: "preset", label: "Gràcia" },
        intent_keys: ["food_drink", "nightlife"],
      },
    });
    const move = response.body.best_move;
    const routeStops = move?.route?.stops || [];

    assert.equal(response.status, 200);
    assert.equal(response.body.city, "barcelona");
    assert.equal(response.body.requested_city, "barcelona");
    assert.equal(response.body.city_fallback_used, false);
    assert.ok(move, "expected Blitz to return a Barcelona move");
    assert.ok(["single_stop", "mini_route_60"].includes(move.kind));
    assert.ok(
      routeStops.every((stop) => stop.type !== "district" && stop.type !== "district-group"),
      "Barcelona Blitz route stops should be real places, not structural route anchors",
    );
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz?lang=en returns English Blitz copy for barcelona", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Barcelona Blitz EN test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/blitz?lang=en",
      body: {
        city: "barcelona",
        now: "2026-05-18T13:00:00+02:00",
        origin: { type: "preset", label: "Sant Antoni" },
        intent_keys: ["food_drink"],
      },
    });

    assert.equal(response.status, 200);
    const move = response.body.best_move;
    assert.ok(move, "expected Blitz move");

    const swedishMarkers = [
      "okänd",
      "låg",
      "låg till medium",
      "Det är kväll nu",
      "Eftermiddagen passar bra",
      "Mitt på dagen",
      "Tidigare på dagen",
      "Senare på kvällen",
      "och vidare på nästa timme",
      "på nästa timme med second hand först",
      "på 60 minuter med vin som landning",
      "Kör Blitz igen",
      "Stanna på ett glas",
      "Låt det glida vidare",
      "ligger nära nog",
      "ligger tillräckligt nära",
      "det tydligaste nästa steget",
      "ger ett faktiskt second hand-spår",
      "Pulse just nu:",
      "har ännu inte ett fullt second hand-pack",
    ];
    const body = JSON.stringify(response.body);
    swedishMarkers.forEach((sw) => {
      assert.equal(
        body.includes(sw),
        false,
        `Blitz EN must not contain Swedish: "${sw}"`,
      );
    });

    assert.doesNotMatch(body, /\{(?:area|name|first|city|title)\}/);

    const englishExpected = [
      "low",
      "medium",
      "for the next hour",
      "Run Blitz again",
      "from where you are",
      "clearest next step",
      "Mid-day",
      "evening",
    ];
    assert.ok(
      englishExpected.some((en) => body.includes(en)),
      "Blitz EN must include at least one expected English phrase",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz?lang=en suppresses Swedish local-truth prose for Rome", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Blitz local-truth leak test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    // Rome second_hand on Sunday is a strong trigger for the SV-only
    // local-truth market-rhythm prose in server/cities/rome/local-truth.js.
    // The Blitz EN response must not surface that text until route-engine
    // i18n lands in a follow-up PR.
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/blitz?lang=en",
      body: {
        city: "rome",
        now: "2026-05-17T13:00:00+02:00",
        intent_keys: ["second_hand"],
      },
    });

    assert.equal(response.status, 200);
    const body = JSON.stringify(response.body);

    // Specific SV phrases known to come from Rome local-truth notes and
    // Rome Pulse editorial. None may surface in the EN response.
    const swedishLocalTruthMarkers = [
      "Marknadsspåret ligger på en stark veckodag",
      "vintage- och second hand-butiker även när marknadsspåret",
      "bärs främst av butiker och vintage-stopp",
      "Klassiska ankare i Rom känns ofta lättare tidigt eller sent",
      "Ferragosto kan ge helgrytm",
      "live-lagret bli extra värdefullt",
      "fungerar bäst när du använder det",
      "ofta bättre som smart start",
      "är ofta bättre som",
    ];
    swedishLocalTruthMarkers.forEach((sw) => {
      assert.equal(
        body.includes(sw),
        false,
        `Blitz EN must not surface Swedish local-truth/Pulse: "${sw}"`,
      );
    });

    // Best-move caution_notes is the surface path that maps note.text
    // directly. Until local-truth supports i18n, this must be empty for
    // non-SV languages (scoring effects elsewhere remain unaffected).
    assert.deepEqual(
      response.body.best_move?.caution_notes || [],
      [],
      "Blitz EN must omit local-truth caution prose entirely",
    );
    if (response.body.backup_option) {
      assert.deepEqual(
        response.body.backup_option.caution_notes || [],
        [],
        "Blitz EN backup must also omit local-truth caution prose",
      );
    }

    // local_truth note schemas differ: caution_notes/route_context_notes/
    // live_context_notes carry prose in .text; verify_opening_hours and
    // score_adjustments carry prose in .reason. Both must be blanked when
    // surfaced under non-SV.
    const checkBlankedProse = (moveLabel, move) => {
      if (!move || !move.local_truth) return;
      const lt = move.local_truth;
      const proseArrays = [
        ["score_adjustments", "reason"],
        ["caution_notes", "text"],
        ["verify_opening_hours", "reason"],
        ["route_context_notes", "text"],
        ["live_context_notes", "text"],
      ];
      for (const [arrayKey, field] of proseArrays) {
        (lt[arrayKey] || []).forEach((entry, index) => {
          if (typeof entry[field] === "string") {
            assert.equal(
              entry[field],
              "",
              `${moveLabel}.local_truth.${arrayKey}[${index}].${field} must be blanked under lang=en`,
            );
          }
        });
      }
    };
    checkBlankedProse("best_move", response.body.best_move);
    checkBlankedProse("backup_option", response.body.backup_option);

    // Broad sanity: no åäö in the full response. Catches both
    // local-truth and Pulse leaks even if they bypass the markers above.
    assert.doesNotMatch(body, /[åäöÅÄÖ]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz?lang=sv preserves Swedish Blitz copy", async () => {
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch during Blitz SV test: ${url}`);
  };

  const server = buildApp().listen(0);

  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/blitz?lang=sv",
      body: {
        city: "rome",
        now: "2026-05-18T13:00:00+02:00",
        intent_keys: ["food_drink"],
      },
    });

    assert.equal(response.status, 200);
    const body = JSON.stringify(response.body);
    const swedishExpected = [
      "på nästa timme",
      "Kör Blitz igen",
      "ligger nära nog",
      "ligger tillräckligt nära",
      "tydligaste nästa steget",
      "låg",
      "medium",
    ];
    assert.ok(
      swedishExpected.some((sv) => body.includes(sv)),
      "Blitz SV must include at least one Swedish marker",
    );
    assert.doesNotMatch(body, /\{(?:area|name|first|city|title)\}/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
