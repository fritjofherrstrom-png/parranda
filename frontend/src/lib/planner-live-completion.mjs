import { LIVE_REFRESH_DELAYS_MS } from './compose-followup.mjs';
import { acceptedLiveEventQuery } from './live-event-query.mjs';

/** Capability is request-local only; the portable answer never carries it. */
export function extractLiveCompletion(body) {
  if (!body || typeof body !== 'object') return { body, capability: null };
  const { live_completion, ...portable } = body;
  const capability = live_completion?.version === 1
    && typeof live_completion.token === 'string' && /^[a-f0-9]{48}$/.test(live_completion.token)
    && Number.isFinite(live_completion.expires_in_ms) && live_completion.expires_in_ms > 0
    ? { token: live_completion.token, expires_in_ms: Math.min(120000, live_completion.expires_in_ms) } : null;
  return { body: portable, capability };
}

/** Serial reads of the original producer. Never submits composition inputs.
 * The expiry is fixed once; neither pending reads nor stalled bodies extend it.
 */
export async function readLiveCompletion({ capability, signal, selectedDate, wait, isCurrent, onReady, fetcher = fetch, now = () => Date.now() }) {
  if (!capability || signal.aborted) return false;
  const controller = new AbortController();
  const deadline = now() + capability.expires_in_ms;
  let stop;
  const stopped = new Promise(resolve => { stop = () => { controller.abort(); resolve(false); }; });
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, capability.expires_in_ms);
  const current = () => !controller.signal.aborted && isCurrent() && now() < deadline;
  const read = async () => {
    for (const delay of LIVE_REFRESH_DELAYS_MS) {
      await wait(Math.min(delay, Math.max(0, deadline - now())), controller.signal);
      if (!current()) return false;
      const response = await fetcher('/api/planner-live-completion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: capability.token }), signal: controller.signal,
      });
      const body = await response.json();
      if (!current()) return false;
      const state = body?.live_completion;
      // Reuse the existing sidecar shape/health gate, not its query authority.
      const events = acceptedLiveEventQuery({ contract: 'live_event_query_v1',
        route_mutation: false, day_anchor_mutation: false, live_events: body?.live_events });
      if (![200, 202].includes(response.status) || state?.version !== 1
        || state.route_upgrade !== 'not_supported' || events?.selected_date !== selectedDate
        || (response.status === 202 ? state.state !== 'pending' || events.pending !== true : state.state !== 'ready' || events.pending !== false)) return false;
      if (response.status === 200) { onReady(events); return true; }
    }
    return false;
  };
  try { return await Promise.race([read(), stopped]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}
