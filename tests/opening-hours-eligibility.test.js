const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSelectedDayHoursFact,
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForRole,
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

// Friday 2026-10-09, local wall clock. A role is judged at the time it is
// visited, not at "some point in the rest of the day".
test("Santiago nonexistent next midnight never attests 45 contiguous real minutes", () => {
  const window = buildLocalDayAvailabilityWindow({ requestedDate: "2026-09-05",
    nowLocalIso: "2026-09-05T23:30:00", timezone: "America/Santiago" });
  assert.deepEqual(evaluateOpeningHoursForRole("Sa 18:00-00:30", "evening_bar_option", window), {
    eligible: true, status: "unknown", reason: "opening_hours_local_clock_uncertain",
  });
});

const FRIDAY = 5;
function at(hour, minute = 0) {
  return { weekday: FRIDAY, localDate: "2026-10-09", timezone: "Europe/Rome", startMinute: hour * 60 + minute, endMinute: 1440 };
}
function roleStatus(hours, role, window) {
  return evaluateOpeningHoursForRole(hours, role, window).status;
}

test("a meal is judged at lunch or dinner, not at any open minute of the day", () => {
  const lunchOnly = "Mo-Fr 11:30-14:30";
  assert.equal(roleStatus(lunchOnly, "food_anchor", at(9)), "available_in_role_window");
  assert.deepEqual(evaluateOpeningHoursForRole(lunchOnly, "food_anchor", at(15)), {
    eligible: false,
    status: "closed_for_role_window",
    reason: "opening_hours_no_possible_role_window_visit",
  });
  assert.equal(roleStatus("Mo-Su 12:00-14:30,19:00-22:30", "food_anchor", at(15)), "available_in_role_window");
  assert.equal(
    roleStatus(lunchOnly, "food_anchor", at(0)),
    "available_in_role_window",
    "a later date is planned from the start of its day",
  );
});

test("arrival needs a real visit before closing, also late in the evening", () => {
  assert.equal(roleStatus("Mo-Su 12:00-22:30", "food_anchor", at(22, 20)), "closed_for_role_window");
  assert.equal(roleStatus("Mo-Su 12:00-23:30", "food_anchor", at(22, 20)), "available_in_role_window");
  assert.equal(roleStatus("Mo-Su 18:00-23:00", "evening_bar_option", at(22, 20)), "closed_for_role_window");
  assert.equal(roleStatus("Mo-Su 16:00-19:00", "evening_bar_option", at(15)), "available_in_role_window");
  assert.equal(roleStatus("Mo-Su 12:00-18:30", "evening_bar_option", at(15)), "closed_for_role_window");
  assert.equal(roleStatus("Tu-Su 10:00-18:00", "culture_stop", at(17, 30)), "closed_for_role_window");
  assert.equal(roleStatus("Mo-Su 08:00-16:00", "coffee_fika_stop", at(23)), "closed_for_role_window");
});

test("a visit may run past local midnight when the place's own hours do", () => {
  assert.equal(roleStatus("Mo-Su 18:00-02:00", "evening_bar_option", at(23, 30)), "available_in_role_window");
  assert.equal(
    roleStatus("Mo-Fr 18:00-24:00; Sa 00:00-02:00,18:00-24:00; Su off", "evening_bar_option", at(23, 30)),
    "available_in_role_window",
  );
  assert.equal(roleStatus("Mo-Fr 18:00-24:00; Sa,Su off", "evening_bar_option", at(23, 30)), "closed_for_role_window");
  assert.equal(roleStatus("24/7", "food_anchor", at(23, 30)), "available_in_role_window");
});

test("role-window eligibility does not attest actual route arrival", () => {
  assert.deepEqual(evaluateOpeningHoursForRole("Fr 18:00-20:15", "food_anchor", at(19, 30)), {
    eligible: true, status: "available_in_role_window", reason: "opening_hours_cover_possible_role_window_visit",
  });
  // Any positive travel time would prevent a 45-minute stay here. This helper
  // intentionally knows neither the final route legs nor previous-stop dwell.
});

test("missing trusted role date or zone stays unknown", () => {
  for (const window of [
    { weekday: FRIDAY, startMinute: 1170, endMinute: 1440 },
    { ...at(19, 30), timezone: undefined },
    { ...at(19, 30), timezone: "Not/AZone" },
    { ...at(19, 30), localDate: "2026-10-08" },
  ]) {
    assert.equal(roleStatus("Fr 18:00-20:15", "food_anchor", window), "unknown");
    assert.equal(evaluateOpeningHoursForRole("Fr off", "food_anchor", window).eligible, true);
  }
});

