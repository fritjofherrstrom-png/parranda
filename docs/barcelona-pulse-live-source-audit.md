# Barcelona Pulse / Live Source Readiness Audit

Checked: 2026-05-16

PR context: Barcelona is a registered `visibility: "preview"` city with real catalog density, route templates, and honest noop Pulse/Live services. This audit asks how Barcelona should get real city rhythm later without fake content, Rome leakage, or a separate Barcelona-only engine.

## Summary

- Barcelona Pulse and Live currently behave correctly for a preview city: city-core copy is visible, curated Pulse is not shown, and live events are empty.
- Rome Pulse/editorial is city-owned content even though the legacy module name is generic. It should be treated as the Rome implementation of the citypack Pulse contract, not copied into Barcelona.
- The root `server/live-events.js` module is effectively a Rome/Turismo Roma provider. Future cities should not call it directly; they should provide city-scoped live source adapters.
- Good Barcelona source coverage appears possible, but no single "events API" is enough. A useful Pulse/Live layer needs official baselines plus selective venue, market, cultural-center, and local editorial signals.
- The next implementation should wire one small Barcelona source adapter only after source quality, parsing stability, language handling, and source-owned fields are clear.

## Current Infrastructure

| Layer | Current implementation | Ownership | Reusable as-is? |
| --- | --- | --- | --- |
| Rome Pulse/editorial | `server/editorial-calendar.js`, re-exported from `server/cities/rome/editorial.js` | Rome citypack editorial + generic helper patterns | Patterns yes; content no |
| Rome Live | `server/live-events.js`, wrapped by `server/cities/rome/live.js` | Turismo Roma provider + app-generated matching | Provider no; scoring ideas partly |
| Barcelona Pulse | `createNoopEditorialService({ cityLabel: "Barcelona" })` | Generic noop citypack contract | Yes |
| Barcelona Live | `createNoopLiveEventsService()` | Generic noop citypack contract | Yes |
| Pulse API wrapper | `GET /api/city-pulse` in `server/app.js` | App layer | Yes, if city services are scoped |

## Rome Pulse / Editorial Findings

Rome Pulse contains three kinds of text:

- City-owned/editorial: Rome-specific moments, route hints, wildcards, area notes, headline/subhead logic, and local rhythm copy.
- App-generated/generic: date labels, recurring matching mechanics, generic Pulse field assembly, and official-event wrapper text in `server/app.js`.
- Source/provider-owned: official live event titles, venue names, summaries, addresses, ticket URLs, and images added through the Live layer.

The code is now language-aware for visible Rome Pulse prose, but it still contains Rome-specific concepts by design. Barcelona should get its own editorial module later rather than using or parameterizing Rome editorial content.

## Live / Events Findings

The current Live module is not a generic provider framework yet:

- It fetches `https://www.turismoroma.it/en/romalive`.
- Its parser is tied to Turismo Roma HTML.
- Its location fallback queries append `Rome, Italy`.
- Its inferred tag corpus includes Rome neighborhoods such as Trastevere, Testaccio, Ostiense, Pigneto, Prati, and Monti.
- `match_reason` is app-generated metadata and remains Swedish-only in the raw `official_events` object.

For user-facing English Pulse cards, `server/app.js` wraps official events with localized visible prose. Raw `official_events[].match_reason` should be treated as deferred metadata localization unless that raw field becomes user-facing.

## Barcelona Current Behavior

Barcelona currently uses noop city services:

- `getCityPulse()` returns language-safe city-core preview copy.
- `items`, `moments`, `official_events`, and `wildcards` are empty.
- `fetchLiveEventsForDates()` returns empty arrays for requested dates.
- No Rome Pulse/editorial or Turismo Roma events are shown.
- No fake Barcelona events are emitted.

This is the correct product behavior until Barcelona has reviewed source wiring.

## Candidate Barcelona Sources

These candidates were researched from available public web sources. They should be verified again before source wiring because calendars, feeds, and HTML structures can change.

