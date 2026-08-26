/**
 * Shareable day links — encode/decode the day's INPUTS (never results) so a link
 * round-trips to the same auto-plan, and only whitelisted preferences survive.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { encodeShareParams, buildShareUrl, decodeShareParams } from "../src/lib/anywhere-share.mjs";

test("encode → decode round-trips the day inputs", () => {
  const inputs = { place: "Lyon", preferences: ["food", "views"], dayOffset: 1, walkKey: "long", lang: "sv" };
  const decoded = decodeShareParams(encodeShareParams(inputs));
  assert.equal(decoded.place, "Lyon");
  assert.deepEqual(decoded.preferences, ["food", "views"]);
  assert.equal(decoded.dayOffset, 1);
  assert.equal(decoded.walkKey, "long");
  assert.equal(decoded.lang, "sv");
});

test("a curated city share preserves its bounded citypack identity", () => {
  const query = encodeShareParams({ city: "barcelona", place: "Barcelona", lang: "en" });
  const decoded = decodeShareParams(query);
  assert.equal(decoded.city, "barcelona");
  assert.equal(decoded.place, "Barcelona");
  assert.equal(decodeShareParams("?city=../../rome&place=Rome").city, null);
});

test("defaults are omitted from the URL and restored on decode", () => {
  const qs = encodeShareParams({ place: "Porto", preferences: [], dayOffset: 0, walkKey: "balanced", lang: "en" });
  assert.ok(!qs.includes("day="), "today is the default → no day param");
  assert.ok(!qs.includes("km="), "balanced is the default → no km param");
  assert.ok(!qs.includes("prefs="), "no prefs → no prefs param");
  const decoded = decodeShareParams(qs);
  assert.equal(decoded.dayOffset, 0);
  assert.equal(decoded.walkKey, "balanced");
});

test("buildShareUrl produces an /anywhere link on the given origin", () => {
  const url = buildShareUrl("https://parranda.app/", { place: "Kyoto", lang: "en" });
  assert.match(url, /^https:\/\/parranda\.app\/anywhere\?/);
  assert.match(url, /place=Kyoto/);
  assert.match(url, /planner=open/);
});

test("decode drops non-whitelisted preferences and bad values (never trusts the URL blindly)", () => {
  const decoded = decodeShareParams("place=X&prefs=food,evil_inject,views&km=999&day=7", ["food", "views", "culture"]);
  assert.deepEqual(decoded.preferences, ["food", "views"], "unknown pref key dropped");
  assert.equal(decoded.walkKey, "balanced", "bad km falls back");
  assert.equal(decoded.dayOffset, 0, "bad day falls back to today");
});

test("only INPUTS are encoded — never composed results", () => {
  const qs = encodeShareParams({ place: "Lyon", preferences: ["food"] });
  assert.ok(!/district|stop|event|safeResponse/i.test(qs), "no result data leaks into the link");
});
