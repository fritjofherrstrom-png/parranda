# Live programmes and bounded Ticketmaster inventory

Live groups accepted bookings for the same programme before the six-highlight
and 24-card limits. A display group requires the same reviewed provider, exact
non-homepage source URL, title, venue, coordinates, venue timezone and preference
fit, with individually stated start instants. It does not invent a publisher
series ID, recurrence, opening time, category, venue or route eligibility.

Every original occurrence stays inside `occurrences`. For you shows one programme
card with an occurrence disclosure; By time shows one programme card per actual
venue-local date. Each admitted occurrence retains its own planning reference.
Existing publisher-declared series keep their existing date navigation. A route
occurrence is removed individually from Live, leaving the other slots available.

Another answering publisher may receive a highlight in place of a repeated
publisher only at the same preference-fit level and score. Partial matches do
not replace strong matches. The existing salient local-discovery slot remains
protected. Accepted source facts and their independent-source counts are not
upgraded by presentation. Server-assigned `live_evidence_rank` preserves the
original evidence order for automatic evening selection, independently of display
grouping and publisher promotion.

Ticketmaster collection reads at most three numeric pages and 120 raw source
rows. All pages share the caller's existing total deadline: 15 seconds by default,
or the existing 30-second background collection budget. There are no additional
retries or per-page timeout resets. Pages are constructed on the configured
endpoint; a source-supplied next URL is never a credential-bearing fetch target.

If more inventory remains, a page repeats, or a later page fails, usable earlier
events remain available and `source_collection_truncated` marks partial source
health. A first-page failure retains its specific failure reason. A successful
bounded collection is never a promise of complete local-event coverage.

Event result cache namespace v17 excludes older first-page-only pools. It does
not delete shared cache files, alter local provider snapshots, or change source
approval, discovery, geometry, time or trust gates.

Regression coverage includes provider pagination/deadlines, grouped occurrence
identity and route-order preservation, cached inventory policy, mounted UI, and
built UI through real local HTTP handlers and real collector/provider components.
External source transport, places, resolver, weather and clock in the HTTP
browser regression are controlled. These tests are not live-provider, public
cache, Pi/arm64 or physical Safari acceptance.
