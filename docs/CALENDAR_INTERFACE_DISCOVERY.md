# Calendar interface discovery: evidenced boundary

**Outcome:** retain a dated Drupal event-card listing as `needs_adapter`, rather
than silently dropping its interface. **Not solved:** extraction,
`no_probeable_source_candidates`, qualification or Live coverage. No manifests,
approvals, runtime events or route/default changes.

## Evidence and cause

Base: `d824a807cd5a72e1716e5140c657b78541fb1f29`.
Saved QA profile (QA a3dcebcc42883b270e013beea4fcab766e72df57):
`/home/hermes/parranda-scout/reports/20261004T144804Z-qa543-search/pulse_source_profiles.final.jsonl`,
Gent key `place-source-profile-v1:378ef1befe45e403`: 9 seeds, 20 inspected
sources, 14 rejected social candidates, no probeable source candidates.

Read-only worker cache `local-event-source-scout/source-page_*.json`:
`0ffb745b4759d6fb` (Visit Gent listing), `31f1ee7dba7943b5` (agenda),
`cf8fee8fb65e946c` (Stad Gent promotion), `f1675e1dab1c3404` (UiT widget),
`662f4ba7d2f5c9b9` (flower-market detail).
Baseline replay detects no event interfaces in those bodies, only social hints.
The listing/agenda have event articles with textual dated schedule fields but
no JSON-LD Event or `<time datetime>`. The existing fallback requires datetime
and English event-list/card classes. Patched replay retains the listing/agenda
as unsupported; the other specimens remain unsupported.

## Narrow contract and safety

Require two distinct same-origin heading/detail identities in separate
`article.node--type-event` cards, each with its own dated
`field--name-field-schedule`. Parse DOM ownership; ignore scripts, comments,
templates, styles and noscript. Do not infer start times or recurrence, broaden
RSS evidence or supply a supported adapter. Fetch/SSRF/robots/terms,
qualification/approval gates and defaults are unchanged. Robots allowance is
not permission. The regression uses two real cached cards (trailing whitespace
removed) with an unrelated seed hostname, not a place/host branch.

The scheduled-card detector uses one iterative postorder traversal with
constant-sized text summaries; nested articles cannot lend dates/headings to
an outer card. After the existing parse5 parse, inspection is bounded to
20,000 visited nodes, 256 stack frames and 1,000,000 inspected text/comment/
attribute characters. Any exhausted budget rejects the entire scheduled-card
signature, even if two earlier cards qualified. No recursive subtree text
rescans or change to the existing root parser is introduced.

## Why extraction remains blocked

Live list, agenda, flower-market and biomarket detail each produce **0 rows**
with both existing schema.org and venue-calendar parsers. Card date-only text
could be parsed without invented hours, but cards have no authoritative
geographic facts. Flower-market detail publishes a Leaflet point for a separate
contact entity (`4089`), not an Event JSON-LD record; detailed hours come from
an external opening-hours widget (`data-service`, `data-channel`, long validity
range). UiT is an external JavaScript widget. A safe next slice needs an explicit
bounded list→detail identity/contact/location join and date/recurrence semantics,
plus compatible permission; merely following details to the existing schema
parser cannot recover events. No such adapter is claimed here.

## Reproduction and raw provenance

```sh
npm ci --ignore-scripts
node --require ./tests/helpers/no-live-network.js --test tests/scheduled-event-interface-discovery.test.js
npm test
```

RED: expected `["stable_html_needs_adapter"]`, actual `[]`; 1 failed, 2 passed.
GREEN: 3 passed, 0 failed. Negatives cover sibling facts, absent facts,
off-origin identities, inert markup, single items, widgets, robots blocking and
no qualification/activation.

Raw artifacts: `/home/hermes/parranda-calendar-fix-evidence/`:
`red.txt`, `green.txt`, `full-test.txt`, `replay.json`,
`extraction-assessment.json`, `live-provenance.json`, cached HTML and
`live-{0,1,2,3,4,5,6}.body`. Provenance records exact URLs, UTC timestamps,
HTTP status, response bytes and SHA-256. Live reads of robots, Visit Gent
listing/agenda/two details and Stad Gent UiT on 2026-10-04 returned HTTP 200,
without redirects; existing robots evaluator allows the inspected paths.
These are bounded operator reads and replays, **not deployed worker acceptance**.
No commit/push/merge/deployment/container/catalog write or source approval.
