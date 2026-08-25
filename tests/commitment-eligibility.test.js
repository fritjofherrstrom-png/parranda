"use strict";

/**
 * Which candidates the routing path will accept a commitment to.
 *
 * The Add lists render from place-structure candidates, and district
 * composition is explicit that those facts "never promote a candidate into the
 * route". The client had no way to tell an idea it could commit to from one it
 * could not, so it offered the verb on all of them and learned the answer only
 * from a refusal after the round trip.
 *
 * Eligibility is therefore declared by the side that knows: the trusted
 * reservoir and the candidates actually offered to the composer. It is NOT
 * derived from whether a candidate ended up in the published route — a
 * perfectly routable place the composer simply did not pick this time is still
 * something the user may commit to.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectCommitmentEligibleIds,
  markCommitmentEligibility,
} = require("../server/planner/commitment-eligibility");

const roles = (...ids) => ({
  roles: [{ role: "food_anchor", candidates: ids.map((id) => ({ candidate_id: id, planner_usable: true })) }],
});
const offered = (...ids) => ids.map((id) => ({ id }));

test("a candidate offered to the composer is eligible", () => {
  const ids = collectCommitmentEligibleIds({ plannerRoles: roles(), sourceCandidates: offered("a") });
  assert.deepEqual([...ids], ["a"]);
});

test("a gated reservoir candidate is eligible even when the composer never saw it", () => {
  // This is the case route membership cannot express: the reservoir holds it,
  // a pin would hoist it, and the day simply did not choose it.
  const ids = collectCommitmentEligibleIds({ plannerRoles: roles("reservoir-only"), sourceCandidates: [] });
  assert.ok(ids.has("reservoir-only"));
});

test("eligibility is not route membership", () => {
  // A candidate is eligible because the routing path would accept it, not
  // because it won a slot. Deriving the field from the final route would make
  // every unselected place look unroutable.
  const ids = collectCommitmentEligibleIds({
    plannerRoles: roles("not-chosen"),
    sourceCandidates: offered("chosen"),
  });
  assert.deepEqual([...ids].sort(), ["chosen", "not-chosen"]);
});

test("a candidate nothing trusted holds is not eligible", () => {
  const ids = collectCommitmentEligibleIds({ plannerRoles: roles("a"), sourceCandidates: offered("b") });
  assert.equal(ids.has("ghost"), false);
});

test("a role candidate the gates did not find planner-usable is not eligible", () => {
  // Reservoir membership alone is not admission: an entry the gates rejected
  // for every role cannot be hoisted by a pin either.
  const ids = collectCommitmentEligibleIds({
    plannerRoles: { roles: [{ role: "food_anchor", candidates: [{ candidate_id: "rejected", planner_usable: false }] }] },
    sourceCandidates: [],
  });
  assert.equal(ids.has("rejected"), false);
});

test("missing inputs yield an empty set, never a permissive one", () => {
  for (const args of [{}, { plannerRoles: null, sourceCandidates: null }, { plannerRoles: {} }]) {
    assert.equal(collectCommitmentEligibleIds(args).size, 0);
  }
});

// --------------------------------------------------------------------------
// Projection onto the public, display-only structure.
// --------------------------------------------------------------------------

const structure = () => ({
  provenance: "agnostic_anchor",
  area_count: 1,
  areas: [{ size: 2, member_ids: ["a", "b"] }],
  district_day: {
    areas: [
      {
        center: { lat: 41.9, lng: 12.49 },
        stop_ids: ["a", "b"],
        stops: [
          { id: "a", name: "Alpha", lat: 41.9, lng: 12.49 },
          { id: "b", name: "Beta", lat: 41.9001, lng: 12.49 },
        ],
      },
    ],
  },
});

test("every public candidate gets an explicit yes or no", () => {
  // A missing field is the client's cue to fail closed, so leaving it off for
  // the ineligible ones would work by accident. Saying so explicitly is what
  // makes the contract readable.
  const marked = markCommitmentEligibility(structure(), new Set(["a"]));
  const stops = marked.district_day.areas[0].stops;
  assert.equal(stops[0].commitment_eligible, true);
  assert.equal(stops[1].commitment_eligible, false);
});

test("the projection copies rather than mutates", () => {
  const original = structure();
  markCommitmentEligibility(original, new Set(["a"]));
  assert.equal("commitment_eligible" in original.district_day.areas[0].stops[0], false);
});

test("no eligible set at all marks everything ineligible", () => {
  // A withheld experiment publishes the baseline, whose candidate context is
  // not what the engine judged. Declaring nothing eligible is the honest
  // outcome, not an omission.
  const marked = markCommitmentEligibility(structure(), new Set());
  for (const stop of marked.district_day.areas[0].stops) {
    assert.equal(stop.commitment_eligible, false);
  }
});

test("the projection carries no private bookkeeping", () => {
  // Only the boolean crosses the boundary — never the reservoir, the loader's
  // private identity metadata, or why a candidate did or did not qualify.
  const marked = markCommitmentEligibility(structure(), new Set(["a"]));
  const keys = Object.keys(marked.district_day.areas[0].stops[0]);
  assert.deepEqual(
    keys.filter((k) => !["id", "name", "lat", "lng"].includes(k)),
    ["commitment_eligible"],
  );
});

test("a structure with nothing to mark survives untouched", () => {
  assert.equal(markCommitmentEligibility(null, new Set(["a"])), null);
  const bare = { provenance: "agnostic_anchor" };
  assert.deepEqual(markCommitmentEligibility(bare, new Set(["a"])), bare);
});

// --------------------------------------------------------------------------
// Which day's candidate context is allowed to authorise a commitment.
// --------------------------------------------------------------------------

const { publishedEligibleIds } = require("../server/planner/commitment-eligibility");

test("a published engine day authorises its own eligible set", () => {
  const ids = new Set(["a", "b"]);
  assert.equal(
    publishedEligibleIds({ promotionPromote: true, commitmentEligibleIds: ids }),
    ids,
  );
});

test("a withheld experiment authorises nothing", () => {
  // The baseline is published instead, and the engine's reservoir describes a
  // candidate context nobody received. Lending it to the baseline would let an
  // unpublished day vouch for commitments against a published one.
  const ids = new Set(["a", "b"]);
  assert.equal(publishedEligibleIds({ promotionPromote: false, commitmentEligibleIds: ids }).size, 0);
});

test("an absent or malformed set authorises nothing either", () => {
  // A compose that never got far enough to declare a set has declared nothing,
  // which is not the same as declaring everything.
  for (const value of [null, undefined, ["a"], "a", {}]) {
    assert.equal(
      publishedEligibleIds({ promotionPromote: true, commitmentEligibleIds: value }).size,
      0,
      `${JSON.stringify(value)} must not authorise anything`,
    );
  }
});
