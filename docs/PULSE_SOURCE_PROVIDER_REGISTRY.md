# Pulse Source Provider Registry v1

This layer is the generic source-provider path that sits before Pulse signal
quality. City adapters own raw/source facts. Parranda core owns normalization,
display gates, dedupe, and route/Pulse eligibility.

## Contracts

`SourceDescriptor` describes a source before it runs:

- `id`
- optional `label`
- optional `publisherId` for the underlying publisher/evidence owner
- optional `sourceFamily` for acquisition-family provenance
- `city`
- `role`
- `sourceType`
- `status`
- `intendedUse`
- `supportedLanguages`
- `updateCadence`
- `parsingRisk`
- `trust`
- `cachePolicy`
- `sourceOwnedFields`
- `parrandaOwnedFields`

`NormalizedEvent` separates:

- `source`: descriptor identity, role, trust, URL, status
- `source_owned`: provider facts such as title, venue, address, dates, raw URL
- `parranda_owned`: app interpretation such as known place, route fit, geocode,
  tags, or confidence
- `confidence`: normalized source confidence
- `display_gate`: generic eligibility decisions

`NormalizedSignal` uses the same base shape for non-event context sources later:
weather, alerts, transport, air quality, coast/dayflow, and computed daily
signals.

`TimeSensitiveSourceEvent` is the generic contract for source-backed happenings
that may matter because of **when** they happen, not just where they are:

- `candidate_kind: "source_event"`
- source identity: `source_url`, `source_label`, `source_type`, `source_tier`
- place context: `city`, `place_context`, `area`, optional `lat` / `lng`
- timing: `starts_at`, `ends_at`, optional `time_window`, `recurrence`,
  `last_checked`, `freshness`
- trust: canonical `confidence`, `provenance`
- planning hints: `tags`, `intents`, optional `route_role_hint`
- `timing_relevance`: `now`, `today`, `tonight`, `future`, `stale`, or
  `unknown`

The contract is city-agnostic. A night market, civic calendar event, venue
programming item, temporary waterfront activity, or seasonal market all enter
through the same normalization path. A source URL / source label / provenance is
required for strong confidence; stale or expired events are downgraded instead
of promoted.

Providers may now return a separate `time_sensitive_events` list. The registry
normalizes those rows through the time-sensitive source-event contract and keeps
them separate from legacy live events, source signals, and route candidates.
After normalization, conservative evidence fusion collapses literal duplicates
and corroborated cross-provider representations of the same occurrence. Fused
events preserve compact `sources[]`, field provenance, conflict reasons, and an
independent publisher count. Different adapters from the same publisher or the
same canonical event URL are not counted as independent confirmation.
The Pulse engine may consume them as gated, salience-ranked context signals when
they are source-backed, current/today/tonight, and at least medium confidence.
They do not automatically become route stops, route candidates, citypack
candidates, or Planner mutations. A separately route-eligible event may produce
one bounded `pulse_route_interrupt_v1`; only the applied branch can alter stop
structure, and only after geometry and the full walking order validate. A
suggested interrupt leaves the route unchanged.

For source acquisition and evaluation before a provider is wired, see
[`LIVE_EVENT_SOURCE_DISCOVERY.md`](./LIVE_EVENT_SOURCE_DISCOVERY.md). That doc
defines the multi-source discovery algorithm, trust/freshness model, and Athens
worked example for deciding which source families deserve provider probes.

## Display Gates

The gate helper answers:

- may show in Pulse
- may show in live list
- may influence routes
- may create a place candidate
- may show as nearby

A source URL alone does not create a place card, place candidate, route influence,
or nearby claim. Nearby/place requires provider coordinates, a known place,
geocode, or venue+address above the confidence threshold.

## Registry Behavior

`SourceProviderRegistry` can register providers, filter them by city/role/status,
and collect normalized events/signals. Provider failures return empty results with
`source_status: failed`; they do not break the whole Pulse request.

Default collection only runs `active` providers. `candidate`, `review-needed`,
and `disabled` descriptors stay inspectable metadata unless explicitly enabled.

The registry rejects duplicate provider ids and skips providers whose descriptor
city does not match the requested city. No cross-city fallback is allowed.

## Historical non-goals for registry v1

- No full source registry UI.
- The registry itself does not directly mutate Planner, Blitz or route-engine
  output; later bounded consumers may use its gated normalized events.
- No Barcelona/Rome/Athens special cases in the registry core.
- No fuzzy title-only event identity. Fusion is occurrence-scoped and requires
  compatible time plus venue/geo evidence across unrelated providers.

## Active v1 wiring

Barcelona's Open Data BCN agenda provider is the first source wired through this
registry path. The adapter still owns the raw CKAN/Open Data shape and its
city-specific quality filtering. The registry owns descriptor validation,
failure-safe collection, source status reporting, dedupe, normalized ownership
boundaries, and display/place/nearby gates.

