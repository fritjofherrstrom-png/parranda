'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlannerLifecycle } = require('../server/planner/cold-lifecycle');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('pending planner acknowledges before the initial provider signals warming', async () => {
  const entered = deferred(), provider = deferred(), finish = deferred();
  const jobs = createPlannerLifecycle();
  let acknowledged, runs = 0;
  const first = jobs.start(async context => {
    runs++;
    entered.resolve();
    await provider.promise;
    context.warming();
    await finish.promise;
    return { status: 200, body: { days: [] } };
  }).then(result => { acknowledged = result; return result; });
  await entered.promise;
  // Observe the real event loop, with provider deliberately unresolved. No
  // millisecond deadline or simulated clock is needed to discriminate the bug.
  await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
  try {
    assert.equal(acknowledged?.status, 202, 'an unresolved provider must not block the initial acknowledgement');
    const pending = acknowledged.body.planner_lifecycle;
    assert.deepEqual(Object.keys(pending).sort(), ['version', 'state', 'token', 'retry_after_ms', 'remaining_ms', 'max_polls'].sort());
    assert.equal(pending.version, 1);
    assert.equal(pending.state, 'warm_pending');
    assert.equal(pending.retry_after_ms, 3000);
    assert.equal(pending.max_polls, 20);
    assert.equal(jobs.read(pending.token).status, 202);
    assert.equal(runs, 1, 'status reads must not reexecute the planner');
  } finally {
    provider.resolve(); finish.resolve();
    const result = await first;
    await new Promise(resolve => setImmediate(resolve));
    if (result.status === 202) {
      assert.equal(jobs.read(result.body.planner_lifecycle.token).status, 200);
      jobs.cancel(result.body.planner_lifecycle.token);
    }
  }
});
