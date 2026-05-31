import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlannerHref,
  featuredLandingCities,
  landingCityAliases,
  landingProofCards,
} from '../src/landing-contract.mjs';

test('Astro landing contract exposes production city choices without changing route ownership', () => {
  assert.deepEqual(
    featuredLandingCities.map((city) => city.key),
    ['barcelona', 'rome', 'athens'],
  );

  assert.equal(buildPlannerHref('barcelona'), '/barcelona?planner=open');
  assert.equal(buildPlannerHref('rome', 'en'), '/rome?planner=open');
  assert.equal(buildPlannerHref('barcelona', 'sv'), '/barcelona?planner=open&lang=sv');
  assert.equal(buildPlannerHref('athens', 'sv'), '/athens?planner=open&lang=sv');

  assert.equal(landingCityAliases.roma, 'rome');
  assert.equal(landingCityAliases.barcelone, 'barcelona');
  assert.equal(landingProofCards.some((card) => /No production route takeover/i.test(card.body)), true);
});
