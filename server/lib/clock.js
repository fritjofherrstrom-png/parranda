"use strict";

// A server-injected clock is either a function returning the instant or an
// object whose now() returns it; either may give a Date, an ISO string or epoch
// milliseconds. Every reader goes through here so that one shape can never be
// silently ignored in favour of wall time.

/**
 * @returns {Date|null} wall time when no clock is injected; null when an
 *   injected clock throws or gives no valid instant, so the caller decides
 *   between honest "unknown" and wall time.
 */
function readClockInstant(clock) {
  if (clock == null) return new Date();
  let raw;
  try {
    raw = typeof clock === "function"
      ? clock()
      : typeof clock.now === "function" ? clock.now() : undefined;
  } catch (_error) {
    return null;
  }
  const date = raw instanceof Date
    ? new Date(raw.getTime())
    : typeof raw === "string" || typeof raw === "number" ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function serverInstant(clock) {
  return readClockInstant(clock) || new Date();
}

module.exports = { readClockInstant, serverInstant };
