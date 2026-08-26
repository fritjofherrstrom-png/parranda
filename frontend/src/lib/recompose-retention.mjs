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
  const city = typeof anchor.city === "string" ? anchor.city.trim().toLowerCase() : "";
  if (city) return `city:${city}`;
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
 * A commitment belongs to the geography it was made in.
 *
 * "Not this one" and "keep this one" are statements about a place in a
 * specific geography. Carried into a different place they are at best
 * meaningless — the ledger would claim choices the user never made there — and
 * at worst wrong, since candidate ids are loader-issued and not guaranteed
 * unique across providers. Same anchor keeps them; genuinely new geography
 * drops them. Anchor identity is the same notion the day itself uses, so the
 * two can never disagree.
 *
 * Commitments are held as one map of candidate id -> { kind, label } rather
 * than as two lists. A candidate therefore has exactly one commitment at a
 * time, and the newest explicit action replaces the previous one — the server
 * can never be handed "must include X" and "exclude X" together, because that
 * state cannot be represented. The label is display-only: it lets the day say
 * WHICH place it could not keep, and it travels with the commitment so the two
 * cannot fall out of sync.
 *
 * @returns {{ entries: Record<string, {kind: string, label: string}>, excludedIds: string[], pinnedIds: string[], applies: boolean }}
 */
export function scopeCommitmentsToAnchor({ entries = {}, ledgerAnchorKey = null, nextAnchorKey = null } = {}) {
  const source = entries && typeof entries === "object" ? entries : {};
  const keys = Object.keys(source);
  const applies = keys.length === 0 ? true : anchorsMatch(ledgerAnchorKey, nextAnchorKey);
  const scoped = applies ? source : {};
  return {
    entries: scoped,
    excludedIds: Object.keys(scoped).filter((id) => scoped[id]?.kind === "exclude"),
    pinnedIds: Object.keys(scoped).filter((id) => scoped[id]?.kind === "pin"),
    applies,
  };
}

/**
 * Which kept places the composed day does NOT contain.
 *
 * A pin is a request, not a guarantee: the server resolves it against the
 * candidates it loaded itself, and it will not invent a place to satisfy one.
 * When it cannot honour a pin it says so — and the day on screen is the proof.
 * Deriving the answer from the RENDERED stops rather than from the request is
 * what keeps the notice honest: it can only ever claim what the user can see.
 *
 * Silent while the day is stale, because the stops on screen belong to the
 * previous request and would accuse the wrong day.
 *
 * @returns {{ labels: string[], count: number }}
 */
export function unhonouredPins({
  entries = {},
  pinnedIds = [],
  stopIds = [],
  isStale = false,
  // The server's own verdict: [{ id, reason }] for each commitment the
  // published day did not contain. Reasons are read, never derived — a client
  // can see that a stop is absent, but not whether the reservoir ever held it,
  // and guessing between those is the fabrication this avoids.
  serverReasons = [],
} = {}) {
  if (isStale) return { labels: [], count: 0, reasons: [] };
  const present = new Set((Array.isArray(stopIds) ? stopIds : []).filter(Boolean));
  const missing = (Array.isArray(pinnedIds) ? pinnedIds : []).filter((id) => id && !present.has(id));
  const byId = new Map(
    (Array.isArray(serverReasons) ? serverReasons : [])
      .filter((entry) => entry && entry.id != null)
      .map((entry) => [String(entry.id), entry.reason]),
  );
  return {
    labels: missing.map((id) => String(entries?.[id]?.label || "").trim()).filter(Boolean),
    count: missing.length,
    // One per missing commitment, in the order the day lists them. A reason of
    // null means the server did not name one, and the caller must fall back to
    // the plain sentence rather than inventing a cause.
    reasons: missing.map((id) => ({
      id,
      label: String(entries?.[id]?.label || "").trim(),
      reason: byId.get(String(id)) ?? null,
    })),
  };
}

function anchorsMatch(ledgerAnchorKey, nextAnchorKey) {
  return Boolean(ledgerAnchorKey) && ledgerAnchorKey === nextAnchorKey;
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
