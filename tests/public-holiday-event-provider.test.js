"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicHolidayEventProvider, publicHolidayFeedForContext, matchMunicipality,
  FESTIVOS_CREDIT, OPEN_CREDIT } = require("../server/pulse-sources/public-holiday-event-provider");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { executeLiveEventQuery, eventMatchesLiveScope } = require("../server/place-candidates/live-event-query");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");
const { fuseTimeSensitiveEvents } = require("../server/pulse-sources/event-fusion");
const { buildAnchorEventSourcePlan } = require("../server/place-candidates/anchor-event-acquisition");
const { scoreEventPreferenceFit } = require("../server/pulse-engine/event-preference-fit");

const ANCHOR = { lat: 48.1173, lng: -1.6778 }, NOW = "2026-07-20T06:00:00Z";
const ES = { country_code: "es", locality: "Test municipality", county: "Test province", region: "Test region" };
const FR = { country_code: "fr", locality: "Test municipality", county: "Test county", region: "Test region" };
const MUNICIPALITY = { ine: "01001", name: ES.locality, province: "01", province_name: ES.county,
  ccaa_iso: "ES-PV", ccaa_name: ES.region };
const COUNTRY = { isoCode: "FR", officialLanguages: ["FR"], name: [{ language: "FR", text: "France" }] };
const SUBDIVISIONS = [{ code: "FR.TR", name: [{ language: "FR", text: FR.region }], children: [
  { code: "FR.TR.TC", name: [{ language: "FR", text: FR.county }], children: [
    { code: "FR.TR.TC.TM", name: [{ language: "FR", text: FR.locality }] },
  ] },
] }, { code: "FR.OTHER", name: [{ language: "FR", text: "Other region" }] }];
function festivo(overrides = {}) {
  return { date: "2026-07-20", name: { es: "Fiesta local" }, level: "local", type: "fixed",
    source: { ref: "Official bulletin 42", url: "https://bulletin.example/42.pdf?version=1" }, ...overrides };
}
function municipalCalendar(year = 2026, holidays = [festivo()]) {
  return { version: "1.0.0", year, municipality: { ine: MUNICIPALITY.ine, name: MUNICIPALITY.name,
    province: { ine: MUNICIPALITY.province, name: MUNICIPALITY.province_name },
    ccaa: { code: MUNICIPALITY.ccaa_iso, name: MUNICIPALITY.ccaa_name } }, holidays,
    license: "CC-BY-4.0", attribution: "<img src=x onerror=alert(1)> & Official owner" };
}
function holiday(overrides = {}) {
  return { id: "national", startDate: "2026-07-20", endDate: "2026-07-20", type: "Public",
    name: [{ language: "EN", text: "Translated holiday" }, { language: "FR", text: "Fête nationale" }],
    regionalScope: "National", temporalScope: "FullDay", nationwide: true, subdivisions: [], groups: [], tags: [], ...overrides };
}
function transport({ context = ES, holidays = [holiday()], calendar = municipalCalendar(),
  index = [MUNICIPALITY], countries = [COUNTRY], subdivisions = SUBDIVISIONS, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, "manual");
    if (url === "https://festivos.io/v1/ref/municipios.json") return new Response(JSON.stringify({ municipalities: index }));
    if (/^https:\/\/festivos.io\/v1\/\d{4}\/municipio\/01001.json$/.test(url)) {
      return new Response(JSON.stringify(typeof calendar === "function" ? calendar(Number(url.split("/")[4])) : calendar));
    }
    if (url === "https://openholidaysapi.org/Countries") return new Response(JSON.stringify(countries));
    if (url === `https://openholidaysapi.org/Subdivisions?countryIsoCode=${context.country_code.toUpperCase()}`) return new Response(JSON.stringify(subdivisions));
    if (url.startsWith(`https://openholidaysapi.org/PublicHolidays?countryIsoCode=${context.country_code.toUpperCase()}&`)) return new Response(JSON.stringify(holidays));
    assert.fail(`unexpected fixture request: ${url}`);
  };
}
function provider(options = {}) {
  const context = options.placeContext || ES;
  return createPublicHolidayEventProvider({ anchor: ANCHOR, placeContext: context,
    fetcher: transport({ context }), ...options }).create();
}
const collect = options => provider(options).collect({ date: "2026-07-20" });

