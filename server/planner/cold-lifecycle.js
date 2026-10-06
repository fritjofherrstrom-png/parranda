"use strict";

const { randomBytes } = require('node:crypto');
const { SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../place-candidates/background-source');
const { normalizeUserIntents, matchCandidateToIntent } = require('../candidates/intent-vocabulary');

const DEADLINE_MS = 60000;
const POLL_MS = 3000;
const PARTIAL_WAIT_MS = 8000;
const COMPOSITION_RESERVE_MS = 15000;
const MAX_POLLS = 20;
const MAX_ACTIVE = 2;
const MAX_RETAINED = 32;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const RETENTION_MS = 60000;

const failure = error => ({ status: 503, body: { error, days: [] } });

// One server execution owns normalization, resolver anchor, acquisition and
// composition. Polls only read that execution; no request/candidate replay.
// Tokens are short-lived bearer capabilities, never URLs or persisted data.
function createPlannerLifecycle({ deadlineMs = DEADLINE_MS, maxActive = MAX_ACTIVE } = {}) {
  const jobs = new Map();
  let active = 0;
  function remove(token) {
    const job = jobs.get(token);
    if (job?.cleanup) clearTimeout(job.cleanup);
    jobs.delete(token);
  }
  function sweep() {
    for (const [token, job] of jobs) if (Date.now() >= job.expiresAt) remove(token);
  }
  function evictOldestCompleted() {
    for (const [token, job] of jobs) {
      if (job.result) { remove(token); return true; }
    }
    return false;
  }
  function read(token, countPoll = true) {
    sweep();
    const job = typeof token === 'string' && jobs.get(token);
    if (!job) return { status: 410, body: { error: 'planner_request_expired', days: [] } };
    if (job.result) return job.result;
    if (countPoll && ++job.polls > MAX_POLLS) {
      job.result = failure('supply_wait_expired');
      job.controller.abort();
      return job.result;
    }
    return { status: 202, body: { planner_lifecycle: {
      version: 1, state: 'warm_pending', token,
      retry_after_ms: POLL_MS,
      remaining_ms: Math.max(0, job.deadline - Date.now()),
      max_polls: MAX_POLLS,
    } } };
  }
  function cancel(token) {
    const job = jobs.get(token);
    if (job) { job.controller.abort(); remove(token); }
  }
  async function start(run, { signal } = {}) {
    sweep();
    if (active >= maxActive) {
      return { status: 429, body: { error: 'busy', retry_after_seconds: 5 } };
    }
    while (jobs.size >= MAX_RETAINED && evictOldestCompleted()) {}
    if (jobs.size >= MAX_RETAINED) return { status: 429, body: { error: 'busy', retry_after_seconds: 5 } };
    const token = randomBytes(24).toString('hex');
    const controller = new AbortController();
    const deadline = Date.now() + Math.min(DEADLINE_MS, deadlineMs);
    const job = { controller, deadline, expiresAt: deadline + RETENTION_MS, result: null, polls: 0, cleanup: null };
    jobs.set(token, job);
    job.cleanup = setTimeout(() => remove(token), Math.max(1, job.expiresAt - Date.now()));
    job.cleanup.unref?.();
    active++;
    let wake;
    const first = new Promise(resolve => { wake = resolve; });
    const abandon = () => { controller.abort(); remove(token); wake(); };
    signal?.addEventListener('abort', abandon, { once: true });
    if (signal?.aborted) abandon();
    const timer = setTimeout(() => {
      job.result = failure('supply_wait_expired');
      controller.abort();
      wake();
    }, Math.max(1, deadline - Date.now()));
    timer.unref?.();
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return run({
        signal: controller.signal,
        deadline,
        warming() { if (!controller.signal.aborted) wake(); },
      });
    }).then(result => {
      if (controller.signal.aborted) return;
      job.result = Buffer.byteLength(JSON.stringify(result.body)) <= MAX_RESULT_BYTES
        ? result : failure('planner_result_too_large');
    }).catch(() => {
      if (!controller.signal.aborted) job.result = failure('planner_failed');
    }).finally(() => {
      active--;
      clearTimeout(timer);
      wake();
    });
    await first;
    signal?.removeEventListener('abort', abandon);
    const result = read(token, false);
    if (result.status !== 202) remove(token); // direct warm/error response needs no retention
    return result;
  }
  return { start, read, cancel };
}

