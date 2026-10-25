'use strict';

// Offline resolver -> intake -> real React choice rendering. No Planner/map build.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');

const root = path.resolve(__dirname, '..');
const frontend = Module.createRequire(path.join(root, 'frontend/package.json'));
const React = frontend('react');
const { renderToStaticMarkup } = frontend('react-dom/server');
const { JSDOM } = frontend('jsdom');
const source = path.join(root, 'frontend/src/components/planner/PlaceChoices.tsx');
const compiled = execFileSync(frontend.resolve('esbuild/bin/esbuild'), [
  source, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic', '--packages=external',
], { cwd: root, encoding: 'utf8', timeout: 10000 });
const component = new Module(path.join(root, 'frontend/place-choice-test.cjs'), module);
component.filename = path.join(root, 'frontend/place-choice-test.cjs');
component.paths = Module._nodeModulePaths(path.join(root, 'frontend'));
component._compile(compiled, component.filename);
const { PlaceChoices } = component.exports;

const QUERY = 'Springfield';
const json = data => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data });
const row = (id, county, extra = {}) => ({
  osm_type: 'node', osm_id: id, category: 'place', type: 'village', addresstype: 'village',
  lat: String(40 + id / 10), lon: '10', importance: 0.4, name: QUERY,
  display_name: `${QUERY}, ${county}, Example Region, Example Country`,
  address: { village: QUERY, county, state: 'Example Region', country: 'Example Country', country_code: 'xx' },
  namedetails: { name: QUERY },
  ...extra,
});
const resolver = (rows, options = {}) => createNominatimPlaceResolver({
  minIntervalMs: 0, sleep: async () => {}, fetcher: async () => json(rows), ...options,
});
const selectionStore = () => createPlaceSelectionStore({ secret: Buffer.alloc(32, 7), now: () => 1000000 });

function renderChoices(intake) {
  const html = renderToStaticMarkup(React.createElement(PlaceChoices, {
    intake, pending: false, locationPending: false, locationFailed: false,
    onChoose: () => {}, t: (_sv, en) => en,
  }));
  const dom = new JSDOM(html);
  try {
    return [...dom.window.document.querySelectorAll('button')].map(button => ({
      text: button.textContent,
      accessible: button.getAttribute('aria-label') || button.textContent,
      unsafeElements: button.querySelectorAll('img, script').length,
    }));
  } finally {
    dom.window.close();
  }
}

async function ambiguity(placeResolver, store = selectionStore(), extra = {}) {
  const result = await resolveAgnosticIntake({
    placeQuery: QUERY, placeResolver, placeSelectionStore: store, ...extra,
  });
  assert.equal(result.anchor, null, 'offered choices must never auto-pick an identity');
  assert.equal(result.intake.query, QUERY);
  return { ...result, store };
}

test('identity: same-name places differing only by county stay visibly and accessibly distinct', async () => {
  const placeResolver = resolver([row(101, 'North County'), row(102, 'South County')]);
  const { intake } = await ambiguity(placeResolver);
  assert.deepEqual(intake.blockers, ['ambiguous_place']);
  assert.deepEqual(intake.candidates.map(choice => choice.place_ref), ['n101', 'n102']);
  assert.notEqual(intake.candidates[0].label, intake.candidates[1].label, 'different source-owned labels');
  const buttons = renderChoices(JSON.parse(JSON.stringify(intake)));
  assert.notEqual(buttons[0].text, buttons[1].text, 'the visible choices lost their distinguishing county');
  assert.notEqual(buttons[0].accessible, buttons[1].accessible, 'the accessible choices must also differ');
  assert.match(buttons[0].text, /North County/);
  assert.match(buttons[1].text, /South County/);
});

test('identity: omitted source qualifiers fall back to full labels only for colliding choices', async () => {
  const rows = [
    row(101, 'Shared County', { display_name: 'Springfield, North District, Shared County, Example Region, Example Country' }),
    row(102, 'Shared County', { display_name: 'Springfield, South District, Shared County, Example Region, Example Country' }),
    row(103, 'West County', {
      display_name: 'Springfield, West County, West Region, Example Country',
      address: { village: QUERY, county: 'West County', state: 'West Region', country: 'Example Country', country_code: 'xx' },
    }),
  ];
  const { intake } = await ambiguity(resolver(rows));
  const buttons = renderChoices(intake);
  assert.equal(buttons[0].text, rows[0].display_name, 'no invented admin context replaces a source qualifier');
  assert.equal(buttons[1].text, rows[1].display_name);
  assert.equal(intake.candidates[2].title, 'Springfield', 'safely distinct contexts stay short');
  assert.equal(intake.candidates[2].context, 'West Region · Example Country');
  assert.ok(!buttons[2].text.includes('West County'), 'non-colliding choices do not expand unnecessarily');
});

