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
