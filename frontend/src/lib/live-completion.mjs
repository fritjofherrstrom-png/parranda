/**
 * Live completion — the client half of the original-generation Live contract.
 *
 * A compose whose Live collection is still running can hand back a short-lived
 * capability (`live_completion`). The client reads the ORIGINAL producer's
 * terminal Live result with it, and — only when the server authorized it —
 * asks the server once whether that result changes the day. The client never
 * decides eligibility, never sends events, dates or geography, and never
 * recomposes the route because Live is pending: a missing or expired
 * capability is reported as unavailable, not hidden behind a new acquisition.
 *
 * The capability is a bearer token. It is taken out of the response before
 * anything else reads it, so it can never reach React state, storage, a saved
 * or shared day, or diagnostics. It lives only in the run that follows it.
 *
 * Pure + deterministic; the caller owns state and decides what is still on
 * screen when a result lands.
 */

export const LIVE_COMPLETION_ENDPOINT = "/api/planner-live-completion";
export const LIVE_ROUTE_UPGRADE_ENDPOINT = "/api/planner-live-route-upgrade";
// Sent on every original compose. Legacy servers ignore unknown query flags.
export const LIVE_COMPLETION_QUERY = "include_live_completion=1&include_live_route_upgrade=1";
// Read cadence after the original day lands. The last step repeats until the
// capability's own lifetime runs out.
export const LIVE_COMPLETION_POLL_DELAYS_MS = [2000, 3000, 5000, 8000, 10000];
export const LIVE_COMPLETION_MAX_LIFETIME_MS = 120000;
const MAX_TOKEN_LENGTH = 512;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Split the capability off a planner response.
 *
 * @returns {{ body: any, capability: null | { token: string, expiresInMs: number, routeUpgrade: "explicit_request" | "not_supported" } }}
 *   `body` never carries `live_completion`, whether or not it was valid.
 */
export function takeLiveCompletion(body) {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, "live_completion")) {
    return { body, capability: null };
  }
  const { live_completion: raw, ...rest } = body;
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    typeof raw.token !== "string" ||
    raw.token.length === 0 ||
    raw.token.length > MAX_TOKEN_LENGTH ||
    /\s/.test(raw.token) ||
    !Number.isFinite(raw.expires_in_ms) ||
    raw.expires_in_ms <= 0
  ) {
    return { body: rest, capability: null };
  }
  return {
    body: rest,
    capability: {
      token: raw.token,
      expiresInMs: Math.min(raw.expires_in_ms, LIVE_COMPLETION_MAX_LIFETIME_MS),
      routeUpgrade: raw.route_upgrade === "explicit_request" ? "explicit_request" : "not_supported",
    },
  };
}

/**
 * One read of the completion endpoint, classified.
 *
 * ASSUMED SHAPE (pending the backend fixtures): a terminal 200 carries
 * `live_events` in the same form as a route response, no longer pending, and
 * `route_upgrade`. Kept in this one function so the real fixtures replace it.
 */
export function readLiveCompletionResponse(status, body) {
  if (status === 202) return { kind: "pending" };
  if (status === 410) return { kind: "expired" };
  if (status === 200 && isRecord(body) && isRecord(body.live_events) && body.live_events.pending !== true) {
    return {
      kind: "terminal",
      liveEvents: body.live_events,
      routeUpgrade: body.route_upgrade === "explicit_request" ? "explicit_request" : "not_supported",
    };
  }
  return { kind: "unavailable" };
}

/** One answer from the explicit upgrade endpoint, classified. */
export function readLiveRouteUpgradeResponse(status, body) {
  if (status === 202) return { kind: "pending" };
  if (status === 410) return { kind: "expired" };
  if (status === 409) return { kind: "not_authorized" };
  const upgrade = isRecord(body) ? body.live_route_upgrade : null;
  if (status === 200 && isRecord(upgrade) && upgrade.version === 1) {
    if (upgrade.state === "applied" && isRecord(upgrade.result) && Array.isArray(upgrade.result.days)) {
      // The upgraded day is a full published response. It must not smuggle a
      // bearer token through to storage either.
      return { kind: "applied", result: takeLiveCompletion(upgrade.result).body };
    }
    if (upgrade.state === "not_eligible" || upgrade.state === "rejected") return { kind: upgrade.state };
  }
  return { kind: "failed" };
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("live_completion_cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Follow one capability to its end: read the original Live result, and ask for
 * the one server-owned upgrade when it was authorized.
 *
 * `onLiveEvents` is called once with the terminal Live result, before any
 * upgrade is requested, so the Live section can update even when the day does
 * not change.
 *
 * @returns {Promise<{ live: "terminal" | "expired" | "unavailable" | "cancelled",
 *                     upgrade: null | { kind: string, result?: any } }>}
 */
export async function followLiveCompletion({
  capability,
  signal,
  onLiveEvents = () => {},
  fetcher = fetch,
  wait = pause,
  now = Date.now,
  delays = LIVE_COMPLETION_POLL_DELAYS_MS,
}) {
  const deadline = now() + capability.expiresInMs;
  const post = async (url) => {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: capability.token }),
      signal,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };
  const cancelled = () => ({ live: "cancelled", upgrade: null });

  // Waits, then reports whether the capability is still alive to be used.
  let attempt = 0;
  const nextTurn = async () => {
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    if (now() + delay >= deadline) return false;
    await wait(delay, signal);
    return true;
  };

  let terminal = null;
  try {
    while (!terminal) {
      if (!(await nextTurn())) return { live: "expired", upgrade: null };
      let read;
      try {
        const { status, body } = await post(LIVE_COMPLETION_ENDPOINT);
        read = readLiveCompletionResponse(status, body);
      } catch {
        if (signal.aborted) return cancelled();
        continue; // a dropped read is retried inside the same lifetime
      }
      if (read.kind === "pending") continue;
      if (read.kind !== "terminal") return { live: read.kind, upgrade: null };
      terminal = read;
    }
    if (signal.aborted) return cancelled();
    onLiveEvents(terminal.liveEvents);
    if (terminal.routeUpgrade !== "explicit_request") return { live: "terminal", upgrade: null };

    // Exactly one upgrade request; a pending answer is re-read on the same
    // cadence because the server shares the one reserved attempt.
    attempt = 0;
    for (let first = true; ; first = false) {
      if (!first && !(await nextTurn())) return { live: "terminal", upgrade: { kind: "expired" } };
      let upgrade;
      try {
        const { status, body } = await post(LIVE_ROUTE_UPGRADE_ENDPOINT);
        upgrade = readLiveRouteUpgradeResponse(status, body);
      } catch {
        if (signal.aborted) return cancelled();
        upgrade = { kind: "failed" };
      }
      if (upgrade.kind !== "pending") return { live: "terminal", upgrade };
    }
  } catch {
    // Only the abortable wait throws here.
    return cancelled();
  }
}