test("country calendar descriptor is attested, mapless and supplemental to independent local calendars", () => {
  assert.equal(publicHolidayFeedForContext({ anchor: ANCHOR }), null);
  assert.equal(publicHolidayFeedForContext({ anchor: { lat: NaN, lng: 1 }, placeContext: ES }), null);
  for (const kind of ["in_place", "near_me", "near_route"]) assert.equal(publicHolidayFeedForContext({ anchor: ANCHOR, placeContext: ES, scope: { kind } }), null);
  assert.equal(publicHolidayFeedForContext({ anchor: ANCHOR, placeContext: ES, scope: { kind: "around_place", trusted_nearby_fallback_m: 25000 } }), null);
  const feed = publicHolidayFeedForContext({ anchor: ANCHOR, placeContext: ES });
  assert.equal(feed.source_scoped_pulse, true);
  assert.equal(feed.pulse_only, true);
  assert.notEqual(feed.id, publicHolidayFeedForContext({ anchor: ANCHOR, placeContext: { ...ES, locality: "Different municipality" } }).id);
  const local = Array.from({ length: 3 }, (_, i) => ({ id: `calendar-${i}`, bbox: feed.bbox, endpoint: `https://calendar-${i}.example/events` }));
  assert.deepEqual(buildAnchorEventSourcePlan({ anchor: ANCHOR, registry: [feed, ...local] }).map(row => row.id), local.map(row => row.id));
});

test("INE joins require exact municipality plus province/region, including ambiguous and mismatched names", () => {
  assert.deepEqual(matchMunicipality([MUNICIPALITY], ES), MUNICIPALITY);
  for (const context of [{ country_code: "es", locality: ES.locality }, { ...ES, country_code: "fr" },
    { ...ES, county: "Wrong province" }, { ...ES, region: "Wrong region" }, { ...ES, locality: "Test municipali" }]) {
    assert.equal(matchMunicipality([MUNICIPALITY], context), null);
  }
  const duplicate = { ...MUNICIPALITY, ine: "01002" };
  assert.equal(matchMunicipality([MUNICIPALITY, duplicate], ES), null);
  assert.equal(matchMunicipality([{ ...MUNICIPALITY, name: "Other name / Test municipality" }], ES).ine, "01001");
});

test("festivos preserves source-local dates, scopes, exact bulletin URL and credits even without a URL", async () => {
  const calls = [];
  const out = await collect({ fetcher: transport({ calls, calendar: municipalCalendar(2026, [festivo(),
    festivo({ name: { es: "Calendario nacional" }, level: "national", source: { ref: "National bulletin" } }),
    festivo({ name: { es: "Calendario regional" }, level: "regional" })]) }) });
  assert.equal(out.collection_status.status, "ok");
  assert.equal(out.time_sensitive_events.length, 3);
  assert.equal(calls.length, 2);
  const [row, national, regional] = out.time_sensitive_events;
  assert.equal(row.source_url, festivo().source.url);
  assert.equal(row.starts_on, "2026-07-20");
  assert.equal(row.starts_at, undefined);
  assert.equal(row.lat, undefined);
  assert.equal(row.provenance.attribution, `${FESTIVOS_CREDIT} · <img src=x onerror=alert(1)> & Official owner · Official bulletin 42`);
  assert.equal(national.source_url, null, "missing official URL is not recovered from a calendar or homepage");
  assert.equal(national.calendar_fact.area, "ES");
  assert.equal(regional.calendar_fact.area, ES.region);
});

