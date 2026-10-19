import test from "node:test";
import assert from "node:assert/strict";
import { stopHoursUnknown, stopTypeLabel, stopWebsiteUrl } from "../src/lib/stop-card-facts.mjs";

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

test("source-closed days are known rather than missing opening hours", () => {
  assert.equal(stopHoursUnknown({ type: "museum", selected_day_hours: { status: "closed", windows: [] } }), false);
});

test("a stop website accepts source-owned absolute HTTP(S) URLs", () => {
  for (const website of ["https://museum.example/visit?day=saturday#hours", "http://cafe.example/"]) {
    assert.equal(stopWebsiteUrl({ website }), website);
  }
  assert.equal(stopWebsiteUrl({ website: "  https://museum.example/  " }), "https://museum.example/");
});

test("website links reject malformed, relative, credentialed and non-HTTP destinations", () => {
  for (const website of [undefined, null, "", "/visit", "//museum.example/", "javascript:alert(1)",
    "data:text/html,hello", "https:example.org", "https://", "https://user:secret@museum.example/",
    "https://museum.example/a\nb", "https://museum.example\\@other.example/", { href: "https://museum.example/" }]) {
    assert.equal(stopWebsiteUrl({ website }), null, String(website));
  }
  assert.equal(stopWebsiteUrl({ source: { url: "https://www.openstreetmap.org/node/42" } }), null,
    "source attribution cannot stand in for a venue website");
});

test("saved stop websites keep the server's 2048-character boundary", () => {
  const base = "https://museum.example/";
  const website = base + "a".repeat(2048 - base.length);
  assert.equal(stopWebsiteUrl({ website }), website);
  assert.equal(stopWebsiteUrl({ website: website + "a" }), null);
  assert.equal(stopWebsiteUrl({ website: base + "ä".repeat(338) }), null,
    "the normalized destination must also stay inside the source-website bound");
});

test("regular hours do not promote an unknown selected day to confirmed hours", () => {
  const selected_day_hours = { status: "unknown", all_day: false, windows: [], ordinary_status: "known",
    ordinary_windows: [{ opens: "06:30", closes: "18:00" }], uncertainty: "holiday_exceptions",
    date: "2026-10-16", timezone: "Europe/Stockholm", source_url: "https://museum.example/visit",
    observed_at: "2026-10-15T10:00:00.000Z" };
  assert.equal(stopHoursUnknown({ type: "museum", selected_day_hours }), true);
  assert.equal(stopHoursUnknown({ type: "museum", selected_day_hours: {
    ...selected_day_hours, ordinary_status: "closed", ordinary_windows: [] } }), true);
});
