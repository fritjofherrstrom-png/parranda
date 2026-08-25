"use strict";

const { plannerUsableOptionsForRole } = require("./candidate-combination");

/**
 * Which public candidates the routing path will accept a commitment to.
 *
 * The Add lists render from place-structure candidates, and district
 * composition is explicit that those facts "never promote a candidate into the
 * route". The client had no way to tell an idea it could commit to from one it
 * could not, so it offered the verb on all of them and the user learned the
 * answer only from a refusal after the round trip.
 *
 * Nothing the client can see distinguishes the two. Coordinates, an id shape, a
 * label, and absence from the route are all equally true of both. So the side
 * that knows says so, once, per exact identity.
 *
 * ELIGIBLE MEANS: this exact public identity is ADMITTED by the trusted
 * routing/commitment path and may be sent back as a pin. It is a statement
 * about admission, not about affordability: the walking budget can still refuse
 * an admitted pin once the finished day is measured, and says so itself
 * (see pin-walking-budget). Nothing cheaper is possible — affordability needs a
 * full re-finalisation, which is not something a candidate list can precompute.
 *
 * It also deliberately does NOT mean the candidate was selected — a perfectly routable place the composer
 * did not pick this time is still something the user may commit to, and
 * deriving the field from route membership would make every unselected place
 * look unroutable.
 *
 * The set is drawn from the three places a pin is resolved against: the
 * candidates actually offered to the composer, the gated role reservoir a pin
 * can hoist from, and the ranked entries just below each role's cut that the
 * pin rescue would re-admit. Reusing plannerUsableOptionsForRole rather than
 * re-deciding admission here is what keeps "eligible" and "pinnable" the same
 * question — if the hoist's rule changes, this changes with it.
 *
 * That third source is not an optimisation, it is the difference between an
 * honest answer and a circular one. The per-role ranking cut is pin-aware, so a
 * candidate below the cut is absent from the reservoir until it is pinned — and
 * then present. Reading only the current request's sets therefore says "no"
 * right up until the moment the user proves it wrong, which was observed on
 * real data: a nearby place declared ineligible was honoured as soon as it was
 * pinned. Eligibility has to be the counterfactual — would a pin naming this
 * identity be accepted — not a description of the set as it happens to stand.
 *
 * Exclusion needs no special case: dismissing a candidate wraps the loader, so
 * an excluded place never reaches the reservoir and is ineligible by
 * construction. The private loaded-identity bookkeeping that survives exclusion
 * for refusal wording is deliberately NOT consulted here — it exists to explain
 * a refusal, never to authorise a commitment.
 */

/**
 * The UPSTREAM answer: what the trusted routing path would accept, before any
 * question of which day was published.
 *
 * Deliberately distinct from publishedEligibleIds below, which takes this set
 * and decides whether the day that actually went out is entitled to vouch for
 * it. Upstream says "the routing path would take this"; published says "and the
 * day on screen is the one that judged it". Both are needed, and conflating
 * them is how a withheld experiment would end up authorising commitments
 * against a baseline nobody composed.
 *
 * @param {object} params
 * @param {object} [params.plannerRoles]       the gated role reservoir
 * @param {object[]} [params.sourceCandidates] what was offered to the composer
 * @returns {Set<string>} exact identities a commitment may name
 */
function collectCommitmentUpstreamEligibleIds({ plannerRoles = null, sourceCandidates = null } = {}) {
  const eligible = new Set();

  for (const candidate of Array.isArray(sourceCandidates) ? sourceCandidates : []) {
    if (candidate && candidate.id != null && candidate.id !== "") eligible.add(String(candidate.id));
  }

  for (const roleEntry of Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : []) {
    for (const option of plannerUsableOptionsForRole(roleEntry)) {
      const id = option?.candidate_id;
      if (id != null && id !== "") eligible.add(String(id));
    }
  }

  // Below the ranking cut, but a pin would re-admit it AND the hoist would then
  // accept it. Collected by the role selector, which is the only place that can
  // see the tail the cut removed.
  for (const id of Array.isArray(plannerRoles?.commitment_rescuable_ids)
    ? plannerRoles.commitment_rescuable_ids
    : []) {
    if (id != null && id !== "") eligible.add(String(id));
  }

  return eligible;
}

/**
 * Stamp the verdict onto the public place structure.
 *
 * Every candidate in a structure THIS FUNCTION MARKS gets an explicit boolean
 * rather than only the eligible ones getting a marker. A missing field already
 * means "no" to the client, so marking only the yeses would work by accident;
 * saying both out loud is what makes the contract readable.
 *
 * Only the engine-compose response path marks. The legacy synthesizer and the
 * recognized-city path publish district candidates with no field at all, and
 * that is correct rather than an omission: neither honours pins, so there is
 * nothing they could truthfully declare committable. The client fails closed on
 * the absent field, so Add simply never appears there.
 *
 * Copies rather than mutates when it marks anything: the structure is also used
 * for the map and the district panel, and a routing verdict must not leak
 * backwards into the display data it is describing. With nothing to mark the
 * input is handed straight back, so callers must not rely on always receiving a
 * new object.
 *
 * @param {object|null} placeStructure
 * @param {Set<string>} eligibleIds
 * @returns {object|null} a copy carrying `commitment_eligible` per candidate
 */
function markCommitmentEligibility(placeStructure, eligibleIds) {
  if (!placeStructure || typeof placeStructure !== "object") return placeStructure;
  const areas = placeStructure.district_day?.areas;
  if (!Array.isArray(areas)) return placeStructure;
  const eligible = eligibleIds instanceof Set ? eligibleIds : new Set();

  return {
    ...placeStructure,
    district_day: {
      ...placeStructure.district_day,
      areas: areas.map((area) => {
        if (!area || !Array.isArray(area.stops)) return area;
        return {
          ...area,
          stops: area.stops.map((stop) => {
            // A malformed entry is left exactly as found rather than being
            // turned into an object that exists only to carry a verdict about
            // nothing — the sibling guard above sets the same precedent.
            if (!stop || typeof stop !== "object") return stop;
            return {
              ...stop,
              // The whole contract: one boolean, per exact identity. Never a
              // reason, never the reservoir, never why.
              commitment_eligible: Boolean(stop.id != null && eligible.has(String(stop.id))),
            };
          }),
        };
      }),
    },
  };
}

/**
 * The eligible set belonging to the day that was actually PUBLISHED.
 *
 * When the promotion gate withholds the engine's day, the baseline goes out
 * instead. The engine's reservoir then describes a candidate context nobody
 * received, so it may not authorise commitments against the day on screen —
 * and an absent set is treated the same way, because a compose that never got
 * far enough to declare one has declared nothing.
 */
function publishedEligibleIds({ promotionPromote = false, commitmentEligibleIds = null } = {}) {
  if (!promotionPromote) return new Set();
  // A copy, so a caller cannot widen the published verdict by mutating the set
  // it was handed.
  return commitmentEligibleIds instanceof Set ? new Set(commitmentEligibleIds) : new Set();
}

module.exports = {
  collectCommitmentUpstreamEligibleIds,
  markCommitmentEligibility,
  publishedEligibleIds,
};
