/**
 * Should the day already on screen stay while a new one composes?
 *
 * Composing a day for a cold place takes 5–20 s. Clearing the screen first
 * means every adjustment destroys a perfectly good answer and leaves the user
 * staring at a spinner, so a valid day is held as STALE until the next verdict
 * lands — then replaced atomically.
 *
 * Two honesty rules bound that:
 *
 *   - Only a day that actually answered counts. A structure-only or
 *     unavailable result has nothing worth holding.
 *   - Only the SAME anchor counts. A day for another place never stands in for
 *     the place now being asked about, not even for a second.
 *
 * A stale day must always be visibly labelled as updating, and the caller must
 * replace it with whatever the new verdict says — including "no day".
 *
 * Pure / side-effect free, like planComposeFollowup.
 */

// A day is only worth holding if it was a day.
const RETAINABLE_STATUSES = ["composed", "composed_limited"];

// GPS jitter is not a new place. ~3 decimals is ~110 m: below that the user has
// not meaningfully moved, above it the anchor is genuinely somewhere else.
const COORD_PRECISION = 3;

/**
 * Stable identity for the thing a day was composed for.
 * @returns {string|null} null when there is no usable anchor
 */
export function anchorKey(anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  const coords = anchor.coords;
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    return `coords:${coords.lat.toFixed(COORD_PRECISION)},${coords.lng.toFixed(COORD_PRECISION)}`;
  }
  const place = typeof anchor.place === "string" ? anchor.place.trim().toLowerCase() : "";
  return place ? `place:${place}` : null;
}

/**
 * @param {object} params
 * @param {boolean} params.silent            a background upgrade, not a user change
 * @param {string|null} params.previousStatus  classification status now on screen
 * @param {string|null} params.previousAnchorKey  anchor the visible day belongs to
 * @param {string|null} params.nextAnchorKey   anchor being composed for
 * @returns {{ keepPrevious: boolean, reason: string }}
 */
export function planRecomposeRetention({
  silent = false,
  previousStatus = null,
  previousAnchorKey = null,
  nextAnchorKey = null,
} = {}) {
  // A silent upgrade never tore the screen down and must not start.
  if (silent) return { keepPrevious: true, reason: "silent_upgrade_keeps_day" };
  if (!RETAINABLE_STATUSES.includes(previousStatus)) {
    return { keepPrevious: false, reason: previousStatus ? "previous_not_a_day" : "no_previous_day" };
  }
  if (!previousAnchorKey || !nextAnchorKey || previousAnchorKey !== nextAnchorKey) {
    return { keepPrevious: false, reason: "anchor_changed" };
  }
  return { keepPrevious: true, reason: "same_anchor_recompose" };
}

/**
 * A dismissal belongs to the day it was made on.
 *
 * "Not this one" is a statement about a place in a specific geography. Carried
 * into a different place it is at best meaningless — the ledger would claim a
 * dismissal the user never made there — and at worst wrong, since not every
 * candidate id is guaranteed globally unique across providers.
 *
 * Same anchor keeps it; genuinely new geography drops it. Anchor identity is
 * the same notion the day itself uses, so the two can never disagree.
 *
 * @returns {{ ids: string[], applies: boolean }}
 */
export function scopeExcludedToAnchor({ ids = [], ledgerAnchorKey = null, nextAnchorKey = null } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return { ids: [], applies: true };
  const applies = Boolean(ledgerAnchorKey) && ledgerAnchorKey === nextAnchorKey;
  return { ids: applies ? list : [], applies };
}

/**
 * What the user is told about a day that is no longer current.
 * @returns {"updating"|"update_failed"|null}
 */
export function staleDayNotice({ isStale = false, phase = "idle" } = {}) {
  if (!isStale) return null;
  if (phase === "error") return "update_failed";
  if (phase === "loading") return "updating";
  return null;
}
