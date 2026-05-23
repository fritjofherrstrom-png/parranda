const test = require("node:test");
const assert = require("node:assert/strict");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const testCity = require("../server/cities/test-city");
const { cityConfigs, getCityConfig, normalizeCityKey, resolveCityConfig } = require("../server/cities");
const { validateCityConfig } = require("../server/cities/contract");
const { validateCitySourceConfig } = require("../server/cities/source-contract");

test("rome uppfyller city-kontraktet", () => {
  assert.doesNotThrow(() => validateCityConfig(rome));
  assert.equal(cityConfigs.rome.key, "rome");
  assert.equal(cityConfigs.rome.timezone, "Europe/Rome");
  assert.equal(cityConfigs.rome.locale, "sv-SE");
  assert.equal(cityConfigs.rome.currency, "EUR");
});

test("test-city uppfyller city-kontraktet utan fallback", () => {
  assert.doesNotThrow(() => validateCityConfig(testCity));
  const resolution = resolveCityConfig("test-city", { allowFallback: false });
  assert.equal(resolution.cityConfig.key, "test-city");
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.found, true);
  assert.equal(getCityConfig("test-city").key, "test-city");
  assert.equal(cityConfigs["test-city"].currency, "MXN");
});

test("barcelona uppfyller city-kontraktet som registrerad preview-stad", () => {
  assert.doesNotThrow(() => validateCityConfig(barcelona));
  const resolution = resolveCityConfig("barcelona", { allowFallback: false });
  assert.equal(resolution.cityConfig.key, "barcelona");
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.found, true);
  assert.equal(getCityConfig("barcelona").key, "barcelona");
  assert.equal(cityConfigs.barcelona.visibility, "preview");
  assert.equal(
    cityConfigs.barcelona.catalog.allItems.filter((item) => !["district", "district-group"].includes(item.kind)).length,
    70,
  );
  assert.equal(cityConfigs.barcelona.catalog.routeTemplates.length, 6);
});