test("municipal identity, years, rights, malformed dates and optional URL validation fail honestly", async () => {
  for (const calendar of [{ ...municipalCalendar(), year: 2025 }, { ...municipalCalendar(), license: "Restricted" },
    { ...municipalCalendar(), municipality: { ...municipalCalendar().municipality, ine: "01002" } },
    municipalCalendar(2026, [festivo({ date: "2026-02-30" })]), municipalCalendar(2026, [festivo({ date: "2027-07-20" })]),
    municipalCalendar(2026, [festivo({ source: { ref: "Official bulletin", url: "javascript:alert(1)" } })]),
    municipalCalendar(2026, [festivo({ source: { url: "https://bulletin.example/" } })])]) {
    const out = await collect({ fetcher: transport({ calendar }) });
    assert.equal(out.collection_status.status, "failed");
    assert.equal(out.collection_status.reason, "source_payload_invalid");
  }
  assert.equal((await collect({ placeContext: { country_code: "es", locality: ES.locality } })).collection_status.reason, "calendar_admin_join_unavailable");
});

test("cross-year collection uses at most two static years and retains only its bounded date envelope", async () => {
  const calls = [];
  const out = await provider({ fetcher: transport({ calls, calendar: year => municipalCalendar(year, [
    festivo({ date: `${year}-01-01` }), festivo({ date: `${year}-12-31` }),
  ]) }) }).collect({ date: "2026-12-29" });
  assert.equal(out.collection_status.status, "ok");
  assert.equal(calls.length, 3);
  assert.deepEqual(out.time_sensitive_events.map(row => row.starts_on), ["2026-12-31", "2027-01-01"]);
});

test("OpenHolidays preserves native names and displays only explicitly applicable national/admin facts", async () => {
  const holidays = [holiday(), holiday({ id: "region", nationwide: false, regionalScope: "Regional", subdivisions: [{ code: "FR.TR" }] }),
    holiday({ id: "local", nationwide: false, regionalScope: "Local", subdivisions: [{ code: "FR.TR.TC.TM" }] }),
    holiday({ id: "other", nationwide: false, regionalScope: "Regional", subdivisions: [{ code: "FR.OTHER" }] }),
    holiday({ id: "half", temporalScope: "HalfDay", tags: ["Recommended", "Provisional"] })];
  const out = await collect({ placeContext: FR, fetcher: transport({ context: FR, holidays }) });
  assert.equal(out.collection_status.status, "ok");
  assert.equal(out.time_sensitive_events.length, 4);
  const [national, regional, local, half] = out.time_sensitive_events;
  assert.equal(national.title, "Fête nationale");
  assert.equal(national.source_language, "fr");
  assert.equal(national.calendar_fact.area, "France");
  assert.equal(regional.calendar_fact.area, FR.region);
  assert.equal(local.calendar_fact.area, FR.locality);
  assert.equal(half.calendar_fact.temporal_scope, "half_day");
  assert.equal(half.time_window.kind, "period");
  assert.equal(half.starts_at, undefined);
  assert.deepEqual(half.calendar_fact.flags, ["Recommended", "Provisional"]);
  assert.equal(national.source_url, "https://openholidaysapi.org/PublicHolidays?countryIsoCode=FR&validFrom=2026-07-19&validTo=2026-07-28");
  assert.equal(national.provenance.attribution, OPEN_CREDIT);
});

test("unsupported countries, unmatched/ambiguous admins and group applicability never claim healthy empty", async () => {
  assert.equal((await collect({ placeContext: FR, fetcher: transport({ context: FR, countries: [{ ...COUNTRY, isoCode: "DE" }] }) })).collection_status.reason, "calendar_country_unsupported");
  for (const options of [
    { context: { country_code: "fr", locality: FR.locality }, holidays: [holiday({ nationwide: false, regionalScope: "Local", subdivisions: [{ code: "FR.TR.TC.TM" }] })] },
    { context: { country_code: "fr", region: FR.region }, subdivisions: [...SUBDIVISIONS, { code: "FR.DUP", name: [{ language: "FR", text: FR.region }] }],
      holidays: [holiday({ nationwide: false, regionalScope: "Regional", subdivisions: [{ code: "FR.TR" }] })] },
    { context: FR, holidays: [holiday({ groups: [{ code: "religious-group" }] })] },
  ]) {
    const out = await collect({ placeContext: options.context, fetcher: transport(options) });
    assert.equal(out.collection_status.status, "failed");
    assert.equal(out.collection_status.reason, "calendar_scope_unresolved");
  }
});

