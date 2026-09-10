# Bounded cold-to-ready Planner lifecycle

## Product contract

A person submits a plan once. If the server has started acquiring source-backed
places, Planner shows an honest waiting state and receives the completed day
automatically. Empty supply, failed acquisition, insufficient trust and poor fit
still cannot manufacture a route. A completed source request is not a promise
that a useful day exists.

The loss reproduced after #499 was between acquisition and consumption:
Overture started warming its cache but returned an empty array. If Overpass
failed, the first composition reported `error_failed_closed`. A subsequent
submission could read the completed cache and compose a route. The browser's
speculative one-shot re-composition did not own that source lifecycle.

The new path keeps **one server execution**, rather than replaying public
requests. Modern Planner requests `Prefer: respond-async`. The existing handler
normalizes its snapshot once and resolves the anchor once. A process-private
Symbol on loader output carries the original acquisition's completion promise;
public fields cannot supply that evidence. Structure and route composition share
one request-local memoized supply snapshot, filtered by the original exclusions.
Existing identity, eligibility, intent, pin, walking and promotion gates still
decide the final route.

On an outstanding source completion, the initial response is HTTP 202:

```json
{"planner_lifecycle":{"version":1,"state":"warm_pending","token":"<48 hex characters>","retry_after_ms":3000,"remaining_ms":42000,"max_polls":20}}
```

The client POSTs only `{token}` to `/api/planner-status`. Polling never resolves
another anchor, starts another source fetch, re-enters rescue or re-composes.
Completion returns the ordinary response, including its honest no-day verdict
when applicable. Both successful and failed final results stop polling.
`warm_pending` is not inferred from a transport error or candidate count.
The compatible API path without `Prefer` continues to return a single response.

## Bounds and ownership

| Boundary | Limit / behavior |
| --- | --- |
| User action | One composition; at most 20 status reads, 3 s spacing, 60 s total client/server deadline |
| Server work | At most 2 active lifecycle executions per process, including after HTTP 202; no queue |
| Retained results | At most 32 entries, at most 2 MiB each; removed by 60 s after the original deadline, with the oldest completed result evicted first when new work needs the bounded slot |
| Token | Random 192-bit bearer capability; memory only, never URL/localStorage; no-store responses; restart/expiry returns 410 |
| Cancellation | DELETE status token, component unmount or input edit; original HTTP disconnect also abandons waiting before token delivery |
| Native Overture work | At most 1 child process per parent process with child-owned slot release; distinct concurrent queries refused without queue; SIGKILL after 45 s including initialization and body reads |
| DuckDB settings | 128 MB engine memory limit, one thread, 64 MiB Node heap, dedicated per-child temp directory capped at 64 MiB and removed by the parent after close; 10 s HTTP timeout, zero HTTP retries; these are not a claim about total RSS |
| Release lookup | Existing 5 s timeout, followed by the 45 s native bound: at most 50 s for this source attempt |
| Overture acquisition | Existing 5 km radius, 600 raw query rows, default 80 / maximum 100 normalized records; at most 2 MiB child result IPC; unchanged taxonomy, confidence and license gates |
| Other providers | Existing Overpass, resolver, NAPI and reviewed-source bounds; no new acquisition endpoint, crawler, source approval or provider retry |

The 60 s user ceiling is a conservative product budget, not a measured cold-load
percentile. #499's preserved Pi cold API responses took 5,275 and 10,295 ms but
returned before Overture completed; the raw two-geography diagnostic timed out
after 55 s and is not acceptance. Those observations justify separating waiting
from HTTP completion and enforcing termination; they do **not** establish that
45 s/128 MB is sufficient for all Pi queries. Sol must measure this new execution
boundary on the frozen head before release. GeoParquet transfer has no new
aggregate byte guarantee; bounded time/rows/radius are not a byte cap.

Cancellation stops the waiting composition from publishing. A shared acquisition
may finish populating its cache for another active user, within its own source
deadline. The server retains an active slot until the execution actually exits.
There is no cross-process job sharing or durable job resume: multi-replica routing
needs affinity or a future shared lifecycle store; unknown tokens fail closed.
Persistent source caches continue to survive restarts independently of jobs.

Fresh adequate cached supply takes a read-only fast path. It retains cached OSM,
Wikidata and NAPI evidence rather than discarding independent corroboration.
An OSM regional sub-anchor cannot be mixed with a different original window.
Missing/thin cached supply still uses the existing bounded acquisition path.
This source-cache guarantee does not claim that optional weather/Live/map tiles
or a cold typed-place resolver perform zero network work.

An empty successful Overture result is cacheable absence; a failed source is not
cached as success. In-flight cache coalescing reuses the producer for the same
window. Rescue can read the result, but cannot restart the original pending job.
Legacy cache v4 semantics and all primary-only taxonomy guards remain intact.

## Browser behavior

Waiting explains that real places are being acquired and the plan will continue
automatically. No percentages, guaranteed route or fabricated ETA are displayed.
The original date, language, anchor, preferences, budget and commitments remain
captured by the same execution. Changes invalidate the old intent immediately,
before the debounce; both request and intent generations reject late bodies.
Invalidation also removes the old waiting announcement immediately. A terminal
deadline renders an explicit retry action, both with an empty screen and while a
previous day is retained; it starts one new execution from the current
authoritative inputs, consumes any pending adjustment debounce, ignores repeated
activation and never resumes or polls the expired token.

The server lifecycle replaces speculative structure/error one-shot refreshes.
The separate bounded Live refresh policy remains for a published day's pending
events. A Live follow-up is a new, explicitly separate composition, not a second
provider fetch inside the cold lifecycle. QA must record those initiators rather
than lump all network requests together.

## Verification and acceptance boundary

Deterministic tests exercise the real HTTP handler and real mounted Planner:
legacy cold loss, pending to route, failure to honest no-day, no-anchor finality,
one resolver/acquisition, cache-only warm response, preserved independent supply,
private pending evidence, bounded polls, deadline/cancel/late-result handling,
and an actual OS child terminated by the deadline. These tests use controlled
source records; they are not real-provider/Pi/browser acceptance.

No deployment or rotating geographic acceptance has been performed for this PR.
See [the Sol handoff](COLD_TO_READY_SOL_QA.md). Keep release acceptance open until
that run measures the final head and classifies its results honestly.
