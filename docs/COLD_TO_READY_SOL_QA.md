# Sol: final-head cold-to-ready acceptance

## Narrow follow-up after the 2026-09-13 cancellation review

The broad cohort and navigation QA already ran on earlier heads. For the new
Wikidata/bfcache correction, perform only the checks below on the exact frozen
image. Preserve/restore staging as before; keep the PR draft. No broad new
geographic cohort or required winning place is needed.

1. In a disposable cold cache, observe an outstanding Wikidata place query
   during `warm_pending`, then Change place. Capture the DELETE 204, provider
   termination and cache state. A sole-owner query must not write its canceled
   window after DELETE. Prefer provider request timing over cache mtime alone;
   resolver, worker and replacement-anchor cache files have different owners.
2. Start two simultaneous lifecycles sharing that window. Cancel one while the
   other remains active: one provider fetch may finish and cache for the owner
   that remains. Also cancel both while it is still outstanding; the last
   cancellation must abort it. Confirm lifecycle capacity recovery. If a warm
   cache/provider timing prevents exercising outstanding work, report that case
   NOT OBSERVED rather than inferring success.
3. Exercise actual back/forward restoration with `pageshow.persisted === true`
   recorded. Do it while cold pending with no day, and while updating a retained
   day (include an edit still inside debounce). On return, no stuck wait/busy
   announcement, old status poll, resumed debounce or automatic composition.
   Current choices and the valid earlier day must survive. **Continue planning**
   must send one new request, even on rapid double activation, using those
   choices and never the old token. A completed day should return without a
   retry notice or network composition. If the browser does an ordinary reload,
   label bfcache NOT OBSERVED; synthetic PageTransitionEvent tests are not proof
   of a real browser cache restoration.
4. Retain a Change place/direct-navigation smoke check for one DELETE and no
   stale result. Reuse prior Overture evidence unless a concrete regression
   calls for new process correlation. If correlation is needed, use a separate
   diagnostic ID, never lifecycle bearer tokens in general logs.

Export raw request timing, response/cache identity, page transition events,
screenshots of restored UI, and restored image/health/config evidence. Separate
VERIFIED, FAILED, INCONCLUSIVE / NOT OBSERVED and INVALID ACCEPTANCE. The code
regressions in this patch are synthetic and add no new Pi/browser evidence.

## Original broad acceptance plan (historical scope; do not repeat for this patch)

Choose the cohort only after the PR head is frozen and its CI passes. Verify the
exact SHA before testing. Preserve earlier evidence and staging image/config/cache;
use a new timestamped directory and isolated cache. Deploy one immutable image
to both web and worker, verify health SHA, then restore the prior environment.
No production deploy, merge, source activation or manual source seeding.

Select at least four previously unsupported places across at least three
countries or language regions. Include small/regional and larger places,
typed and fixed-coordinate anchors, desktop and mobile. Rotate culture+green,
fika+second hand, food+views, and nightlife or a local market, with materially
different walking budgets. Kolding may be one regression sentinel at most;
Kivik is not primary acceptance. Require no particular winning stop or city rule.

For each case:

1. Prove the anchor resolves unambiguously and pin date, language, preferences,
   coordinates, commitments and budget. `no_anchor` is invalid supply acceptance.
2. On an isolated cold cache submit once through the real browser. Record the
   composition response, any 202 token (redact in shared exports), each status
   request, final response and request initiators/timings. Demonstrate the waiting
   copy and transition to final route or honest terminal result without reload.
3. Trace source calls independently at the network/process boundary. Status
   polling must not start provider work or another composition. Identify separate
   Live refreshes. Measure actual time through STAC, DuckDB startup, query and
   completion; confirm child termination on timeout and slot recovery.
4. Repeat identical inputs warm. With adequate fresh supply the source layer
   must not fetch, including Overpass/NAPI; record geocoding, weather, Live and
   map-tile work separately. Compare candidate identities/families/eligibility
   and final stops, covered/missing preferences and walking fit. Attribution is
   not proof of a selection improvement. Preserve heuristic-geometry caveats.
5. While cold pending, change preferences/budget/date; also use Change place,
   direct navigation, and browser back/forward. For every known lifecycle token,
   prove exactly one keepalive DELETE begins before navigation accepts the next
   request. Prove the old wait cancels, its sole source cache is not written, its
   native child exits, and both lifecycle slots plus the native slot recover.
   A shared same-window producer may continue only when another active lifecycle
   still owns it. A delayed old response must not overwrite the new day.
   The waiting announcement must disappear immediately, before debounce. Drive a
   terminal deadline once and verify the visible retry starts exactly one new
   execution from current inputs without polling the expired token.
   Expand route/source cards and exercise Keep/Not-this on eligible published
   identities. Record desktop/mobile loading, map, cards and final state.
6. Include at least one actual failed provider attempt. The run must terminate
   honestly, with no route fabrication, infinite poll or hidden manual retry.
   A controlled staging-only network denial may exercise failure handling;
   label it fault injection, not a naturally observed provider outage.
7. Sample and capture peak web cgroup resource use **including the native child**,
   worker, child count and memory. Check 45 s termination, one native child per
   process, 60 s user deadline, 20-read ceiling and busy handling for concurrent
   distinct windows. Confirm the per-child temporary directory is capped at
   64 MiB and removed after both success and SIGKILL. Exercise a late child event
   without allowing a second concurrent query. Do not mistake DuckDB's 128 MB
   setting for total RSS.

Preserve raw request/responses, source/network and console evidence, screenshots
or trace, cache comparison, resource logs and restored health/image/config hashes.
At minimum prove cold success without manual retry, adequate warm zero source
acquisition, honest provider failure and edit cancellation. Report separately:
VERIFIED, FAILED, INCONCLUSIVE / NOT OBSERVED, INVALID ACCEPTANCE. If a provider
prevents a fair success trial, contribution is inconclusive, not a product fail.

Particular new risk: the bounded disposable DuckDB process changes initialization
and memory behavior. Compare completion and resource use with the preserved base
under equivalent inputs; report resource-limit/query failures explicitly. If the
cohort cannot fit the Pi bounds, return that evidence before changing budgets.

Existing language initialization, hydration, top-level city label, geographic
category quality and heuristic street/barrier limitations remain separate unless
this change demonstrably regresses them. No invented browser artifacts and no
synthetic parser/API fixture promoted into live acceptance.
