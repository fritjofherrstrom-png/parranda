'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectCommitmentUpstreamEligibleIds } = require('../server/planner/commitment-eligibility');
const { mapPlannerReservoirToSourceCandidates } = require('../server/planner/agnostic-engine-compose');
const rich = (covered, extra = {}) => ({
  candidate_id: 'explicit', planner_usable: true, candidate_status: 'partial',
  coordinates: { lat: 41.9, lng: 12.49 }, covered_preferences: covered,
  partial_preferences: covered.length ? [] : ['food'], local_feel_rank: 3,
  gates: { may_influence_routes: true }, ...extra,
});
for (const reverse of [false, true]) {
  for (const [name, direct, expected] of [
    ['no direct assessment', [], true],
    ['all direct assessments reject', [rich(['coffee'], { planner_usable: false })], false],
    ['one direct assessment passes', [rich(['coffee'], { planner_usable: false }), rich(['coffee'])], true],
  ]) {
    test(name + ' preserves explicit admission across role order ' + reverse, () => {
      const roles = [{ role: 'food_anchor', candidates: [rich([])] },
        ...direct.map((candidate, i) => ({ role: 'direct_' + i, candidates: [candidate] }))];
      if (reverse) roles.reverse();
      const plannerRoles = { requested_preferences: ['food', 'coffee'], roles };
      const before = structuredClone(plannerRoles);
      assert.equal(collectCommitmentUpstreamEligibleIds({ plannerRoles }).has('explicit'), expected);
      for (const field of ['pinnedIds', 'retainedIds']) {
        const result = mapPlannerReservoirToSourceCandidates({ plannerRoles, [field]: ['explicit'],
          includeCapacityFrontier: false });
        assert.equal(result.some(candidate => candidate.id === 'explicit'), expected);
      }
      assert.deepEqual(plannerRoles, before);
    });
  }
}
test('complete pre-cut admission overrides incomplete role and old tail verdicts', () => {
  const plannerRoles = { roles: [{ role: 'food_anchor', candidates: [rich([])] }],
    commitment_admissible_ids: [], commitment_rescuable_ids: ['explicit'] };
  assert.equal(collectCommitmentUpstreamEligibleIds({ plannerRoles }).has('explicit'), false);
  assert.equal(collectCommitmentUpstreamEligibleIds({ plannerRoles,
    sourceCandidates: [{ id: 'explicit' }] }).has('explicit'), true,
    'an automatically offered identity is still in the actual composer supply');
});
for (const eligible of [undefined, true, false]) test('individual availability ' + eligible, () => {
  const candidate = rich(['coffee'], { availability: { eligible } });
  const plannerRoles = { roles: [{ role: 'coffee_fika_stop', candidates: [candidate] }] };
  assert.equal(collectCommitmentUpstreamEligibleIds({ plannerRoles }).has('explicit'), eligible !== false);
});
