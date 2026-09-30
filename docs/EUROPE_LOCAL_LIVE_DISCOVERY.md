# Place-driven European Live discovery

Live must find local rhythm through a resolved place, rather than depend on a
named-city branch. This change builds on the selected-period/cold-refresh fix
in PR #540, based on the user's `dd22e852` integration candidate.

## What changed

- Ordinary around-place queries now carry resolver-owned country/locality and
  discovery bounds for large settlements as well as small ones. Previously the
  small-settlement fallback gate also suppressed discovery context for cities.
- Coordinate queries can use the resolver's existing reverse-context method to
  discover local sources. GPS stays the anchor and near-me stays at two kilometres.
- Discovery bounds are separate from event-collection geometry. Forwarding a
  municipality's context cannot silently widen an ordinary local query.
- One approved calendar no longer suppresses complementary source scouting.
  Fewer than two independent publishers or two known source families triggers
  the existing bounded catalog-demand write when trusted place context exists.
  Stable targets, leases and existing refresh/backoff control actual crawling.
- Discovery vocabulary covers 47 European country contexts. A separate bounded
  lane includes local festivities/holidays (for example `festivos`, `sagra`,
  `village festa`, `pučka fešta`, `falunap`). These queries stay attached to the
  locality and survive a full ordinary calendar/intent term budget. Vocabulary
  is only a search hint; it supplies no occurrence, date, closure or tradition.
- Live offers **Whole area / Hela området**. The server resolves the place again,
  validates agreement with the published anchor, and accepts bounded settlement,
  district or municipality map extents. Exact event coordinates must lie inside
  those extents and the derived radius (at most 40 km). Farther rows show distance.
  A map extent is a bounding rectangle, not proof of an administrative polygon;
  the interface calls it an area rather than claiming city membership.
- Approved catalog/file sources whose bounds intersect that area can participate,
  including small venue calendars away from the anchor and area corners. Catalog
  reads retain approval revision, key and expiry checks; acquisition remains
  capped at three local sources plus one credential-gated global family.

Near-route geometry and ordinary around-place/small-settlement behaviour retain
their existing limits. Live queries never mutate the day anchor or route. Rich
citypack composition and default route selection remain unchanged.

## Evidence

Deterministic tests exercise discovery demand from an unsupported large
settlement, trusted reverse context, detached/ambiguous resolution, injected
bounds, exact area filtering, off-centre approved feeds, complementary scouting,
local-festivity query coverage and a mounted Whole-area journey with distance.
The mounted journey proves that changing Live area does not resubmit the day.

Real Stockholm calendar check on 2026-09-30, same anchor (59.3326, 18.0649),
selected date and source snapshot:

| View | Collection radius | Accepted collection pool | Acquisition |
| --- | ---: | ---: | --- |
| Around place | 3,000 m | 127 | Healthy, 40.8 s cold |
| Whole area | 20,884 m, then map-extent filter | 169 | Healthy, 5.6 s using shared source snapshot |

The Whole-area following-days highlights include **Restvärde Open Studio** at
3.22 km, **Sagovärldar** at 3.16 km and **Tunnelbanan - i takt med tiden** at
3.20 km, with explicit distance. The first example is a small open-studio event
that the three-kilometre view excluded. Highlight caps still apply; pool counts
are not displayed-event counts or proof of complete area coverage. The provider's
calendar changed since the prior PR's measurement, so that PR's 43/125 numbers
are not used as this comparison's baseline. Both requests report
`route_mutation:false` and `day_anchor_mutation:false`.

## Operation and remaining coverage

The background source search requires an operator-owned SearXNG JSON endpoint,
the persistent Source Catalog and a running source-scout worker. Configure
`PARRANDA_SOURCE_CATALOG`, its database binding, `PARRANDA_SOURCE_SEARCH=enabled`
and `PARRANDA_SOURCE_SEARCH_ENDPOINT` in the existing self-hosted catalog profile.
Search returns untrusted seeds. Existing public-URL, robots, terms, interface,
qualification and review gates govern whether they may become event supply.
Ticketmaster's global family separately requires its configured credential.
There is no automatic activation of unknown websites or source-owned public text.

This cloud workspace has no configured runtime credentials, identities or VPN
connection to the user's local preview at port 18508. That preview has not been
updated. The real-source comparison proves the new selection capability against
one approved calendar; it does not prove running source discovery across Europe.

Neither bounded search nor approved feeds guarantee every local event. Missing
source coverage, unstructured/social-only announcements, language gaps, dated
programmes, source/page/venue budgets and refresh latency remain recall limits.
The next operational step is to run discovery and review genuinely usable local
sources across rotating large/small European places, then measure actual live
occurrences and source freshness. Country vocabulary must never be reported as
event coverage. Holidays affect dates/closures only when a trusted source supplies
that evidence.
