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

test("legacy 'nivåer' / 'levels' key still exists for one-release compat but is not used in active surfaces", () => {
  // We keep the key so older client bundles don't crash on lookup,
  // but the active rendering uses metaSignals / metaSignalsWithLive.
  // This test simply pins that the key remains addressable.
  const sv = translate("sv", "pulse.meta", { signals: 4, levels: 2 });
  const en = translate("en", "pulse.meta", { signals: 4, levels: 2 });
  assert.match(sv, /nivåer/);
  assert.match(en, /levels/);
});
