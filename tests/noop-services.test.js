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

test("noop editorial service returnerar neutral och stabil city pulse", () => {
  const editorial = createNoopEditorialService({ cityLabel: "Teststad" });
  const pulse = editorial.getCityPulse("2026-05-01");
  const englishPulse = editorial.getCityPulse("2026-05-01", { lang: "en" });

  assert.equal(pulse.date, "2026-05-01");
  assert.equal(pulse.headline, "Teststad city-core är aktivt");
  assert.match(pulse.subhead, /Kuraterad Pulse för Teststad är inte redo än/);
  assert.equal(englishPulse.headline, "Teststad city-core is active");
  assert.match(englishPulse.subhead, /Curated Teststad Pulse is not ready yet/);
  assert.deepStrictEqual(pulse.items, []);
  assert.deepStrictEqual(editorial.getDateSignals("2026-05-01"), []);
});
