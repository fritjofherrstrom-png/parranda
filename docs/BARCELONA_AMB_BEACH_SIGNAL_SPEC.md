# Barcelona AMB Beach Signal Spec

Status: implementation-ready planning doc

This document turns the AMB beach-status finding into a Parranda signal design. It should be read together with `docs/SOURCE_SIGNAL_ROLES.md`.

Core framing:

```text
AMB Beach Status is not another event feed.
It is a Barcelona-specific adapter for a generic coast/day-flow signal.
```

## Why this matters

Parranda should understand the day, not just list places. Beach/coast data helps answer whether a coastal route should be boosted, downranked, explained, or ignored today.

The generic engine lesson is reusable:

```text
city-specific source -> coast_condition / environmental_dayflow_signal -> route bias + Pulse framing
```

Barcelona is the first concrete instance. Other cities may later provide the same signal through different data: Naxos wind/meltemi, Copenhagen harbor swim data, Stockholm swim-water data, Rio beach/surf conditions, or a small coastal town's wind/coast alerts.

## Endpoint

Primary v1 endpoint:

```text
GET https://opendata.amb.cat/dades_estat_platja/search
```

Recommended params:

| Param | Required | Example | Notes |
|---|---|---|---|
| `municipi` | yes | `barcelona` | Always filter to Barcelona. |
| `rows` | no | `10` | Barcelona has 10 beach records. |
| `getFields` | no | `bandera,ocupacio,meduses,estat_aigua,aspecte_aigua,disponible,platja,date_updated,data_report_ocupacio` | Keeps payload small. |

No auth required.

Companion endpoint, not required for v1:

```text
GET https://opendata.amb.cat/dades_meteorologiques/search
```

Use beach status first. Beach weather can be added later if it reliably provides beach-local wind/wave/UV data. Parranda already has Open-Meteo for city weather.

## Raw fields

Expected AMB status fields:

| AMB field | Meaning | Source-owned |
|---|---|---|
| `bandera` | beach flag | yes |
| `ocupacio` | occupancy | yes |
| `meduses` | jellyfish reported | yes |
| `estat_aigua` | water quality/state | yes |
| `aspecte_aigua` | water appearance | yes |
| `disponible` | whether monitored/lifeguard beach-status data is available | yes |
| `platja` | AMB beach identifier | yes |
| `date_updated` | provider update timestamp | yes |
| `data_report_ocupacio` | occupancy report timestamp; may be empty | yes |

## Normalization maps

Normalize Catalan source values at the adapter boundary. Shared engine code should not consume raw Catalan enum values.

```js
const FLAG_MAP = {
  VERDA: "green",
  GROGA: "yellow",
  VERMELLA: "red",
  DESCONEGUT: "unknown",
};

const OCCUPANCY_MAP = {
  BAIXA: "low",
  MITJANA: "medium",
  ALTA: "high",
  SENSE_INFORMACIO: "unknown",
};

const WATER_QUALITY_MAP = {
  APTA: "good",
  NO_APTA: "poor",
  DESCONEGUT: "unknown",
};

const WATER_APPEARANCE_MAP = {
  NETA: "clean",
  BRUTA: "dirty",
  DESCONEGUT: "unknown",
};
```

Unknown provider values must map to `unknown`, not throw.

## Beach-to-area mapping

The adapter maps AMB beach identifiers into existing Parranda Barcelona areas.

| AMB beach | Parranda area | Macro |
|---|---|---|
| `platja_barcelona.sant_sebasti` | `barceloneta` | `coast-east` |
| `platja_barcelona.sant_miquel` | `barceloneta` | `coast-east` |
| `platja_barcelona.barceloneta` | `barceloneta` | `coast-east` |
| `platja_barcelona.somorrostro` | `barceloneta` | `coast-east` |
| `platja_barcelona.nova_icria` | `poblenou` | `coast-east` |
| `platja_barcelona.bogatell` | `poblenou` | `coast-east` |
| `platja_barcelona.mar_bella` | `poblenou` | `coast-east` |
| `platja_barcelona.nova_mar_bella` | `poblenou` | `coast-east` |
| `platja_barcelona.llevant` | `poblenou` | `coast-east` |
| `platja_barcelona.banys_frum` | `poblenou` | `coast-east` |

Unknown future beach ids should be ignored and logged for review. Do not fabricate areas.

## Zone aggregation

Route-level decisions should use two coast zones rather than individual beach records:

| Zone | Beaches | Area |
|---|---|---|
| `barceloneta_coast` | Sant Sebastià, Sant Miquel, Barceloneta, Somorrostro | `barceloneta` |
| `poblenou_coast` | Nova Icària, Bogatell, Mar Bella, Nova Mar Bella, Llevant, Banys del Fòrum | `poblenou` |

Aggregation rule:

- worst flag wins
- highest occupancy wins
- any jellyfish reports true
- any monitored beach means zone has monitored data

This is conservative and better for route trust than cherry-picking the best beach.

## Normalized coast condition

Suggested internal shape:

```js
{
  signal_type: "coast_condition",
  city: "barcelona",
  zone: "barceloneta_coast",
  area: "barceloneta",
  macro: "coast-east",

  // source-owned
  flag: "green",              // green | yellow | red | unknown
  occupancy: "low",           // low | medium | high | unknown
  jellyfish: false,
  water_quality: "good",      // good | poor | unknown
  water_appearance: "clean",  // clean | dirty | unknown
  monitored: true,
  updated_at: "2026-07-15T09:30:00.000Z",

  // Parranda-owned
  condition: "beach_day",     // beach_day | beach_busy | beach_caution | beach_closed | off_season | unknown
  coast_boost: 2,
  surface_in_pulse: true,
  confidence: "high",
  pulse_text_key: "pulse.coast.beach_day"
}
```

