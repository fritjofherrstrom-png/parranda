"use strict";

const { randomBytes } = require('node:crypto');
const { shapeCollectedLiveEvents } = require('../place-candidates/live-event-query');
const { retainComposition } = require('./live-route-upgrade');
const { publicLiveSourceUrls, associateTerminalLiveEvidence, liveDestinationRetention } = require('../place-candidates/live-source-destination-evidence');

// Non-JSON capability: only the trusted supply can bind a read to the exact
// producer generation. Public geometry, references and event rows cannot do so.
const LIVE_COLLECTION_READ = Symbol('liveCollectionRead');
const RETENTION_MS = 120000;
const MAX_RETAINED = 128;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

// Reuse the existing iterative retained-graph budget before copying any frame.
// The source-owned Set is native private evidence, not JSON or a plain object;
// count its payload in the same graph, then preserve that exact witness.
function retainLivePublication(context) {
  try {
    if (!context || typeof context !== 'object') return null;
    const privacy = Object.getOwnPropertyDescriptor(context, 'privacy');
    if (privacy && !('value' in privacy)) return null;
    const source = privacy?.value && Object.getOwnPropertyDescriptor(privacy.value, 'publicSourceUrls');
    if (source && !('value' in source)) return null;
    const witness = source?.value;
    const urls = [];
    let bytes = 0;
    if (witness != null) {
      for (const url of Set.prototype.values.call(witness)) {
        if (typeof url !== 'string' || url.length > MAX_RESULT_BYTES) return null;
        bytes += Buffer.byteLength(url) + 16;
        if (bytes > MAX_RESULT_BYTES) return null;
        urls.push(url);
      }
    }
    // No object spread, native clone or full JSON serialization of the input.
    // Array accounting also covers witness strings shared with the public body.
    const bounded = retainComposition([context, urls]);
    if (!bounded) return null;
    // Composition replay supports dependency functions; a publication frame is
    // data-only. Do not retain an opaque closure that cannot share this budget.
    const pending = [bounded];
    const seen = new Set();
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'function') return null;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      for (const key of Reflect.ownKeys(value)) pending.push(Object.getOwnPropertyDescriptor(value, key).value);
    }
    const captured = bounded[0];
    if (witness != null) Object.defineProperty(captured.privacy, 'publicSourceUrls', { ...source, value: witness });
    return captured;
  } catch (_) { return null; }
}

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
      // Capture the original producer's evidence before JSON loses identity.
      const liveWitness = publicLiveSourceUrls(liveEvents);
      const retainedEvidence = !liveEvents.pending && liveWitness !== null && retainLivePublication({
        privacy: entry.publicationContext?.privacy,
        originalContext: entry.publicationContext,
        terminalLive: liveEvents, provenance: liveDestinationRetention(liveEvents),
        liveUrls: [...liveWitness],
      });
      const result = { status: liveEvents.pending ? 202 : 200, body: {
        live_events: liveEvents,
        live_completion: { version: 1, state: liveEvents.pending ? 'pending' : 'ready', route_upgrade: entry.authorizedUpgrade ? 'explicit_request' : 'not_supported' },
      } };
      const bodyBytes = Buffer.byteLength(JSON.stringify(result.body));
      if (bodyBytes > MAX_RESULT_BYTES) throw new Error('large_live_completion');
      if (!liveEvents.pending) {
        entry.terminal = JSON.parse(JSON.stringify(result));
        entry.terminalLive = entry.terminal.body.live_events;
        // Reserve refusal overhead from the already-bounded legacy envelope,
        // before exposing its mutable DTO. Optional failure need not serialize it.
        entry.refusalFits = bodyBytes + Buffer.byteLength(',"day_snapshot":{"version":1,"state":"unavailable"}') <= MAX_RESULT_BYTES;
        if (retainedEvidence) associateTerminalLiveEvidence(liveEvents, entry.terminalLive, liveWitness);
      }
      return entry.terminal || result;
    } catch (_) {
      entry.terminal = { status: 503, body: { error: 'live_completion_unavailable' } };
      return entry.terminal;
    }
  }
  function bindPublication(token, context, publish) {
    sweep();
    const entry = entries.get(token);
    if (!entry || entry.publicationAuthorized) return false;
    entry.publicationAuthorized = true;
    try {
      if (typeof publish !== 'function') return false;
      const captured = retainLivePublication(context);
      if (!captured) return false;
      entry.publicationContext = captured;
      entry.publish = publish;
      return true;
    } catch (_) { return false; }
  }
  async function readWithPublication(token) {
    const completed = read(token); // preserve the synchronous legacy API
    const entry = entries.get(token);
    if (completed.status !== 200 || !entry?.publicationAuthorized) return completed;
    const current = () => entries.get(token) === entry && entry.expiresAt > now();
    if (!current()) return { status: 410, body: { error: 'live_completion_expired' } };
    // Reserve once, before awaiting projection/persistence. Pending polls never
    // enter here; concurrent consumers and failures share the exact same answer.
    if (!entry.publicationAttempt) {
      let timer;
      const expired = new Promise(resolve => {
        timer = setTimeout(() => {
          if (entries.get(token) === entry) entries.delete(token);
          resolve({ status: 410, body: { error: 'live_completion_expired' } });
        }, Math.max(0, entry.expiresAt - now()));
        timer.unref?.();
      });
      const execution = Promise.resolve().then(async () => {
        const unavailable = () => entry.refusalFits
          ? { ...completed, body: { ...completed.body, day_snapshot: { version: 1, state: 'unavailable' } } }
          : completed;
        const unchanged = () => completed.body.live_events === entry.terminalLive &&
          publicLiveSourceUrls(entry.terminalLive) !== null;
        try {
          // Preflight the actual owning call site BEFORE optional serialization.
          // Refusal uses captured envelope headroom, never the changed Live graph.
          if (!unchanged()) return unavailable();
          if (!entry.refusalFits) return completed;
          const snapshot = current() && entry.publish
            ? await entry.publish(entry.publicationContext, entry.terminalLive, current)
            : { version: 1, state: 'unavailable' };
          // Storage may yield while a legacy reader changes the terminal DTO.
          if (!unchanged()) return unavailable();
          const result = { ...completed, body: { ...completed.body, day_snapshot: snapshot } };
          return Buffer.byteLength(JSON.stringify(result.body)) <= MAX_RESULT_BYTES ? result : unavailable();
        } catch (_) { return unavailable(); /* optional persistence never changes usable Live health */ }
        finally { entry.publicationContext = null; entry.publish = null; }
      });
      entry.publicationAttempt = Promise.race([execution, expired]).finally(() => clearTimeout(timer));
    }
    const result = await entry.publicationAttempt;
    if (!current()) return { status: 410, body: { error: 'live_completion_expired' } };
    // The legacy synchronous terminal DTO remains mutable. A write awaiting
    // storage, or an earlier memoized ref, cannot attest later changed facts.
    if (result.body?.day_snapshot?.state === 'ready' &&
        (result.body.live_events !== entry.terminalLive || publicLiveSourceUrls(entry.terminalLive) === null))
      return { ...result, body: { ...result.body, day_snapshot: { version: 1, state: 'unavailable' } } };
    return result;
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
  return { issue, read, readWithPublication, bindPublication, bindUpgrade, upgrade };
}

module.exports = { LIVE_COLLECTION_READ, createLiveCompletionStore, retainLivePublication };
