const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const Render = require("../dogfood-render");
const { translations } = require("../server/ui-i18n");

const DOGFOOD_CLIENT_SOURCE = fs.readFileSync(path.join(__dirname, "..", "dogfood.js"), "utf8");
const I18N = { lang: "en", strings: translations.en };

function experimentWith(engineReadiness) {
  return { agnostic_route_output_experiment: { engine_readiness: engineReadiness } };
}

// --- pure: buildEngineReadinessSummary -------------------------------------

test("pure: eligible engine verdict renders an eligible decision + engine path + applied daypart", () => {
  const view = Render.buildExperimentView(
    experimentWith({
      engine_path_active: true,
      synthesized_via: "agnostic_compose_engine",
      promotion_decision: "eligible",
      promotion_blockers: [],
      daypart: { applied: true, fallback: false, reason: "daypart_rhythm" },
      retirement_ready: true,
      remaining_for_default: [],
    }),
    I18N,
  );
  const r = view.engineReadiness;
  assert.ok(r);
  assert.equal(r.enginePathActive, true);
  assert.equal(r.decision, "eligible");
  assert.equal(r.decisionLabel, translations.en["dogfood.engine_readiness.decision.eligible"]);
  assert.equal(r.guide, translations.en["dogfood.engine_readiness.guide.eligible"]);
  assert.equal(r.retirementReady, true);
  assert.equal(r.daypart.caption, translations.en["dogfood.engine_readiness.daypart.applied"]);
  assert.deepEqual(r.remaining, []);
});

test("pure: blocked verdict surfaces remaining tiles with known + capped_by captions", () => {
  const view = Render.buildExperimentView(
    experimentWith({
      engine_path_active: true,
      synthesized_via: "agnostic_compose_engine",
      promotion_decision: "blocked",
      promotion_blockers: ["capped_by_thin_day", "status_not_promotable:blocked"],
      daypart: { applied: false, fallback: true, reason: "daypart_order_exceeded_walk_budget" },
      retirement_ready: false,
      remaining_for_default: ["capped_by_thin_day", "status_not_promotable:blocked"],
    }),
    I18N,
  );
  const r = view.engineReadiness;
  assert.equal(r.decision, "blocked");
  const byToken = Object.fromEntries(r.remaining.map((tile) => [tile.token, tile.caption]));
  // capped_by_* falls back to the calibration cap caption
  assert.equal(byToken["capped_by_thin_day"], translations.en["dogfood.calibration.cap.capped_by_thin_day"]);
  // suffixed token keys on its prefix
  assert.equal(byToken["status_not_promotable:blocked"], translations.en["dogfood.engine_readiness.remaining.status_not_promotable"]);
  // honest daypart fallback caption
  assert.equal(r.daypart.caption, translations.en["dogfood.engine_readiness.daypart.fallback"]);
});

test("pure: legacy path → not active, path.legacy caption, unknown decision", () => {
  const view = Render.buildExperimentView(
    experimentWith({
      engine_path_active: false,
      synthesized_via: null,
      promotion_decision: "unknown",
      promotion_blockers: [],
      daypart: null,
      retirement_ready: false,
      remaining_for_default: ["engine_path_not_active"],
    }),
    I18N,
  );
  const r = view.engineReadiness;
  assert.equal(r.enginePathActive, false);
  assert.equal(r.decision, "unknown");
  assert.equal(r.remaining[0].caption, translations.en["dogfood.engine_readiness.remaining.engine_path_not_active"]);
});

test("pure: no engine_readiness block → view.engineReadiness is null (back-compatible)", () => {
  const view = Render.buildExperimentView({ agnostic_route_output_experiment: {} }, I18N);
  assert.equal(view.engineReadiness, null);
});

test("pure: an unknown remaining token falls back honestly with the raw token visible", () => {
  const view = Render.buildExperimentView(
    experimentWith({
      engine_path_active: true,
      synthesized_via: "agnostic_compose_engine",
      promotion_decision: "blocked",
      remaining_for_default: ["future_remaining_token"],
    }),
    I18N,
  );
  assert.ok(view.engineReadiness.remaining[0].caption.includes("future_remaining_token"));
});

// --- i18n coverage ----------------------------------------------------------

test("i18n: every engine-readiness key exists in both sv and en", () => {
  const keys = new Set([
    "dogfood.engine_readiness.heading",
    "dogfood.engine_readiness.path.engine",
    "dogfood.engine_readiness.path.legacy",
    "dogfood.engine_readiness.daypart.applied",
    "dogfood.engine_readiness.daypart.fallback",
    "dogfood.engine_readiness.daypart.none",
    "dogfood.engine_readiness.remaining.unknown",
    ...Object.values(Render.ENGINE_READINESS_DECISION_KEYS),
    ...Object.values(Render.ENGINE_READINESS_REMAINING_KEYS),
  ]);
  for (const decision of Object.keys(Render.ENGINE_READINESS_DECISION_KEYS)) {
    keys.add(`dogfood.engine_readiness.guide.${decision}`);
  }
  for (const lang of ["sv", "en"]) {
    for (const key of keys) {
      assert.equal(typeof translations[lang][key], "string", `${lang} missing ${key}`);
      assert.ok(translations[lang][key].length > 0, `${lang} empty ${key}`);
    }
  }
});

// --- guards -----------------------------------------------------------------

test("guard: engine-readiness view text has no eta/best route/optimal/fastest/shortest", () => {
  const view = Render.buildExperimentView(
    experimentWith({
      engine_path_active: true,
      synthesized_via: "agnostic_compose_engine",
      promotion_decision: "blocked",
      daypart: { applied: false, fallback: true, reason: "daypart_order_exceeded_walk_budget" },
      remaining_for_default: ["capped_by_thin_day", "anchor_not_strong"],
    }),
    I18N,
  );
  const text = Render.flattenViewText(view);
  for (const banned of ["eta", "best route", "optimal", "fastest", "shortest"]) {
    const re = new RegExp("\\b" + banned.replace(/\s+/g, "\\s+") + "\\b", "i");
    assert.equal(re.test(text), false, `must not contain "${banned}"`);
  }
});

test("client: renderEngineReadiness exists, is invoked after calibration, avoids innerHTML", () => {
  assert.match(
    DOGFOOD_CLIENT_SOURCE,
    /function renderEngineReadiness\(view\) \{[\s\S]*?textContent[\s\S]*?el\(/,
    "renderEngineReadiness must build text via el/textContent",
  );
  assert.match(
    DOGFOOD_CLIENT_SOURCE,
    /renderCalibration\(view\);\s*renderEngineReadiness\(view\);/,
    "engine readiness renders right after calibration",
  );
  const body = DOGFOOD_CLIENT_SOURCE.match(/function renderEngineReadiness\(view\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(body, /innerHTML\s*=/, "engine readiness renderer must not use innerHTML");
});
