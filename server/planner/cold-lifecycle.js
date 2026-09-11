"use strict";

const { randomBytes } = require('node:crypto');
const { SOURCE_COMPLETION } = require('../place-candidates/background-source');

const DEADLINE_MS = 60000;
const POLL_MS = 3000;
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
function lifecycleLoader(loader, context) {
  if (typeof loader !== 'function') return loader;
  const loads = new Map();
  return request => {
    context.signal.throwIfAborted();
    const key = JSON.stringify(request);
    if (!loads.has(key)) loads.set(key, (async () => {
      let records = await loader({ ...request, preferCachedSupply: true, signal: context.signal });
      if (records?.[SOURCE_COMPLETION]) {
        context.warming();
        records = await new Promise((resolve, reject) => {
          const abort = () => reject(new Error('planner_cancelled'));
          if (context.signal.aborted) return abort();
          context.signal.addEventListener('abort', abort, { once: true });
          Promise.resolve(records[SOURCE_COMPLETION]).then(resolve, reject)
            .finally(() => context.signal.removeEventListener('abort', abort));
        });
      }
      context.signal.throwIfAborted();
      return records;
    })());
    return loads.get(key);
  };
}

module.exports = { createPlannerLifecycle, lifecycleLoader, DEADLINE_MS, POLL_MS, MAX_POLLS };
