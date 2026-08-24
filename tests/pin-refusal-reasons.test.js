"use strict";

/**
 * The day could already say THAT a kept place did not make it. It could not say
 * why, and the causes had genuinely diverged — a place the server never loaded,
 * one it loaded but never offered to the composer, one the requested walk could
 * not afford, and one the composer simply did not choose. All four read
 * identically to the user.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PIN_REFUSAL_REASONS,
  attributeToWithheldDay,
  classifyUnhonouredPins,
  isPinRefusalReason,
} = require("../server/planner/pin-refusal-reasons");

const stop = (id) => ({ id });
const candidate = (id) => ({ id });
const roles = (...ids) => ({ roles: [{ role: "food_anchor", candidates: ids.map((id) => ({ candidate_id: id })) }] });

test("an honoured commitment is not explained at all", () => {
  const out = classifyUnhonouredPins({
    pinnedIds: ["a"],
    stops: [stop("a"), stop("b")],
    plannerRoles: roles("a"),
    sourceCandidates: [candidate("a")],
  });
  assert.deepEqual(out, [], "there is nothing to say about a commitment that was met");
});

test("an id the server loaded nothing for is named as unknown", () => {
  // Distinct from every other case: the user may simply be holding a stale id,
  // and no amount of re-composing will change that.
  const out = classifyUnhonouredPins({
    pinnedIds: ["ghost"],
    stops: [stop("a")],
    plannerRoles: roles("a"),
    sourceCandidates: [candidate("a")],
  });
  assert.deepEqual(out, [{ id: "ghost", reason: PIN_REFUSAL_REASONS.UNKNOWN_CANDIDATE }]);
});

test("a loaded candidate the composer never saw is distinct from an unknown one", () => {
  // This is the case the counts could never express: the place exists, the
  // server has it, and the role reservoir simply never offered it onward.
  const out = classifyUnhonouredPins({
    pinnedIds: ["known"],
    stops: [stop("a")],
    plannerRoles: roles("a", "known"),
    sourceCandidates: [candidate("a")],
    loadedCandidateIds: ["a", "known"],
  });
  assert.deepEqual(out, [{ id: "known", reason: PIN_REFUSAL_REASONS.NOT_OFFERED_TO_ROUTE }]);
});

test("a candidate the composer had and did not choose says so", () => {
  const out = classifyUnhonouredPins({
    pinnedIds: ["offered"],
    stops: [stop("a")],
    plannerRoles: roles("a", "offered"),
    sourceCandidates: [candidate("a"), candidate("offered")],
  });
  assert.deepEqual(out, [{ id: "offered", reason: PIN_REFUSAL_REASONS.NOT_SELECTED }]);
});

test("the walking budget owns the refusals it made", () => {
  // Shedding only ever happens to a pin that reached finalisation, so the walk
  // is checked first: the later stages did run for it, and none of them are
  // the reason.
  const out = classifyUnhonouredPins({
    pinnedIds: ["far"],
    stops: [stop("a")],
    plannerRoles: roles("a", "far"),
    sourceCandidates: [candidate("a"), candidate("far")],
    shedForBudget: ["far"],
  });
  assert.deepEqual(out, [{ id: "far", reason: PIN_REFUSAL_REASONS.WALKING_BUDGET }]);
});

test("no walking budget was applied, so none can be blamed", () => {
  // A no_limit request never runs the shedding rule, so shedForBudget is empty
  // and walking_budget is unreachable — the reason must fall to what actually
  // happened in composition.
  const out = classifyUnhonouredPins({
    pinnedIds: ["far"],
    stops: [stop("a")],
    plannerRoles: roles("a", "far"),
    sourceCandidates: [candidate("a"), candidate("far")],
    shedForBudget: [],
  });
  assert.deepEqual(out, [{ id: "far", reason: PIN_REFUSAL_REASONS.NOT_SELECTED }]);
  assert.notEqual(out[0].reason, PIN_REFUSAL_REASONS.WALKING_BUDGET);
});

test("a withheld experiment is attributed to the withholding, nothing else", () => {
  // Whatever the engine did with these commitments describes a day nobody
  // received. Saying the reservoir or the walk refused them would explain a
  // route the user is not looking at.
  const out = attributeToWithheldDay(["a", "b"], [stop("a")]);
  assert.deepEqual(out, [{ id: "b", reason: PIN_REFUSAL_REASONS.DAY_NOT_PUBLISHED }]);
});

test("the vocabulary is closed", () => {
  // A free-text reason would become a place for the engine to explain itself at
  // length; every value here has to be worth a sentence in every language.
  for (const reason of Object.values(PIN_REFUSAL_REASONS)) {
    assert.equal(isPinRefusalReason(reason), true);
    assert.match(reason, /^[a-z][a-z_]*$/, "stable, lowercase tokens the client can switch on");
  }
  assert.equal(isPinRefusalReason("because_i_said_so"), false);
  assert.equal(isPinRefusalReason(undefined), false);
  assert.equal(Object.values(PIN_REFUSAL_REASONS).length, 5, "adding one is a deliberate contract change");
});

test("every unmet commitment gets exactly one reason, in request order", () => {
  const out = classifyUnhonouredPins({
    pinnedIds: ["ghost", "known", "offered", "far", "honoured"],
    stops: [stop("honoured")],
    plannerRoles: roles("known", "offered", "far", "honoured"),
    sourceCandidates: [candidate("offered"), candidate("far"), candidate("honoured")],
    shedForBudget: ["far"],
  });
  assert.deepEqual(out, [
    { id: "ghost", reason: PIN_REFUSAL_REASONS.UNKNOWN_CANDIDATE },
    { id: "known", reason: PIN_REFUSAL_REASONS.NOT_OFFERED_TO_ROUTE },
    { id: "offered", reason: PIN_REFUSAL_REASONS.NOT_SELECTED },
    { id: "far", reason: PIN_REFUSAL_REASONS.WALKING_BUDGET },
  ]);
});

test("a stale shed token cannot turn an unknown pin into a walking refusal", () => {
  // The budget layer may only shed ids that actually reached composition. The
  // classifier still fails closed if an inconsistent caller supplies a stale
  // shed token: unknown server evidence wins over the later-stage claim.
  const out = classifyUnhonouredPins({
    pinnedIds: ["far"],
    stops: [stop("a")],
    plannerRoles: roles("a"),
    sourceCandidates: [candidate("a")],
    loadedCandidateIds: ["a"],
    shedForBudget: ["far"],
  });
  assert.deepEqual(out, [{ id: "far", reason: PIN_REFUSAL_REASONS.UNKNOWN_CANDIDATE }]);
});
