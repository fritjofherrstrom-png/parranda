"use strict";

const { createConcurrencyGate, createFixedWindowLimiter, clientKey, guardSettings } = require('../lib/public-access-guard');

// Read an already admitted server-owned record. This handler never accepts a
// publication body, acquires sources or calls the planner.
function createPublishedDayReadHandler(store, { env = process.env, now = () => Date.now() } = {}) {
  const gate = createConcurrencyGate({ max: 4 });
  // Disk reads have a separate cheap budget; they never consume or enlarge the
  // upstream acquisition allowance. Reuse the operator's trusted client identity.
  const limiter = createFixedWindowLimiter({ windowMs: 60000, max: 120, now });
  const settings = guardSettings(env);
  return async (request, response) => {
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response.set('Allow', 'GET, HEAD').status(405).json({ error: 'day_snapshot_read_only' });
    }
    if (request.originalUrl.includes('?') || request.body !== undefined
      || Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding'] !== undefined) {
      return response.status(400).json({ error: 'invalid_day_snapshot_request' });
    }
    const limit = limiter.check(clientKey(request, { mode: settings.identityMode, trustedHops: settings.trustedHops }));
    if (!limit.allowed) {
      return response.set('Retry-After', String(limit.retryAfterSec)).status(429)
        .json({ error: 'day_snapshot_rate_limited', retry_after_seconds: limit.retryAfterSec });
    }
    if (!gate.tryAcquire()) {
      return response.set('Retry-After', '1').status(429).json({ error: 'day_snapshot_busy', retry_after_seconds: 1 });
    }
    try {
      const result = await store.read(request.path.slice(1));
      response.status(result.status).json(result.body);
    } catch {
      response.status(404).json({ error: 'day_snapshot_unavailable' });
    } finally {
      // A closed client does not mean an outstanding filesystem read settled.
      gate.release();
    }
  };
}

module.exports = { createPublishedDayReadHandler };