test("transition days and skipped local dates fail open for every judged role", () => {
  const { ROLE_VISIT_WINDOWS } = require("../server/place-candidates/opening-hours");
  for (const [localDate, timezone] of [
    ["2026-03-29", "Europe/Rome"], // 23-hour day
    ["2026-10-25", "Europe/Rome"], // 25-hour day
    ["2026-04-04", "America/Santiago"], // midnight fold
    ["2011-12-30", "Pacific/Apia"], // skipped date
  ]) {
    const window = buildLocalDayAvailabilityWindow({ requestedDate: localDate,
      nowLocalIso: `${localDate}T12:00:00`, timezone });
    for (const role of Object.keys(ROLE_VISIT_WINDOWS)) {
      assert.deepEqual(evaluateOpeningHoursForRole("Mo-Su 00:00-24:00", role, window), {
        eligible: true, status: "unknown", reason: "opening_hours_local_clock_uncertain",
      }, `${localDate} ${timezone} ${role}`);
    }
  }
});

test("ordinary midnight, future and past dates preserve the local-day contract", () => {
  const today = buildLocalDayAvailabilityWindow({ requestedDate: "2026-09-12",
    nowLocalIso: "2026-09-12T23:30:00", timezone: "America/Santiago" });
  assert.equal(roleStatus("Sa 18:00-00:30", "evening_bar_option", today), "available_in_role_window");
  const future = buildLocalDayAvailabilityWindow({ requestedDate: "2026-09-12",
    nowLocalIso: "2026-09-05T23:30:00", timezone: "America/Santiago" });
  assert.equal(future.startMinute, 0);
  assert.equal(roleStatus("Sa 18:00-00:30", "food_anchor", future), "available_in_role_window");
  assert.equal(buildLocalDayAvailabilityWindow({ requestedDate: "2026-09-04",
    nowLocalIso: "2026-09-05T23:30:00", timezone: "America/Santiago" }), null);
});

test("a possible midnight visit into a transition day stays unknown", () => {
  const window = buildLocalDayAvailabilityWindow({ requestedDate: "2026-03-28",
    nowLocalIso: "2026-03-28T23:30:00", timezone: "Europe/Rome" });
  assert.equal(roleStatus("Sa 18:00-02:00", "evening_bar_option", window), "unknown");
  // A daytime potential visit does not depend on tomorrow's clock transition.
  assert.equal(roleStatus("Sa 18:00-02:00", "evening_bar_option", { ...window, startMinute: 1080 }), "available_in_role_window");
});

test("source-day hours are facts, not role-window eligibility or DST attestation", () => {
  const window = buildLocalDayAvailabilityWindow({ requestedDate: "2026-09-05",
    nowLocalIso: "2026-09-05T23:30:00", timezone: "America/Santiago" });
  assert.equal(roleStatus("Sa 18:00-00:30", "evening_bar_option", window), "unknown");
  assert.deepEqual(buildSelectedDayHoursFact("Sa 18:00-00:30", window), {
    status: "known", all_day: false, windows: [{ opens: "18:00", closes: "24:00" }],
  });
  assert.equal(roleStatus("Fr 08:00-09:00", "culture_stop", at(8)), "closed_for_role_window");
  assert.equal(buildSelectedDayHoursFact("Fr 08:00-09:00", at(8)).status, "known");
  assert.equal(buildSelectedDayHoursFact("Fr off", at(8)).status, "closed");
  for (const hours of [null, "sunrise-sunset", "PH off; Mo-Su 10:00-18:00"]) {
    assert.equal(roleStatus(hours, "food_anchor", at(15)), "unknown");
    assert.equal(evaluateOpeningHoursForRole(hours, "food_anchor", at(15)).eligible, true);
  }
});

test("unknown hours, unsupported syntax and unjudged roles never exclude", () => {
  assert.equal(evaluateOpeningHoursForRole("PH off; Mo-Su 10:00-18:00", "food_anchor", at(15)).eligible, true);
  assert.equal(roleStatus("sunrise-sunset", "scenic_anchor", at(15)), "unknown");
  assert.equal(roleStatus(null, "food_anchor", at(15)), "unknown");
  assert.equal(roleStatus("Mo-Su 10:00-18:00", "not_a_route_role", at(10)), "unknown");
  assert.equal(roleStatus("Mo-Su 10:00-18:00", "toString", at(10)), "unknown");
  assert.equal(roleStatus("Mo-Su 10:00-18:00", "food_anchor", { weekday: 9, startMinute: 0, endMinute: 1440 }), "unknown");
});
