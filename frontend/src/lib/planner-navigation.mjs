import { savedEntryId, savedEntryAnchorKey, isComposedEntry, isEditedEmptyEntry } from './anywhere-storage.mjs';
import { encodeShareParams, validPlaceRef } from './anywhere-share.mjs';
import { readCommitmentSnapshot } from './commitment-snapshot.mjs';
import { freezeComposeDateIso } from './anywhere-payload.mjs';
import { anchorKey } from './recompose-retention.mjs';

// Private, same-tab navigation data, never a public sharing authority. History
// and URLs carry only an opaque reference; location-bearing response facts stay
// in session storage. A query identity is not an immutable publication ID.
export const NAVIGATION_KEY = 'parranda:anywhere:navigation:v1';
export const NAVIGATION_STATE_KEY = 'parrandaDayView';
export const NAVIGATION_PARAM = 'view';
export const NAVIGATION_CAP = 12;
export const NAVIGATION_ENTRY_BYTES = 1024 * 1024;
export const NAVIGATION_TOTAL_BYTES = 3 * 1024 * 1024;
const referencePattern = /^[a-f0-9]{32}$/;
const bytes = value => new TextEncoder().encode(value).byteLength;

export function navigationDayPresentation(dateIso, lang, now = new Date()) {
  const activeOffset = dateIso === freezeComposeDateIso({ dayOffset: 0, now }) ? 0
    : dateIso === freezeComposeDateIso({ dayOffset: 1, now }) ? 1 : null;
  const label = new Intl.DateTimeFormat(lang === 'sv' ? 'sv-SE' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dateIso}T00:00:00Z`));
  return { label, activeOffset };
}

function publicationAnchorKey(entry) {
  const saved = savedEntryAnchorKey(entry);
  if (saved) return saved;
  const input = entry.inputs;
  // No ledger needs carrying, but a position day still has published source
  // geometry. This binds a display view only; it never returns a GPS fix.
  if (input?.mode !== 'near_me' || entry.commitments != null ||
      input.city || input.place || input.placeLabel || input.placeRef) return null;
  const first = entry.safeResponse?.days?.[0]?.primary_route?.map_route_points?.[0];
  const anchors = [entry.safeResponse?.agnostic_route_output_experiment?.source_status?.anchor,
    first?.role === 'start' ? first : null].filter(value => value != null);
  if (!anchors.length || anchors.some(value => !Number.isFinite(value?.lat) || !Number.isFinite(value?.lng) ||
      Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180)) return null;
  const key = anchorKey({ coords: anchors[0] });
  return anchors.every(value => anchorKey({ coords: value }) === key) ? key : null;
}

function validEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.inputs ||
      (!isComposedEntry(entry) && !isEditedEmptyEntry(entry))) return false;
  const date = entry.dateIso;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date ||
      entry.safeResponse?.days?.[0]?.date !== date) return false;
  const input = entry.inputs;
  if (!['typed', 'near_me'].includes(input.mode) || !Array.isArray(input.selected) ||
      (input.placeRef && !validPlaceRef(input.placeRef))) return false;
  if (entry.id !== savedEntryId({ ...input, dateIso: date })) return false;
  if (input.mode === 'typed' && !String(input.place || '').trim() && !input.placeRef) return false;
  const anchor = publicationAnchorKey(entry);
  if (!anchor) return false;
  if (entry.commitments != null && !readCommitmentSnapshot(entry.commitments, {
    anchorKey: anchor, dayKey: entry.id,
  }).applies) return false;
  const selectedDate = entry.safeResponse?.live_events?.selected_date;
  if (selectedDate && selectedDate !== date) return false;
  if (isComposedEntry(entry) && (!Array.isArray(entry.safeResponse?.days?.[0]?.primary_route?.main_stops) ||
      entry.safeResponse.days[0].primary_route.main_stops.length === 0)) return false;
  return true;
}

function neutralAddress(pathname, search) {
  const params = new URLSearchParams(search);
  params.delete('lang');
  params.delete(NAVIGATION_PARAM);
  params.sort();
  return `${pathname}?${params.toString()}`;
}

export function navigationAddress(entry, { lang = 'en', readOnly = false, pathname = '/anywhere' } = {}) {
  const input = entry.inputs || {};
  const params = readOnly ? new URLSearchParams('restore=last') : new URLSearchParams(encodeShareParams({
    place: input.place || entry.place,
    placeRef: input.placeRef,
    preferences: input.selected,
    preferencePriority: input.preferencePriority,
    dayEdit: input.dayEdit,
    invalidDayEdit: input.invalidDayEdit,
    dayOffset: input.dayOffset,
    walkKey: input.walkKey,
    lang,
  }));
  if (!readOnly && input.mode === 'near_me') params.set('anchor', 'near');
  params.set('lang', lang === 'sv' ? 'sv' : 'en');
  return `${pathname}?${params.toString()}`;
}

function readStore(storage) {
  const raw = storage.getItem(NAVIGATION_KEY);
  if (!raw) return { version: 1, records: [] };
  if (bytes(raw) > NAVIGATION_TOTAL_BYTES) return null;
  const store = JSON.parse(raw);
  return store?.version === 1 && Array.isArray(store.records) && store.records.length <= NAVIGATION_CAP
    ? store : null;
}

export function saveNavigationPublication(storage, entry, { address, readOnly = false, crypto = globalThis.crypto } = {}) {
  try {
    if (!validEntry(entry) || typeof address !== 'string') return null;
    const serialized = JSON.stringify(entry);
    if (bytes(serialized) > NAVIGATION_ENTRY_BYTES) return null;
    const copy = JSON.parse(serialized);
    // A position receipt is an execution handoff, not durable navigation data.
    delete copy.inputs.placeSelection;
    for (const key of ['live_completion', 'live_route_upgrade', 'planner_lifecycle']) delete copy.safeResponse[key];
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    const reference = [...buffer].map(value => value.toString(16).padStart(2, '0')).join('');
    const url = new URL(address, 'http://navigation.invalid');
    const record = {
      version: 1, reference, address: neutralAddress(url.pathname, url.search),
      entryAddress: neutralAddress(url.pathname, navigationAddress(copy, { pathname: url.pathname }).split('?')[1]),
      anchorKey: publicationAnchorKey(copy),
      readOnly: readOnly === true, entry: copy,
    };
    const old = readStore(storage);
    if (!old || old.records.some(value => value.reference === reference)) return null;
    const records = [record, ...old.records].slice(0, NAVIGATION_CAP);
    let encoded = JSON.stringify({ version: 1, records });
    while (records.length > 1 && bytes(encoded) > NAVIGATION_TOTAL_BYTES) {
      records.pop();
      encoded = JSON.stringify({ version: 1, records });
    }
    if (bytes(encoded) > NAVIGATION_TOTAL_BYTES) return null;
    storage.setItem(NAVIGATION_KEY, encoded);
    return { reference, address: record.address, readOnly: record.readOnly };
  } catch {
    return null;
  }
}

export function navigationHistoryState(state, publication) {
  return {
    ...(state && typeof state === 'object' ? state : {}),
    [NAVIGATION_STATE_KEY]: { version: 1, reference: publication.reference, address: publication.address },
  };
}

export function navigationHref(publication, lang) {
  const url = new URL(publication.address, 'http://navigation.invalid');
  url.searchParams.set('lang', lang === 'sv' ? 'sv' : 'en');
  url.searchParams.set(NAVIGATION_PARAM, publication.reference);
  return `${url.pathname}${url.search}`;
}

export function readNavigationPublication(storage, { pathname = '/anywhere', search = '', state = null, navigationType = null } = {}) {
  const params = new URLSearchParams(search);
  const explicit = params.has(NAVIGATION_PARAM);
  const marker = state && typeof state === 'object' ? state[NAVIGATION_STATE_KEY] : null;
  const fromHistory = ['reload', 'back_forward'].includes(navigationType) && marker != null;
  if (!explicit && !fromHistory) return { kind: 'absent' };
  try {
    if (explicit && params.getAll(NAVIGATION_PARAM).length !== 1) return { kind: 'invalid' };
    const reference = explicit ? params.get(NAVIGATION_PARAM) : marker.reference;
    if (!referencePattern.test(reference || '') || (!explicit && marker.version !== 1)) return { kind: 'invalid' };
    const store = readStore(storage);
    const record = store?.records.find(value => value.reference === reference);
    const address = neutralAddress(pathname, search);
    if (!record || record.version !== 1 || record.address !== address ||
        bytes(JSON.stringify(record.entry)) > NAVIGATION_ENTRY_BYTES ||
        (!explicit && marker.address !== address) || !validEntry(record.entry) ||
        record.anchorKey !== publicationAnchorKey(record.entry) ||
        record.entryAddress !== neutralAddress(pathname, navigationAddress(record.entry, { pathname }).split('?')[1])) return { kind: 'invalid' };
    return {
      kind: 'restored', entry: JSON.parse(JSON.stringify(record.entry)),
      publication: { reference, address, readOnly: record.readOnly === true },
    };
  } catch {
    return { kind: 'invalid' };
  }
}
