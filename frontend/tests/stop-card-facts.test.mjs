import test from "node:test";
import assert from "node:assert/strict";
import { stopHoursUnknown, stopTypeLabel } from "../src/lib/stop-card-facts.mjs";

const secondHand = (category) => ({ type: "vintage-shop", source: category ? { label: "osm", category } : { label: "osm" } });

test("a second-hand stop names the source's own narrower category", () => {
  assert.equal(stopTypeLabel(secondHand("antiques"), "sv"), "Antik");
  assert.equal(stopTypeLabel(secondHand("antiques"), "en"), "Antiques");
  assert.equal(stopTypeLabel(secondHand("charity"), "en"), "Charity shop");
  assert.equal(stopTypeLabel(secondHand("vintage"), "en"), "Vintage");
  assert.equal(stopTypeLabel(secondHand("second_hand"), "sv"), "Second hand");
});

test("without a narrower source category the chip is the broad kind, never vintage", () => {
  // A used-games shop or an antiques hall filed as generic second hand must not
  // read as clothing vintage in either language.
  for (const stop of [secondHand(null), secondHand("second_hand"), secondHand("payload-supplied"), { type: "vintage-shop" }]) {
    assert.equal(stopTypeLabel(stop, "en"), "Second hand");
    assert.equal(stopTypeLabel(stop, "sv"), "Second hand");
    assert.doesNotMatch(stopTypeLabel(stop, "en"), /vintage/i);
  }
});

test("other stop kinds keep their labels, and unknown kinds show the engine token", () => {
  assert.equal(stopTypeLabel({ type: "museum" }, "sv"), "Museum");
  assert.equal(stopTypeLabel({ type: "cafe" }, "en"), "Café");
  assert.equal(stopTypeLabel({ type: "harbour" }, "en"), "harbour");
  assert.equal(stopTypeLabel({}, "en"), "");
});

test("hours are unknown for an hours-dependent stop whose source gives none for the day", () => {
  assert.equal(stopHoursUnknown({ type: "vintage-shop" }), true);
  assert.equal(stopHoursUnknown({ type: "vintage-shop", selected_day_hours: { status: "unknown", windows: [] } }), true);
  assert.equal(stopHoursUnknown({ type: "museum", selected_day_hours: { status: "known", windows: [{ opens: "payload", closes: "18:00" }] } }), true);
  assert.equal(
    stopHoursUnknown({ type: "vintage-shop", selected_day_hours: { status: "known", windows: [{ opens: "11:00", closes: "16:00" }] } }),
    false,
    "a source-backed schedule for the selected day is known",
  );
  assert.equal(stopHoursUnknown({ type: "park" }), false, "a park's visit does not depend on opening hours");
  assert.equal(stopHoursUnknown({ type: "viewpoint" }), false);
});
