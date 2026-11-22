'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rome = require('../server/cities/rome');
const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');
const { candidateProvenance } = require('../server/candidates/candidate-pool');
const { mapAdmittedSelectionToSourceCandidates } = require('../server/planner/agnostic-engine-compose');

function realRole() {
  const candidate = buildCuratedCatalogPlaceCandidates(rome).find(row => row.id === 'roscioli-salumeria');
  const coordinates = { lat: candidate.lat, lng: candidate.lng };
  const rich = { candidate_id: candidate.id, label: candidate.label, type: candidate.type,
    origin: 'curated_catalog', candidate_status: 'filled', planner_usable: true, coordinates,
    confidence: 'high', gates: { may_anchor_route: true, may_influence_routes: true },
    covered_preferences: ['food'], partial_preferences: [], missing_preferences: [],
    provenance: candidateProvenance(candidate, {}) };
  const selected = [{ candidate_id: candidate.id, role: 'food_anchor', coordinates }];
  return { rich, selected };
}
function mapped(rich, selected) {
  return mapAdmittedSelectionToSourceCandidates({ selected,
    plannerRoles: { requested_preferences: ['food'], roles: [{ role: 'food_anchor', candidates: [rich] }] } });
}

test('actual role-to-engine mapping preserves the reviewed article relation after JSON transport', () => {
  const { rich, selected } = realRole();
  const input = JSON.parse(JSON.stringify(rich));
  const output = mapped(input, selected);
  assert.equal(output.length, 1, 'the existing individually admitted role reaches the real engine mapper');
  assert.deepEqual(output[0].provenance.venue_mentions, rich.provenance.venue_mentions,
    'reviewed articles must survive the real role-to-engine boundary');
});
