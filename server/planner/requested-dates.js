"use strict";

/**
 * The dates a compose request may ask for.
 *
 * Every date runs the whole recommendation flow once — route profiles, stop
 * ordering, Pulse, weather and live handling — inside a single HTTP request.
 * Unbounded, that is a public work multiplier: measured on staging, one date
 * took 3.3s and thirty took 315s, so the cost grows steeply rather than
 * linearly and one request can occupy the event loop for minutes.
 *
 * The engine itself still composes multi-day ranges; this is the HTTP
 * boundary's own bound, and it is deliberately the narrowest thing the shipped
 * client actually asks for. Multi-day is not a product capability yet, so the
 * public contract is one day. Widening it is a deliberate change here, not a
 * side effect of a caller sending more.
 *
 * Nothing is silently trimmed. A request that asks for more than the contract
 * allows is refused and told so, because quietly returning fewer days than
 * were asked for is the kind of dishonesty the rest of this engine avoids.
 */

const MAX_REQUESTED_DATES = 1;
// Guards the array BEFORE de-duplication, so a huge payload of one repeated
// date is refused on its own terms rather than collapsing to something that
// looks reasonable.
const MAX_RAW_REQUESTED_DATES = 8;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely something ISO-shaped: "2026-02-31" and
 * "2026-13-01" both match the pattern and neither exists.
 */
function isRealIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * @returns {{ ok: true, dates: string[] }
 *   | { ok: false, error: string, detail: string }}
 */
function parseRequestedDates(value) {
  if (value === undefined || value === null) return { ok: true, dates: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "invalid_dates", detail: "dates must be an array of ISO dates" };
  }
  if (value.length === 0) return { ok: true, dates: [] };
  if (value.length > MAX_RAW_REQUESTED_DATES) {
    return {
      ok: false,
      error: "too_many_dates",
      detail: `dates accepts at most ${MAX_RAW_REQUESTED_DATES} entries, received ${value.length}`,
    };
  }

  const invalid = value.filter((entry) => !isRealIsoDate(entry));
  if (invalid.length) {
    return {
      ok: false,
      error: "invalid_dates",
      detail: `dates must be real ISO calendar dates (YYYY-MM-DD); rejected: ${invalid
        .map((entry) => JSON.stringify(entry))
        .slice(0, 3)
        .join(", ")}`,
    };
  }

  const unique = [...new Set(value)].sort();
  if (unique.length > MAX_REQUESTED_DATES) {
    return {
      ok: false,
      error: "too_many_dates",
      detail: `a plan covers ${MAX_REQUESTED_DATES} day at a time; received ${unique.length} distinct dates`,
    };
  }

  return { ok: true, dates: unique };
}

module.exports = {
  MAX_REQUESTED_DATES,
  MAX_RAW_REQUESTED_DATES,
  isRealIsoDate,
  parseRequestedDates,
};
