# Live QA handoff for Jean Bob (hermes)

Host repository: `/home/hermes/parranda`. Current QA container:
`parranda-qa-rhythm-map-fix-web`. Browser endpoint:
`http://127.0.0.1:18508/anywhere`. App path in an image: `/app`.

## Choose the frozen code

- **PR #540 only:** `1adb39fb485a7f79f9be6d341e433986fcd01d8b`.
  This fixes time-driven acquisition, cold refresh, nearby cache isolation,
  reviewed-calendar pagination and removes the obsolete festival feed.
- **Both PRs:** use the full frozen SHA supplied with the PR #541 handoff.
  It contains #540 and adds complementary European source discovery and
  Whole-area browsing. Never substitute a moving branch tip without checking SHA.

PR #540 needs no new worker, database or migration to fix existing approved
feeds. The runtime must have `PARRANDA_AGNOSTIC_EVENTS=enabled`,
`PARRANDA_PLACE_RESOLVER=enabled`,
`PARRANDA_EVENT_FEEDS_FILE=/app/config/reviewed-event-feeds.json`, and a writable
`PARRANDA_CACHE_DIR`. Preserve the existing Planner/resolver supply flags. The
repository Compose contract supplies these. Use its versioned feed file rather
than an old `PARRANDA_EVENT_FEEDS` JSON override, which could reintroduce the
retired festival programme. No blanket cache deletion is needed: #540 versions
the bounded-result cache and includes selected date, period, geometry and feeds.

## Isolated localhost QA deployment

Use a separate worktree, image, Compose project and cache/catalog volumes.
Keep the old QA container stopped for rollback. Do not invoke the production
deployment script or start Caddy for this localhost-only QA run.

```bash
cd /home/hermes/parranda
git fetch origin fix/live-period-latest fix/europe-local-live-discovery
qa_sha=1adb39fb485a7f79f9be6d341e433986fcd01d8b
# For combined QA, replace qa_sha with the full frozen #541 SHA from the handoff.
qa_checkout="/home/hermes/parranda-qa-live-${qa_sha:0:12}"
git worktree add --detach "$qa_checkout" "$qa_sha"
test "$(git -C "$qa_checkout" rev-parse HEAD)" = "$qa_sha"
docker build --build-arg "PARRANDA_BUILD_SHA=$qa_sha" \
  --tag "parranda-qa-live:$qa_sha" "$qa_checkout"
```

Create `/home/hermes/.config/parranda/qa-live.env`, owner-readable only:

```dotenv
PARRANDA_IMAGE=parranda-qa-live:FULL_FROZEN_SHA
PARRANDA_BUILD_SHA=FULL_FROZEN_SHA
PARRANDA_SOURCE_CATALOG=disabled
PARRANDA_SOURCE_SEARCH=disabled
PARRANDA_PLACE_RESOLVER_USER_AGENT=Parranda QA operator (set your contact URL)
```

Replace both SHA fields with `qa_sha`. Keep credentials in this local file;
do not paste it into chat or print expanded Compose configuration. For #540-only
QA, the override file below comes from #541's handoff checkout (or can be copied
verbatim from `deploy/qa-live.override.yml`); it is independent of runtime code.
Set `qa_override` to its absolute host path.

```bash
qa_env=/home/hermes/.config/parranda/qa-live.env
qa_override=/ABSOLUTE/PATH/TO/deploy/qa-live.override.yml
chmod 600 "$qa_env"
qa_compose() {
  docker compose --project-name parranda-qa-live --env-file "$qa_env" \
    -f "$qa_checkout/compose.production.yml" -f "$qa_override" "$@"
}
qa_compose config --quiet
docker stop parranda-qa-rhythm-map-fix-web
qa_compose up -d --no-deps web
curl --fail --silent http://127.0.0.1:18508/api/health
docker exec -e EXPECTED_SHA="$qa_sha" parranda-qa-live-web node -e \
  "fetch('http://127.0.0.1:8000/api/health').then(r=>r.json()).then(b=>{if(b.ok!==true||b.build_sha!==process.env.EXPECTED_SHA)process.exit(1);console.log('Exact QA build verified')}).catch(()=>process.exit(1))"
```

Allow the image's healthcheck to become healthy before opening the page. Reuse
the same isolated project when updating its image. If an existing worktree at
that exact SHA already exists, verify it and reuse it rather than adding it again.

