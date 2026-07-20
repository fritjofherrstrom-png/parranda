const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForWindow,
  normalizeOpeningHours,
} = require("../server/place-candidates/opening-hours");

test("normalizes bounded source-owned opening-hours text", () => {
  assert.equal(normalizeOpeningHours("  Mo-Fr   09:00-18:00  "), "Mo-Fr 09:00-18:00");
  assert.equal(normalizeOpeningHours(""), null);
  assert.equal(normalizeOpeningHours("x".repeat(513)), null);
  assert.equal(normalizeOpeningHours({ value: "24/7" }), null);
});

test("simple weekly schedules distinguish remaining-day overlap from closure", () => {
  const hours = "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off";
  assert.deepEqual(
    evaluateOpeningHoursForWindow(hours, { weekday: 1, startMinute: 13 * 60, endMinute: 1440 }),
    {
      eligible: true,
      status: "available_in_window",
      reason: "opening_hours_overlap_query_window",
    },
  );
  assert.deepEqual(
    evaluateOpeningHoursForWindow(hours, { weekday: 1, startMinute: 18 * 60, endMinute: 1440 }),
    {
      eligible: false,
      status: "closed_for_window",
      reason: "opening_hours_closed_for_query_window",
    },
  );
  assert.equal(
    evaluateOpeningHoursForWindow(hours, { weekday: 0, startMinute: 0, endMinute: 1440 }).eligible,
    false,
  );
});

test("overnight hours remain available on both sides of local midnight", () => {
  const hours = "Fr-Sa 18:00-02:00; Su-Th off";
  assert.equal(
    evaluateOpeningHoursForWindow(hours, { weekday: 5, startMinute: 23 * 60, endMinute: 1440 }).eligible,
    true,
  );
  assert.equal(
    evaluateOpeningHoursForWindow(hours, { weekday: 6, startMinute: 30, endMinute: 90 }).eligible,
    true,
  );
});

test("unsupported or precedence-sensitive syntax fails open as unknown", () => {
  for (const hours of [
    "Mo-Su 09:00-18:00; Tu off",
    "sunrise-sunset",
    "Mo-Fr 10:00+",
    'Mo-Fr 09:00-18:00 \"appointment only\"',
  ]) {
    const result = evaluateOpeningHoursForWindow(hours, { weekday: 2, startMinute: 12 * 60, endMinute: 1440 });
    assert.equal(result.eligible, true, hours);
    assert.equal(result.status, "unknown", hours);
  }
});

test("24/7 stays available and missing facts never exclude a candidate", () => {
  assert.equal(
    evaluateOpeningHoursForWindow("24/7", { weekday: 3, startMinute: 1439, endMinute: 1440 }).eligible,
    true,
  );
  assert.deepEqual(
    evaluateOpeningHoursForWindow(null, { weekday: 3, startMinute: 0, endMinute: 1440 }),
    { eligible: true, status: "unknown", reason: "opening_hours_unavailable" },
  );
});

test("local availability window uses trusted local now only for the selected current date", () => {
  assert.deepEqual(
    buildLocalDayAvailabilityWindow({
      requestedDate: "2026-07-20",
      nowLocalIso: "2026-07-20T23:12:00",
    }),
    { weekday: 1, startMinute: 23 * 60 + 12, endMinute: 1440 },
  );
  assert.deepEqual(
    buildLocalDayAvailabilityWindow({
      requestedDate: "2026-07-21",
      nowLocalIso: "2026-07-20T23:12:00",
    }),
    { weekday: 2, startMinute: 0, endMinute: 1440 },
  );
  assert.equal(
    buildLocalDayAvailabilityWindow({
      requestedDate: "2026-07-19",
      nowLocalIso: "2026-07-20T23:12:00",
    }),
    null,
  );
  assert.equal(buildLocalDayAvailabilityWindow({ requestedDate: "2026-07-20" }), null);
  assert.equal(
    buildLocalDayAvailabilityWindow({
      requestedDate: "2026-02-31",
      nowLocalIso: "2026-02-01T12:00:00",
    }),
    null,
  );
});
