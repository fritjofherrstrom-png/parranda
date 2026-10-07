// A one-shot handoff between pages. Tokens are reverified by the server;
// storage is never authority for location, confidence or administrative bounds.
const KEY = 'parranda:place-choice';
export function storePlaceChoice({ place, selection, label } = {}) {
  if (!place || !selection) return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ place, selection, label, at: Date.now() })); } catch (_) {}
}
export function consumePlaceChoice(place) {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    const entry = raw ? JSON.parse(raw) : null;
    if (!entry || typeof entry.selection !== 'string' || entry.selection.length > 8192 || typeof entry.place !== 'string' || !Number.isFinite(entry.at) || Date.now() - entry.at > 24 * 60 * 60 * 1000) return {};
    if (entry.place.trim().toLowerCase() === String(place).trim().toLowerCase()) return { placeSelection: entry.selection, selectionLabel: typeof entry.label === 'string' ? entry.label : undefined };
    return { placeContextSelection: entry.selection };
  } catch (_) { return {}; }
}
