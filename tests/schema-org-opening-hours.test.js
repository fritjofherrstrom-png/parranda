"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeSchemaOrgOpeningHours } = require("../server/place-candidates/schema-org-opening-hours");
const { buildSelectedDayHoursFact } = require("../server/place-candidates/opening-hours");

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fullWeek = (overrides = {}) => ({
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: weekdays,
    opens: "09:00",
    closes: "17:00",
    ...overrides,
  },
});

test("schema openingHours text arrays retain every supported rule", () => {
  const hours = normalizeSchemaOrgOpeningHours({ openingHours: [" Mo-Fr 09:00-17:00 ", "Sa 10:00-13:00", "Su off"] });
  assert.equal(hours, "Mo-Fr 09:00-17:00; Sa 10:00-13:00; Su off");
  assert.deepEqual(buildSelectedDayHoursFact(hours, { weekday: 6 }), {
    status: "known", all_day: false, windows: [{ opens: "10:00", closes: "13:00" }],
  });
  assert.deepEqual(buildSelectedDayHoursFact(hours, { weekday: 0 }), {
    status: "closed", all_day: false, windows: [],
  });
  assert.equal(normalizeSchemaOrgOpeningHours({ openingHours: "24/7" }), "24/7");
});

test("unsupported or malformed text never contributes a partial schedule", () => {
  for (const openingHours of [[], ["Mo 09:00-17:00", null], ["Mo 09:00-17:00", ""],
    ["Mo 09:00-17:00", "ask the operator"], ["Mo 09:00-17:00", "Mo 18:00-20:00"],
    "PH off", "Mo 09:00-17:00; ask the operator", "Mo 09:00-09:00", "x".repeat(513)]) {
    assert.equal(normalizeSchemaOrgOpeningHours({ openingHours }), null, JSON.stringify(openingHours));
  }
});

test("structured explicit seven-day schedules preserve enum identities and overnight hours", () => {
  const hours = normalizeSchemaOrgOpeningHours(fullWeek({
    dayOfWeek: weekdays.map((day, index) => index % 2 ? { "@id": `https://schema.org/${day}` } : `http://schema.org/${day}`),
    opens: "20:00:00", closes: "02:00:00",
  }));
  assert.deepEqual(buildSelectedDayHoursFact(hours, { weekday: 2 }), {
    status: "known", all_day: false,
    windows: [{ opens: "00:00", closes: "02:00" }, { opens: "20:00", closes: "24:00" }],
  });
});

test("an explicitly closed selected weekday stays closed without inventing the other days", () => {
  const hours = normalizeSchemaOrgOpeningHours({ openingHoursSpecification: [
    { dayOfWeek: weekdays.slice(0, 6), opens: "09:00", closes: "17:00" },
    { dayOfWeek: "Sunday" },
  ] });
  assert.deepEqual(buildSelectedDayHoursFact(hours, { weekday: 0 }), { status: "closed", all_day: false, windows: [] });
  assert.equal(normalizeSchemaOrgOpeningHours({ openingHoursSpecification: { dayOfWeek: "Sunday" } }), null,
    "one closed day does not assert closures on six unstated days");
});

test("partial, overlapping and malformed structured schedules remain unknown", () => {
  for (const openingHoursSpecification of [[], null, "Mo-Fr 09:00-17:00",
    { dayOfWeek: "Monday", opens: "09:00", closes: "17:00" },
    { opens: "09:00", closes: "17:00" },
    { dayOfWeek: weekdays, opens: "09:00" },
    { dayOfWeek: weekdays, opens: "09:00", closes: "09:00" },
    { dayOfWeek: weekdays, opens: "09:00:30", closes: "17:00" },
    { dayOfWeek: weekdays, opens: "25:00", closes: "17:00" },
    { dayOfWeek: ["https://not-schema.org/Monday", ...weekdays.slice(1)], opens: "09:00", closes: "17:00" },
    { dayOfWeek: [...weekdays, "PublicHolidays"], opens: "09:00", closes: "17:00" },
    { dayOfWeek: [...weekdays, "Monday"], opens: "09:00", closes: "17:00" },
    [{ dayOfWeek: weekdays, opens: "09:00", closes: "17:00" }, { dayOfWeek: "Monday" }],
    [{ dayOfWeek: weekdays, opens: "09:00", closes: "17:00" }, null],
  ]) {
    assert.equal(normalizeSchemaOrgOpeningHours({ openingHoursSpecification }), null, JSON.stringify(openingHoursSpecification));
  }
});

test("seasonal or special schedules cannot be flattened into weekly availability", () => {
  for (const override of [{ validFrom: "2026-06-01" }, { validThrough: "2026-08-31" },
    { specialOpeningHoursSpecification: [{ dayOfWeek: "Monday" }] }]) {
    assert.equal(normalizeSchemaOrgOpeningHours(fullWeek(override)), null);
    assert.equal(normalizeSchemaOrgOpeningHours({ openingHours: "24/7", ...override }), null);
  }
  assert.equal(normalizeSchemaOrgOpeningHours({ openingHours: "24/7", openingHoursSpecification: fullWeek().openingHoursSpecification }), null,
    "two schedule representations require reconciliation rather than first-field wins");
});
