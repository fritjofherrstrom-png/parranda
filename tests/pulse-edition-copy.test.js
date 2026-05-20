const assert = require("node:assert/strict");
const test = require("node:test");

const { translate } = require("../server/ui-i18n");

// Edition label and meta copy are user-facing and used to leak internal
// jargon ("EDITION", "nivåer"). These tests pin the new copy so the
// strings don't silently regress.

test("Edition label SV uses IDAG instead of Edition", () => {
  assert.equal(translate("sv", "pulse.firstPaintEdition"), "IDAG");
});

test("Edition label EN uses TODAY instead of Edition", () => {
  assert.equal(translate("en", "pulse.firstPaintEdition"), "TODAY");
});

test("meta signals-only key exists and replaces {signals}", () => {
  assert.equal(
    translate("sv", "pulse.metaSignals", { signals: 4 }),
    "4 signaler idag",
  );
  assert.equal(
    translate("en", "pulse.metaSignals", { signals: 4 }),
    "4 signals today",
  );
});

test("meta signals-with-live key exists and replaces {signals} and {live}", () => {
  assert.equal(
    translate("sv", "pulse.metaSignalsWithLive", { signals: 4, live: 1 }),
    "4 signaler · 1 live",
  );
  assert.equal(
    translate("en", "pulse.metaSignalsWithLive", { signals: 4, live: 1 }),
    "4 signals · 1 live",
  );
});

test("metaSignalsZero returns 'Inga signaler idag' / 'No signals today'", () => {
  assert.equal(translate("sv", "pulse.metaSignalsZero"), "Inga signaler idag");
  assert.equal(translate("en", "pulse.metaSignalsZero"), "No signals today");
});

test("emptyHardHeadline interpolates city name in SV and EN", () => {
  assert.equal(
    translate("sv", "pulse.emptyHardHeadline", { city: "Barcelona" }),
    "Vi har inte Barcelona på riktigt än",
  );
  assert.equal(
    translate("en", "pulse.emptyHardHeadline", { city: "Barcelona" }),
    "We don't have Barcelona for real yet",
  );
});

test("emptyHardSubhead interpolates city name in SV and EN", () => {
  const sv = translate("sv", "pulse.emptyHardSubhead", { city: "Barcelona" });
  const en = translate("en", "pulse.emptyHardSubhead", { city: "Barcelona" });
  assert.match(sv, /Vi har inget lokalt lager för Barcelona/);
  assert.match(sv, /riktiga platser, rytm och signaler/);
  assert.match(en, /There is no local layer for Barcelona yet/);
  assert.match(en, /real places, rhythm, and signals/);
});

test("emptySoftHeadline interpolates city name in SV and EN", () => {
  assert.equal(
    translate("sv", "pulse.emptySoftHeadline", { city: "Barcelona" }),
    "Inget sticker ut i Barcelona just nu",
  );
  assert.equal(
    translate("en", "pulse.emptySoftHeadline", { city: "Barcelona" }),
    "Nothing standing out in Barcelona right now",
  );
});

test("emptySoftSubhead is present and action-oriented in SV and EN", () => {
  const sv = translate("sv", "pulse.emptySoftSubhead");
  const en = translate("en", "pulse.emptySoftSubhead");
  assert.match(sv, /Inga starka live-händelser/);
  assert.match(sv, /Du kan fortfarande bygga dagen/);
  assert.match(en, /No strong live events/);
  assert.match(en, /You can still build the day/);
});

test("empty-state keys contain no internal jargon", () => {
  const keys = [
    "pulse.emptyHardHeadline",
    "pulse.emptyHardSubhead",
    "pulse.emptySoftHeadline",
    "pulse.emptySoftSubhead",
  ];
  for (const key of keys) {
    for (const lang of ["sv", "en"]) {
      const value = translate(lang, key, { city: "X" });
      assert.doesNotMatch(value, /city-core/i, `${key} (${lang}) must not contain 'city-core'`);
      assert.doesNotMatch(value, /curated/i, `${key} (${lang}) must not contain 'curated'`);
      assert.doesNotMatch(value, /editorial/i, `${key} (${lang}) must not contain 'editorial'`);
      assert.doesNotMatch(value, /noop/i, `${key} (${lang}) must not contain 'noop'`);
      assert.doesNotMatch(value, /citypack/i, `${key} (${lang}) must not contain 'citypack'`);
      assert.doesNotMatch(value, /provider/i, `${key} (${lang}) must not contain 'provider'`);
      assert.doesNotMatch(value, /diagnostics/i, `${key} (${lang}) must not contain 'diagnostics'`);
    }
  }
});

test("legacy 'nivåer' / 'levels' key still exists for one-release compat but is not used in active surfaces", () => {
  // We keep the key so older client bundles don't crash on lookup,
  // but the active rendering uses metaSignals / metaSignalsWithLive.
  // This test simply pins that the key remains addressable.
  const sv = translate("sv", "pulse.meta", { signals: 4, levels: 2 });
  const en = translate("en", "pulse.meta", { signals: 4, levels: 2 });
  assert.match(sv, /nivåer/);
  assert.match(en, /levels/);
});
