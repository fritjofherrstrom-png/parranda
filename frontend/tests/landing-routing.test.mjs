/**
 * Landing search routing — the same product contract as the current landing:
 * registered city → curated shell (URL contract unchanged); anything else →
 * the any-city planner; empty → nothing. Pure + deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolveEntryLoose, inlineCompletion, routeForInput } from "../src/lib/landing-routing.mjs";

const REGISTRY = {
  barcelona: { key: "barcelona", label: "Barcelona", status: "beta" },
  bcn: { key: "barcelona", label: "Barcelona", status: "beta" },
  rome: { key: "rome", label: "Rome", status: "public" },
  rom: { key: "rome", label: "Rome", status: "public" },
};

test("a registered city (exact alias or prefix) routes to its curated shell — URL contract unchanged", () => {
  const exact = routeForInput(REGISTRY, "Barcelona", "sv");
  assert.equal(exact.type, "city");
  assert.equal(exact.href, "/barcelona?planner=open&lang=sv");

  const prefix = routeForInput(REGISTRY, "Barc", "en");
  assert.equal(prefix.type, "city");
  assert.match(prefix.href, /^\/barcelona\?/);

  const alias = routeForInput(REGISTRY, "bcn", "en");
  assert.equal(alias.href.split("?")[0], "/barcelona");
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
  assert.equal(inlineCompletion(REGISTRY, "Barcelona"), null, "already complete");
  assert.equal(inlineCompletion(REGISTRY, "Malm"), null, "unknown place → no completion");
  assert.equal(inlineCompletion(REGISTRY, ""), null);
});

test("prefix resolution prefers label-prefix and higher status, deterministically", () => {
  const both = {
    ...REGISTRY,
    romaville: { key: "romaville", label: "Romaville", status: "preview" },
  };
  // "rom" matches Rome (public, label prefix, shorter) over Romaville (preview).
  assert.equal(resolveEntryLoose(both, "rom").key, "rome");
});

test("a null/absent registry treats everything as freeform (empty-registry dev mode)", () => {
  const r = routeForInput(null, "Barcelona", "en");
  assert.equal(r.type, "anywhere", "no registry → no curated routing, everything composes live");
});
