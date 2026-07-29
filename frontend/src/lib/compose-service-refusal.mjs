const REFUSAL_KINDS = new Set(["busy", "rate_limited"]);

/**
 * Classify only the public guard's explicit machine-readable refusals. Other
 * HTTP failures stay on the normal transport-error path rather than being
 * dressed up as a known capacity condition.
 */
export function composeServiceRefusal(status, body) {
  const kind = body && typeof body.error === "string" ? body.error : null;
  if (Number(status) !== 429 || !REFUSAL_KINDS.has(kind)) return null;
  const rawRetry = Number(body && body.retry_after_seconds);
  return {
    kind,
    retry_after_seconds: Number.isFinite(rawRetry) && rawRetry > 0 ? Math.ceil(rawRetry) : null,
  };
}
