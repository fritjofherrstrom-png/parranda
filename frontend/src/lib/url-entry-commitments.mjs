import { anchorKey } from './recompose-retention.mjs';
import { isComposedEntry, savedEntryId, normalizeSavedWalkKey, savedEntryAnchorKey } from './anywhere-storage.mjs';
import { readCommitmentSnapshot } from './commitment-snapshot.mjs';
import { validPlaceRef } from './anywhere-share.mjs';

const empty = () => ({ applies: false, entries: {} });
const label = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const preferences = values => Array.isArray(values) && values.every(value => typeof value === 'string')
  ? JSON.stringify([...values].sort()) : null;
const knownRhythm = value => ['calm', 'balanced', 'full', 'free', 'short', 'long'].includes(value);

/**
 * An ordinary reload asks the same question again, with fresh acquisition.
 * Recover only that question's bounded choices, never its response or verdict.
 * New navigation (including shared links) is independent even at the same URL.
 * Exact positions are deliberately not persisted. A freshly shared position may
 * match the coarse identity already carried by the saved ledger. Explicit snapshot
 * restore stays a separate operation with its existing contract.
 */
export function urlEntryCommitments(entry, { navigationType, anchor, dateIso, selected, walkKey } = {}) {
  if (navigationType !== 'reload' || !isComposedEntry(entry)) return empty();
  const inputs = entry.inputs;
  if (!inputs || inputs.city || entry.dateIso !== dateIso ||
      entry.safeResponse?.days?.[0]?.date !== dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso || '') ||
      !knownRhythm(inputs.walkKey) || !knownRhythm(walkKey) ||
      normalizeSavedWalkKey(inputs.walkKey) !== normalizeSavedWalkKey(walkKey) ||
      !preferences(inputs.selected) || preferences(inputs.selected) !== preferences(selected)) return empty();
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateIso) return empty();

  const savedAnchor = savedEntryAnchorKey(entry);
  if (inputs.mode === 'near_me') {
    if (!anchor?.coords || !savedAnchor || anchorKey(anchor) !== savedAnchor) return empty();
  } else {
    if (inputs.mode !== 'typed' || anchor?.coords) return empty();
    const requestedRef = validPlaceRef(anchor?.placeRef);
    const savedRef = validPlaceRef(inputs.placeRef);
    if ((anchor?.placeRef && !requestedRef) || (inputs.placeRef && !savedRef)) return empty();
    if (requestedRef || savedRef) {
      if (requestedRef !== savedRef) return empty();
    } else {
      // A lost namesake qualifier is not the same location. Without a durable
      // identity require both query and selected label to agree independently.
      if (!label(anchor?.place) || label(anchor.place) !== label(inputs.place) ||
          label(anchor.selectionLabel || anchor.place) !== label(inputs.placeLabel || inputs.place)) return empty();
    }
  }
  const expectedDayKey = savedEntryId({ city: inputs.city, place: inputs.place, placeLabel: inputs.placeLabel,
    dateIso, selected: inputs.selected, walkKey: inputs.walkKey });
  if (!savedAnchor || entry.id !== expectedDayKey) return empty();
  const snapshot = readCommitmentSnapshot(entry.commitments, { anchorKey: savedAnchor, dayKey: expectedDayKey });
  return snapshot.applies ? { applies: true, entries: snapshot.entries } : empty();
}
