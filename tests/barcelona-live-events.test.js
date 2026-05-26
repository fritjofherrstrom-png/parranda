const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCkanDateWindowUrl,
  evaluateOpenDataAgendaRecord,
  fetchLiveEventsForDates,
  normalizeOpenDataAgendaEvents,
  normalizeOpenDataAgendaRecord,
  resetBarcelonaLiveEventsCache,
  shimFlatRecord,
} = require("../server/cities/barcelona/live");

test.afterEach(() => {
  resetBarcelonaLiveEventsCache();
});

function buildFixtureRecord(overrides = {}) {
  return {
    register_id: 12345,
    name: "Concert de barri a Barcelona",
    status: "published",
    core_type: "event",
    core_type_name: "Agenda",
    body: "<p>Concert gratuït amb food trucks i activitats de barri.</p>",
    start_date: "2027-06-15T18:00:00+02:00",
    end_date: "2027-06-15T20:00:00+02:00",
    type_name: "Puntual",
    addresses: [
      {
        place: "Centre Cívic Example",
        address_name: "C Example",
        start_street_number: 12,
        neighborhood_name: "el Poblenou",
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
    secondary_filters_data: [{ name: "Música" }, { name: "Gastronomia" }],
    image_data: { url: "https://example.com/event.jpg" },
    ...overrides,
  };
}

test("Barcelona Open Data agenda adapter normaliserar fixture-event", () => {
  const event = normalizeOpenDataAgendaRecord(buildFixtureRecord());

  assert.equal(event.id, "barcelona-open-data-12345");
  assert.equal(event.source_id, "barcelona-open-data-agenda");
  assert.equal(event.source_label, "Open Data BCN");
  assert.equal(event.source_language, "ca");
  assert.equal(event.title, "Concert de barri a Barcelona");
  assert.equal(event.start_date, "2027-06-15");
  assert.equal(event.end_date, "2027-06-15");
  assert.equal(event.venue, "Centre Cívic Example");
  assert.equal(event.address, "C Example, 12");
  assert.equal(event.lat, 41.402);
  assert.equal(event.lng, 2.203);
  assert.equal(event.provider_category, "Concerts");
  assert.ok(event.match_tags.includes("kultur"));
  assert.ok(event.match_tags.includes("mat"));
  assert.ok(event.match_tags.includes("music"));
  assert.equal(event.match_reason, undefined);
});

test("Barcelona Open Data agenda adapter markerar användbara och brusiga fixture-events", () => {
  const useful = evaluateOpenDataAgendaRecord(buildFixtureRecord());
  assert.equal(useful.accepted, true);
  assert.ok(useful.score >= 8);
  assert.ok(useful.tags.includes("music"));

  const noisySchoolyard = buildFixtureRecord({
    register_id: 777,
    name: "Patis oberts a les escoles",
    body: "<p>Espai familiar recurrent.</p>",
    classifications_data: [{ name: "Patis oberts a les escoles" }],
    secondary_filters_data: [{ name: "Actes per nens i nenes" }],
  });
  const noise = evaluateOpenDataAgendaRecord(noisySchoolyard);
  assert.equal(noise.accepted, false);
  assert.ok(noise.reasons.includes("family-infrastructure-noise"));
  assert.deepEqual(normalizeOpenDataAgendaEvents([noisySchoolyard]), []);
});

test("Barcelona Open Data agenda adapter hanterar provider-koordinater i verklig ordning", () => {
  const event = normalizeOpenDataAgendaRecord(
    buildFixtureRecord({
      addresses: [
        {
          place: "Punt de trobada",
          address_name: "C Example",
          location_4326_latlon: {
            geometries: [
              {
                type: "Point",
                coordinates: [2.1497623991638353, 41.37080678367533],
              },
            ],
          },
        },
      ],
    }),
  );

  assert.equal(event.lat, 41.37080678367533);
  assert.equal(event.lng, 2.1497623991638353);
});

test("Barcelona Open Data agenda adapter returnerar date-keyed events", async () => {
  const result = await fetchLiveEventsForDates(["2027-06-15", "2027-06-16"], {
    fetchOpenDataAgendaEvents: async () => [
      buildFixtureRecord(),
      buildFixtureRecord({
        register_id: 67890,
        name: "Taller familiar",
        start_date: "2027-06-16T10:00:00+02:00",
        end_date: "2027-06-16T12:00:00+02:00",
        body: "<p>Activitat familiar al barri.</p>",
        classifications_data: [{ name: "Tallers" }],
      }),
    ],
  });

  assert.equal(result["2027-06-15"].length, 1);
  assert.equal(result["2027-06-15"][0].title, "Concert de barri a Barcelona");
  assert.equal(result["2027-06-16"].length, 1);
  assert.equal(result["2027-06-16"][0].title, "Taller familiar");
});

test("Barcelona Open Data agenda adapter bucketar fler-dagarsevent utan konstig duplicering", async () => {
  const result = await fetchLiveEventsForDates(["2027-06-15", "2027-06-16", "2027-06-17"], {
    fetchOpenDataAgendaEvents: async () => [
      buildFixtureRecord({
        register_id: 24680,
        name: "Festival de barri",
        start_date: "2027-06-15T10:00:00+02:00",
        end_date: "2027-06-17T22:00:00+02:00",
        body: "<p>Festival amb música, mercat i activitats de barri.</p>",
      }),
    ],
  });

  assert.equal(result["2027-06-15"].length, 1);
  assert.equal(result["2027-06-16"].length, 0);
  assert.equal(result["2027-06-17"].length, 0);
});

test("Barcelona Open Data agenda adapter tål saknade koordinater", () => {
  const event = normalizeOpenDataAgendaRecord(
    buildFixtureRecord({
      addresses: [
        {
          place: "Centre Cívic Sense Coordenades",
          address_name: "C Sense Coordenades",
        },
      ],
    }),
  );

  assert.equal(event.venue, "Centre Cívic Sense Coordenades");
  assert.equal(event.address, "C Sense Coordenades");
  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
});

test("Barcelona Open Data agenda adapter härleder bredare men säkra kategori-taggar", () => {
  const event = normalizeOpenDataAgendaRecord(
    buildFixtureRecord({
      name: "Fira vintage i mercat de segona mà al litoral del barri amb vi i música",
      body: "<p>Market, food, wine, beach and community music session.</p>",
      classifications_data: [{ name: "Fires" }],
      secondary_filters_data: [{ name: "Mercats" }],
    }),
  );

  assert.ok(event.match_tags.includes("market"));
  assert.ok(event.match_tags.includes("mat"));
  assert.ok(event.match_tags.includes("vin"));
  assert.ok(event.match_tags.includes("coast"));
  assert.ok(event.match_tags.includes("community"));
  assert.ok(event.match_tags.includes("music"));
});

test("Barcelona Open Data agenda adapter hanterar tomma och trasiga provider-svar säkert", async () => {
  assert.deepEqual(normalizeOpenDataAgendaEvents(null), []);
  assert.deepEqual(normalizeOpenDataAgendaEvents([{ name: "" }]), []);

  const empty = await fetchLiveEventsForDates(["2027-06-15"], {
    fetchOpenDataAgendaEvents: async () => [],
  });
  assert.deepEqual(empty, { "2027-06-15": [] });

  resetBarcelonaLiveEventsCache();
  const failed = await fetchLiveEventsForDates(["2027-06-15"], {
    fetchOpenDataAgendaEvents: async () => {
      throw new Error("provider down");
    },
  });
  assert.deepEqual(failed, { "2027-06-15": [] });
});

test("Barcelona Open Data agenda adapter cachear lyckade tomma provider-svar", async () => {
  let calls = 0;
  const context = {
    fetchOpenDataAgendaEvents: async () => {
      calls += 1;
      return [];
    },
  };

  // Same date window → same cache key → single fetch.
  assert.deepEqual(await fetchLiveEventsForDates(["2027-06-15"], context), {
    "2027-06-15": [],
  });
  assert.deepEqual(await fetchLiveEventsForDates(["2027-06-15"], context), {
    "2027-06-15": [],
  });
  assert.equal(calls, 1);
});

test("Barcelona Open Data agenda adapter cachear inte malformed provider-svar", async () => {
  let calls = 0;
  const context = {
    fetchOpenDataAgendaEvents: async () => {
      calls += 1;
      return { records: "unexpected-shape" };
    },
  };

  assert.deepEqual(await fetchLiveEventsForDates(["2027-06-15"], context), {
    "2027-06-15": [],
  });
  // Different date window → different cache key → re-fetches.
  assert.deepEqual(await fetchLiveEventsForDates(["2027-06-16"], context), {
    "2027-06-16": [],
  });
  assert.equal(calls, 2);
});

test("Barcelona Open Data agenda adapter returnerar säker tom shape för ogiltiga datum", async () => {
  assert.deepEqual(await fetchLiveEventsForDates(), {});
  assert.deepEqual(await fetchLiveEventsForDates(null), {});
  assert.deepEqual(await fetchLiveEventsForDates("2027-06-15"), {});
});

test("buildCkanDateWindowUrl produces datastore_search_sql URL with date window", () => {
  const url = buildCkanDateWindowUrl("2027-06-15", "2027-06-17");
  assert.ok(url.includes("datastore_search_sql"), "uses CKAN datastore SQL endpoint");
  assert.ok(url.includes("877ccf66-9106-4ae2-be51-95a9f6469e4c"), "references CSV resource ID");
  assert.ok(url.includes("2027-06-15"), "includes start date in query");
  assert.ok(url.includes("2027-06-17"), "includes end date in query");
  assert.ok(url.includes("end_date"), "filters on end_date");
  assert.ok(url.includes("start_date"), "filters on start_date");
  assert.ok(!url.includes("/download"), "does not use the full-dump download URL");
});

test("shimFlatRecord converts flat CKAN CSV record to nested format", () => {
  const flat = {
    register_id: "﻿99400753057",
    name: "Taller de ceràmica",
    start_date: "2027-06-15T10:00:00+02:00",
    end_date: "2027-06-15T12:00:00+02:00",
    addresses_road_name: "Carrer de l'Exemple",
    addresses_start_street_number: "42",
    addresses_neighborhood_name: "el Poblenou",
    addresses_district_name: "Sant Martí",
    geo_epgs_4326_lat: "41.4035",
    geo_epgs_4326_lon: "2.2045",
    values_category: "Puntual",
    secondary_filters_name: "Tallers",
  };

  const nested = shimFlatRecord(flat);

  // BOM prefix stripped from register_id
  assert.equal(nested.register_id, "99400753057");
  assert.equal(nested.name, "Taller de ceràmica");
  assert.equal(nested.start_date, "2027-06-15T10:00:00+02:00");
  assert.ok(Array.isArray(nested.addresses), "produces nested addresses array");
  assert.equal(nested.addresses[0].address_name, "Carrer de l'Exemple");
  assert.equal(nested.addresses[0].neighborhood_name, "el Poblenou");
  assert.equal(nested.addresses[0].district_name, "Sant Martí");
  // Coordinates are embedded in location_4326 geometry
  const coords = nested.addresses[0].location_4326?.geometries?.[0]?.coordinates;
  assert.ok(coords, "has location_4326 geometry");
  assert.ok(Math.abs(coords[0] - 41.4035) < 0.001, "lat in coordinates");
  assert.ok(Math.abs(coords[1] - 2.2045) < 0.001, "lng in coordinates");
});

test("shimFlatRecord passes through already-nested records unchanged", () => {
  const nested = buildFixtureRecord();
  const result = shimFlatRecord(nested);
  assert.equal(result, nested, "same reference returned for nested records");
});

test("evaluateOpenDataAgendaRecord rejects past events", () => {
  const pastEvent = buildFixtureRecord({
    start_date: "2024-01-10T18:00:00+02:00",
    end_date: "2024-01-10T20:00:00+02:00",
  });
  const result = evaluateOpenDataAgendaRecord(pastEvent);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("past-event"));
});

test("normalizeOpenDataAgendaEvents filters out past events via shimFlatRecord pipeline", () => {
  const pastFlat = {
    register_id: "111",
    name: "Old Festival",
    start_date: "2024-01-10T10:00:00+02:00",
    end_date: "2024-01-10T22:00:00+02:00",
    addresses_road_name: "Rambla",
    geo_epgs_4326_lat: "41.38",
    geo_epgs_4326_lon: "2.17",
  };
  const futureNested = buildFixtureRecord();

  const result = normalizeOpenDataAgendaEvents([pastFlat, futureNested]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Concert de barri a Barcelona");
});

test("different date windows produce separate cache entries", async () => {
  let calls = 0;
  const context = {
    fetchOpenDataAgendaEvents: async () => {
      calls += 1;
      return [buildFixtureRecord()];
    },
  };

  await fetchLiveEventsForDates(["2027-06-15"], context);
  resetBarcelonaLiveEventsCache();
  await fetchLiveEventsForDates(["2027-06-20", "2027-06-21"], context);
  assert.equal(calls, 2, "different date windows trigger separate fetches");
});

test("concurrent requests for different date windows fetch independently", async () => {
  let calls = 0;
  const eventA = buildFixtureRecord({
    register_id: 50001,
    name: "Event Window A",
    start_date: "2027-07-01T18:00:00+02:00",
    end_date: "2027-07-01T20:00:00+02:00",
  });
  const eventB = buildFixtureRecord({
    register_id: 50002,
    name: "Event Window B",
    start_date: "2027-07-10T18:00:00+02:00",
    end_date: "2027-07-10T20:00:00+02:00",
  });

  const context = {
    fetchOpenDataAgendaEvents: async () => {
      calls += 1;
      // Return whichever event set matches the current call order.
      return calls === 1 ? [eventA] : [eventB];
    },
  };

  const [resultA, resultB] = await Promise.all([
    fetchLiveEventsForDates(["2027-07-01"], context),
    fetchLiveEventsForDates(["2027-07-10"], context),
  ]);

  assert.equal(calls, 2, "two different date windows must trigger two fetches");
  assert.equal(resultA["2027-07-01"].length, 1);
  assert.equal(resultA["2027-07-01"][0].title, "Event Window A");
  assert.equal(resultB["2027-07-10"].length, 1);
  assert.equal(resultB["2027-07-10"][0].title, "Event Window B");
});