// One memoized trusted supply snapshot for both structure and composer. Await
// only evidence attached by a server source, never status strings in JSON.
function lifecycleLoader(loader, context, { partialWaitMs = PARTIAL_WAIT_MS, reserveMs = COMPOSITION_RESERVE_MS, independentSupply = [] } = {}) {
  if (typeof loader !== 'function') return loader;
  const loads = new Map();
  return request => {
    context.signal.throwIfAborted();
    const key = JSON.stringify(request);
    if (!loads.has(key)) loads.set(key, (async () => {
      let records = await loader({ ...request, preferCachedSupply: true, signal: context.signal });
      if (records?.[SOURCE_COMPLETION]) {
        context.warming();
        const initial = records;
        const remaining = Number.isFinite(context.deadline) ? context.deadline - Date.now() - reserveMs : partialWaitMs;
        const waitMs = Math.max(0, Math.min(partialWaitMs, remaining));
        records = await new Promise((resolve, reject) => {
          let timer;
          const cleanup = () => { clearTimeout(timer); context.signal.removeEventListener('abort', abort); };
          const abort = () => { cleanup(); reject(new Error('planner_cancelled')); };
          const done = value => { cleanup(); resolve(value); };
          if (context.signal.aborted) return abort();
          context.signal.addEventListener('abort', abort, { once: true });
          const takeSnapshot = () => {
            // Only a source-owned symbol can supply a newer partial snapshot.
            const value = typeof initial[SOURCE_SNAPSHOT] === 'function' ? initial[SOURCE_SNAPSHOT]() : initial;
            const intents = normalizeUserIntents(request.requestedIntents || []).intents;
            const available = [...(Array.isArray(value) ? value : []), ...independentSupply];
            const relevant = available.length > 0 && intents.every(intent =>
              available.some(record => matchCandidateToIntent(record, intent).level === 'strong'));
            // Reserve composition time only when there is supply to compose.
            // Finalizing an empty snapshot at the reserve boundary discards
            // the original acquisition even if usable rows arrive before the
            // hard deadline. Keep awaiting that same work, never reacquire it.
            const remaining = Number.isFinite(context.deadline)
              ? context.deadline - Date.now() - (available.length ? reserveMs : 0) : 0;
            // A failed fast source is not proof that the whole day lacks
            // supply. Keep the original execution alive for outstanding real
            // sources when no relevant partial exists, within the SAME budget.
            if (!relevant && remaining > 0) {
              timer = setTimeout(takeSnapshot, Math.min(partialWaitMs, remaining));
              return;
            }
            const snapshot = [...(Array.isArray(value) ? value : [])];
            for (const name of ['loader_status', 'loader_error']) {
              if (value[name] !== undefined) Object.defineProperty(snapshot, name, { value: value[name] });
            }
            Object.defineProperty(snapshot, 'loader_metadata', { value: {
              ...(value.loader_metadata || {}),
              source_completion: { ...(value.loader_metadata?.source_completion || {}), status: 'partial', reason: 'bounded_lifecycle_snapshot' },
            } });
            done(snapshot);
          };
          timer = setTimeout(takeSnapshot, waitMs);
          Promise.resolve(initial[SOURCE_COMPLETION]).then(done, error => {
            cleanup(); reject(error);
          });
        });
      }
      context.signal.throwIfAborted();
      // The enrichment seam belongs to the real server loader, never payload.
      if (typeof loader.enrich === 'function') records = await loader.enrich(records, {
        ...request, signal: context.signal, deadline: context.deadline,
      });
      context.signal.throwIfAborted();
      return records;
    })());
    return loads.get(key);
  };
}

module.exports = { createPlannerLifecycle, lifecycleLoader, DEADLINE_MS, POLL_MS, MAX_POLLS, PARTIAL_WAIT_MS, COMPOSITION_RESERVE_MS };
