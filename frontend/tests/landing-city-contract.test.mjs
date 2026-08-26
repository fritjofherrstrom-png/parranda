import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlannerHref,
  featuredLandingCities,
  landingCityAliases,
  landingProofCards,
} from '../src/landing-contract.mjs';

test('Astro landing contract points city choices at the modern planner', () => {
  assert.deepEqual(
    featuredLandingCities.map((city) => city.key),
    ['barcelona', 'rome', 'athens'],
  );

  assert.equal(buildPlannerHref('barcelona'), '/anywhere?city=barcelona&place=Barcelona&planner=open&lang=en');
  assert.equal(buildPlannerHref('rome', 'en'), '/anywhere?city=rome&place=Rome&planner=open&lang=en');
  assert.equal(buildPlannerHref('barcelona', 'sv'), '/anywhere?city=barcelona&place=Barcelona&planner=open&lang=sv');
  assert.equal(buildPlannerHref('athens', 'sv'), '/anywhere?city=athens&place=Athens&planner=open&lang=sv');

  assert.equal(landingCityAliases.roma, 'rome');
  assert.equal(landingCityAliases.barcelone, 'barcelona');
  assert.equal(landingProofCards.some((card) => /modern planner/i.test(card.body)), true);
});