test("OpenHolidays unknown/contradictory timing, scope, language and excessive payloads fail", async () => {
  for (const overrides of [{ nationwide: true, regionalScope: "Regional" }, { temporalScope: "Unknown" },
    { startDate: "2026-02-30" }, { endDate: "2026-07-19" }, { tags: ["Unknown"] }, { name: [] },
    { nationwide: false, subdivisions: [] }, { type: "School" },
    { nationwide: false, regionalScope: "Regional", subdivisions: [{ code: "unverified-code" }] }]) {
    assert.equal((await collect({ placeContext: FR, fetcher: transport({ context: FR, holidays: [holiday(overrides)] }) })).collection_status.status, "failed");
  }
  assert.equal((await collect({ placeContext: FR, fetcher: transport({ context: FR,
    holidays: Array.from({ length: 161 }, (_, index) => holiday({ id: String(index) })) }) })).collection_status.status, "failed");
});

test("empty, HTTP/year failure, redirects, timeout, byte bounds and failed metadata cache remain distinct", async () => {
  assert.equal((await collect({ fetcher: transport({ calendar: municipalCalendar(2026, []) }) })).collection_status.status, "empty");
  assert.equal((await collect({ placeContext: FR, fetcher: transport({ context: FR, holidays: [] }) })).collection_status.status, "empty");
  const referenceCache = createSourceCache({ namespace: "calendar-fixture", ttlMs: 60000 });
  for (const fetcher of [async () => new Response("missing", { status: 404 }), async () => new Response("not JSON"),
    async () => ({ ok: true, url: "https://redirect.invalid/", text: async () => "{}" }),
    async () => new Response(" ".repeat(4 * 1024 * 1024 + 1))]) {
    assert.equal((await collect({ fetcher, referenceCache })).collection_status.status, "failed");
    assert.equal(referenceCache.peek("festivos-municipalities"), null);
  }
  assert.equal((await collect({ timeoutMs: 50, fetcher: () => new Promise(() => {}) })).collection_status.reason, "source_timeout");
  const calls = [];
  const options = { fetcher: transport({ calls }), referenceCache };
  await collect(options); await collect(options);
  assert.equal(calls.filter(call => call.url.endsWith("municipios.json")).length, 1);
});

test("calendar facts never fuse with venue programmes or other holidays sharing an API/bulletin URL", async () => {
  const out = await collect({ fetcher: transport({ calendar: municipalCalendar(2026, [festivo(),
    festivo({ name: { es: "Different holiday" } }), festivo({ level: "regional" })]) }) });
  const rows = out.time_sensitive_events.map(row => normalizeTimeSensitiveSourceEvent(row, { now: NOW, timezone: row.timezone }));
  const venue = { ...rows[0], calendar_fact: null, lat: ANCHOR.lat, lng: ANCHOR.lng };
  const fused = fuseTimeSensitiveEvents([...rows, venue]);
  assert.equal(fused.length, 4);
  assert.equal(new Set(fused.map(row => row.fusion_id)).size, 4);
  assert.ok(fused.filter(row => row.calendar_fact).every(row => row.lat == null));
  const fakeGeometry = normalizeTimeSensitiveSourceEvent({ ...out.time_sensitive_events[0], ...ANCHOR }, { now: NOW });
  assert.equal(fakeGeometry.lat, undefined, "admin date facts never carry venue geometry, even from malformed source rows");
  assert.equal(normalizeTimeSensitiveSourceEvent({ ...out.time_sensitive_events[0], calendar_fact: { kind: "public_holiday" } }), null);
  const preferenceFit = scoreEventPreferenceFit({ ...rows[0], title: "Food festival", tags: ["concert", "market"],
    route_role_hint: "culture_stop" }, ["culture", "food", "markets"]);
  assert.equal(preferenceFit.level, "none", "a holiday name cannot supply an invented matching programme");
  assert.deepEqual(preferenceFit.matched_preferences, []);
});

