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
| Cancellation | Exactly one same-origin keepalive DELETE for a known status token on input edit, component unmount, Change place, direct navigation or browser history navigation; original HTTP disconnect also abandons waiting before token delivery |
| Native Overture work | At most 1 child process per parent process with child-owned slot release; distinct concurrent queries refused without queue; SIGKILL on lifecycle cancellation or after 45 s including initialization and body reads |
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

Cancellation stops the waiting composition from publishing. A sole background
producer is aborted and cannot populate its cache after cancellation. A shared
same-window acquisition continues only while another active consumer still owns
it, within its own source deadline. The canceled execution returns its lifecycle
slot when it exits; the native slot remains owned until the child has actually
closed.
There is no cross-process job sharing or durable job resume: multi-replica routing
needs affinity or a future shared lifecycle store; unknown tokens fail closed.
Persistent source caches continue to survive restarts independently of jobs.

Wikidata uses this same consumer ownership even though its optional
corroboration does not extend the composition's wait. It starts only after
Overpass selects the applicable regional cluster. A lifecycle signal owns a
share of the producer; the producer's separate signal reaches fetch and body
reading, and cache storage rechecks it. Canceling the last owner prevents both
memory and disk writes. A replacement request does not join a canceled promise,
and late cleanup cannot release that replacement's cache slot. A concurrent
legacy request without a lifecycle signal retains its existing bounded warm.
Wikidata's 30 s timeout, radius/record limits, six-hour default cache TTL,
nonempty-only storage and independent trust requirements are unchanged.

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
Change place initiates cancellation before its link navigation. `pagehide` owns
the equivalent boundary for direct navigation and browser back/forward, rather
than relying on a React unmount that a document navigation does not perform.
Navigation also clears the adjustment debounce and scheduled Live follow-up and
invalidates request/intent generations. A real `pageshow.persisted` return
clears the canceled wait. If work was interrupted, the screen explains that
planning paused when the person left and offers **Continue planning**. It keeps
the previous valid day, anchor, current inputs and commitments. That button
starts one new execution from those inputs; restoration itself never composes
or polls the canceled token. A completed day returns unchanged. This is an
explicit fresh execution, not a claim that server work survived navigation.

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
and an actual OS child terminated by both deadline and lifecycle cancellation.
These tests use controlled
source records; they are not real-provider/Pi/browser acceptance.

## Cancellation follow-up evidence — 2026-09-13

Pi/browser acceptance occurred on earlier heads, including the cancellation
follow-up on `9ebc023429300e6f738aabea5c1220cdaa15eadd`. Its preserved package is
`20260913T154039Z-pr500-cancellation-resume-share.tar.gz`; all 20 files listed in
its manifest verify. Staging restoration is attested in that package. Those
runs are historical evidence, not runtime acceptance of the newer correction.

The Pärnu capture records DELETE 204 at `15:51:27.861Z`, followed by
`wikidata/58.387_24.503.json` at `15:51:28.293462Z`, before the Tartu POST at
`15:51:28.597Z`. This is about 432 ms after the response (386 ms after the
capture's later `cancelAt` timestamp). The producer was the Planner's Wikidata
cache, not the worker's separately named source-scout cache. Code inspection
confirmed that the old factory discarded the lifecycle signal, used unowned
`cache.warm`, and stored any nonempty result. The raw source also listened only
to its own timeout. There was no storage-level asynchronous queue that explained
away this late write: `writeFileSync` and `renameSync` execute synchronously.
The correction preserves the cancellation contract rather than allowing that
write after the last owner cancels.

The same head canceled navigation correctly but nulled `activeRequestRef`
before `finally` could clear `supplyPending`; `catch` correctly rejected the
aborted result but left `phase` loading. No `pageshow` handler repaired that
state, and document navigation did not clear the debounce/Live timers. Mounted
component regressions reproduce and correct this flow, including a late poll
body, retained day, pending edit, repeated return, explicit retry and a completed
day. Provider tests use the real configured Wikidata factory with controlled
network responses and temporary disk cache, proving last-owner abort, safe
shared ownership, and canceled/replacement producer races. These are synthetic
tests; they do not establish actual browser bfcache or provider acceptance.

The captured ordinary history navigation did **not** observe
`pageshow.persisted === true`; actual bfcache restoration remains **NOT OBSERVED**.
The Overture process timings from Change place/direct navigation remain useful
historical evidence; this correction adds no process telemetry or token logging.
See [the narrow follow-up handoff](COLD_TO_READY_SOL_QA.md). Keep the PR draft
until the remaining runtime checks are classified on the corrected head.
