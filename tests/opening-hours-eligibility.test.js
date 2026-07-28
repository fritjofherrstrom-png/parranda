const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSelectedDayHoursFact,
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForWindow,
  normalizeOpeningHours,
  normalizeSelectedDayHoursFact,
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

test("common comma-separated OSM day rules stay distinct from day lists and time windows", () => {
  const hours = "Mo-Fr 09:30-18:00, Sa,Su 10:00-17:00";
  assert.deepEqual(
    evaluateOpeningHoursForWindow(hours, { weekday: 1, startMinute: 19 * 60 + 2, endMinute: 1440 }),
    {
      eligible: false,
      status: "closed_for_window",
      reason: "opening_hours_closed_for_query_window",
    },
  );
  assert.equal(
    evaluateOpeningHoursForWindow(hours, { weekday: 0, startMinute: 12 * 60, endMinute: 1440 }).eligible,
    true,
  );
  assert.deepEqual(buildSelectedDayHoursFact(hours, { weekday: 6 }), {
    status: "known",
    all_day: false,
    windows: [{ opens: "10:00", closes: "17:00" }],
  });

  assert.deepEqual(buildSelectedDayHoursFact("Mo,Tu 09:00-12:00,13:00-18:00", { weekday: 2 }), {
    status: "known",
    all_day: false,
    windows: [
      { opens: "09:00", closes: "12:00" },
      { opens: "13:00", closes: "18:00" },
    ],
  });
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

test("selected-day facts expose bounded local windows without raw schedule syntax", () => {
  assert.deepEqual(
    buildSelectedDayHoursFact("Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", { weekday: 1 }),
    {
      status: "known",
      all_day: false,
      windows: [{ opens: "09:00", closes: "18:00" }],
    },
  );
  assert.deepEqual(buildSelectedDayHoursFact("24/7", { weekday: 4 }), {
    status: "known",
    all_day: true,
    windows: [],
  });
  assert.deepEqual(buildSelectedDayHoursFact("Su off", { weekday: 0 }), {
    status: "closed",
    all_day: false,
    windows: [],
  });
});

test("selected-day facts keep overnight windows local and fail closed on unsupported syntax", () => {
  assert.deepEqual(buildSelectedDayHoursFact("Fr-Sa 18:00-02:00; Su-Th off", { weekday: 5 }), {
    status: "known",
    all_day: false,
    windows: [{ opens: "18:00", closes: "24:00" }],
  });
  assert.deepEqual(buildSelectedDayHoursFact("Fr-Sa 18:00-02:00; Su-Th off", { weekday: 6 }), {
    status: "known",
    all_day: false,
    windows: [
      { opens: "00:00", closes: "02:00" },
      { opens: "18:00", closes: "24:00" },
    ],
  });
  assert.equal(buildSelectedDayHoursFact("sunrise-sunset", { weekday: 2 }), null);
  assert.equal(buildSelectedDayHoursFact("Mo 09:00-18:00", { weekday: null }), null);
});

test("public selected-day facts accept only the closed bounded shape", () => {
  assert.deepEqual(
    normalizeSelectedDayHoursFact({
      status: "known",
      all_day: false,
      windows: [
        { opens: "9:00", closes: "18:00" },
        { opens: "bad", closes: "22:00" },
        { opens: "20:00", closes: "10:00" },
      ],
      raw_schedule: "must not survive",
    }),
    {
      status: "known",
      all_day: false,
      windows: [{ opens: "09:00", closes: "18:00" }],
    },
  );
  assert.equal(normalizeSelectedDayHoursFact({ status: "known", windows: [] }), null);
  assert.equal(normalizeSelectedDayHoursFact({ status: "unknown", all_day: true }), null);
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