## Condition derivation

Rules:

```js
function deriveCondition({ flag, occupancy, monitored }) {
  if (!monitored) return "off_season";
  if (flag === "unknown") return "unknown";
  if (flag === "red") return "beach_closed";
  if (flag === "yellow") return "beach_caution";
  if (flag === "green" && occupancy === "high") return "beach_busy";
  if (flag === "green") return "beach_day";
  return "unknown";
}
```

Coast boost:

| Condition | Boost | Behavior |
|---|---:|---|
| `beach_day` | `+2` | Boost coast-area templates and coast starts/finals. |
| `beach_day` + jellyfish | `+1` | Still positive, but avoid swim-heavy framing. |
| `beach_busy` | `+0.5` | Mild coast bias; do not use quiet-beach copy. |
| `beach_busy` + jellyfish | `-0.5` | Downrank swimming-adjacent routes; coastal walks still okay. |
| `beach_caution` | `0` | Neutral; show caution when coast intent is explicit. |
| `beach_closed` | `-3` | Downrank coast-heavy routes unless coast intent is explicit. |
| `off_season` | `0` | No signal; no fake negative. |
| `unknown` | `0` | No signal; no fake certainty. |

## Freshness and seasonality

- Use `date_updated` as the source freshness timestamp.
- If `date_updated` is older than 4 hours while `disponible === true`, downgrade confidence to `low` and suppress Pulse output.
- If `disponible === false`, treat as `off_season`/no monitored signal.
- Off-season or unknown data should not become a negative beach claim.
- Missing data should usually suppress the signal, not tell the user beaches are bad.

## Product behavior

Positive coast signal:

- green flag + low/medium occupancy + monitored data
- boost `coast-east` route templates
- suggest coastal start when morning and conditions are fresh
- suggest coast final when afternoon/evening and route already fits
- Pulse can mention the specific coast zone

Caution signal:

- yellow flag, jellyfish, or high occupancy
- avoid strong beach-day copy
- show warning if the user explicitly wants coast/beach
- otherwise keep route scoring neutral or mildly damped

Negative signal:

- red flag
- downrank coast-heavy templates
- do not suppress coastal walks entirely if the user explicitly asks for coast; frame it as walk-only/caution

No signal:

- off-season, stale, unknown, API failure, empty response
- no route bias
- no Pulse card
- coast routes remain available on their own merits

## Explicit coast intent override

If the user explicitly asks for beach/coast/strand/platja/coast-walk style routing, the engine should not hide coast routes solely because of a weak beach signal.

Instead:

- red/yellow status becomes context and caution
- green status becomes supportive context
- off-season/unknown does not add fake caution

## Pulse copy examples

English:

- `Beach morning works: Barceloneta has a green flag and low occupancy. Good day to start by the coast.`
- `Coast is open but busy: Barceloneta is active, Poblenou may be calmer.`
- `Yellow flag at Barceloneta: coastal walks are fine, swimming needs caution.`
- `Jellyfish reported near the coast: keep the walk, avoid swim-heavy framing.`

Swedish:

- `Bra strandmorgon: Barceloneta har grön flagga och låg beläggning. Bra dag att börja vid kusten.`
- `Kusten fungerar men är livlig: Barceloneta är aktivt, Poblenou kan vara lugnare.`
- `Gul flagga vid Barceloneta: kustpromenad fungerar, bad kräver försiktighet.`
- `Maneter rapporterade vid kusten: behåll promenaden, men tona ner bad/strandhäng.`

No off-season copy. Omit the signal.

## Implementation placement

Preferred generic-first shape:

```text
server/signals/coast-condition.js
```

Barcelona adapter can live near the city source layer:

```text
server/cities/barcelona/coast-signal.js
```

Suggested split:

- city adapter fetches AMB and maps beach ids to areas
- generic `coast-condition` module normalizes conditions, derives confidence, Pulse surfacing, and route bias

This keeps Barcelona-specific endpoint logic out of shared engine behavior.

## Tests to add

Unit tests:

1. flag normalization: `VERDA`, `GROGA`, `VERMELLA`, `DESCONEGUT`, unknown fallback
2. occupancy normalization: `BAIXA`, `MITJANA`, `ALTA`, `SENSE_INFORMACIO`, empty fallback
3. condition derivation: off-season, red, yellow, green/high, green/low, unknown
4. coast boost derivation, including jellyfish dampening
5. zone aggregation: worst flag, highest occupancy, any jellyfish, monitored handling
6. staleness: fresh vs stale update timestamps
7. Pulse surfacing: beach-day and caution surface, off-season and stale suppress

Integration tests:

1. beach id maps to expected area/macro
2. unknown beach id is ignored, no crash
3. API 200 happy path emits coast signals
4. API 500/timeout/empty response emits no signal and does not crash
5. off-season data applies no route penalty and no Pulse output

## Implementation gates

Do not wire this as an event feed.

Do not let it block Pulse, Blitz, Planner, or route generation.

Do not produce negative beach claims from no-data/off-season responses.

Do not add Barcelona-specific branches inside shared route-engine logic.

Do not use beach data to force route stops. It should influence scoring and framing.

## Independence from agenda-diaria

AMB beach status can be implemented independently from Open Data BCN `agenda-diaria` because it is a different source, cadence, and signal type.

- `agenda-diaria` = city event baseline
- AMB beach status = coast/day-flow condition

They can proceed as separate workstreams. The shared point is that both should emit normalized signals with trust/freshness and avoid source-owned text leaking directly into app-owned prose.
