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
  collectCommitmentUpstreamEligibleIds,
  markCommitmentEligibility,
} = require("../server/planner/commitment-eligibility");

const roles = (...ids) => ({
  roles: [{ role: "food_anchor", candidates: ids.map((id) => ({ candidate_id: id, planner_usable: true })) }],
});
const offered = (...ids) => ids.map((id) => ({ id }));

test("a candidate offered to the composer is eligible", () => {
  const ids = collectCommitmentUpstreamEligibleIds({ plannerRoles: roles(), sourceCandidates: offered("a") });
  assert.deepEqual([...ids], ["a"]);
});

test("a gated reservoir candidate is eligible even when the composer never saw it", () => {
  // This is the case route membership cannot express: the reservoir holds it,
  // a pin would hoist it, and the day simply did not choose it.
  const ids = collectCommitmentUpstreamEligibleIds({ plannerRoles: roles("reservoir-only"), sourceCandidates: [] });
  assert.ok(ids.has("reservoir-only"));
});

test("eligibility is not route membership", () => {
  // A candidate is eligible because the routing path would accept it, not
  // because it won a slot. Deriving the field from the final route would make
  // every unselected place look unroutable.
  const ids = collectCommitmentUpstreamEligibleIds({
    plannerRoles: roles("not-chosen"),
    sourceCandidates: offered("chosen"),
  });
  assert.deepEqual([...ids].sort(), ["chosen", "not-chosen"]);
});

test("a candidate nothing trusted holds is not eligible", () => {
  const ids = collectCommitmentUpstreamEligibleIds({ plannerRoles: roles("a"), sourceCandidates: offered("b") });
  assert.equal(ids.has("ghost"), false);
});

test("a role candidate the gates did not find planner-usable is not eligible", () => {
  // Reservoir membership alone is not admission: an entry the gates rejected
  // for every role cannot be hoisted by a pin either.
  const ids = collectCommitmentUpstreamEligibleIds({
    plannerRoles: { roles: [{ role: "food_anchor", candidates: [{ candidate_id: "rejected", planner_usable: false }] }] },
    sourceCandidates: [],
  });
  assert.equal(ids.has("rejected"), false);
});

test("missing inputs yield an empty set, never a permissive one", () => {
  for (const args of [{}, { plannerRoles: null, sourceCandidates: null }, { plannerRoles: {} }]) {
    assert.equal(collectCommitmentUpstreamEligibleIds(args).size, 0);
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
  const published = publishedEligibleIds({ promotionPromote: true, commitmentEligibleIds: ids });
  assert.deepEqual([...published].sort(), ["a", "b"]);
  // A copy: widening the published verdict must not be possible by mutating
  // the set the caller handed in.
  ids.add("smuggled");
  assert.equal(published.has("smuggled"), false);
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

test("a candidate below the ranking cut is eligible, because a pin would rescue it", () => {
  // Observed on real data before this: a nearby place was declared ineligible
  // and then honoured the moment it was pinned. The per-role ranking cut is
  // pin-aware, so reading only the current request's sets answers "no" right up
  // until the user proves it wrong — eligible because pinned, which is circular.
  const ids = collectCommitmentUpstreamEligibleIds({
    plannerRoles: {
      roles: [{ role: "food_anchor", candidates: [{ candidate_id: "above-cut", planner_usable: true }] }],
      // A SIBLING of roles, not a field on one: the inspect sidecar emits role
      // entries verbatim, so internal bookkeeping hung on a role entry becomes
      // public payload.
      commitment_rescuable_ids: ["below-cut"],
    },
    sourceCandidates: [],
  });
  assert.deepEqual([...ids].sort(), ["above-cut", "below-cut"]);
});

test("eligibility does not change just because the request carried the pin", () => {
  // The same identity must get the same answer whether or not this particular
  // request pinned it. Anything else makes the field describe the request
  // instead of the candidate.
  const unpinned = collectCommitmentUpstreamEligibleIds({
    plannerRoles: {
      roles: [{ role: "food_anchor", candidates: [{ candidate_id: "a", planner_usable: true }] }],
      commitment_rescuable_ids: ["b"],
    },
    sourceCandidates: [{ id: "a" }],
  });
  // With the pin, the rescue has already moved "b" into the role's candidates
  // and the composer's supply — the same answer must come back.
  const pinned = collectCommitmentUpstreamEligibleIds({
    plannerRoles: {
      roles: [{ role: "food_anchor", candidates: [{ candidate_id: "a", planner_usable: true }, { candidate_id: "b", planner_usable: true }] }],
      commitment_rescuable_ids: [],
    },
    sourceCandidates: [{ id: "a" }, { id: "b" }],
  });
  assert.deepEqual([...unpinned].sort(), [...pinned].sort());
});

test("a rescued candidate the hoist would still reject is NOT eligible", () => {
  // The consumer trusts the selector's answer rather than rank. Whether the
  // selector answers correctly is asserted behaviourally in
  // tests/role-selector-commitment-rescue.test.js, which drives the real
  // selector rather than a hand-built list.
  const ids = collectCommitmentUpstreamEligibleIds({
    plannerRoles: {
      roles: [{ role: "food_anchor", candidates: [{ candidate_id: "kept", planner_usable: true }] }],
      commitment_rescuable_ids: [],
    },
    sourceCandidates: [],
  });
  assert.equal(ids.has("rejected-tail"), false);
  assert.deepEqual([...ids], ["kept"]);
});

test("internal rescue bookkeeping never rides on a role entry", () => {
  // buildPlannerCandidateInspectSidecar emits `roles` verbatim, so a field hung
  // on a role entry is public payload. Found in review: the first version put
  // it there and published the below-the-cut ranked tail.
  const { selectPlannerRoleCandidates } = require("../server/planner/role-selector");
  const source = require("node:fs").readFileSync(
    require.resolve("../server/planner/role-selector"),
    "utf8",
  );
  assert.equal(typeof selectPlannerRoleCandidates, "function");
  assert.ok(
    !/pin_rescuable_candidate_ids:/.test(source),
    "the rescue list must not be assigned onto a role entry",
  );
  assert.match(source, /commitment_rescuable_ids: \[\.\.\.new Set\(rescuableByRole\)\]/);
});
