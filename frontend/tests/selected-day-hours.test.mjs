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

test("all-day is explicit while unknown, closed, and malformed facts stay silent", () => {
  assert.equal(
    selectedDayHoursLabel({ status: "known", all_day: true, windows: [] }, "sv"),
    "Källans tider för vald dag: hela dygnet",
  );
  assert.equal(selectedDayHoursLabel({ status: "unknown", windows: [] }, "en"), null);
  assert.equal(selectedDayHoursLabel({ status: "closed", windows: [] }, "en"), null);
  assert.equal(
    selectedDayHoursLabel({ status: "known", windows: [{ opens: "payload", closes: "18:00" }] }, "en"),
    null,
  );
  assert.equal(
    selectedDayHoursLabel({ status: "known", windows: [{ opens: "10:00", closes: "24:30" }] }, "en"),
    null,
  );
});

test("selected-day copy never claims live availability", () => {
  const rendered = selectedDayHoursLabel(
    { status: "known", windows: [{ opens: "09:00", closes: "17:00" }] },
    "en",
  );
  assert.doesNotMatch(rendered, /open now|currently open|live/i);
});
