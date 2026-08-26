import test from "node:test";
import assert from "node:assert/strict";
import { classifyCuratedCityResult } from "../src/lib/curated-city-decision.mjs";

const route = [{ id: "bcn-market", name: "Mercat" }];

test("an exact server-confirmed citypack day is safe for the modern planner", () => {
  const result = classifyCuratedCityResult(
    {
      city: "barcelona",
      city_label: "Barcelona",
      requested_city: "barcelona",
      city_fallback_used: false,
      days: [{ primary_route: { main_stops: route } }],
    },
    { city: "barcelona", label: "Spoofed label" },
  );
  assert.equal(result.status, "composed");
  assert.equal(result.placeLabel, "Barcelona");
});

test("curated mode fails closed on fallback, identity mismatch, or an empty day", () => {
  for (const body of [
    { city: "rome", city_label: "Rom", requested_city: "barcelona", city_fallback_used: true, days: [{ primary_route: { main_stops: route } }] },
    { city: "rome", city_label: "Rom", requested_city: "rome", city_fallback_used: false, days: [{ primary_route: { main_stops: route } }] },
    { city: "barcelona", city_label: "Barcelona", requested_city: "barcelona", city_fallback_used: false, days: [] },
    { city: "barcelona", requested_city: "barcelona", city_fallback_used: false, days: [{ primary_route: { main_stops: route } }] },
  ]) {
    assert.equal(classifyCuratedCityResult(body, { city: "barcelona", label: "Barcelona" }).status, "unavailable");
  }
});