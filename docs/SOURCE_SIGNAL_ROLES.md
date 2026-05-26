# Source Signal Roles

Parranda should not add sources simply to show more items. A source is valuable when it gives the engine a better sense of the day.

The core rule:

```text
City-specific source adapter -> generic signal role -> shared engine behavior -> city-specific area mapping
```

A source integration should make Parranda more agnostic whenever possible. Barcelona can be the first implementation of a signal, but the engine lesson should be reusable by Athens, Naxos, Rome, Rio, Copenhagen, Stockholm, Simrishamn, or any later city.

## Source vs Parranda ownership

Source-owned fields must stay close to the original provider. Parranda can normalize names, values, freshness, and confidence, but should not rewrite provider facts as if they were app knowledge.

Examples of source-owned fields:

- provider id and source URL
- title or source label
- venue, address, municipality, beach, district, or coordinates
- start/end date, updated-at timestamp, timetable, or season flag
- provider category, raw status, raw summary, source language
- raw environmental values such as flag, occupancy, water status, wind, rain, or UV

Parranda-owned fields are app interpretation.

Examples of Parranda-owned fields:

- signal role and signal type
- route fit and route bias
- affected areas/macros
- confidence and freshness interpretation
- match reason and why-it-matters
- Pulse wrapper prose
- Blitz or Planner hints
- downrank/avoid reason

## Core signal roles

Use source roles to describe why a source exists, not what website it came from.

| Role | Purpose | Example source |
|---|---|---|
| `official_live_baseline` | Broad official event coverage for a city | Open Data BCN `agenda-diaria` |
| `market_rhythm` | Local market, food, street-market, and neighborhood rhythm | Mercats-derived Open Data events |
| `neighborhood_culture` | Civic/local culture with neighborhood texture | Civic center programming if structured |
| `secondary_culture_source` | Secondary official/cultural coverage, often overlapping the baseline | Gencat Agenda Cultural |
| `venue_programming` | High-signal venue calendars | MACBA RSS, if structured enough |
| `coast_or_dayflow_signal` | Environmental/coast/waterfront condition that affects the shape of the day | AMB Beach Status |
| `computed_daily_signal` | Parranda-owned computation from weather/date/catalog/opening-hours/density | Heat, rain, golden hour, route continuity |

Avoid wiring sources that only add volume. Prefer one clean source with a distinct role over several fragile feeds that duplicate the same event layer.

## Agnostic transfer checklist

Every source review or implementation spec should answer these questions:

1. What generic signal type does this source represent?
2. Which parts are city-specific adapter work?
3. Which parts belong in Parranda core?
4. Can another city expose the same signal through a different source?
5. What route bias, confidence handling, stale/off-season behavior, Pulse framing, and area mapping should be reusable?
6. What must remain city-specific: endpoint, raw field names, language, source values, local area mapping, local thresholds?
7. Does this teach the engine something reusable, or is it only a one-off city hack?

A source should usually land in the city adapter. Its interpretation should usually land in the generic engine.

## Example: AMB Beach as an agnostic signal

AMB Beach Status is Barcelona-specific data, but it should not create Barcelona-only engine behavior.

Bad pattern:

```text
If Barcelona beach flag is green -> recommend Barceloneta
```

Better pattern:

```text
AMB Beach Status -> coast_condition -> route bias -> Barcelona area mapping
```

Generic signal type:

```text
coast_condition
```

Possible normalized shape:

```json
{
  "type": "coast_condition",
  "source": {
    "id": "amb-beach-status",
    "role": "coast_or_dayflow_signal",
    "trust": "official",
    "updated_at": "2026-05-26T00:00:00Z"
  },
  "city": "barcelona",
  "affected_areas": ["barceloneta", "poblenou"],
  "source_owned": {
    "beach": "platja_de_la_barceloneta",
    "flag": "VERDA",
    "occupancy": "BAIXA",
    "jellyfish": false,
    "water_state": "DESCONEGUT",
    "water_appearance": "NETA",
    "available": true
  },
  "parranda_owned": {
    "condition": "good",
    "confidence": "high",
    "surface_in_pulse": true,
    "route_bias": {
      "coast": 0.8,
      "views": 0.3,
      "low_key": 0.2
    },
    "avoid_reason": null
  }
}
```

Barcelona owns:

- AMB endpoint(s)
- raw Catalan field values
- beach identifiers
- beach-to-area mapping
- seasonal caveats specific to the provider

Parranda core owns:

- `coast_condition` semantics
- freshness/staleness handling
- off-season/no-data behavior
- route bias contract
- Pulse framing rules
- confidence and suppression logic

The same model could later be fed by other sources:

| City/place | Local source or input | Generic signal |
|---|---|---|
| Naxos | meltemi/wind and beach suitability | `coast_condition`, `wind_exposure` |
| Athens | heat, coast, ferry/wind context | `heat_pressure`, `coast_condition` |
| Copenhagen | harbor swim or wind data | `waterfront_condition`, `wind_exposure` |
| Stockholm | swim-water/archipelago/weather data | `waterfront_condition` |
| Rio | beach/surf/crowd/weather data | `coast_condition` |
| Rome | heat/shade/rain/park suitability | `heat_pressure`, `shade_need`, `indoor_bias` |
| Simrishamn | wind/coast/rain/local market rhythm | `coast_condition`, `local_rhythm` |

## Surface rules

A signal should surface only when it improves trust or decisions.

- Good data can boost or explain a route.
- Weak data should not create fake certainty.
- Missing data should usually suppress the signal, not produce a negative claim.
- Stale data should be labeled or ignored.
- Off-season data should be treated as unavailable unless the source explicitly reports meaningful conditions.
- High-risk or caution states should downrank routes more readily than they create dramatic copy.

For AMB Beach specifically:

- green flag + low/medium occupancy + clean/available data can boost coast or waterfront routes
- red flag should suppress or strongly downrank beach-heavy routes
- yellow flag should create a caution, especially when the user explicitly asked for coast/beach
- jellyfish should avoid swim/beach-hang framing but may still allow a waterfront walk
- high occupancy should avoid quiet/low-key beach copy
- unknown/off-season should usually omit the beach signal

## Implementation gates

Before activating a source:

1. The source role must be explicit.
2. Source-owned and Parranda-owned fields must be separated.
3. The adapter must fail safely without breaking Pulse, Blitz, Planner, or the city page.
4. The implementation must avoid brittle scraping unless there is a testable fallback.
5. The source must include freshness and confidence handling.
6. The source must not duplicate an existing feed unless it adds meaningfully different signal quality.
7. The PR should document the agnostic transfer: what the generic engine learned.

## Anti-patterns

- Wiring a source because it has many items.
- Treating an event feed as intelligence without filtering or role mapping.
- Adding Barcelona-only route branches inside shared engines.
- Turning missing data into negative recommendations.
- Scraping bot-hostile HTML when official structured data exists elsewhere.
- Letting source text become app-owned prose without language-aware wrapping.
- Making Pulse signals become forced route stops.
