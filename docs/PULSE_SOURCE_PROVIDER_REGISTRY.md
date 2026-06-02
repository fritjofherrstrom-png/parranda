# Pulse Source Provider Registry v1

This layer is the generic source-provider path that sits before Pulse signal
quality. City adapters own raw/source facts. Parranda core owns normalization,
display gates, dedupe, and route/Pulse eligibility.

## Contracts

`SourceDescriptor` describes a source before it runs:

- `id`
- optional `label`
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

## Non-goals for v1

- No full source registry UI.
- No Planner, Blitz, route-engine, or citypack behavior changes.
- No Barcelona/Rome/Athens special cases in the registry core.
- No full cross-source merge layer. Dedupe is v1-lite and should not be treated
  as canonical event identity across unrelated providers.

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

It does not dump raw provider payloads by default. The inspect shape is meant to
speed up provider review and failure diagnosis without turning `/api/city-pulse`
into a raw source debugger.
