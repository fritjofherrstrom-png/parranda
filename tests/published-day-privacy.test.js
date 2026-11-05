'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
let capturePublishedDayPrivacy;
try {
  ({ capturePublishedDayPrivacy } = require('../server/planner/published-day-privacy'));
} catch (error) {
  // Allow an unchanged-base run to reach the explicit missing-feature assertion.
  if (error.code !== 'MODULE_NOT_FOUND' ||
      !error.message.startsWith("Cannot find module '../server/planner/published-day-privacy'")) throw error;
}

const absent = {
  explicitCoordinatesPresent: false,
  customEndpointPresent: false,
  biasPresent: false,
  contextSelectionPresent: false,
  selectionPresent: false,
  requestedPlaceRefPresent: false,
};

test('captures an immutable private presence tuple without copying request values', () => {
  assert.equal(typeof capturePublishedDayPrivacy, 'function', 'raw presence needs an internal capture boundary');
  const request = { body: { place: 'Stockholm', unrelated_private_value: 'not-for-publication' }, query: { lang: 'sv' } };
  const before = structuredClone(request);
  const captured = capturePublishedDayPrivacy(request);
  assert.deepEqual(captured, absent);
  assert.equal(Object.isFrozen(captured), true);
  assert.deepEqual(request, before);
});

test('captures coordinate-field presence before coercion for body, query and nested origin', () => {
  for (const value of [undefined, null, false, true, [], {}, '', 'not-a-point', 0, 91]) {
    for (const key of ['lat', 'lng']) {
      for (const request of [
        { body: { [key]: value }, query: {} },
        { body: {}, query: { [key]: value } },
        { body: { origin: { [key]: value } }, query: {} },
      ]) {
        assert.deepEqual(capturePublishedDayPrivacy(request), {
          ...absent, explicitCoordinatesPresent: true,
        }, `raw ${key} presence must survive ${JSON.stringify(value)}`);
      }
    }
  }
});

test('captures private narrowing and identity presence without retaining their values', () => {
  for (const [key, flag] of [
    ['place_bias', 'biasPresent'],
    ['place_context_selection', 'contextSelectionPresent'],
    ['place_selection', 'selectionPresent'],
    ['place_ref', 'requestedPlaceRefPresent'],
  ]) {
    for (const value of [undefined, null, false, 0, '', 'private-controlled-sentinel', {}]) {
      assert.deepEqual(capturePublishedDayPrivacy({ body: { [key]: value } }), {
        ...absent, [flag]: true,
      }, `${key} presence must be recorded independently of parsing`);
    }
  }
});

test('identifies custom or malformed endpoints even when disguised as auto', () => {
  for (const key of ['home_base', 'start', 'end']) {
    for (const value of [
      undefined, null, '', false, 0, [], {}, { type: 'hotel', label: 'private endpoint' },
      { type: 'auto', lat: 0 }, { type: 'auto', lng: 0 },
      { type: 'auto', origin: { lat: 0, lng: 0 } },
      { type: 'auto', address: 'private endpoint' },
      { type: 'auto', label: 'private custom label' },
      { type: 'auto', label: null }, { type: 'auto', label: 'Parranda väljer', coordinates: [] },
    ]) {
      assert.deepEqual(capturePublishedDayPrivacy({ body: { [key]: value } }), {
        ...absent, customEndpointPresent: true,
      }, `${key} is not the supported default auto endpoint`);
    }
  }
});

test('preserves the real frontend auto-endpoint payload in every rhythm', async () => {
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  for (const dayRhythm of ['calm', 'balanced', 'full', 'free']) {
    const body = buildAnywherePayload({ place: 'Stockholm', dates: ['2026-10-24'], dayRhythm });
    assert.deepEqual(capturePublishedDayPrivacy({ body, query: { lang: 'en' } }), absent);
    assert.deepEqual(capturePublishedDayPrivacy({ body, query: { lang: 'sv' } }), absent);
  }
});

test('refuses unparsed request containers instead of certifying private-field absence', () => {
  for (const request of [
    { body: null }, { query: null }, { body: false }, { query: false },
    { body: '' }, { query: '' }, { body: [] }, { query: [] },
    { body: 0 }, { query: 0 }, { body: 'private unparsed body' },
    { body: Object.create({ lat: 0 }) },
    null, undefined, false, 0, '', [],
  ]) {
    assert.equal(capturePublishedDayPrivacy(request), null,
      'only parsed body/query records can produce private presence evidence');
  }
});

test('client privacy claims cannot override the real request fields or attest URLs', () => {
  const body = {
    lat: null,
    explicitCoordinatesPresent: false,
    customEndpointPresent: false,
    privacy: { ...absent, publicSourceUrls: ['https://example.invalid/private'] },
    publicSourceUrls: new Set(['https://example.invalid/private']),
  };
  assert.deepEqual(capturePublishedDayPrivacy({ body }), { ...absent, explicitCoordinatesPresent: true });
});

test('captured evidence is independent of later request mutation', () => {
  const request = { body: { lat: 0, place_selection: 'private-controlled-sentinel' } };
  const evidence = capturePublishedDayPrivacy(request);
  delete request.body.lat;
  delete request.body.place_selection;
  request.body.place_bias = 'new-private-sentinel';
  assert.deepEqual(evidence, { ...absent, explicitCoordinatesPresent: true, selectionPresent: true });
  assert.equal(JSON.stringify(evidence).includes('sentinel'), false);
});

test('accepts parser-owned null-prototype records and the bare auto sentinel', () => {
  const body = Object.assign(Object.create(null), { home_base: { type: 'auto' } });
  const query = Object.create(null);
  assert.deepEqual(capturePublishedDayPrivacy({ body, query }), absent);
  query.lng = 0;
  assert.deepEqual(capturePublishedDayPrivacy({ body, query }), { ...absent, explicitCoordinatesPresent: true });
});

test('does not inspect unrelated private request graphs', () => {
  const body = { place: 'Stockholm' };
  Object.defineProperty(body, 'unused_private_graph', { get() { throw new Error('must not traverse private graph'); } });
  body.unused_cycle = body;
  assert.deepEqual(capturePublishedDayPrivacy({ body }), absent);
});
