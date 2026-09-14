const MAX_WAIT_MS = 60000;
const MAX_POLLS = 20;

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('planner_cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Serialize once. Polls carry only a server token, never a replacement plan.
export async function fetchPlannerLifecycle(url, {
  payload, signal, onPending = () => {}, onCancellationReady = () => {},
  fetcher = fetch, wait = pause, now = Date.now,
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let deadline = now() + MAX_WAIT_MS;
  const timer = setTimeout(abort, MAX_WAIT_MS);
  let token = null;
  let complete = false;
  let cancellationSent = false;
  const cancel = () => {
    if (!token || complete || cancellationSent) return;
    cancellationSent = true;
    // Start the same-origin keepalive request while the document is still
    // alive. Waiting for an aborted request's finally block is too late during
    // navigation: the page can disappear before that microtask runs.
    try {
      Promise.resolve(fetcher('/api/planner-status', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), keepalive: true,
      })).catch(() => {});
    } catch {}
    controller.abort();
  };
  let cancellationPublished = false;
  try {
    controller.signal.throwIfAborted();
    let response = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    let body = await response.json();
    let polls = 0;
    while (response.status === 202) {
      controller.signal.throwIfAborted();
      const pending = body?.planner_lifecycle;
      if (pending?.version !== 1 || pending.state !== 'warm_pending' ||
          !/^[a-f0-9]{48}$/.test(pending.token) ||
          !Number.isFinite(pending.remaining_ms) || pending.remaining_ms < 0 ||
          !Number.isFinite(pending.retry_after_ms) ||
          !Number.isInteger(pending.max_polls) || pending.max_polls < 1 ||
          (token && token !== pending.token)) throw new Error('invalid_planner_lifecycle');
      token = pending.token;
      if (!cancellationPublished) {
        cancellationPublished = true;
        onCancellationReady(cancel);
      }
      deadline = Math.min(deadline, now() + pending.remaining_ms);
      const remaining = deadline - now();
      if (polls >= Math.min(MAX_POLLS, pending.max_polls) || remaining <= 500) throw new Error('supply_wait_expired');
      // Reserve a short final status read rather than abandoning the last
      // partial polling interval while a completed day may already exist.
      const delay = Math.min(Math.max(1000, Math.min(5000, pending.retry_after_ms)), remaining - 500);
      onPending();
      await wait(delay, controller.signal);
      controller.signal.throwIfAborted();
      if (now() >= deadline) throw new Error('supply_wait_expired');
      response = await fetcher('/api/planner-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), signal: controller.signal,
      });
      body = await response.json();
      polls++;
    }
    controller.signal.throwIfAborted();
    complete = true;
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    cancel();
  }
}
