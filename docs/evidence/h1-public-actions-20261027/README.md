# H1 public actions — 27 October 2026

Owner Codex; branch `codex/h1-public-actions-20261027`. Base/public at start:
`dcb0d0fef028edc420edcc3b29735fd8593167a6`.
Code checkpoint `90d12e7d1493080607ada7fcf2bdd044b761511b`; this directory is evidence only.
The PR's exact head and final CI are authoritative. No other open PR is integrated.

## Confirmed defects and changes

* Public Roma/Culture Remove sent four retained IDs. The composer produced the
  intended walk but publication refused an otherwise retained garden whose role
  no longer claimed Culture. The existing soft preference exception now includes
  explicitly retained IDs of a successfully applied strict edit. No new coverage,
  facts, availability, opening hours or walking permission are granted. Replacement
  candidates still need requested relevance. RED two failures; GREEN 41 tests.
* Exact Live sharing was restricted to a single Wix public-calendar pipeline.
  The user explicitly approved a general publication rule for existing sources.
  Actual configured structured provider output now issues source-bound public URL
  receipts; actual OSM/Overture/Wikidata factories and owned caches retain public
  attribution/website destinations. Public DTOs/JSON copies cannot mint authority.
* Applied Live route upgrades publish their own immutable answer, rather than
  losing Share or reusing the original route reference. The client binds that new
  reference only to the accepted typed-place entry. No acquisition is repeated.
  Capability deadlines and once-only finalization remain; returned DTO mutation
  cannot mutate the memoized answer.

## Verification and boundaries

* `tests/day-edit-retained-publication.test.js`: real HTTP/engine/catalog with
  controlled external seams; Remove/Replace RED → GREEN. Focused publication,
  composition, stop-edit and preference-focus regressions: 41 PASS.
* `tests/retained-day-actions-http-browser.test.js`: actual built UI → real HTTP,
  controlled sources/clock, 390px Chromium: Remove, Replace, Undo, exact reload,
  actual Save/Restore after date change; no substituted product API responses.
* `sharing-final-regressions.log`: 105 PASS, zero failures/skips on isolated
  Linux/arm64 Node 22.23.4 for Live upgrade, destination, Ticketmaster and cache
  regressions. `generic-final-Linux.log` separately includes the final added
  new-process generic-provider cache test: 10 PASS, zero failures/skips.
* `upgrade-frontend-GREEN.log`: 22 mounted frontend tests; own-reference positive,
  no-reference negative, changed intent, manual period/scope and late replies.
* `browser-sharing-result.json` / screenshot: built mobile Chromium 153 on macOS
  → actual isolated Linux/arm64 Node22 HTTP and real filesystem store. Pending →
  terminal Linked Events transport fixture → actually applied Live route → real
  Share/clipboard → empty recipient. Exact date, ordered stop identity/coordinates,
  route points and retained Live facts/source link; sender reload retains the day
  without composition. Recipient makes one shared-day GET, no source acquisition;
  zero JavaScript exceptions. Provider transports and clock are controlled;
  external map assets are blocked. This is not live-provider or physical-iPhone QA.
* Typecheck and build pass. Rebuilt committed dist passes the drift guard.
* macOS filesystem publication reports `storage_unavailable`; Linux storage
  positives above use the production filesystem contract unchanged. A local broad
  frontend run is not accepted as a final verdict: it includes those OS failures
  and overlapped a dist rebuild (one stale asset filename). Final full CI runs from
  the frozen, committed checkout on Linux; do not promote the local run to PASS.

## Publication/privacy limits

Only http(s) public destinations without credentials, query, fragment or known
private paths can acquire sharing authority; unsupported links retain ordinary
Live facts but sharing refuses, never strips facts silently. Private/GPS arrivals,
unknown link provenance, pending source evidence and expired capabilities still
refuse. This grants no extra event/place confidence or opening-hours evidence.

Live pool/collection namespaces become v18/v3 so old incomplete publication
provenance cannot be treated as new proof. Existing cache files are preserved;
normal bounded collection may run once under the new namespace. No place cache,
source timeout/budget, public cache contents, service config or deployment setting
is changed by this patch. New owned memory/disk reuse preserves age and health;
changed source configuration and arbitrary JSON replay cannot recover authority.

Private saved/navigation restores keep their existing rule of withdrawing the
public Share authority; the copied public snapshot URL remains immutable and
re-shareable. The reload proof above claims preserved day facts, not new Share
permission from private storage. Safe refusal when a manual edit cannot preserve
an explicit Live Keep remains a limitation, not successful Live editing.

## Independent review corrections

The pre-release review found and reproduced noncanonical private URLs (trailing
DNS dots and encoded private path segments); five real configured
provider→collector→HTTP cases failed RED. The URL decision now rejects trailing
dots, decodes paths before checking private actions, and refuses ambiguous double
encoding. `encoded-destination-GREEN.log`: all 17 pass including normal public
Live/upgrade/storage and place-source positives; no blanket removal of links.

The review also caught lost receipts in a fresh process reading an intermediate
calendar snapshot (outer period changes, source snapshot unchanged), and in OSM
cache envelopes/regional mapping. Source snapshots now persist bounded original
raw-row receipts, bound to the configured source and row integrity; only the
application-owned intermediate cache can revalidate them. Changed rows/config
and injected caches refuse. OSM witnesses are re-established from the owned
`{records,status,error,metadata}` envelope and the actual regional transport
mapping. `destination-cache-GREEN.log`: 89 PASS including the three independent
intermediate-cache regressions; no cache age renewal or extra acquisition.

The broad native sender/recipient run predates these backend-only privacy/cache
corrections. They do not change the built UI or the positive Linked Events
source-output path; the final focused tests and Linux CI cover the updated code.
