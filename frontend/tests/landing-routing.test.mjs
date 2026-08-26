/**
 * Landing search routing — the same product contract as the current landing:
 * registered city → modern planner with citypack identity; anything else →
 * freeform any-city intake; empty → nothing. Pure + deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { curatedCityHref, inlineCompletion, routeForInput } from "../src/lib/landing-routing.mjs";

const landingSource = readFileSync(new URL("../src/components/LandingHero.tsx", import.meta.url), "utf8");

const REGISTRY = {
  barcelona: { key: "barcelona", label: "Barcelona", status: "beta" },
  bcn: { key: "barcelona", label: "Barcelona", status: "beta" },
  rome: { key: "rome", label: "Rome", status: "public" },
  rom: { key: "rome", label: "Rome", status: "public" },
};

test("a registered city or exact alias keeps citypack curation on the modern planner", () => {
  const exact = routeForInput(REGISTRY, "Barcelona", "sv");
  assert.equal(exact.type, "city");
  assert.equal(exact.href, "/anywhere?city=barcelona&place=Barcelona&planner=open&lang=sv");

  const alias = routeForInput(REGISTRY, "bcn", "en");
  assert.equal(alias.href, "/anywhere?city=barcelona&place=Barcelona&planner=open&lang=en");
  assert.equal(curatedCityHref(REGISTRY.rome, "en"), "/anywhere?city=rome&place=Rome&planner=open&lang=en");
});

test("the frontpage Extra curated chips cannot link back into a legacy city shell", () => {
  assert.match(landingSource, /href=\{curatedCityHref\(city, lang\)/);
  assert.doesNotMatch(landingSource, /href=\{`\/\$\{city\.key\}/);
});

test("loose and short prefixes stay freeform until an inline completion is accepted", () => {
  for (const value of ["b", "ba", "Barc", "a", "at"]) {
    const route = routeForInput(REGISTRY, value, "en");
    assert.equal(route.type, "anywhere", `${value} must not be promoted to a curated city`);
    assert.equal(new URL(`https://x${route.href}`).searchParams.get("place"), value);
  }
});

test("any other place routes to the any-city planner as a freeform place (never a city key)", () => {
  const r = routeForInput(REGISTRY, "Malmö", "sv");
  assert.equal(r.type, "anywhere");
  const u = new URL(`https://x${r.href}`);
  assert.equal(u.pathname, "/anywhere");
  assert.equal(u.searchParams.get("place"), "Malmö");
  assert.equal(u.searchParams.get("planner"), "open");
  assert.equal(u.searchParams.get("lang"), "sv");
});

test("empty input routes nowhere; bad lang falls back to en", () => {
  assert.equal(routeForInput(REGISTRY, "   "), null);
  const r = routeForInput(REGISTRY, "Kyoto", "fr");
  assert.equal(new URL(`https://x${r.href}`).searchParams.get("lang"), "en");
});

test("inline completion completes a label prefix in place ('Barc' → 'Barcelona'), never shrinks", () => {
  assert.equal(inlineCompletion(REGISTRY, "Barc"), "Barcelona");
  assert.equal(inlineCompletion(REGISTRY, "B"), null, "one character is too ambiguous");
  assert.equal(inlineCompletion(REGISTRY, "Ba"), null, "two characters are too ambiguous");
  assert.equal(inlineCompletion(REGISTRY, "Barcelona"), null, "already complete");
  assert.equal(inlineCompletion(REGISTRY, "Malm"), null, "unknown place → no completion");
  assert.equal(inlineCompletion(REGISTRY, ""), null);
});

test("inline completion requires one unique matching city key", () => {
  const aliasesForOneCity = {
    ...REGISTRY,
    barceloneta: { key: "barcelona", label: "Barcelona", status: "beta" },
  };
  assert.equal(inlineCompletion(aliasesForOneCity, "Barc"), "Barcelona");

  const ambiguous = {
    ...REGISTRY,
    barletta: { key: "barletta", label: "Barletta", status: "preview" },
  };
  assert.equal(inlineCompletion(ambiguous, "Bar"), null, "shared prefix across cities stays silent");
  assert.equal(routeForInput(ambiguous, "Bar", "en").href, "/anywhere?place=Bar&planner=open&lang=en");
});

test("a null/absent registry treats everything as freeform (empty-registry dev mode)", () => {
  const r = routeForInput(null, "Barcelona", "en");
  assert.equal(r.type, "anywhere", "no registry → no curated routing, everything composes live");
});
