import assert from "node:assert/strict";
import test from "node:test";

import { STOP_CATEGORY_FAMILIES, stopCategoryFamily } from "../src/lib/stop-category.mjs";
import { componentSource } from "./helpers/planner-source.mjs";

test("every kind the surface has words for also has a family symbol", () => {
  const copy = componentSource("planner/copy.ts");
  const block = copy.slice(copy.indexOf("export const TYPE_LABELS"), copy.indexOf("};", copy.indexOf("export const TYPE_LABELS")));
  const kinds = [...block.matchAll(/^\s+"?([a-z_-]+)"?: \{ sv:/gm)].map((m) => m[1]);
  assert.ok(kinds.length > 30, `read ${kinds.length} kinds`);
  for (const kind of kinds) {
    assert.ok(STOP_CATEGORY_FAMILIES.includes(stopCategoryFamily(kind)), `${kind} has a family`);
  }
});

test("an unknown or missing kind has no family, never a guessed one", () => {
  assert.equal(stopCategoryFamily("not-a-kind"), null);
  assert.equal(stopCategoryFamily(undefined), null);
  assert.equal(stopCategoryFamily(""), null);
});