## Enable actual European source discovery

For combined #541 QA, configure an operator-owned SearXNG endpoint reachable
**from the worker container**. A host's `127.0.0.1` is not the container's host.
Use a reachable HTTPS endpoint or an existing same-network search service.
Its JSON search interface must be enabled. Add to the local QA environment file:

```dotenv
PARRANDA_SOURCE_CATALOG=enabled
PARRANDA_SOURCE_CATALOG_PASSWORD=YOUR_LOCALLY_GENERATED_URL_SAFE_SECRET
PARRANDA_SOURCE_CATALOG_DATABASE_URL=postgresql://parranda:YOUR_LOCALLY_GENERATED_URL_SAFE_SECRET@postgres:5432/parranda
PARRANDA_SOURCE_SEARCH=enabled
PARRANDA_SOURCE_SEARCH_ENDPOINT=https://YOUR_OPERATOR_OWNED_SEARCH/search
PARRANDA_SOURCE_SEARCH_USER_AGENT=Parranda QA source search (set your contact URL)
```

Use a fresh QA-only database password and the isolated project's volumes.
`PARRANDA_TICKETMASTER_KEY`, if the operator already has a valid key, is a
separate optional global-event family. The combined Compose contract forwards
it to the web container; it does not replace local-calendar scouting. #540's
older Compose contract requires an explicit web environment override for that
key. No global coverage is claimed while the credential is absent.

```bash
qa_compose --profile source-catalog up -d --wait postgres
qa_compose --profile source-catalog run --rm source-catalog-migrate
qa_compose --profile source-catalog up -d --no-deps web source-scout-worker
qa_compose --profile source-catalog logs --tail=60 source-scout-worker
```

The worker command is `node scripts/run-source-scout-worker.js --watch --limit 1
--interval-ms 300000`. It discovers/probes sources in bounded batches and persists
profiles. A manual bounded batch is `qa_compose --profile source-catalog run --rm
source-scout-worker node scripts/run-source-scout-worker.js --limit 1`; run it
while the watching worker is stopped to avoid competing for the same target.

New source pages remain review/qualification gated. `pending`, `observing` and
`review_required` are real intermediate states. Do not backdate observations or
auto-approve every search result to make QA appear populated. Inspect and approve
usable source evidence through the existing `scripts/review-source-profile.js`
operator workflow; see `SELF_HOSTED_PRODUCTION.md` for its exact decision format.

## Verify the user journey and source lifecycle

1. Check `/api/health` reports the requested full SHA. Use a fresh browser session.
2. Open an already-covered place for today's locally selected date. Open Live
   while cold. A source taking 20–40 seconds should complete without reopening
   the sheet. Retry must remain available after the bounded refresh window.
3. Switch selected-day/following-seven-days, Near me, and Near the route. Each
   action must request its own scope/time/date, supersede older responses and
   leave the published Planner day/route unchanged. GPS must be exercised with
   actual browser permission; a JSON request alone does not verify permission.
4. With #541, choose Whole area. In-area occurrences beyond 3 km may appear with
   distance; outside map extents or unresolved coordinates must be excluded.
   Unsupported or excessively broad extents must explain the fallback choices.
5. Confirm no `malmofestivalen-program` descriptor remains in active feeds. The
   current Malmö municipal calendar should still work. A direct JSON override
   or independently approved stale profile is configuration to inspect separately.
6. With the worker configured, test two newly unsupported European places, one
   city and one small place, such as Bologna and Felanitx. Check demand is queued,
   the worker claims it, local-language/festivity queries actually execute, and
   profile/probe/review states persist. A single answering approved calendar may
   coexist with complementary discovery. Language vocabulary alone is not supply.
7. After an eligible real source is reviewed, verify subsequent Live reads consume
   it with actual date, venue, provenance and geometry. Report empty responses
   separately from failed/uncovered sources. Include per-place evidence in QA.

Record full SHA, selected date, place/scope/time, source-health state, discovered
source interfaces, approved real occurrences, distances and any failure. Do not
include credentials or expanded environment output in the report.

## Roll back this QA endpoint

```bash
qa_compose --profile source-catalog stop web source-scout-worker
docker start parranda-qa-rhythm-map-fix-web
curl --fail --silent http://127.0.0.1:18508/api/health
```

Keep the isolated cache/catalog volumes and previous image for review. These
instructions do not merge either PR or publish a production deployment.
