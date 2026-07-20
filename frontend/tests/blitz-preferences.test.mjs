import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ANYWHERE_PREFERENCES } from "../src/lib/anywhere-payload.mjs";
import {
  BLITZ_PREFERENCE_BUNDLES,
  chooseBlitzPreferences,
} from "../src/lib/blitz-preferences.mjs";

const ALLOWED = new Set(ANYWHERE_PREFERENCES.map((preference) => preference.key));
const plannerSource = readFileSync(new URL("../src/components/AnywherePlanner.tsx", import.meta.url), "utf8");

test("Blitz bundles are coherent, canonical, and contain no duplicate axes", () => {
  assert.ok(BLITZ_PREFERENCE_BUNDLES.length >= 5);
  for (const bundle of BLITZ_PREFERENCE_BUNDLES) {
    assert.equal(bundle.preferences.length, 3, `${bundle.id} stays compact`);
    assert.equal(new Set(bundle.preferences).size, bundle.preferences.length, `${bundle.id} has no duplicates`);
    assert.ok(bundle.preferences.every((preference) => ALLOWED.has(preference)), `${bundle.id} uses canonical axes`);
  }
});

test("Blitz selection is deterministic with injected randomness and never mutates bundles", () => {
  const first = chooseBlitzPreferences({ random: () => 0 });
  const last = chooseBlitzPreferences({ random: () => 1 });

  assert.deepEqual(first, BLITZ_PREFERENCE_BUNDLES[0].preferences);
  assert.deepEqual(last, BLITZ_PREFERENCE_BUNDLES.at(-1).preferences);
  first.push("nightlife");
  assert.equal(BLITZ_PREFERENCE_BUNDLES[0].preferences.length, 3);
});

test("Blitz excludes the current bundle so consecutive runs do not repeat directly", () => {
  const current = [...BLITZ_PREFERENCE_BUNDLES[0].preferences].reverse();
  const next = chooseBlitzPreferences({ previous: current, random: () => 0 });

  assert.notDeepEqual([...next].sort(), [...current].sort());
  assert.deepEqual(next, BLITZ_PREFERENCE_BUNDLES[1].preferences);
});

test("the product Blitz control uses the coherent selector, not shuffled raw axes", () => {
  assert.match(plannerSource, /chooseBlitzPreferences\(\{ previous: selected \}\)/);
  assert.doesNotMatch(plannerSource, /sort\(\(\) => Math\.random\(\) - 0\.5\)/);
});
