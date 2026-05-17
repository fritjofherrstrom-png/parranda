const assert = require("node:assert/strict");
const test = require("node:test");

const {
  fetchLiveEventsForDates,
  normalizeOpenDataAgendaEvents,
  normalizeOpenDataAgendaRecord,
  resetBarcelonaLiveEventsCache,
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
    start_date: "2026-05-17T18:00:00+02:00",
    end_date: "2026-05-17T20:00:00+02:00",
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
    secondary_filters_data: [{ name: "Música" }],
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
  assert.equal(event.start_date, "2026-05-17");
  assert.equal(event.end_date, "2026-05-17");
  assert.equal(event.venue, "Centre Cívic Example");
  assert.equal(event.address, "C Example, 12");
  assert.equal(event.lat, 41.402);
  assert.equal(event.lng, 2.203);
  assert.equal(event.provider_category, "Concerts");
  assert.ok(event.match_tags.includes("kultur"));
  assert.ok(event.match_tags.includes("mat"));
  assert.equal(event.match_reason, undefined);
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
  const result = await fetchLiveEventsForDates(["2026-05-17", "2026-05-18"], {
    fetchOpenDataAgendaEvents: async () => [
      buildFixtureRecord(),
      buildFixtureRecord({
        register_id: 67890,
        name: "Taller familiar",
        start_date: "2026-05-18T10:00:00+02:00",
        end_date: "2026-05-18T12:00:00+02:00",
        body: "<p>Activitat familiar al barri.</p>",
        classifications_data: [{ name: "Tallers" }],
      }),
    ],
  });

  assert.equal(result["2026-05-17"].length, 1);
  assert.equal(result["2026-05-17"][0].title, "Concert de barri a Barcelona");
  assert.equal(result["2026-05-18"].length, 1);
  assert.equal(result["2026-05-18"][0].title, "Taller familiar");
});

test("Barcelona Open Data agenda adapter hanterar tomma och trasiga provider-svar säkert", async () => {
  assert.deepEqual(normalizeOpenDataAgendaEvents(null), []);
  assert.deepEqual(normalizeOpenDataAgendaEvents([{ name: "" }]), []);

  const empty = await fetchLiveEventsForDates(["2026-05-17"], {
    fetchOpenDataAgendaEvents: async () => [],
  });
  assert.deepEqual(empty, { "2026-05-17": [] });

  resetBarcelonaLiveEventsCache();
  const failed = await fetchLiveEventsForDates(["2026-05-17"], {
    fetchOpenDataAgendaEvents: async () => {
      throw new Error("provider down");
    },
  });
  assert.deepEqual(failed, { "2026-05-17": [] });
});

test("Barcelona Open Data agenda adapter cachear lyckade tomma provider-svar", async () => {
  let calls = 0;
  const context = {
    fetchOpenDataAgendaEvents: async () => {
      calls += 1;
      return [];
    },
  };

  assert.deepEqual(await fetchLiveEventsForDates(["2026-05-17"], context), {
    "2026-05-17": [],
  });
  assert.deepEqual(await fetchLiveEventsForDates(["2026-05-18"], context), {
    "2026-05-18": [],
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

  assert.deepEqual(await fetchLiveEventsForDates(["2026-05-17"], context), {
    "2026-05-17": [],
  });
  assert.deepEqual(await fetchLiveEventsForDates(["2026-05-18"], context), {
    "2026-05-18": [],
  });
  assert.equal(calls, 2);
});

test("Barcelona Open Data agenda adapter returnerar säker tom shape för ogiltiga datum", async () => {
  assert.deepEqual(await fetchLiveEventsForDates(), {});
  assert.deepEqual(await fetchLiveEventsForDates(null), {});
  assert.deepEqual(await fetchLiveEventsForDates("2026-05-17"), {});
});
