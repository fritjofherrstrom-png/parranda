# Event wire profiles and reviewed venues

The `mapped_events` adapter reads public event records whose shape is set by a publishing platform, not by a city. A reviewed row in `config/reviewed-event-feeds.json` binds:

- an endpoint;
- its bounding box;
- its timezone and language;
- a `wire_profile`.

The profile (`server/pulse-sources/event-wire-profiles.js`) says where the title, times, venue, address and map pin sit in the records. City content stays in the config. The engine has no branch per city.

## Profiles

| Profile | Platform | Read from | Geometry |
|---|---|---|---|
| `dpl_cms_events_v1` | DPL CMS, the shared CMS of Danish public libraries | `/api/v1/events`, a JSON array of upcoming events with UTC-offset instants | Branch address only. Points come from the reviewed venue registry. |
| `nuxt_wordpress_acf_events_v1` | Headless WordPress event posts with an ACF `information` group, rendered by Nuxt (goteborg.com) | The `__NUXT_DATA__` state the public page embeds. One page fetch carries every listed event and occurrence. | The publisher's map pin, used only when it has street-level detail. A city or area pin stays mapless. |

## Rules the adapter keeps

- **One stated slot is one event.** An occurrence list becomes one event per occurrence inside the collection window (default 8 days).
- **No guessed times.** A clock is used only when the source states it. A missing or backwards end is left out, never guessed. Floating local clocks are converted in the row's IANA timezone, including clock changes.
- **Dropped records:** cancelled records, online-only records and records outside the window.
- **Bounded fetch:** one bounded fetch, same-origin redirects only, and no provider-supplied URLs are followed.
- **Robots:** both sources allow the paths used. Göteborg & Co's CMS API (`cms.goteborg.com`) is robots-excluded and is not used.
- **Unknown reuse terms:** rows stay `pulse_only` with `terms_status: "unknown"`, like the existing Barcelona and Rome rows.

## Reviewed venue registry

`config/reviewed-event-venues.json` holds points for venue addresses that a source publishes without coordinates.

- **How points are made:** `scripts/resolve-event-source-venues.js` resolves each new address once through Nominatim, at most one request per 1.1 s, stopping at the first refusal.
- **When a point is kept:** only when exactly one result has the source's own house number and postcode inside the feed's bounding box.
- **Attribution stays attached.** Events placed this way carry `venue_resolution.source: "reviewed_venue_registry"` with the ODbL licence and OpenStreetMap attribution. The point is never presented as source-owned geometry.

This takes these fixed addresses out of the per-request venue lookup budget, which allows four new lookups per request.

## Adding a source

1. **Check the platform.** For a DPL library, confirm `/api/v1/events` answers and robots allows `/api/`.
2. **Add the reviewed row.** Copy an existing DPL row and change `id`, `label`, `endpoint`, `source_identity` and the municipality `bbox`. Take the bbox from the municipality's OSM boundary, never by hand.
3. **Resolve the venues once:**

   ```sh
   node scripts/resolve-event-source-venues.js --only <feed-id>
   node scripts/resolve-event-source-venues.js --only <feed-id> --write
   ```

4. **Review the diff** of `config/reviewed-event-venues.json`, then run `node --test tests/mapped-event-source-provider.test.js`.

**Next platform profiles:** Helsingborg's Event Manager API (WordPress REST) and Visit Värmland's TURID v8 API. Both carry coordinates and occurrence lists.
