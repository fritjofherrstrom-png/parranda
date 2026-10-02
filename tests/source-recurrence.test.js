"use strict";

// The closed recurrence grammar, read directly. Every refusal is paired with a
// control the grammar accepts, so a refusal cannot pass merely because nothing
// is read at all. Expected dates were checked against an independent calendar.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  listedDatesFromText,
  resolveLabelledSchedule,
  resolveSchedulePattern,
  statesDailyOccurrence,
} = require("../server/pulse-sources/source-recurrence");

// The template lead-in real Sitevision event pages print before the rule.
const LEAD_IN = "Detta evenemang äger rum";
const AFTERNOON = { start: { hour: 13, minute: 0 }, end: { hour: 14, minute: 30 } };
const EVENING = { start: { hour: 18, minute: 0 }, end: { hour: 21, minute: 0 } };
const THURSDAYS = ["2026-06-25", "2026-07-02", "2026-07-09", "2026-07-16"];

function dateParts(key) {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), day: Number(key.slice(8, 10)) };
}

// A readable recurrence section beside an explicit range and one session
// clock, as a Sitevision detail page hands them over.
function recurrence(text, { from = "2026-09-07", to = "2026-12-17", time = AFTERNOON } = {}) {
  return resolveSchedulePattern(text, {
    range: { start: dateParts(from), end: dateParts(to) },
    explicitRange: true,
    time,
    statesDaily: false,
    present: true,
    complete: true,
  });
}

// The three weekly statements captured on 2026-09-26 (see
// tests/fixtures/sitevision-2026-09-26), as the adapter joins their lines.
const CAPTURED_WEEKLY = [
  {
    text: `${LEAD_IN}; varje måndag och torsdag`,
    from: "2026-09-07",
    to: "2026-12-17",
    dates: [
      "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21", "2026-09-24",
      "2026-09-28", "2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15",
      "2026-10-19", "2026-10-22", "2026-10-26", "2026-10-29", "2026-11-02", "2026-11-05",
      "2026-11-09", "2026-11-12", "2026-11-16", "2026-11-19", "2026-11-23", "2026-11-26",
      "2026-11-30", "2026-12-03", "2026-12-07", "2026-12-10", "2026-12-14", "2026-12-17",
    ],
  },
  {
    text: `${LEAD_IN}; varje måndag`,
    from: "2026-08-24",
    to: "2026-12-07",
    dates: [
      "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28",
      "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09",
      "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07",
    ],
  },
  {
    text: `${LEAD_IN}; varje tisdag`,
    from: "2026-09-08",
    to: "2026-11-17",
    dates: [
      "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13",
      "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17",
    ],
  },
];

test("a recurrence statement may open with the template lead-in", () => {
  for (const { text, from, to, dates } of CAPTURED_WEEKLY) {
    const result = recurrence(text, { from, to });
    assert.equal(result.mode, "listed", text);
    assert.deepEqual(result.dates, dates, text);
    // The lead-in adds no days: the rule alone reads the same.
    assert.deepEqual(recurrence(text.slice(`${LEAD_IN}; `.length), { from, to }), result, text);
  }
  // The lead-in on the rule's own line.
  assert.deepEqual(recurrence(`${LEAD_IN} varje måndag och torsdag`).dates, CAPTURED_WEEKLY[0].dates);
  // It widens no bound: a weekday rule over more than 120 days is not expanded.
  assert.equal(recurrence(`${LEAD_IN}; varje måndag`, { from: "2026-01-01", to: "2026-06-30" }).mode, "unresolved");
  assert.equal(recurrence(`${LEAD_IN}; varje måndag`, { from: "2026-01-01", to: "2026-04-30" }).mode, "listed");
});

test("the lead-in alone states no days", () => {
  for (const text of [LEAD_IN, `${LEAD_IN};`, `${LEAD_IN}: på`]) {
    const result = recurrence(text);
    assert.equal(result.mode, "unresolved", text);
    assert.equal(result.dates, undefined, text);
  }
  assert.equal(recurrence(`${LEAD_IN}; varje måndag`).mode, "listed");
});