test("ordinary Live exposes mapless admin dates/credits in both buckets without spending venue budget", async () => {
  let venueLookups = 0;
  const out = await collectAnchorEvents({ anchor: ANCHOR, placeContext: ES, selectedDate: "2026-07-20", now: NOW,
    registry: [publicHolidayFeedForContext({ anchor: ANCHOR, placeContext: ES })],
    fetcher: transport({ calendar: municipalCalendar(2026, [festivo(), festivo({ date: "2026-07-23" })]) }),
    venueResolver: () => { venueLookups++; assert.fail("a public holiday is not an unresolved venue"); } });
  assert.equal(out.tonight.length, 1);
  assert.equal(out.this_week.length, 1);
  assert.equal(venueLookups, 0);
  for (const row of [out.tonight[0], out.this_week[0]]) {
    assert.equal(row.calendar_fact.kind, "public_holiday");
    assert.equal(row.lat, null);
    assert.equal(row.route_eligible, false);
    assert.equal(row.cultural_tier, "neutral");
    assert.equal(row.source_scope_verified, true);
    assert.ok(row.sources[0].attribution.includes(FESTIVOS_CREDIT));
    assert.equal(eventMatchesLiveScope(row, { kind: "around_place" }), true);
    for (const kind of ["near_me", "near_route", "in_place"]) assert.equal(eventMatchesLiveScope(row, { kind }), false);
    assert.equal(eventMatchesLiveScope(row, { kind: "around_place", trusted_nearby_fallback_m: 25000 }), false);
  }
});

test("public provider/INE/country injection cannot activate a calendar without resolver attestation", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" });
  const response = await executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR,
    country_code: "es", ine: "01001", place_context: ES, provider_url: "https://injected.invalid/" }, eventSupply: supply, now: NOW });
  assert.equal(response.body.live_events.coverage, "uncovered");
  assert.equal(response.body.route_mutation, false);
  assert.equal(response.body.day_anchor_mutation, false);
});

for (const lang of ["en", "sv"]) test(`${lang} period/retry reuses calendar snapshot, binds attested context and preserves local scout demand`, async () => {
  const calls = [], work = []; let demands = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    eventCache: createSourceCache({ namespace: `calendar-fixture-${lang}`, ttlMs: 60000 }),
    sourceCatalog: { recordScoutDemand: async () => { demands++; return { status: "recorded" }; } },
    collectEvents: options => { const promise = collectAnchorEvents({ ...options, fetcher: transport({ calls }) }); work.push(promise); return promise; },
  });
  const day = { selected_date: "2026-07-20", route: ["a", "b"] }, before = JSON.stringify(day);
  const resolver = async (_query, options) => {
    assert.equal(options.language, lang);
    return [{ ...ANCHOR, label: ES.locality, confidence: "medium", provenance: "trusted_fixture_resolver", admin_context: ES,
      spatial_scope: { source: "resolver_bounds", kind: "settlement", bounds: {
        south: ANCHOR.lat - 0.1, north: ANCHOR.lat + 0.1, west: ANCHOR.lng - 0.1, east: ANCHOR.lng + 0.1 } } }];
  };
  for (const time of ["tonight", "this_week"]) {
    const query = () => executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR, place_query: ES.locality,
      selected_date: day.selected_date, time, country_code: "de", ine: "99999", provider_url: "https://injected.invalid/" },
      eventSupply: supply, placeResolver: resolver, placeLanguage: lang, now: NOW });
    assert.equal((await query()).body.live_events.pending, true);
    await Promise.all(work); await new Promise(resolve => setImmediate(resolve));
    const response = await query();
    const warm = response.body.live_events;
    assert.equal(warm.tonight[0].calendar_fact.scope, "local");
    assert.equal((await query()).body.live_events.tonight[0].source_url, festivo().source.url);
    assert.equal(warm.selected_date, day.selected_date);
    assert.equal(response.body.query.time, time);
    assert.equal(response.body.route_mutation, false);
    assert.equal(response.body.day_anchor_mutation, false);
    assert.equal(JSON.stringify(day), before);
  }
  assert.equal(calls.length, 2, "one reference read and one shared calendar read");
  assert.ok(demands > 0, "a broad calendar cannot satisfy the local source mix");
});
