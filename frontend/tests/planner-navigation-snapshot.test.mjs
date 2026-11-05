import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSavedEntry } from '../src/lib/anywhere-storage.mjs';
import {
  NAVIGATION_CAP, NAVIGATION_ENTRY_BYTES, NAVIGATION_KEY, NAVIGATION_TOTAL_BYTES,
  navigationAddress, navigationHistoryState, navigationHref, readNavigationPublication, saveNavigationPublication,
} from '../src/lib/planner-navigation.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function entry(id = 'first-stop') {
  const inputs = { mode: 'typed', place: 'Testville', placeLabel: 'Testville', placeRef: 'n123456', selected: ['culture'], walkKey: 'balanced', dayOffset: 0 };
  return buildSavedEntry({
    place: inputs.place, placeLabel: inputs.placeLabel, dateIso: '2026-10-24', savedAt: '2026-10-24T12:00:00Z', inputs,
    classification: { status: 'composed' },
    safeResponse: { days: [{ date: '2026-10-24', primary_route: { main_stops: [{ id, label: 'Fixture stop', lat: 55.6, lng: 13 }] } }] },
  });
}
function entryWithBytes(size, id = 'first-stop') {
  const value = entry(id);
  const stop = value.safeResponse.days[0].primary_route.main_stops[0];
  stop.label = '';
  stop.label = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(value)));
  assert.equal(Buffer.byteLength(JSON.stringify(value)), size);
  return value;
}
function store(storage, value, options = {}) {
  return saveNavigationPublication(storage, value, { address: navigationAddress(value), ...options });
}
function positionEntry() {
  const original = entry();
  return buildSavedEntry({ ...original, place: null,
    inputs: { ...original.inputs, mode: 'near_me', place: null, placeLabel: null, placeRef: null },
    safeResponse: { ...original.safeResponse, agnostic_route_output_experiment: { source_status: { anchor: { lat: 55.6, lng: 13 } } } },
  });
}
function read(storage, publication) {
  const url = new URL(publication.address, 'http://localhost');
  return readNavigationPublication(storage, { pathname: url.pathname, search: url.search, navigationType: 'reload', state: navigationHistoryState({ foreign: 'preserved' }, publication) });
}

test('equal query IDs still have distinct immutable publication references', () => {
  const storage = memoryStorage();
  const a = entry('first-stop');
  const b = entry('another-stop');
  assert.equal(a.id, b.id, 'precondition: two answers to exactly the same question');
  const original = structuredClone(a);
  const first = store(storage, a); const second = store(storage, b);
  assert.ok(first && second);
  assert.deepEqual(a, original, 'saving does not mutate the caller entry');
  assert.match(first.reference, /^[a-f0-9]{32}$/);
  assert.match(second.reference, /^[a-f0-9]{32}$/);
  assert.notEqual(first.reference, second.reference);
  b.safeResponse.days[0].primary_route.main_stops[0].id = 'later-mutation';
  assert.equal(read(storage, first).entry.safeResponse.days[0].primary_route.main_stops[0].id, 'first-stop');
  assert.equal(read(storage, second).entry.safeResponse.days[0].primary_route.main_stops[0].id, 'another-stop');
  assert.equal(navigationHistoryState({ foreign: 'preserved' }, first).foreign, 'preserved');
});

test('a corrupted place reference cannot restore another geography under an unchanged query ID', () => {
  const storage = memoryStorage();
  const value = entry(); const publication = store(storage, value);
  assert.ok(publication);
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  persisted.records[0].entry.inputs.placeRef = 'n987654';
  assert.equal(persisted.records[0].entry.id, value.id, 'query ID itself does not include the durable reference');
  storage.setItem(NAVIGATION_KEY, JSON.stringify(persisted));
  assert.equal(read(storage, publication).kind, 'invalid', 'the exact record must bind its own durable place identity');
});

test('a present foreign commitment snapshot invalidates the exact record instead of dropping its choices', () => {
  const storage = memoryStorage(); const publication = store(storage, entry());
  assert.ok(publication);
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  persisted.records[0].entry.commitments = { version: 999, anchorKey: 'place:Testville', entries: {}, appliedPins: [], refusals: [] };
  storage.setItem(NAVIGATION_KEY, JSON.stringify(persisted));
  assert.equal(read(storage, publication).kind, 'invalid');
});

test('an absent navigation marker is fresh entry, but a missing explicit record fails closed', () => {
  const storage = memoryStorage();
  assert.equal(readNavigationPublication(storage, { search: '?place=Testville' }).kind, 'absent');
  assert.equal(readNavigationPublication(storage, { search: '?place=Testville&view=0123456789abcdef0123456789abcdef' }).kind, 'invalid');
});