test('control: display fallback preserves exact query-bound receipts and resolver-owned facts', async () => {
  const placeResolver = resolver([row(101, 'North County'), row(102, 'South County')]);
  const original = await placeResolver(QUERY);
  const before = structuredClone(original);
  const { intake, store } = await ambiguity(placeResolver);
  assert.deepEqual(await placeResolver(QUERY), before, 'choice presentation must not mutate source facts');
  for (const choice of JSON.parse(JSON.stringify(intake)).candidates) {
    const candidate = original.find(value => value.label === choice.label);
    assert.ok(candidate);
    assert.equal(choice.selection_id, store.issue(candidate, QUERY), 'receipt bytes retain original label/query/geometry');
    const receipt = store.read(choice.selection_id, QUERY);
    assert.equal(receipt.label, candidate.label);
    for (const [field, value] of Object.entries(candidate.admin_context)) {
      if (typeof value === 'string') assert.equal(receipt.admin_context[field], value);
    }
    assert.equal(receipt.admin_context.municipality, undefined, 'receipts omit absent/null admin fields');
    for (const field of ['name', 'title', 'context']) assert.equal(receipt[field], undefined);
    assert.equal(store.read(choice.selection_id, 'Unrelated query'), null);
    const selected = await resolveAgnosticIntake({
      placeQuery: QUERY, placeSelection: choice.selection_id, placeSelectionStore: store,
      placeResolver: () => assert.fail('a selected receipt must not re-resolve'),
    });
    assert.deepEqual(selected.anchor, { lat: candidate.lat, lng: candidate.lng });
    assert.equal(selected.intake.query, QUERY);
    assert.equal(selected.intake.resolved.label, candidate.label);
    assert.equal(selected.intake.resolved.selection_id, choice.selection_id);
    assert.equal(selected.intake.resolved.place_ref, choice.place_ref);
  }
});

test('control: disk-cached resolver facts recompute safe choice labels after restart', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'parranda-choice-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const rows = [row(101, 'North County'), row(102, 'South County')];
  const first = resolver(rows, { cacheDir: dir, fetcher: async () => { calls++; return json(rows); } });
  const sourceFacts = await first(QUERY);
  assert.equal(calls, 1);
  const namespace = path.join(dir, 'place-resolver-nominatim-v7');
  const files = readdirSync(namespace);
  assert.equal(files.length, 1);
  const persisted = JSON.parse(readFileSync(path.join(namespace, files[0]), 'utf8'));
  assert.deepEqual(persisted.value.candidates, sourceFacts);
  assert.ok(persisted.value.candidates.every(value => value.title === undefined && value.context === undefined));
  const restarted = resolver(rows, {
    cacheDir: dir, fetcher: () => assert.fail('the restart must reuse the existing source-fact cache'),
  });
  const { intake } = await ambiguity(restarted);
  const buttons = renderChoices(intake);
  assert.match(buttons[0].text, /North County/);
  assert.match(buttons[1].text, /South County/);
  assert.deepEqual(await restarted(QUERY), sourceFacts);
});

test('control: fallback labels and short title/context are React-escaped source text', async () => {
  const { intake } = await ambiguity(resolver([
    row(101, 'North County', { display_name: 'Springfield, <img src=x onerror=alert(1)>, North County' }),
    row(102, 'South County', { display_name: 'Springfield, <script>bad()</script>, South County' }),
  ]));
  const fallback = renderChoices(intake);
  assert.match(fallback[0].text, /<img/);
  assert.match(fallback[1].text, /<script>/);
  const short = renderChoices({ candidates: [{
    label: 'Source-owned full label', title: '<img src=x onerror=alert(1)>',
    context: '<script>bad()</script>', selection_id: 'render-only-placeholder',
  }] });
  assert.match(short[0].text, /<img/);
  assert.ok([...fallback, ...short].every(button => button.unsafeElements === 0));
});

for (const [name, extra, blocker] of [
  ['ordinary ambiguity', {}, 'ambiguous_place'],
  ['invalid previous selection', { placeSelection: 'invalid-token' }, 'place_selection_invalid'],
  ['missing exact reference', { placeRef: 'n999' }, 'place_ref_not_found'],
]) {
  test(`membership: ${name} reorders only the original first five strong choices`, async () => {
    const rows = Array.from({ length: 6 }, (_, index) => row(101 + index, `County ${index + 1}`, {
      osm_type: index === 0 ? 'node' : 'relation', importance: 0.4 - index * 0.005,
    }));
    const requests = [];
    const placeResolver = resolver(rows, {
      limit: 6,
      fetcher: async url => {
        const request = new URL(url);
        requests.push(request);
        return json(request.pathname === '/lookup' ? [] : rows);
      },
    });
    const original = await placeResolver(QUERY);
    const before = structuredClone(original);
    assert.equal(original.length, 6, 'the supported provider limit produces six distinct identities');
    assert.ok(original.every(value => value.confidence === 'medium'));
    const { intake, store } = await ambiguity(placeResolver, selectionStore(), extra);
    assert.deepEqual(intake.blockers, [blocker]);
    assert.equal(intake.candidates_considered, 6);
    assert.equal(intake.candidates.length, 5, 'the existing visible bound stays five');
    assert.deepEqual(intake.candidates.map(choice => choice.place_ref), ['r102', 'r103', 'r104', 'r105', 'n101'],
      'area-first display order must not replace n101 with the sixth identity r106');
    for (const choice of intake.candidates) {
      const candidate = original.slice(0, 5).find(value => value.label === choice.label);
      assert.ok(candidate, 'every offered identity belongs to the original bounded set');
      assert.equal(choice.selection_id, store.issue(candidate, QUERY));
      assert.deepEqual(store.read(choice.selection_id, QUERY), store.read(store.issue(candidate, QUERY), QUERY));
    }
    assert.deepEqual(await placeResolver(QUERY), before, 'display order must not mutate cached resolver order');
    const searches = requests.filter(value => value.pathname === '/search');
    assert.equal(searches.length, 1, 'no additional search budget or reacquisition');
    assert.equal(searches[0].searchParams.get('limit'), '6');
    assert.equal(requests.filter(value => value.pathname === '/lookup').length, extra.placeRef ? 1 : 0);
  });
}
