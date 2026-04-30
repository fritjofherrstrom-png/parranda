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

test("noop editorial service returnerar neutral och stabil city pulse", () => {
  const editorial = createNoopEditorialService({ cityLabel: "Teststad" });
  const pulse = editorial.getCityPulse("2026-05-01");

  assert.equal(pulse.date, "2026-05-01");
  assert.equal(pulse.headline, "Teststad just nu");
  assert.deepStrictEqual(pulse.items, []);
  assert.deepStrictEqual(editorial.getDateSignals("2026-05-01"), []);
});