The provider must not create a place candidate or nearby claim from a source URL
alone. Nearby/place eligibility requires provider coordinates, a known place,
geocode, or a venue+address above the confidence threshold.

## Generic weather-context provider (Open-Meteo)

The first city-AGNOSTIC source provider. Where the Open Data BCN provider is one
city + one official feed, `createWeatherContextProvider()` works for any city
that exposes a `center` and a `fetchWeatherForDates` service. It is wired for
Rome, Barcelona, and Athens through the same `services.pulseSourceProviders`
path, proving the registry can back agnostic intelligence, not only per-city
feeds.

It produces source-backed **signals, never events**. A weather signal carries no
coordinates and no place, so the display-gate layer structurally keeps it as
Pulse context only — it can never become a live event, place candidate, nearby
claim, or route stop.

Product rule: Parranda is not a weather app. The interpreter stays silent on
normal weather and emits at most one signal — the single most dayflow-relevant
shift — only when weather actually changes the plan (rain → indoor-leaning
route, strong heat/cold → comfort/timing, high wind → exposed coast/views, or an
unusually good outdoor window). Boring weather produces no Pulse signal.

Data reuse: the provider calls the city's existing `fetchWeatherForDates`
(server/weather.js, Open-Meteo) and shares its 30-minute cache, so a single
`/api/city-pulse` request makes no duplicate weather network calls.

### Source honesty — Open-Meteo licensing

Open-Meteo's free API is licensed for **non-commercial use** under CC BY 4.0 with
fair-use rate limits (no API key, ~10k calls/day guidance). This provider is
wired `status: "active"` for product development. A commercial deployment would
require an Open-Meteo paid plan (or an equivalent licensed weather source) — it
is **not** production-commercial cleared as-is. This note is the honest record;
it does not block development use.

## Inspect mode v1

`GET /api/city-pulse?...&inspect=sources` exposes a compact runtime inspect view
for source providers.

It is additive and off by default. When requested, it reports:

- `provider_ids`
- `source_status`
- `normalized_event_count`
- capped `event_rows`
- per-event `display_gate`
- source identity and compact source-owned facts
- whether the event converted into the legacy live-event compatibility shape

For signal-producing providers (e.g. the weather-context provider) it also
reports a capped signal summary:

- `normalized_signal_count`
- capped `signal_rows`
- per-signal `signal_type`, `signal_kind`, `confidence`, and `dayflow_reason`
- per-signal `display_gate` (proving weather stays Pulse-only)

For time-sensitive source-event providers it reports a capped event summary:

- `normalized_time_sensitive_event_count`
- capped `time_sensitive_event_rows`
- per-event `timing_relevance`, `starts_at`, `ends_at`, `confidence`,
  `route_role_hint`, `candidate_kind`, source label/URL, and coordinates when
  known
- compact fusion status, independent source count, evidence sources,
  field provenance, and conflicts when multiple provider rows describe one
  occurrence

It does not dump raw provider payloads by default. The inspect shape is meant to
speed up provider review and failure diagnosis without turning `/api/city-pulse`
into a raw source debugger.

## Source honesty — place resolver (geocoding) licensing (#263)

The agnostic place resolver (`server/place-candidates/place-resolver.js`,
`createNominatimPlaceResolver` / `resolveDefaultPlaceResolver`) wires OSM
**Nominatim** behind the trusted `placeResolver` seam. It is **default-off**:
`resolveDefaultPlaceResolver(env)` returns `null` unless the deploy sets
`PARRANDA_PLACE_RESOLVER`, so default behavior is unchanged.

This is **low-volume, user-triggered dogfood/MVP** wiring, not a
production-commercial-cleared geocoding service:

- Nominatim's usage policy requires a valid identifying **User-Agent**
  (deploy-configurable via `PARRANDA_PLACE_RESOLVER_USER_AGENT`, default carries a
  project/contact URL), **≤1 request/second** (honored per-resolver-instance via a
  global rate gate + in-flight dedupe), and **client-side caching of repeated
  queries** (in-memory TTL only — lost on restart).
- Nominatim asks geocoding-**primary** services to self-host. Higher-volume or
  commercial use needs **persistent caching and/or a paid or self-hosted provider**
  (e.g. OpenCage, Geoapify, LocationIQ, or self-hosted Photon/Pelias).
- Data is **© OpenStreetMap contributors under ODbL**; mapped candidates carry
  `attribution` + `license` so a UI that displays a resolved place can show it.
- Nominatim returns **no timezone**, so freeform-place requests keep time-of-day
  signals off (`timezone_unavailable`, per #262). No coordinate→timezone lookup is added.

This note is the honest record; it does not block development use.
