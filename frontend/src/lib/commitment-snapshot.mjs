/**
 * The commitments a saved day answered, stored with that day.
 *
 * Restoring used to drop the ledger outright, and that was the honest thing to
 * do: saved days carried no record of what they were composed under, so a
 * same-place snapshot would have inherited whatever the live ledger happened to
 * hold — a ledger the stops on screen had never been asked about.
 *
 * The fix is not to stop clearing. It is to give the saved day something it can
 * answer WITH: an immutable, versioned record of the exact ledger the request
 * carried and the applied-pin verdict that came back. A restore may then carry
 * commitments only when that record is present, intact, of a version this build
 * understands, and belongs to this day and this geography. Anything else — a
 * day saved by an older build, a hand-edited localStorage, a snapshot from
 * another place or another day — fails closed to no commitments, which is
 * exactly the previous behaviour.
 *
 * BOTH keys are required, because neither is sufficient alone. The anchor says
 * where; the day key says which day at that anchor. v1 bound only the anchor,
 * so a record written for Thursday was accepted on Friday's day for the same
 * place, and a record written under one set of preferences was accepted under
 * another — same geography, different question, and the stops on screen had
 * never answered it.
 *
 * Bounded on write as well as read: this lives in localStorage alongside up to
 * SAVED_CAP days, and a ledger is user input.
 */

/**
 * Bumped whenever the stored shape changes meaning. An unknown version is not
 * upgraded in place — it is refused, because guessing what an older or newer
 * build meant is precisely the kind of inference this module exists to prevent.
 *
 * v1 carried no day key. Rather than infer one for it, v1 records fail closed
 * to no ledger: a v1 snapshot cannot prove which day it belongs to, and that
 * is the whole question.
 */
export const COMMITMENT_SNAPSHOT_VERSION = 2;

// Mirrors the server's own ledger limits (MAX_PINNED_IDS / MAX_EXCLUDED_IDS).
// Storing more than the server would ever accept is storage spent on something
// that could not be sent.
export const MAX_SNAPSHOT_PINS = 12;
export const MAX_SNAPSHOT_EXCLUSIONS = 40;
const MAX_LABEL_LENGTH = 120;
const MAX_REASON_LENGTH = 64;
const REASON_PATTERN = /^[a-z][a-z_]*$/;

function cleanId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= 128 ? id : "";
}

function cleanLabel(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_LABEL_LENGTH) : "";
}

function cleanReason(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  return reason.length <= MAX_REASON_LENGTH && REASON_PATTERN.test(reason) ? reason : "";
}

/**
 * Freeze the ledger and verdict a composed day answered.
 *
 * `entries` is the scoped ledger the request carried; `appliedPins` is the
 * verdict snapshot recorded beside the classification. Both are copied, never
 * referenced, so later edits to the live ledger cannot reach back into a day
 * that has already been answered.
 *
 * @returns {{version: number, anchorKey: string, dayKey: string, entries: object, appliedPins: object[], refusals: object[]}|null}
 */
export function buildCommitmentSnapshot({
  anchorKey = null,
  dayKey = null,
  entries = {},
  appliedPins = [],
  refusals = [],
} = {}) {
  const key = typeof anchorKey === "string" ? anchorKey.trim() : "";
  const day = typeof dayKey === "string" ? dayKey.trim() : "";
  // No day key, no record. A snapshot that cannot say which day it belongs to
  // is the exact ambiguity this exists to remove.
  if (!key || !day) return null;

  const source = entries && typeof entries === "object" ? entries : {};
  const kept = {};
  let pins = 0;
  let exclusions = 0;
  for (const id of Object.keys(source)) {
    const cleanedId = cleanId(id);
    const kind = source[id]?.kind;
    if (!cleanedId || (kind !== "pin" && kind !== "exclude")) continue;
    if (kind === "pin") {
      if (pins >= MAX_SNAPSHOT_PINS) continue;
      pins += 1;
    } else {
      if (exclusions >= MAX_SNAPSHOT_EXCLUSIONS) continue;
      exclusions += 1;
    }
    kept[cleanedId] = { kind, label: cleanLabel(source[id]?.label) };
  }

  const verdict = (Array.isArray(appliedPins) ? appliedPins : [])
    .map((pin) => ({ id: cleanId(pin?.id), kind: "pin", label: cleanLabel(pin?.label) }))
    .filter((pin) => pin.id)
    .slice(0, MAX_SNAPSHOT_PINS);

  // Reasons are part of the same verdict snapshot. Keep only one bounded token
  // for a pin this day actually answered; raw/free-text server output and
  // unrelated ids never become durable localStorage state.
  const appliedIds = new Set(verdict.map((pin) => pin.id));
  const seenRefusals = new Set();
  const keptRefusals = [];
  for (const refusal of Array.isArray(refusals) ? refusals : []) {
    const id = cleanId(refusal?.id);
    const reason = cleanReason(refusal?.reason);
    if (!id || !reason || !appliedIds.has(id) || seenRefusals.has(id)) continue;
    seenRefusals.add(id);
    keptRefusals.push({ id, reason });
    if (keptRefusals.length >= MAX_SNAPSHOT_PINS) break;
  }

  if (!Object.keys(kept).length && !verdict.length) return null;
  return {
    version: COMMITMENT_SNAPSHOT_VERSION,
    anchorKey: key,
    dayKey: day,
    entries: kept,
    appliedPins: verdict,
    refusals: keptRefusals,
  };
}

/**
 * Read a stored snapshot back, for THIS day at THIS anchor.
 *
 * Every refusal is named rather than silently swallowed, so a day that declines
 * to carry its commitments can say which rule declined it.
 *
 * @returns {{applies: boolean, reason: string, entries: object, appliedPins: object[], refusals: object[]}}
 */
export function readCommitmentSnapshot(snapshot, { anchorKey = null, dayKey = null } = {}) {
  const empty = (reason) => ({ applies: false, reason, entries: {}, appliedPins: [], refusals: [] });

  if (!snapshot || typeof snapshot !== "object") return empty("absent");
  // A day saved before commitments were stored at all. Not a fault — just
  // nothing to answer with.
  if (snapshot.version !== COMMITMENT_SNAPSHOT_VERSION) return empty("version_mismatch");

  const storedKey = typeof snapshot.anchorKey === "string" ? snapshot.anchorKey.trim() : "";
  const wantedKey = typeof anchorKey === "string" ? anchorKey.trim() : "";
  if (!storedKey || !wantedKey) return empty("anchor_unknown");
  // Matching geography is necessary but NOT sufficient: two saved days can
  // share an anchor and differ in date or preferences, and each answered its
  // own question.
  if (storedKey !== wantedKey) return empty("anchor_changed");

  const storedDay = typeof snapshot.dayKey === "string" ? snapshot.dayKey.trim() : "";
  const wantedDay = typeof dayKey === "string" ? dayKey.trim() : "";
  if (!storedDay || !wantedDay) return empty("day_unknown");
  if (storedDay !== wantedDay) return empty("day_changed");

  const rebuilt = buildCommitmentSnapshot({
    anchorKey: storedKey,
    dayKey: storedDay,
    entries: snapshot.entries,
    appliedPins: snapshot.appliedPins,
    refusals: snapshot.refusals,
  });
  // Re-normalising on read is what makes hand-edited or truncated storage safe:
  // anything that does not survive the same rules it was written under is not
  // trusted back in.
  if (!rebuilt) return empty("empty_or_malformed");

  return {
    applies: true,
    reason: "same_day_same_anchor",
    entries: rebuilt.entries,
    appliedPins: rebuilt.appliedPins,
    refusals: rebuilt.refusals,
  };
}