test("barcelona preview håller Pulse noop när Live-källan är tom", async () => {
  const pulse = cityConfigs.barcelona.services.getCityPulse("2026-05-14", { lang: "en" });
  const liveEvents = await cityConfigs.barcelona.services.fetchLiveEventsForDates([
    "2026-05-14",
    "2026-05-15",
  ], {
    fetchOpenDataAgendaEvents: async () => [],
  });

  assert.equal(cityConfigs.barcelona.visibility, "preview");
  assert.match(pulse.headline, /We don't have Barcelona for real yet/);
  assert.match(pulse.subhead, /There is no local layer for Barcelona yet/);
  assert.deepEqual(pulse.items, []);
  assert.deepEqual(pulse.official_events, []);
  assert.deepEqual(pulse.wildcards, []);
  assert.deepEqual(liveEvents, {
    "2026-05-14": [],
    "2026-05-15": [],
  });
});

test("pulse/live source descriptors validerar city-scopade källor", () => {
  const barcelonaSources = cityConfigs.barcelona.sources;
  const romeSources = cityConfigs.rome.sources;

  assert.doesNotThrow(() => validateCitySourceConfig(barcelonaSources));
  assert.doesNotThrow(() => validateCitySourceConfig(romeSources));
  assert.ok(barcelonaSources.liveSources.length >= 1);
  assert.ok(barcelonaSources.pulseSources.length >= 1);
  assert.ok(
    barcelonaSources.liveSources.some(
      (source) => source.id === "barcelona-open-data-agenda" && source.status === "active",
    ),
    "Barcelona should expose the active Open Data BCN agenda live source descriptor",
  );
  assert.ok(
    barcelonaSources.pulseSources.every((source) => source.status !== "active"),
    "Barcelona Pulse source descriptors should remain candidate/review-only until editorial wiring exists",
  );
  assert.ok(
    romeSources.liveSources.some(
      (source) => source.id === "turismo-roma-live" && source.status === "active",
    ),
  );
});

test("pulse/live source descriptors stoppar otydliga källkontrakt", () => {
  assert.throws(
    () =>
      validateCitySourceConfig({
        liveSources: [
          {
            id: "broken-source",
            sourceType: "official_open_data",
            sourceUrl: "not-a-url",
            status: "maybe",
            supportedLanguages: [],
            updateCadence: "daily",
            sourceOwnedFields: ["title"],
            parrandaOwnedFields: ["match_reason"],
            qualityFlags: [],
            parsingRisk: "medium",
            intendedUse: "live",
          },
        ],
        pulseSources: [],
      }),
    /sourceUrl|status|supportedLanguages/,
  );
});

test("barcelona har en strukturell neighborhood-modell med första route seeds", () => {
  const areaDefinitions = cityConfigs.barcelona.routing.areaDefinitions;
  const macroAreaLabels = cityConfigs.barcelona.routing.macroAreaLabels;
  const expectedAreas = [
    "gracia",
    "born-sant-pere-santa-caterina",
    "gothic",
    "eixample",
    "sant-antoni",
    "poble-sec",
    "poblenou",
    "barceloneta",
    "raval",
    "montjuic",
    "sants-les-corts",
  ];

  for (const area of expectedAreas) {
    assert.ok(areaDefinitions[area], `missing Barcelona area ${area}`);
  }

  assert.deepEqual(Object.keys(macroAreaLabels).sort(), [
    "central-grid",
    "coast-east",
    "montjuic-southwest",
    "northwest-local",
    "old-town",
  ]);
  assert.equal(areaDefinitions["sant-antoni"].macro, "central-grid");
  assert.equal(areaDefinitions.eixample.macro, "central-grid");
  assert.equal(areaDefinitions.gracia.label, "Gràcia");
  assert.equal(areaDefinitions.montjuic.label, "Montjuïc");
  assert.equal(areaDefinitions["barri-gotic"].macro, areaDefinitions.gothic.macro);
  assert.equal(areaDefinitions["el-born"].macro, areaDefinitions["born-sant-pere-santa-caterina"].macro);
  assert.equal(cityConfigs.barcelona.catalog.routeTemplates.length, 6);
});

test("barcelona pilotkatalog använder giltiga area tokens, provenance och route templates", () => {
  const areaDefinitions = cityConfigs.barcelona.routing.areaDefinitions;
  const { allItems, findItemByName, routeTemplates } = cityConfigs.barcelona.catalog;
  const barcelonaCatalog = require("../server/cities/barcelona/catalog");
  const expectedIds = new Set([
    "bandinis-barcelona",
    "mercat-sant-antoni",
    "casa-vicens",
    "mercat-poblenou",
    "mercat-barceloneta",
    "mercat-llibertat",
    "castell-montjuic",
    "museu-tapies",
    "filmoteca-catalunya",
    "mercat-santa-caterina",
    "cccb",
    "quimet-quimet",
  ]);

  const placeItems = allItems.filter((item) => !["district", "district-group"].includes(item.kind));
  const routeAnchors = allItems.filter((item) => item.kind === "district-group");

  assert.equal(placeItems.length, 70);
  assert.equal(routeAnchors.length, 5);
  assert.equal(barcelonaCatalog.routeTemplates.length, 6);
  assert.equal(findItemByName("bandini").id, "bandinis-barcelona");
  assert.equal(findItemByName("moritz").id, "fabrica-moritz-barcelona");
  assert.equal(findItemByName("mar bella").id, "platja-mar-bella");

  for (const item of allItems) {
    assert.ok(areaDefinitions[item.area], `missing Barcelona area token for ${item.id}: ${item.area}`);
    assert.ok(Array.isArray(item.tags) && item.tags.length > 0, `missing tags for ${item.id}`);
    assert.ok(Array.isArray(item.searchTerms) && item.searchTerms.length > 0, `missing searchTerms for ${item.id}`);
    assert.ok(Number.isFinite(item.lat), `missing lat for ${item.id}`);
    assert.ok(Number.isFinite(item.lng), `missing lng for ${item.id}`);

    const provenance = barcelonaCatalog.provenanceById[item.id];
    assert.ok(provenance, `missing provenance for ${item.id}`);
    assert.ok(provenance.source_url || provenance.source_note, `missing source for ${item.id}`);
    assert.match(provenance.confidence, /^(high|medium|needs_review)$/);
    assert.equal(provenance.area, item.area);
    assert.equal(provenance.macro, areaDefinitions[item.area].macro);
    assert.equal(typeof provenance.why_included, "string");
    assert.equal(typeof provenance.needs_human_verification, "boolean");
  }

  const byArea = placeItems.reduce((counts, item) => {
    counts[item.area] = (counts[item.area] || 0) + 1;
    return counts;
  }, {});

  for (const item of placeItems) {
    assert.notEqual(item.structuralRouteAnchor, true, `real Barcelona place should not be a structural route anchor: ${item.id}`);
  }

  assert.ok((byArea.poblenou || 0) + (byArea.barceloneta || 0) >= 8);
  assert.ok((byArea.gracia || 0) >= 7);
  assert.ok((byArea["poble-sec"] || 0) + (byArea.montjuic || 0) >= 7);
  assert.ok((byArea["sant-antoni"] || 0) + (byArea.eixample || 0) >= 7);

  for (const id of expectedIds) {
    assert.ok(allItems.some((item) => item.id === id), `missing expected Barcelona pilot place ${id}`);
  }

  for (const [id, provenance] of Object.entries(barcelonaCatalog.provenanceById)) {
    if (provenance.source_type === "osm_structured_data") {
      assert.equal(
        provenance.needs_human_verification,
        true,
        `osm_structured_data should remain explicitly human-verification-gated for ${id}`,
      );
    }
  }

  const itemIds = new Set(allItems.map((item) => item.id));

  for (const template of routeTemplates) {
    assert.ok(template.id, "route template is missing id");
    assert.ok(Array.isArray(template.stops) && template.stops.length >= 4, `route template ${template.id} is too thin`);
    assert.ok(
      Array.isArray(template.preferenceTags) && template.preferenceTags.length > 0,
      `route template ${template.id} is missing preferenceTags`,
    );

    for (const stopId of template.stops) {
      assert.ok(itemIds.has(stopId), `route template ${template.id} references unknown Barcelona stop ${stopId}`);
    }
  }
});

test("test-city är markerad som intern arkitekturstub", () => {
  assert.equal(testCity.visibility, "internal");
  assert.equal(cityConfigs["test-city"].visibility, "internal");
});

test("city-kontraktet accepterar giltiga globala koordinater", () => {
  assert.doesNotThrow(() =>
    validateCityConfig({
      ...rome,
      key: "test-city",
      label: "Test City",
      center: { lat: -34.6037, lng: -58.3816 },
    }),
  );
});

test("city-registret kan avslöja unknown city även när publik fallback används", () => {
  assert.equal(normalizeCityKey("ROME"), "rome");
  const resolution = resolveCityConfig("unknown-city");
  assert.equal(resolution.cityConfig.key, "rome");
  assert.equal(resolution.requestedKey, "unknown-city");
  assert.equal(resolution.fallbackUsed, true);
  assert.equal(resolution.found, false);
  assert.equal(getCityConfig().key, "rome");
});

test("city-registret kan köras utan fallback för interna kontroller", () => {
  const resolution = resolveCityConfig("unknown-city", { allowFallback: false });
  assert.equal(resolution.cityConfig, null);
  assert.equal(resolution.resolvedKey, null);
  assert.equal(resolution.found, false);
  assert.equal(resolution.fallbackUsed, false);
});

test("city-kontraktet stoppar trasiga city packs tidigt", () => {
  assert.throws(
    () =>
      validateCityConfig({
        key: "broken",
        label: "Broken",
        timezone: "Europe/Stockholm",
        locale: "sv-SE",
        currency: "EUR",
        center: { lat: 1, lng: 2 },
        todayIsoDate: () => "2026-04-30",
        catalog: {
          routeTemplates: [],
          allItems: [],
          findItemByName: () => null,
        },
        services: {
          geocodeQuery: async () => ({}),
          fetchWeatherForDates: async () => ({}),
          getCityPulse: async () => ({}),
          getDateSignals: async () => [],
        },
        walking: {
          defaultProvider: "heuristic",
          truthPassTopCandidates: 5,
          requestTimeoutMs: 4500,
        },
        routing: {
          areaDefinitions: {},
          macroAreaLabels: {},
          tuning: {},
        },
      }),
    /fetchLiveEventsForDates/,
  );
});