test('an accepted near-me day without commitments can be displayed using its published anchor', () => {
  const storage = memoryStorage(); const value = positionEntry();
  assert.equal(value.commitments, null);
  const publication = store(storage, value);
  assert.ok(publication, 'a ledger-free near-me answer still has an exact display view');
  assert.equal(read(storage, publication).kind, 'restored');
  assert.equal(read(storage, publication).entry.inputs.mode, 'near_me');
});

test('a position display record cannot silently acquire a different published anchor', () => {
  const storage = memoryStorage(); const publication = store(storage, positionEntry());
  assert.ok(publication);
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  persisted.records[0].entry.safeResponse.agnostic_route_output_experiment.source_status.anchor.lat = 56.6;
  storage.setItem(NAVIGATION_KEY, JSON.stringify(persisted));
  assert.equal(read(storage, publication).kind, 'invalid', 'the position publication binds its original coarse geography');
});

test('a stored entry over its byte bound fails closed even within the total quota', () => {
  const storage = memoryStorage(); const publication = store(storage, entry());
  assert.ok(publication);
  assert.equal(read(storage, publication).kind, 'restored', 'precondition: an actual valid saved record');
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  const saved = persisted.records[0].entry;
  saved.safeResponse.days[0].primary_route.main_stops[0].label = 'é'.repeat(NAVIGATION_ENTRY_BYTES / 2);
  const serializedEntry = JSON.stringify(saved);
  assert.ok(serializedEntry.length < NAVIGATION_ENTRY_BYTES, 'character count alone is not a byte bound');
  assert.ok(Buffer.byteLength(serializedEntry) > NAVIGATION_ENTRY_BYTES);
  const encoded = JSON.stringify(persisted);
  assert.ok(Buffer.byteLength(encoded) < NAVIGATION_TOTAL_BYTES);
  storage.setItem(NAVIGATION_KEY, encoded);
  const fromHistory = read(storage, publication);
  assert.equal(fromHistory.kind, 'invalid');
  assert.deepEqual(fromHistory, { kind: 'invalid' });
  const url = new URL(navigationHref(publication, 'en'), 'http://localhost');
  assert.deepEqual(readNavigationPublication(storage, { pathname: url.pathname, search: url.search }), { kind: 'invalid' });
});

test('preservation: the entry byte limit is inclusive and oversized writes leave storage unchanged', () => {
  const storage = memoryStorage();
  const value = entryWithBytes(NAVIGATION_ENTRY_BYTES);
  const publication = store(storage, value);
  assert.ok(publication);
  assert.equal(read(storage, publication).kind, 'restored');
  const before = storage.getItem(NAVIGATION_KEY);
  value.safeResponse.days[0].primary_route.main_stops[0].label += 'x';
  assert.equal(Buffer.byteLength(JSON.stringify(value)), NAVIGATION_ENTRY_BYTES + 1);
  assert.equal(store(storage, value), null);
  assert.equal(storage.getItem(NAVIGATION_KEY), before);
  assert.equal(read(storage, publication).kind, 'restored');
});

test('preservation: the total read byte limit is inclusive and refuses an oversized store', () => {
  const storage = memoryStorage(); const publication = store(storage, entry());
  assert.ok(publication);
  const raw = storage.getItem(NAVIGATION_KEY);
  const atLimit = raw + ' '.repeat(NAVIGATION_TOTAL_BYTES - Buffer.byteLength(raw));
  assert.equal(Buffer.byteLength(atLimit), NAVIGATION_TOTAL_BYTES);
  storage.setItem(NAVIGATION_KEY, atLimit);
  assert.equal(read(storage, publication).kind, 'restored');
  storage.setItem(NAVIGATION_KEY, `${atLimit} `);
  assert.deepEqual(read(storage, publication), { kind: 'invalid' });
});

test('preservation: the record-count write quota evicts only the oldest reference', () => {
  const storage = memoryStorage();
  const publications = Array.from({ length: NAVIGATION_CAP }, (_, index) => store(storage, entry(`stop-${index}`)));
  assert.ok(publications.every(Boolean));
  assert.equal(JSON.parse(storage.getItem(NAVIGATION_KEY)).records.length, NAVIGATION_CAP);
  for (const publication of publications) assert.equal(read(storage, publication).kind, 'restored');
  const newest = store(storage, entry('newest-stop'));
  assert.ok(newest);
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  assert.equal(persisted.records.length, NAVIGATION_CAP);
  assert.deepEqual(read(storage, publications[0]), { kind: 'invalid' });
  const evictedUrl = new URL(navigationHref(publications[0], 'en'), 'http://localhost');
  assert.deepEqual(readNavigationPublication(storage, { pathname: evictedUrl.pathname, search: evictedUrl.search }), { kind: 'invalid' });
  for (const publication of [...publications.slice(1), newest]) assert.equal(read(storage, publication).kind, 'restored');
  assert.deepEqual(persisted.records.map(record => record.reference), [newest, ...publications.slice(1).reverse()].map(value => value.reference));
});

