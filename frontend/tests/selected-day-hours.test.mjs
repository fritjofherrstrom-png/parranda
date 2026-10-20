import test from "node:test";
import assert from "node:assert/strict";
import { selectedDayHoursLabel } from "../src/lib/selected-day-hours.mjs";

test("selected-day hours render bounded source facts in sv/en without open-now claims", () => {
  const fact = {
    status: "known",
    all_day: false,
    windows: [
      { opens: "10:00", closes: "14:00" },
      { opens: "18:00", closes: "24:00" },
    ],
  };
  assert.equal(selectedDayHoursLabel(fact, "sv"), "Källans tider för vald dag: 10:00–14:00, 18:00–24:00");
  assert.equal(selectedDayHoursLabel(fact, "en"), "Source hours for selected day: 10:00–14:00, 18:00–24:00");
});

test("all-day is explicit while unknown and malformed facts stay silent", () => {
  assert.equal(
    selectedDayHoursLabel({ status: "known", all_day: true, windows: [] }, "sv"),
    "Källans tider för vald dag: hela dygnet",
  );
  assert.equal(selectedDayHoursLabel({ status: "unknown", windows: [] }, "en"), null);
  assert.equal(
    selectedDayHoursLabel({ status: "known", windows: [{ opens: "payload", closes: "18:00" }] }, "en"),
    null,
  );
  assert.equal(
    selectedDayHoursLabel({ status: "known", windows: [{ opens: "10:00", closes: "24:30" }] }, "en"),
    null,
  );
});

test("an explicit source-closed day stays distinct from missing hours", () => {
  const closed = { status: "closed", all_day: false, windows: [] };
  assert.equal(selectedDayHoursLabel(closed, "sv"), "Källan anger stängt för vald dag");
  assert.equal(selectedDayHoursLabel(closed, "en"), "Source reports closed for selected day");
});

test("selected-day copy never claims live availability", () => {
  const rendered = selectedDayHoursLabel(
    { status: "known", windows: [{ opens: "09:00", closes: "17:00" }] },
    "en",
  );
  assert.doesNotMatch(rendered, /open now|currently open|live/i);
});

const ordinary = {
  status: "unknown", all_day: false, windows: [], ordinary_status: "known",
  ordinary_windows: [{ opens: "06:30", closes: "18:00" }], uncertainty: "holiday_exceptions",
  date: "2026-10-16", timezone: "Europe/Stockholm", source_url: "https://museum.example/visit",
  observed_at: "2026-10-15T10:00:00.000Z",
};

test("conditional hours show the regular schedule while the selected day stays unconfirmed", () => {
  assert.equal(selectedDayHoursLabel(ordinary, "en"), "Regular hours: 06:30–18:00 · Holiday hours unconfirmed");
  assert.equal(selectedDayHoursLabel(ordinary, "sv"), "Ordinarie tider: 06:30–18:00 · Helgdagstider ej bekräftade");
  assert.equal(selectedDayHoursLabel({ ...ordinary, uncertainty: "unresolved_conditions" }, "en"),
    "Regular hours: 06:30–18:00 · Selected day unconfirmed");
  assert.equal(selectedDayHoursLabel({ ...ordinary, uncertainty: "unresolved_conditions" }, "sv"),
    "Ordinarie tider: 06:30–18:00 · Vald dag ej bekräftad");
});

test("ordinary closed never becomes a confirmed closure for the selected day", () => {
  const closed = { ...ordinary, ordinary_status: "closed", ordinary_windows: [] };
  assert.equal(selectedDayHoursLabel(closed, "en"), "Regular hours: closed · Holiday hours unconfirmed");
  assert.equal(selectedDayHoursLabel(closed, "sv"), "Ordinarie tider: stängt · Helgdagstider ej bekräftade");
  assert.doesNotMatch(selectedDayHoursLabel(closed, "en"), /Source reports closed|open now|currently open/i);
});

test("malformed or unsafe conditional facts never publish a partial regular schedule", () => {
  const invalid = [
    { all_day: true }, { windows: [{ opens: "06:30", closes: "18:00" }] },
    { ordinary_status: "payload" }, { ordinary_windows: [] },
    { ordinary_windows: [{ opens: "06:30", closes: "18:00" }, { opens: "payload", closes: "18:00" }] },
    { ordinary_status: "closed" }, { uncertainty: "<b>payload</b>" },
    { date: "2026-02-30" }, { timezone: "payload" }, { source_url: "javascript:alert(1)" },
    { source_url: "https://user:secret@museum.example/" }, { observed_at: "not a date" },
    { observed_at: "2026-10-15T10:00:00" }, { observed_at: "2026-02-30T10:00:00.000Z" },
    { ordinary_windows: [{ opens: "18:00", closes: "06:30" }] },
    { ordinary_windows: Array.from({ length: 5 }, () => ({ opens: "06:30", closes: "18:00" })) },
  ];
  for (const extra of invalid) assert.equal(selectedDayHoursLabel({ ...ordinary, ...extra }, "en"), null, JSON.stringify(extra));
  for (const key of ["all_day", "windows", "ordinary_status", "ordinary_windows", "uncertainty", "date", "timezone", "source_url", "observed_at"]) {
    const fact = { ...ordinary };
    delete fact[key];
    assert.equal(selectedDayHoursLabel(fact, "en"), null, key);
  }
});
