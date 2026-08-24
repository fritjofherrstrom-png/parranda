"use strict";

/**
 * WHY a commitment went unmet — a bounded, server-owned vocabulary.
 *
 * The day could already say THAT a kept place did not make it. It could not say
 * why, and the causes had genuinely diverged: a place the server never loaded,
 * one it loaded but never offered to the composer, one the requested walk could
 * not afford, and one the composer simply did not choose. All four read
 * identically to the user, and three of them are actionable in different ways.
 *
 * The vocabulary lives here rather than in the client because only the server
 * knows which of these happened. A client inspecting the response can see that
 * a stop is absent; it cannot see whether the reservoir ever held it. Inferring
 * a reason from route absence is exactly the fabrication this exists to
 * prevent, so the contract is: the server names the reason, the client renders
 * the name it is given, and anything it does not recognise falls back to the
 * plain "could not fit" sentence it has always had.
 *
 * Bounded on purpose. A free-text reason would become a place for the engine to
 * explain itself at length, and every value here has to be worth a sentence in
 * every supported language.
 */

const PIN_REFUSAL_REASONS = Object.freeze({
  /** Nothing the server loaded for this request matched the id. */
  UNKNOWN_CANDIDATE: "unknown_candidate",
  /** Loaded and gated, but never offered to the composer for any role. */
  NOT_OFFERED_TO_ROUTE: "not_offered_to_route",
  /** The composer had it and the finished day could not afford the walk. */
  WALKING_BUDGET: "walking_budget",
  /** The composer had it, the walk allowed it, and it still was not chosen. */
  NOT_SELECTED: "not_selected",
  /** The day that honoured it was not the day published (promotion withheld). */
  DAY_NOT_PUBLISHED: "day_not_published",
});

const VALID_REASONS = new Set(Object.values(PIN_REFUSAL_REASONS));

function isPinRefusalReason(value) {
  return VALID_REASONS.has(value);
}

function idSet(items, read) {
  const out = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = read(item);
    if (id != null && id !== "") out.add(String(id));
  }
  return out;
}

/**
 * Classify each requested pin the published day does not contain.
 *
 * Order matters, and it is the order of how far the candidate got: never
 * loaded, then loaded but never offered, then offered but unaffordable, then
 * offered and affordable but not chosen. The first stage that stops a candidate
 * is the honest answer, because the later ones never ran for it.
 *
 * @param {object} params
 * @param {string[]} params.pinnedIds        ids the request asked for
 * @param {object[]} params.stops            main_stops of the PUBLISHED day
 * @param {object} [params.plannerRoles]     the gated role reservoir
 * @param {object[]} [params.sourceCandidates] what was offered to the composer
 * @param {string[]} [params.loadedCandidateIds] ids the trusted loader actually resolved
 * @param {string[]} [params.shedForBudget]  pins the walking budget dropped
 * @returns {Array<{id: string, reason: string}>} one entry per unmet pin
 */
function classifyUnhonouredPins({
  pinnedIds = [],
  stops = [],
  plannerRoles = null,
  sourceCandidates = [],
  loadedCandidateIds = null,
  shedForBudget = [],
} = {}) {
  const requested = (Array.isArray(pinnedIds) ? pinnedIds : []).map(String);
  const present = idSet(stops, (stop) => stop?.id ?? stop?.place_id ?? stop?.candidate_id);
  const offered = idSet(sourceCandidates, (candidate) => candidate?.id);
  const shed = new Set((Array.isArray(shedForBudget) ? shedForBudget : []).map(String));

  const reservoir = new Set();
  for (const roleEntry of Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : []) {
    for (const candidate of Array.isArray(roleEntry?.candidates) ? roleEntry.candidates : []) {
      if (candidate?.candidate_id != null) reservoir.add(String(candidate.candidate_id));
    }
  }
  const loaded = Array.isArray(loadedCandidateIds)
    ? new Set(loadedCandidateIds.filter((id) => id != null && id !== "").map(String))
    : reservoir;

  const out = [];
  for (const id of requested) {
    if (present.has(id)) continue;
    if (!loaded.has(id) && !offered.has(id)) {
      out.push({ id, reason: PIN_REFUSAL_REASONS.UNKNOWN_CANDIDATE });
      continue;
    }
    if (!offered.has(id)) {
      out.push({ id, reason: PIN_REFUSAL_REASONS.NOT_OFFERED_TO_ROUTE });
      continue;
    }
    if (shed.has(id)) {
      out.push({ id, reason: PIN_REFUSAL_REASONS.WALKING_BUDGET });
      continue;
    }
    out.push({ id, reason: PIN_REFUSAL_REASONS.NOT_SELECTED });
  }
  return out;
}

/**
 * The published day is the baseline, not the engine's.
 *
 * Whatever the engine did with these commitments describes a day nobody
 * received, so every unmet pin is attributed to that and to nothing else.
 */
function attributeToWithheldDay(pinnedIds = [], stops = []) {
  const present = idSet(stops, (stop) => stop?.id ?? stop?.place_id ?? stop?.candidate_id);
  return (Array.isArray(pinnedIds) ? pinnedIds : [])
    .map(String)
    .filter((id) => !present.has(id))
    .map((id) => ({ id, reason: PIN_REFUSAL_REASONS.DAY_NOT_PUBLISHED }));
}

module.exports = {
  PIN_REFUSAL_REASONS,
  attributeToWithheldDay,
  classifyUnhonouredPins,
  isPinRefusalReason,
};
