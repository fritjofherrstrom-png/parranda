# Live acquisition follows the selected view

Live previously stopped its cold refresh after 9.5 seconds. Real provider reads
observed on 30 September 2026 took 18–28 seconds through the full local API.
Opening a pending panel did not start a sheet refresh, and changing the time tab
only switched already-fetched buckets. The server accepted `time` but never
forwarded it to acquisition; today's mapless venues consumed the four lookups
before following-day venues.

## Behavior

- Changing time makes a new, cancellable Live query for the selected scope and
  published calendar date. The newest choice owns the response. Changing time
  near me reuses the coordinates obtained for that Live session; explicitly
  pressing Near me obtains a fresh position. A new published day clears them.
- Opening pending Live continues checking automatically. The bounded retry
  sequence allows about two minutes for collection, then exposes Try again.
  Closing the sheet, changing the day and unmounting cancel its waiter.
- Acquisition prioritizes venues in the active bucket. The four-lookup cap,
  actual-clock normalization, source-local date, proximity and trust gates stay
  authoritative. Ordinary composition keeps its selected-day-first default.
- Geographic result pools use metre-level anchors, radius, calendar date and
  active period in a hashed disk-safe key. A rejected row at one edge of an old
  kilometre-wide cache cell can no longer disappear for another anchor.
- Reviewed localized APIs read up to ten consecutive numbered pages of their
  exact endpoint, with one time budget, five-megabyte total budget and bounded
  page sizes. Provider URLs are never followed. Repeated identities are removed.
  A failed, malformed or truncated later page retains valid earlier evidence
  and reports failure/incompleteness instead of claiming a complete empty read.
- The default supply shares a persistent 20-minute source snapshot for these
  geography/date-independent APIs. Location and time views separately normalize
  and gate that evidence. Full source descriptors bind snapshot identity;
  failed/incomplete snapshots are not stored. The geographic namespace is v8.

## Verification on 30 September 2026

Target before this change: `dd22e85256ec72e08a6f4af39c096210a11cdf16`
(`codex/rhythm-focus-map-integration`, PR #538). Initial diagnosis used main
`ceee59e7b4dac36b7c8832a2dee0146179d02932`; changes were then integrated on
the exact user-specified candidate, preserving its Live sessions and UI.
Real-provider evidence is from the local full-profile API, not production.

| Check | Observed result |
| --- | --- |
| Stockholm official API | 805 raw records across nine pages; 729 mapped factual rows |
| Same central Stockholm anchor, 3 km, selected 30 September | First-page acquisition accepts 43 rows; paginated acquisition accepts 125 |
| Full API, Stockholm | Healthy source; 125 accepted rows; finished after 18.5 s |
| Full API, Malmö | Two verified following-day events; finished after 27.3 s; municipal calendar responds, festival program reports invalid payload |
| Full API, Simrishamn | Seven accepted rows, six highlights for following days; both reviewed sources respond; finished after 27.7 s |

The Stockholm comparison ran first-page and paginated acquisition against the
same live API, anchor and date a few seconds apart. It measures accepted supply,
not a 3× increase in displayed highlights; the existing 6-highlight/24-row
per-bucket presentation cap remains. The obsolete summer festival program has now been removed from the active
manifest at the user's request. Its failure above describes the initial probe;
municipal events remain the current Malmö source. The changed source plan
automatically bypasses caches containing the removed source.
No unsupported place is given invented coverage.

Deterministic tests exercise active-period lookup priority, page traversal,
identity deduplication, malicious next URLs, partial failures, shared source
snapshots with separate geometry/date gates, cache separation and the mounted
React journey (time changes, late-response cancellation, slow readiness and GPS).
Source links and event times remain source evidence. Production release and
on-device GPS are separate checks; neither is claimed by local verification.

Latest-candidate repeat against `dd22e852` plus the fix: Stockholm 125 accepted
rows (30.9 s), Malmö 3 accepted rows including 2 following-day events (33.4 s),
Simrishamn 7 accepted rows (26.4 s). All six Stockholm scope/time combinations
(around place, near me, near route × selected day, following days) return healthy
results and `route_mutation: false`; repeat view timings were 1.1–8.3 s. These
HTTP checks use supplied coordinates and do not prove on-device GPS permission.

Seven newly added behavioral regressions fail on the exact unmodified dd22e852
base and pass with the fix. The 117 focused checks and 368 frontend checks pass.
