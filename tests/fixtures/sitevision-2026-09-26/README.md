# Captured Sitevision calendar pages, 2026-09-26

Public listing and first eight detail pages of two reviewed Sitevision
calendars (`simrishamn-municipal-calendar`, `malmo-municipal-calendar`), fetched
on 2026-09-26 by a self-hosted probe. `manifest.json` records every URL, its
fetch time and the SHA-256 of both the full capture and the stored file.

The pages are reduced to what the adapter reads:

- detail pages keep the `<h1>`, the "Datum och tid" and "Återkommande
  tillfällen" portlets, the venue/address/map block, every map link, the page
  landmarks and portlet anchors as empty shells, and the AppRegistry
  registrations;
- event-showcase state keeps its id, title, date range, occasions and
  locations; the state of unrelated apps (cookie consent, search, feedback,
  analytics) is `{}`;
- listings keep the calendar rows without images or teaser text;
- editorial text, images, navigation, contact details and all other scripts
  are removed.

The three Malmö rows that link to organizers' own sites are not stored; tests
serve them as a page without Sitevision markup, which the adapter handles like
the captured pages.

Replayed through the adapter at `ceee59e`, `2ea85b8` and `4d69254`, the reduced
pages produced the same rows, timing, recurrence, venues and pins as the full
captures. The only difference is the listing timing label, which no longer
carries the removed teaser text. A snapshot is evidence for its day, not a
fresh response.
