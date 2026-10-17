# Selected-stop opening hours

Owner: Codex. Branch: `codex/opening-hours-evidence-20261017`.
Base and unchanged public QA release: `166609cd4482f38ff52fe91ad5f657181d2a7b54`.
Landing condition: final-candidate regression/CI and review; release is a separate operation.

## Proven gaps and retained limits

- Existing OSM scalar hours already reach candidate availability. The shipped
  Rome/Barcelona/Athens catalogs contain no machine-readable hours or venue URLs;
  their unknown hours are source absence, not a demonstrated transport loss.
- Reviewed schema.org place extraction dropped text-array/structured hours.
- A venue website was lost in exact duplicate reconciliation, role formatting
  and published route stops. Attribution URLs are not venue websites.
- All-week explicit closure could survive without a trusted timezone. Such a
  complete closure needs no timezone; partial/unsupported schedules still do.

## Resulting behavior

Unknown hours retain a usable day, with “Opening hours unavailable” /
“Öppettider saknas”, a safe source-owned Website action when present, and the
existing Replace action. Source windows remain selected-day facts; none claims
open now, guaranteed arrival, current operational verification or holiday
exceptions. A closed restored fact is no longer labeled unknown.

Modern asynchronous Planner can check only already composed, selected unknown
identities. Existing operator checks and this pass share four identities, two
concurrent reads and the original six-second request budget. It uses the same
DNS-pinned public HTTPS reader and 512 KiB response bound. Generic checks follow
no contact/discovery links; the existing exact-path www/apex canonical redirect
remains DNS-validated. A candidate needs one unambiguous structured place with
matching normalized name, source-owned page identity and coordinates within
25 metres. No new place, source family, approval or trust promotion is emitted.

Only completed, identity-bound positive facts share a six-hour cache. Failures
stay unknown and do not renew old data. Concurrent requests own cancellation
independently; per-request dedupe prevents repeated attempts. New facts cause at
most one replay of the same frozen supply/context through the existing
preference, commitment, edit and final walking gates. No sources are reacquired.
An exclusion cannot trigger a website check. Live completion retains final facts
and uses its existing enrichment-free replay.

Published enriched facts retain source URL, actual observation timestamp,
selected local date and trusted timezone. A later date rebuilds its day fact
from fresh weekly evidence and does not reset the source observation time.

The conservative schema.org subset accepts supported scalar/text-array weekly
hours and complete, nonconflicting seven-day specifications. Partial structured
weeks, seasonal/date-bound/special overrides, conflicting representations and
unsupported syntax stay unknown. Definitions: [openingHours](https://schema.org/openingHours)
and [OpeningHoursSpecification](https://schema.org/OpeningHoursSpecification).

## Evidence and checks

- Frozen unmodified base plus new HTTP regressions demonstrates RED for the
  selected-hours path and all-week closure. Initial exploratory HTTP requests
  without `Prefer: respond-async` are not evidence for the modern lifecycle.
- Focused source/parser/identity, URL publication and frontend tests capture
  RED→GREEN. Independent review found a shared-producer cancellation bug;
  a two-consumer regression now proves one cancellation cannot abort the other.
- `frontend/tests/planner-selected-hours-http-browser.test.mjs` exercises the
  built UI through real HTTP/handlers/composer. Controlled resolver/source HTML,
  clock and weather cover missing hours, HTTP503 and selected-day closure.
  This is ordinary free-text URL entry, not a landing-form, provider, physical
  venue, opening-time or deployed acceptance claim.
- Existing Blitz unknown/closed/late-open/outdoor contracts remain in scope as
  regressions; there is no parallel Blitz implementation or new ranking policy.

Commands: `npm test`, `npm run test:frontend`, `npm run check:frontend`,
`npm run build:frontend`, `node scripts/check-frontend-dist-drift.js`,
`git diff --check`. Use the configured Playwright Chromium executable through
`PARRANDA_TEST_CHROMIUM` when required. Full final results/skips, exact candidate
SHA and local-vs-CI runtime identity belong to the PR/delivery receipt.

No public cache, staging service, deploy settings or production image is changed
by these source/tests. No new paid APIs, model readers, city rules or fabricated
opening hours are introduced. Raw source identity/coordinate errors are separate
limits; checking hours does not repair them.
