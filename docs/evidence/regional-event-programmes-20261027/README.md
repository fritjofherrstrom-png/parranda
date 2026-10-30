# Regional programme discovery — 2026-10-27

Owner: Codex. Original investigation base: cf18a576. Integrated main base:
721c026a (#657), including 1cca6dda (#656); these unrelated identity/preferences
changes do not alter the inspected event-source modules. Target: main through
[PR #658](https://github.com/fritjofherrstrom-png/parranda/pull/658).

## Why this example was missed

The [official 2026 programme](https://osterlenlyser.se/program-2026/) was
already public for 30 October–1 November. Exact raw HTML snapshots of the
homepage and programme were retrieved once each on 27 October, then replayed
offline. The existing homepage locator finds the programme link. Supplying
the exact programme directly still produces zero event manifests and a failed
official-program provider (`source_payload_invalid`). Thus a format blocker
exists independently of search ranking or later geography gates.

The original reader does not understand the programme's numeric day headings
and document structure. A bold disclaimer accidentally opens its only section;
the section limit omits Sunday. An intermediate rejected row incorrectly uses
a booking deadline as its date. None of those intermediate facts was emitted.

A read-only runtime snapshot at 11:35 UTC showed search, catalog, worker,
request-time discovery and qualified-source runtime enabled on cf18a576.
The model reader was disabled with no configured key. The inspected regional
catalog contained no current scout targets and only an old Ystad profile.
This is an observation of that catalog, not proof that any particular user
request lost a queue write or that a particular search engine failed.

Separately, current code performed request-time discovery only when there was
no local source. One approved calendar could therefore prevent immediate
complementary discovery even though background scouting already recognized
the source mix as thin.

## Delivered behavior

- A closed, publisher-independent programme grammar reads an explicit title
  and year, numeric date headings, local area headings and timed first lines.
  It uses no URL year, image name, old anchor name, deadline or current-year guess.
- A document must establish numeric date order independently. Invalid dates,
  contradictory weekdays, malformed/qualitative clock ranges and hidden inline
  facts fail closed. Missing programme facts cannot be repaired from booking
  deadlines. Contact/stop headings end both date-order and row scope, and an
  unsupported subheading requires a fresh area. The existing article grammar
  retains its own scope.
- Source rows keep separate stable occurrence identities and precise names
  plus areas. Same-time activities at different places on one programme page
  survive fusion as distinct activities.
- The programme title, exact source page and observed date span accompany local
  activities through normalization, fusion, Live, shared publication and both
  Live source surfaces. The span describes programme days, not opening hours.
- Thin source mixes can receive bounded request-time discovery. Within the
  active period, an exact programme-area match to trusted locality receives
  the existing venue budget first. This supplies no coordinate or extra trust.
- Final pools use v19 so old thin/empty answers cannot bypass the change.
  Existing cache files, their ages and lower raw/descriptor caches are retained.

New sources retain ordinary robots, rights, probation, temporal and geography
checks. They remain low-trust and Pulse-only. No paid reader/provider,
source activation, database mutation, deployment or named-place rule is added.

## Frozen raw replay

Programme: 183,888 bytes, SHA-256
`f96faa99f254def1511bed74522396231b58144fdf41fe532adbaff6b1313099`.
Homepage: 80,464 bytes, SHA-256
`f5239782487574dd6bcba5c26480be71f22abab2bab88939fa96c226d2493b9f`.

| Input | Before | New parser/provider replay | Friday | Saturday | Sunday |
| --- | ---: | ---: | ---: | ---: | ---: |
| Exact programme HTML | 0 emitted | 175 factual rows | 64 | 63 | 48 |
| Reduced factual fixture | 0 emitted | 4 factual rows | 2 | 1 | 1 |

The full-source provider replay explicitly uses limit 300 to inspect extraction;
the ordinary provider still defaults to its existing limit of 160. These counts
are extracted factual rows, not 175 geocoded, activated or displayed events.
Twenty-five scoped paragraphs remain deliberately unmatched, including prose,
untimed rows, multiple embedded sessions and dangling clock ranges. The full
source remains local evidence; only a small factual structure fixture is committed.

## Verification scope

Tests exercise the real parser and provider, homepage → scout → probationary
feed → collection → normalization/fusion → Live, exact source-area lookup
priority with a one-query cap, old editions, robots exclusions, absent/outside
geometry, coherent programme publication, escaped EN/SV card/sheet context and
persisted old-pool renewal. Each implementation regression has RED/GREEN evidence.

Final focused parser/provider/scout/context/Live/venue/discovery checks pass
115/115. EN/SV mounted Live card/sheet and related frontend checks pass 46/46;
frontend typecheck/build, committed-dist and self-hosted contract checks pass.
Independent whole-branch review found two parser scope issues; seven additional
RED/GREEN regressions cover their fixes, including post-Contact date-order
evidence and legacy explicit preceding-heading date compatibility. The raw
replay counts above remain unchanged after those fixes.

The local development full run reported 5,328 passed, 90 failed and 3 skipped
(5,421 total). Eighty-nine failures concern immutable storage/publication on
macOS: the store deliberately requires Linux `/proc/self/fd`, absent here. Two
generic sharing failures independently reproduce on untouched cf18a576. One
intermediate clock-title failure overlapped its code/test fix and is superseded
by the final focused checks. No permissive storage fallback is included, and no
local full-suite pass is claimed. Exact final-head Linux CI must verify that path.

Local raw snapshots, before/after replay scripts/results, runtime flags and
test logs are preserved in the task's sibling evidence directory
`parranda-event-discovery-evidence-20261027/` outside the repository.

Remaining limitations: actual search-engine recall and deployed end-to-end
acceptance remain unobserved for this change. Free prose, PDF/poster-only
programmes and standalone regional context without a locally accepted activity
are outside this first grammar. Source coverage is still bounded, not exhaustive.
Merge and deployment require their own coordinated landing decision.
