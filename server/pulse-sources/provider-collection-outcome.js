"use strict";

const COLLECTION_STATUSES = new Set(["ok", "empty", "failed", "unavailable"]);

function buildProviderCollectionOutcome(status, { reason = null, eventRows = 0 } = {}) {
  const normalizedStatus = COLLECTION_STATUSES.has(status) ? status : "failed";
  return {
    status: normalizedStatus,
    reason: normalizeReason(reason),
    event_rows: nonNegativeInteger(eventRows),
  };
}

function normalizeProviderCollectionOutcome(value, { eventRows = 0 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildProviderCollectionOutcome(eventRows > 0 ? "ok" : "empty", {
      reason: eventRows > 0 ? null : "source_empty",
      eventRows,
    });
  }
  return buildProviderCollectionOutcome(value.status, {
    reason: value.reason,
    eventRows: value.event_rows ?? eventRows,
  });
}

function registryStatusForCollectionOutcome(outcome) {
  if (outcome.status === "failed") return "failed";
  if (outcome.status === "unavailable") return "skipped";
  return "ok";
}

function normalizeReason(value) {
  if (typeof value !== "string") return null;
  const reason = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return reason || null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

module.exports = {
  COLLECTION_STATUSES,
  buildProviderCollectionOutcome,
  normalizeProviderCollectionOutcome,
  registryStatusForCollectionOutcome,
};