| Source | Type | Feasibility | Best fit | Notes |
| --- | --- | --- | --- | --- |
| Ajuntament / Guia BCN agenda (`https://guia.barcelona.cat/en/agenda/`) | Official city agenda | High if backed by Open Data/API; avoid brittle UI scraping first | Live baseline + Pulse candidates | Broad official event coverage, likely multilingual enough for source-owned fields, but needs filtering for locality and quality. |
| Open Data BCN agenda datasets (`https://opendata-ajuntament.barcelona.cat/data/en/dataset/agenda-diaria`) | Official structured data | High candidate for first adapter if fields are stable | Live baseline | Prefer structured feeds over scraping Guia BCN pages. Need inspect exact dataset cadence, category fields, geocoding, and license. |
| Barcelona Cultura (`https://www.barcelona.cat/barcelonacultura/ca`) | Official cultural agenda | Medium; likely HTML plus shared city data | Pulse/Live discovery | Good cultural signal, but may duplicate Guia BCN/Open Data. Use as source discovery unless structured endpoint is confirmed. |
| Generalitat Agenda Cultural (`https://agenda.cultura.gencat.cat/`) | Official regional cultural agenda/RSS | Medium-high | Live candidates + broader culture | Useful for Catalonia-wide cultural events filtered to Barcelona; may include strong venue programming but needs locality filtering. |
| Mercats de Barcelona (`https://ajuntament.barcelona.cat/mercats/ca`) | Official market site | Medium; activity pages need exact endpoint verification | Pulse local rhythm | Strong for markets, food, seasonal moments. Should not be treated as full city events coverage. |
| Centres Civics (`https://www.barcelona.cat/centrescivics/ca`) | Official civic/cultural-center site | Medium; agenda access needs exact endpoint verification | Pulse + local culture | Potentially high local/repeat-visitor value. Needs filtering to avoid overwhelming low-signal listings. |
| Venue calendars: Sala Apolo, Razzmatazz, Heliogabal, CCCB, MACBA, Design Hub, Palo Alto | Official venue/programming pages | Medium; per-source adapters | Live/source-owned events | High quality but fragmented. Start with one or two stable sources, not a giant scrape. |
| Flea/vintage market sources: Flea Market BCN, Fleadonia, Lost & Found, Palo Alto Market | Organizer pages/social calendars | Medium-low; stability varies | Pulse moments + Live candidates | Valuable for second-hand/vintage rhythm, but must verify current pages and avoid fragile social-only scraping. |
| Beteve agenda (`https://beteve.cat/agenda/`) / local media calendars | Local media | Medium as review signal, lower as automated source | Pulse review candidates | Good locality signal, but should not be copied blindly or treated as official truth. |
| Local blogs/newsletters/guides | Curated signals | Low for automation, useful for review | Editorial review input | Use to discover candidates and judge quality, not as direct provider feeds. |
| Beach/coast official pages (`https://www.barcelona.cat/en/what-to-do-in-bcn/bathing-and-beaches`) and open data | Official condition/seasonal data | Medium for seasonal status, low for events | Pulse seasonal layer | Useful for beach/coast moments, weather/seasonality, and closures; not a substitute for event feeds. |

## Source Quality Bar

A Barcelona source should not be wired just because it returns events. It should pass these checks:

- City-scoped: can be filtered to Barcelona without borrowing Rome or global noise.
- Locality: surfaces neighborhood culture, markets, venue programming, or seasonal city rhythm.
- Update cadence: changes often enough to be useful but not so volatile that tests become flaky.
- Field clarity: separates source-owned title/summary/venue/address from Parranda-owned tags, route fit, and explanatory copy.
- Language handling: source language is preserved; Parranda-generated wrappers are localized.
- Parse stability: structured data or RSS beats HTML scraping; HTML adapters need tests and graceful failure.
- Safety: provider failure should degrade to empty/noop events, not break Pulse or routes.

## Future Citypack Source Contract

Future citypacks should be able to define source hooks without changing the public API shape:

```js
sources: {
  liveSources: [
    {
      id: "barcelona-open-data-agenda",
      type: "official_open_data",
      url: "...",
      languages: ["ca", "es", "en"],
      updateCadence: "daily",
      sourceOwnedFields: ["title", "summary", "venue", "address", "start_date", "end_date", "url"],
      reviewFlags: ["broad_feed", "needs_quality_filter"],
    },
  ],
  pulseSources: [
    {
      id: "barcelona-markets-agenda",
      type: "official_market_calendar",
      url: "...",
      role: "market_rhythm",
      sourceOwnedFields: ["title", "venue", "date", "url"],
      parrandaOwnedFields: ["tags", "route_role", "why_it_matters"],
    },
  ],
}
```

Minimum expectations:

- `fetchLiveEventsForDates(dates, context)` always returns a date-keyed object and never throws through to the API.
- Empty/noop is valid for preview cities.
- Provider adapters keep cache TTL, timeout, user agent, and parser tests close to the adapter.
- Source-owned text can remain in its source language.
- Parranda-owned `kind`, `when`, `why_it_matters`, route-fit notes, tags, and UI wrappers must be language-aware.
- Raw metadata such as provider IDs, route hints, tags, source labels, and match reasons should remain stable across `lang`.

## Recommended Next PR Sequence

1. `test: harden Pulse/Live source contracts`
   Add a small contract around city source metadata and provider-owned vs Parranda-owned fields if the first adapter needs it.

2. `feat: wire Barcelona official agenda source`
   Start with one official structured source, ideally Open Data BCN / Guia BCN if stable. Keep Barcelona preview and emit only source-owned official events with localized app wrappers.

3. `feat: add Barcelona market/civic Pulse signals`
   Add one market or civic-center source after the official baseline is safe. This is where Barcelona starts to feel more locally useful.

4. `feat: localize official_events match metadata`
   If raw `official_events[].match_reason` becomes visible or consumed by clients, make it language-aware in the provider/matching layer.

5. `feat: add Barcelona editorial Pulse layer`
   Add Parranda-owned city rhythm only after source-backed signals reveal what should be editorialized.

## Deferred

- No Barcelona live source is wired in this PR.
- No fake Pulse items, fake events, or Rome fallback events are added.
- No Barcelona editorial prose is added.
- No public API shape changes are required.
- The root Rome Live provider remains Rome-specific until a source-adapter extraction PR.
