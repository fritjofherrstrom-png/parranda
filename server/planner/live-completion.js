"use strict";

const { randomBytes } = require('node:crypto');
const { shapeCollectedLiveEvents } = require('../place-candidates/live-event-query');

// Non-JSON capability: only the trusted supply can bind a read to the exact
// producer generation. Public geometry, references and event rows cannot do so.
const LIVE_COLLECTION_READ = Symbol('liveCollectionRead');
const RETENTION_MS = 120000;
const MAX_RETAINED = 128;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

function createLiveCompletionStore({ now = () => Date.now() } = {}) {
  const entries = new Map();
  function sweep() {
    for (const [token, entry] of entries) if (entry.expiresAt <= now()) entries.delete(token);
  }
  function issue(collected) {
    sweep();
    if (!collected?.pending || typeof collected[LIVE_COLLECTION_READ] !== 'function' || entries.size >= MAX_RETAINED) return null;
    const token = randomBytes(24).toString('hex');
    entries.set(token, { read: collected[LIVE_COLLECTION_READ], expiresAt: now() + RETENTION_MS, terminal: null });
    return { version: 1, token, expires_in_ms: RETENTION_MS };
  }
  function read(token) {
    sweep();
    const entry = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) && entries.get(token);
    if (!entry) return { status: 410, body: { error: 'live_completion_expired' } };
    if (entry.terminal) return entry.terminal;
    try {
      const liveEvents = shapeCollectedLiveEvents(entry.read());
      if (!liveEvents) throw new Error('invalid_live_completion');
      const result = { status: liveEvents.pending ? 202 : 200, body: {
        live_events: liveEvents,
        live_completion: { version: 1, state: liveEvents.pending ? 'pending' : 'ready', route_upgrade: entry.authorizedUpgrade ? 'explicit_request' : 'not_supported' },
      } };
      if (Buffer.byteLength(JSON.stringify(result.body)) > MAX_RESULT_BYTES) throw new Error('large_live_completion');
      if (!liveEvents.pending) entry.terminal = JSON.parse(JSON.stringify(result));
      return entry.terminal || result;
    } catch (_) {
      entry.terminal = { status: 503, body: { error: 'live_completion_unavailable' } };
      return entry.terminal;
    }
  }
  function bindUpgrade(token, upgrade) {
    sweep();
    const entry = entries.get(token);
    if (!entry || typeof upgrade !== 'function') return false;
    entry.upgrade = upgrade;
    entry.authorizedUpgrade = true;
    return true;
  }
  async function upgrade(token) {
    sweep();
    const entry = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) && entries.get(token);
    if (!entry) return { status: 410, body: { error: 'live_completion_expired' } };
    if (!entry.upgrade && !entry.attempt) return { status: 409, body: { error: 'live_route_upgrade_not_authorized' } };
    const completed = read(token);
    if (completed.status !== 200) return completed;
    // Reserve BEFORE any awaited work. Duplicates share even a failed attempt.
    if (!entry.attempt) {
      let timer;
      const expiry = new Promise(resolve => {
        timer = setTimeout(() => {
          entries.delete(token);
          entry.upgrade = null;
          resolve({ status: 410, body: { error: 'live_completion_expired' } });
        }, Math.max(0, entry.expiresAt - now()));
        timer.unref?.();
      });
      const run = entry.upgrade;
      const execution = Promise.resolve().then(async () => {
        try {
          const body = await run(completed.body.live_events);
          if (Buffer.byteLength(JSON.stringify(body)) > MAX_RESULT_BYTES) throw new Error('large_live_upgrade');
          return { status: 200, body: JSON.parse(JSON.stringify(body)) };
        } catch (_) {
          return { status: 503, body: { error: 'live_route_upgrade_unavailable', live_route_upgrade: { version: 1, state: 'failed' } } };
        } finally {
          entry.upgrade = null;
        }
      });
      entry.attempt = Promise.race([execution, expiry]).finally(() => clearTimeout(timer));
    }
    const result = await entry.attempt;
    if (entry.expiresAt <= now() || entries.get(token) !== entry) return { status: 410, body: { error: 'live_completion_expired' } };
    return result;
  }
  return { issue, read, bindUpgrade, upgrade };
}

module.exports = { LIVE_COLLECTION_READ, createLiveCompletionStore };
