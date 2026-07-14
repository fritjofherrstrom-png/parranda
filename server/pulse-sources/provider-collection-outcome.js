"use strict";

const COLLECTION_STATUSES = new Set(["ok", "empty", "failed", "unavailable"]);
const COLLECTION_REASON_TOKENS = new Set([
  "collection_context_unavailable",
  "collection_outcome_missing",
  "provider_failed",
  "source_collect_failed",
  "source_credentials_unavailable",
  "source_empty",
  "source_endpoint_unavailable",
  "source_fetch_failed",
  "source_fetch_unavailable",
  "source_payload_invalid",
  "source_timeout",
  "source_unavailable",
  "trusted_anchor_unavailable",
]);
const HTTP_REASON_PATTERN = /^source_http_(?:[1-5]\d{2}|not_ok)$/;

function buildProviderCollectionOutcome(status, { reason = null, eventRows = 0 } = {}) {
  const normalizedStatus = COLLECTION_STATUSES.has(status) ? status : "failed";
  return {
    status: normalizedStatus,
    reason: classifyCollectionReason(reason, { fallback: fallbackReasonForStatus(normalizedStatus) }),
    event_rows: nonNegativeInteger(eventRows),
  };
}

function normalizeProviderCollectionOutcome(value, { eventRows = 0 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildProviderCollectionOutcome(eventRows > 0 ? "ok" : "unavailable", {
      reason: eventRows > 0 ? null : "collection_outcome_missing",
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

function classifyCollectionReason(value, { fallback = null } = {}) {
  const reason = normalizeReason(value);
  if (!reason) return fallback;
  if (COLLECTION_REASON_TOKENS.has(reason) || HTTP_REASON_PATTERN.test(reason)) return reason;
  return fallback;
}

function classifyProviderFailureReason(value) {
  return classifyCollectionReason(value, { fallback: "provider_failed" });
}

function fallbackReasonForStatus(status) {
  if (status === "empty") return "source_empty";
  if (status === "failed") return "provider_failed";
  if (status === "unavailable") return "source_unavailable";
  return null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

module.exports = {
  COLLECTION_STATUSES,
  buildProviderCollectionOutcome,
  classifyProviderFailureReason,
  normalizeProviderCollectionOutcome,
  registryStatusForCollectionOutcome,
};