test("the lead-in is read only as the whole opening phrase", () => {
  const refused = [
    `Varje måndag; ${LEAD_IN}`, // after the rule
    `${LEAD_IN}; ${LEAD_IN} varje måndag`, // repeated
    "Detta evenemang varje måndag", // partial
    "Evenemang äger rum varje måndag",
    `${LEAD_IN}varje måndag`, // not a whole word
  ];
  // None of its words is filler: alone, before or after the rule, each fails.
  for (const word of ["detta", "evenemang", "äger", "rum"]) {
    refused.push(`${word} varje måndag`, `varje måndag ${word}`);
  }
  for (const text of refused) {
    assert.equal(recurrence(text).mode, "unresolved", text);
  }
  const control = recurrence(`${LEAD_IN} varje måndag`);
  assert.equal(control.mode, "listed");
  assert.deepEqual(control, recurrence("varje måndag"));
});

test("every other week stays unresolved with or without the lead-in", () => {
  // The source does not say which weeks; the range start is not that evidence.
  const range = { from: "2026-09-15", to: "2026-12-08" };
  for (const text of ["Varannan tisdag", `${LEAD_IN} varannan tisdag`, `${LEAD_IN}; varannan; tisdag`]) {
    const result = recurrence(text, range);
    assert.equal(result.mode, "unresolved", text);
    assert.equal(result.dates, undefined, text);
  }
  // The captured shape with "varje" instead: every Tuesday of the range.
  const control = recurrence(`${LEAD_IN}; varje; tisdag`, range);
  assert.equal(control.mode, "listed");
  assert.deepEqual(control.dates, [
    "2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27",
    "2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08",
  ]);
});

test("statements without the lead-in read as before", () => {
  const summer = { from: "2026-06-25", to: "2026-07-16", time: EVENING };
  const cases = [
    ["Varje torsdag", "listed", THURSDAYS],
    ["Torsdagar kl. 18.00–21.00", "listed", THURSDAYS],
    ["torsdag 25 juni, torsdag 2 juli, torsdag 9 juli, torsdag 16 juli", "listed", THURSDAYS],
    ["25 juni samt 2, 9 och 16 juli", "listed", THURSDAYS],
    ["Måndag till söndag", "daily"],
    ["Dagligen", "daily"],
    ["Varannan torsdag", "unresolved"],
    ["Dagligen utom måndag", "unresolved"],
    ["fredag 25 juni", "unresolved"],
    ["Torsdagar kl. 17.00–20.00", "unresolved"],
    ["Se programmet för aktuella datum.", "unresolved"],
  ];
  for (const [text, mode, dates] of cases) {
    const result = recurrence(text, summer);
    assert.equal(result.mode, mode, text);
    assert.deepEqual(result.dates, dates, text);
  }
});

test("date and time labels still refuse the lead-in", () => {
  // Only a recurrence section opens with it. Date and time labels (a Wix "När"
  // or "Tid", a Sitevision "Datum och tid") gain nothing from this rule.
  assert.equal(listedDatesFromText(`${LEAD_IN} 15 juli, 22 juli`, "2026-07-15"), null);
  assert.deepEqual(listedDatesFromText("15 juli, 22 juli", "2026-07-15")?.dates, ["2026-07-15", "2026-07-22"]);

  const labelled = (dateText) => resolveLabelledSchedule({
    dateText,
    timeText: "18.00–21.00",
    range: { start: dateParts("2026-07-06"), end: dateParts("2026-07-27") },
    time: EVENING,
  });
  assert.equal(labelled(`${LEAD_IN} varje måndag`).mode, "unresolved");
  assert.deepEqual(labelled("varje måndag").dates, ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);

  assert.equal(statesDailyOccurrence(`${LEAD_IN} dagligen`), false);
  assert.equal(statesDailyOccurrence("dagligen"), true);
});