test('preservation: an over-count store fails closed instead of selecting a valid record', () => {
  const storage = memoryStorage();
  for (let index = 0; index < NAVIGATION_CAP; index += 1) assert.ok(store(storage, entry(`stop-${index}`)));
  const full = JSON.parse(storage.getItem(NAVIGATION_KEY));
  const publication = store(storage, entry('newest-stop'));
  assert.ok(publication);
  const persisted = JSON.parse(storage.getItem(NAVIGATION_KEY));
  persisted.records.push(full.records.at(-1));
  assert.equal(persisted.records.length, NAVIGATION_CAP + 1);
  const encoded = JSON.stringify(persisted);
  assert.ok(Buffer.byteLength(encoded) < NAVIGATION_TOTAL_BYTES);
  storage.setItem(NAVIGATION_KEY, encoded);
  assert.deepEqual(read(storage, publication), { kind: 'invalid' });
});

test('preservation: the total write byte quota drops oldest records without truncating retained entries', () => {
  const storage = memoryStorage();
  const size = NAVIGATION_ENTRY_BYTES - 4096;
  const publications = Array.from({ length: 3 }, (_, index) => store(storage, entryWithBytes(size, `stop-${index}`)));
  assert.ok(publications.every(Boolean));
  const before = JSON.parse(storage.getItem(NAVIGATION_KEY));
  assert.equal(before.records.length, publications.length);
  const newest = store(storage, entryWithBytes(size, 'newest-stop'));
  assert.ok(newest);
  const encoded = storage.getItem(NAVIGATION_KEY);
  const persisted = JSON.parse(encoded);
  const unbounded = { version: before.version, records: [persisted.records[0], ...before.records] };
  assert.ok(unbounded.records.length < NAVIGATION_CAP, 'the byte quota, not count, forces eviction');
  assert.ok(Buffer.byteLength(JSON.stringify(unbounded)) > NAVIGATION_TOTAL_BYTES);
  assert.ok(Buffer.byteLength(encoded) <= NAVIGATION_TOTAL_BYTES);
  assert.equal(persisted.records.length, publications.length);
  assert.deepEqual(read(storage, publications[0]), { kind: 'invalid' });
  const evictedUrl = new URL(navigationHref(publications[0], 'en'), 'http://localhost');
  assert.deepEqual(readNavigationPublication(storage, { pathname: evictedUrl.pathname, search: evictedUrl.search }), { kind: 'invalid' });
  for (const publication of [...publications.slice(1), newest]) {
    const restored = read(storage, publication);
    assert.equal(restored.kind, 'restored');
    assert.equal(Buffer.byteLength(JSON.stringify(restored.entry)), size);
  }
});

test('preservation: malformed, truncated, unsupported and missing records fail closed', () => {
  const storage = memoryStorage(); const publication = store(storage, entry());
  assert.ok(publication);
  assert.equal(read(storage, publication).kind, 'restored');
  const raw = storage.getItem(NAVIGATION_KEY);
  const mutations = [
    ['unsupported store version', value => { value.version += 1; }],
    ['unsupported record version', value => { value.records[0].version += 1; }],
    ['truncated entry', value => { delete value.records[0].entry.safeResponse; }],
    ['missing entry', value => { delete value.records[0].entry; }],
    ['missing record', value => { value.records = []; }],
  ];
  for (const [label, mutate] of mutations) {
    const persisted = JSON.parse(raw);
    mutate(persisted);
    storage.setItem(NAVIGATION_KEY, JSON.stringify(persisted));
    assert.deepEqual(read(storage, publication), { kind: 'invalid' }, label);
  }
  for (const malformed of ['not json', raw.slice(0, -1)]) {
    storage.setItem(NAVIGATION_KEY, malformed);
    assert.deepEqual(read(storage, publication), { kind: 'invalid' });
  }
});

test('preservation: empty or unavailable storage returns invalid for an explicit reference without throwing', () => {
  const storage = memoryStorage(); const publication = store(storage, entry());
  assert.ok(publication);
  const url = new URL(navigationHref(publication, 'en'), 'http://localhost');
  const options = { pathname: url.pathname, search: url.search };
  for (const unavailable of [memoryStorage(), null, { getItem() { throw new Error('storage unavailable'); } }]) {
    assert.deepEqual(readNavigationPublication(unavailable, options), { kind: 'invalid' });
  }
});
