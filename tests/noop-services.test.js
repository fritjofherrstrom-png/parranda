const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createNoopEditorialService,
  createNoopLiveEventsService,
} = require("../server/cities/noop-services");

test("noop live service returnerar tomma eventlistor per datum", async () => {
  const fetchLiveEventsForDates = createNoopLiveEventsService();
  const result = await fetchLiveEventsForDates(["2026-05-01", "2026-05-02"]);

  assert.deepStrictEqual(result, {
    "2026-05-01": [],
    "2026-05-02": [],
  });
});

test("noop live service är tolerant mot saknade eller ogiltiga datumlistor", async () => {
  const fetchLiveEventsForDates = createNoopLiveEventsService();

  assert.deepStrictEqual(await fetchLiveEventsForDates(), {});
  assert.deepStrictEqual(await fetchLiveEventsForDates(null), {});
  assert.deepStrictEqual(await fetchLiveEventsForDates("2026-05-01"), {});
});

test("noop editorial service returnerar hard-empty copy på svenska", () => {
  const editorial = createNoopEditorialService({ cityLabel: "Teststad" });
  const pulse = editorial.getCityPulse("2026-05-01");

  assert.equal(pulse.date, "2026-05-01");
  assert.match(pulse.headline, /Vi har inte Teststad på riktigt än/);
  assert.match(pulse.subhead, /Vi har inget lokalt lager för Teststad/);
  assert.equal(pulse._noop, true);
  assert.deepStrictEqual(pulse.items, []);
  assert.deepStrictEqual(editorial.getDateSignals("2026-05-01"), []);
});

test("noop editorial service returnerar hard-empty copy på engelska", () => {
  const editorial = createNoopEditorialService({ cityLabel: "Teststad" });
  const pulse = editorial.getCityPulse("2026-05-01", { lang: "en" });

  assert.match(pulse.headline, /We don't have Teststad for real yet/);
  assert.match(pulse.subhead, /There is no local layer for Teststad yet/);
  assert.equal(pulse._noop, true);
});

test("noop editorial service innehåller inte intern jargong", () => {
  const editorial = createNoopEditorialService({ cityLabel: "Teststad" });
  const sv = editorial.getCityPulse("2026-05-01");
  const en = editorial.getCityPulse("2026-05-01", { lang: "en" });

  // These strings should never appear in user-facing copy.
  for (const pulse of [sv, en]) {
    assert.doesNotMatch(pulse.headline || "", /city-core/i);
    assert.doesNotMatch(pulse.headline || "", /curated/i);
    assert.doesNotMatch(pulse.headline || "", /citypack/i);
    assert.doesNotMatch(pulse.headline || "", /noop/i);
    assert.doesNotMatch(pulse.subhead || "", /city-core/i);
    assert.doesNotMatch(pulse.subhead || "", /kuraterad/i);
    assert.doesNotMatch(pulse.subhead || "", /editorial-lager/i);
  }
});
