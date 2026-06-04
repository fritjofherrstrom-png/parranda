/**
 * #248 Planner Reservoir QA / comparison scenarios.
 *
 * A truth-serum pass over the #246 inspect sidecar BEFORE the reservoir is
 * allowed to influence Planner output. QA-only: no production behavior changes.
 *
 * Two layers:
 *   - API: /api/route-recommendations (recognized citypacks Rome/Barcelona/
 *     Athens) — the inspect path. Unknown cities fall back to the default pack,
 *     so agnostic Malmö/Simrishamn are NOT reachable here (documented finding).
 *   - Helper: selectPlannerRoleCandidates + summarizeDayflowHonesty directly,
 *     for agnostic/sparse + lens behavior the API path cannot reach yet.
 *
 * Deterministic; mocked weather + injected loader; no live network.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compareInspectVsDefault,
  externalRecord,
  makeLoader,
  routeBody,
  roleByName,
  originsInRole,
} = require("./helpers/planner-reservoir-compare");

const { selectPlannerRoleCandidates } = require("../server/planner/role-selector");
const { summarizeDayflowHonesty } = require("../server/planner/dayflow-honesty");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");

const DATE = "2026-06-03";

// === 1. Rich citypack baseline (Rome / Barcelona) ==========================

test("Rome rich citypack: inspect stays rich and does not change the route", async () => {
  const { planner_roles } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic", "food"]),
  });
  assert.equal(planner_roles.density, "rich");
  assert.ok(planner_roles.summary);
  assert.ok(planner_roles.summary.by_status);
  // requested anchors fill from curated catalog
  assert.equal(roleByName(planner_roles, "scenic_anchor").status, "filled");
  assert.equal(roleByName(planner_roles, "food_anchor").status, "filled");
  assert.ok(originsInRole(planner_roles, "scenic_anchor").every((o) => o === "curated_catalog"));
});

test("Barcelona rich citypack stays rich under inspect", async () => {
  const { planner_roles, dayflow } = await compareInspectVsDefault({
    body: routeBody("barcelona", ["scenic", "food"]),
  });
  assert.equal(planner_roles.density, "rich");
  assert.ok(!dayflow.quality_flags.includes("thin_catalog_density"));
});

test("a rich citypack is NOT distorted even when external candidates are fetched", async () => {
  // The planner sidecar fetches open data on request for any city; curated-first
  // + curated-only density must keep Rome rich and curated-led regardless.
  const loader = makeLoader([externalRecord("ext-beach", "Open Beach", "beach", 41.73, 12.27, ["coast"])]);
  const { planner_roles, dayflow } = await compareInspectVsDefault({
    openDataLoader: loader,
    body: routeBody("rome", ["scenic", "food"]),
    query: "planner_inspect=1&include_external_candidates=1",
  });
  assert.equal(planner_roles.density, "rich", "external must not inflate density");
  assert.ok(!dayflow.quality_flags.includes("thin_catalog_density"));
  // curated still leads the requested anchors
  assert.ok(originsInRole(planner_roles, "scenic_anchor").includes("curated_catalog"));
});

// === 2. Athens — thin/beta city ============================================

test("Athens thin city: honest filled/missing, route untouched", async () => {
  const { planner_roles, dayflow } = await compareInspectVsDefault({
    body: routeBody("athens", ["scenic", "food", "swimming"]),
  });
  assert.equal(planner_roles.density, "thin");
  assert.ok(dayflow.quality_flags.includes("thin_catalog_density"));
  // curated covers scenic+food; Athens has no beach → swimming honestly missing
  assert.equal(roleByName(planner_roles, "swimming_coast_option").status, "missing");
  assert.equal(roleByName(planner_roles, "swimming_coast_option").candidates.length, 0);
  // a requested-but-missing role keeps the day below "full"
  assert.notEqual(dayflow.day_status, "full");
});

test("Athens external gap-fill: a trusted loader can fill a missing role", async () => {
  const loader = makeLoader([externalRecord("ath-beach", "Kavouri Beach", "beach", 37.82, 23.78, ["coast"])]);
  const { planner_roles } = await compareInspectVsDefault({
    openDataLoader: loader,
    body: routeBody("athens", ["swimming"]),
    query: "planner_inspect=1&include_external_candidates=1",
  });
  const swim = roleByName(planner_roles, "swimming_coast_option");
  assert.notEqual(swim.status, "missing");
  assert.ok((swim.candidates || []).some((c) => c.origin === "external_open"));
  // density stays thin — external augmentation never upgrades curation
  assert.equal(planner_roles.density, "thin");
});

// === Hotfix regression at API level ========================================

test("Rome + swimming preference reports the role as MISSING, never fallback (hotfix #247)", async () => {
  const { planner_roles, dayflow } = await compareInspectVsDefault({
    body: routeBody("rome", ["swimming"]),
  });
  const swim = roleByName(planner_roles, "swimming_coast_option");
  assert.equal(swim.status, "missing");
  assert.equal(swim.candidates.length, 0, "no unrelated places masquerading as fallback");
  assert.ok(dayflow.role_coverage.missing.includes("swimming_coast_option"));
});

// === 7. External candidate safety ==========================================

test("public payload.external_provider is ignored by the planner sidecar", async () => {
  const malicious = [externalRecord("evil-beach", "Fake Beach", "beach", 41.9, 12.5, ["coast"])];
  // No trusted loader; a payload-injected dataset must NOT reach the reservoir.
  const { planner_roles } = await compareInspectVsDefault({
    openDataLoader: null,
    body: routeBody("rome", ["swimming"], { external_provider: { dataset: malicious } }),
    query: "planner_inspect=1&include_external_candidates=1",
  });
  assert.equal(roleByName(planner_roles, "swimming_coast_option").status, "missing");
  assert.ok(planner_roles.source_status.some((s) => s.status === "no_loader_configured"));
});

test("a missing trusted loader fails closed with honest source_status", async () => {
  const { planner_roles } = await compareInspectVsDefault({
    openDataLoader: null,
    body: routeBody("athens", ["swimming"]),
    query: "planner_inspect=1&include_external_candidates=1",
  });
  assert.ok(planner_roles.source_status.some((s) => s.status === "no_loader_configured"));
});

test("a loader that throws fails closed and does not break the planner response", async () => {
  const throwingLoader = async () => {
    throw new Error("overpass down");
  };
  const { inspected, planner_roles } = await compareInspectVsDefault({
    openDataLoader: throwingLoader,
    body: routeBody("athens", ["swimming"]),
    query: "planner_inspect=1&include_external_candidates=1",
  });
  assert.ok(inspected.days, "route response intact despite loader failure");
  assert.ok(planner_roles.source_status.some((s) => s.status === "error_failed_closed"));
});

// === 4. Agnostic / sparse honesty (helper-level — not reachable via API) ====

test("agnostic sparse context stays honest: sparse, all roles missing, no fabrication", () => {
  const ctx = buildAgnosticCityContext({ lat: 55.55, lng: 14.35, todayIsoDate: () => DATE });
  const pr = selectPlannerRoleCandidates(ctx, { candidate_mode: 1, date: DATE, preferences: ["scenic", "food"] });
  const dayflow = summarizeDayflowHonesty({ ...pr, requested_preferences: ["scenic", "food"] });
  assert.equal(pr.density, "absent");
  assert.equal(dayflow.day_status, "sparse");
  assert.equal(dayflow.role_coverage.filled.length, 0);
  assert.equal(dayflow.role_coverage.missing.length, 6); // nothing fabricated
});

test("agnostic context with a trusted loader can fill matching roles, others stay missing", () => {
  const ctx = buildAgnosticCityContext({ lat: 55.55, lng: 14.35, todayIsoDate: () => DATE });
  const dataset = [externalRecord("agn-view", "Open Viewpoint", "viewpoint", 55.55, 14.35, ["utsikt"])];
  const pr = selectPlannerRoleCandidates(
    ctx,
    { candidate_mode: 1, date: DATE, include_external_candidates: 1, preferences: ["scenic", "swimming"] },
    { external_provider: { dataset } },
  );
  const dayflow = summarizeDayflowHonesty({ ...pr, requested_preferences: ["scenic", "swimming"] });
  // scenic fills from the external viewpoint; swimming stays honestly missing
  assert.notEqual(roleByName(pr, "scenic_anchor").status, "missing");
  assert.equal(roleByName(pr, "swimming_coast_option").status, "missing");
  assert.ok(dayflow.day_status !== "full");
});

// === 5. Lens comparison (helper-level) =====================================

test("lens can reorder role candidates from the same universe; route would be untouched", () => {
  const rome = require("../server/cities/rome.js");
  const firstTime = selectPlannerRoleCandidates(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "first_time" });
  const local = selectPlannerRoleCandidates(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "local" });
  const ftTop = roleByName(firstTime, "scenic_anchor").candidates[0]?.candidate_id;
  const loTop = roleByName(local, "scenic_anchor").candidates[0]?.candidate_id;
  // lens is forwarded and can change ordering where signals justify it
  assert.ok(ftTop && loTop);
  assert.notEqual(ftTop, loTop);
});

test("unknown lens remains null/neutral (contract preserved, not coerced to balanced)", () => {
  const rome = require("../server/cities/rome.js");
  const pr = selectPlannerRoleCandidates(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "nonsense-lens" });
  assert.equal(pr.lens, null);
});

// === 6. Time diagnostics ====================================================

test("time context is exposed as diagnostics only (no route sequencing)", async () => {
  const { dayflow, def, inspected } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic"], { now: `${DATE}T19:30:00` }),
  });
  assert.ok("time_summary" in dayflow);
  assert.ok("time_band" in dayflow.time_summary);
  // diagnostic only: route identical with/without inspect (asserted in helper)
  assert.deepEqual(def.days?.[0]?.primary_route?.main_stops?.map((s) => s.id), inspected.days?.[0]?.primary_route?.main_stops?.map((s) => s.id));
});

// === Documented findings (current behavior — see PR body) ===================
// These FINDING tests are characterization tests for current known limitations.
// They intentionally lock today's behavior so the next dayflow-honesty
// refinement PR can update them deliberately rather than accidentally.

test("FINDING: a rich INLAND city with no preferences is classified 'partial' (lacks a beach)", () => {
  const rome = require("../server/cities/rome.js");
  const pr = selectPlannerRoleCandidates(rome, { candidate_mode: 1, date: DATE });
  const dayflow = summarizeDayflowHonesty({ ...pr, requested_preferences: [] });
  // Current behavior: no-preference day_status targets ALL six role slots, so a
  // rich complete inland city can never be "full" because swimming is missing.
  // Recommended refinement (next PR): target anchor roles when no preferences.
  assert.equal(dayflow.day_status, "partial");
  assert.ok(dayflow.role_coverage.missing.includes("swimming_coast_option"));
});

test("FINDING: quality flags fire for UNREQUESTED missing roles (potential noise)", () => {
  const rome = require("../server/cities/rome.js");
  const pr = selectPlannerRoleCandidates(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  const dayflow = summarizeDayflowHonesty({ ...pr, requested_preferences: ["scenic"] });
  // swimming was NOT requested, yet a missing_* flag is emitted.
  // Recommended refinement: scope missing/partial flags to requested roles.
  assert.ok(dayflow.quality_flags.includes("missing_swimming_coast_option"));
});
