"use strict";

/**
 * The counterfactual the eligibility verdict rests on.
 *
 * A role keeps only its top `limitPerRole` ranked entries, and
 * keepPinnedEntriesInRole re-admits one below that cut when the request pins it.
 * That makes the role's candidate list depend on which pins the request
 * carried — right for composing, wrong for answering "could this be committed
 * to?", because the answer is no right up until the user pins it and then yes.
 *
 * `commitment_rescuable_ids` records the stable answer. This drives the REAL
 * selector rather than a hand-built role object, because the mechanism it
 * guards was previously deletable without a single red test: the end-to-end
 * fixtures happened to contain no below-the-cut candidate that survives
 * admission, so emptying the loop changed nothing they observed.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { selectPlannerRoleCandidates, DEFAULT_LIMIT_PER_ROLE } = require("../server/planner/role-selector");
const { plannerUsableOptionsForRole } = require("../server/planner/candidate-combination");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");
const {
  admitExperimentalInferredExternalCandidate,
} = require("../server/planner/agnostic-route-output");

const DATE = "2026-07-20";
const ORIGIN = { lat: 59.3293, lng: 18.0686 };

const city = () =>
  buildAgnosticCityContext({
    key: "agnostic-engine-area",
    label: "Resolved place",
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    todayIsoDate: () => DATE,
  });

/** Distinct coordinates so nothing is lost to identity dedup. */
function source(id, index) {
  return {
    id,
    name: id,
    type: "restaurant",
    lat: ORIGIN.lat + index * 0.0004,
    lng: ORIGIN.lng + (index % 3) * 0.0004,
    tags: ["mat"],
    sources: [
      { provider: "osm", family: "map", tier: "inferred", url: `https://www.openstreetmap.org/node/${id}` },
      { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q${index}` },
    ],
  };
}

const helpers = (dataset) => ({
  resolveNowContext: () => ({ date: DATE, hour: 13, weekday: 1, now_iso: `${DATE}T13:00:00Z` }),
  resolveTimeBand: () => "midday",
  external_provider: { dataset },
  experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
});

const select = (dataset, extra = {}) =>
  selectPlannerRoleCandidates(
    city(),
    { include_external_candidates: 1, preferences: ["food"], origin: ORIGIN, ...extra },
    helpers(dataset),
  );

// A role deeper than the cut, so there is genuinely a tail to answer about.
const DEEP = Array.from({ length: DEFAULT_LIMIT_PER_ROLE + 4 }, (_, i) => source(`food-${i}`, i));

test("a role deeper than its cut reports the tail a pin could rescue", () => {
  const result = select(DEEP);
  const food = result.roles.find((role) => role.role === "food_anchor");
  assert.ok(food, "precondition: the fixture fills the food role");
  assert.equal(
    food.candidates.length,
    DEFAULT_LIMIT_PER_ROLE,
    "precondition: the cut actually bites, or there is no tail to test",
  );

  const kept = new Set(food.candidates.map((candidate) => candidate.candidate_id));
  assert.ok(
    result.commitment_rescuable_ids.length > 0,
    "the tail below the cut is answered for, not silently treated as unroutable",
  );
  for (const id of result.commitment_rescuable_ids) {
    assert.equal(kept.has(id), false, `${id} is already kept — the tail must not repeat it`);
  }
});

test("the answer is the same whether or not this request carried the pin", () => {
  // The whole point. Pinning a below-cut candidate re-admits it into the role's
  // candidate list; the eligibility answer for that identity must not move.
  const unpinned = select(DEEP);
  const target = unpinned.commitment_rescuable_ids[0];
  assert.ok(target, "precondition: something is rescuable");

  const pinned = select(DEEP, { pinnedIds: [target] });
  const pinnedFood = pinned.roles.find((role) => role.role === "food_anchor");
  assert.ok(
    pinnedFood.candidates.some((candidate) => candidate.candidate_id === target),
    "precondition: pinning really does re-admit it, or this proves nothing",
  );

  const eligibleWhenPinned = new Set([
    ...pinned.commitment_rescuable_ids,
    ...pinnedFood.candidates
      .filter((candidate) => plannerUsableOptionsForRole(pinnedFood).includes(candidate))
      .map((candidate) => candidate.candidate_id),
  ]);
  assert.ok(
    eligibleWhenPinned.has(target),
    `${target} was rescuable unpinned and must stay committable once pinned`,
  );
});

test("only a tail entry the hoist would accept is reported", () => {
  // The tail is where the rejected statuses live — entries sort filled ->
  // partial -> admitted -> fallback. Reporting on rank alone declared
  // fallback-status candidates committable, and pinning them was refused: the
  // round-trip refusal the eligibility field exists to remove.
  const result = select(DEEP);
  const food = result.roles.find((role) => role.role === "food_anchor");

  for (const id of result.commitment_rescuable_ids) {
    const asIfRescued = {
      candidates: [
        ...food.candidates,
        // Rebuild the entry the way keepPinnedEntriesInRole would, by asking
        // the selector for it directly.
        select(DEEP, { pinnedIds: [id] })
          .roles.find((role) => role.role === "food_anchor")
          .candidates.find((candidate) => candidate.candidate_id === id),
      ].filter(Boolean),
    };
    assert.ok(
      plannerUsableOptionsForRole(asIfRescued).some((option) => option.candidate_id === id),
      `${id} was reported rescuable but the hoist would refuse it`,
    );
  }
});

test("a role that never fills reports nothing to rescue", () => {
  // Fail closed: no supply, no claims.
  const result = select([]);
  assert.deepEqual(result.commitment_rescuable_ids, []);
});
