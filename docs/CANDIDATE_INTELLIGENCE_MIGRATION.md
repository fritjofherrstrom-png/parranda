# Candidate Intelligence Migration

**Status:** Working design / migration plan  
**Scope:** Parranda engine architecture  
**Purpose:** Turn the existing candidate infrastructure into a shared decision spine for Blitz and generated `Your Day` without creating a fourth pipeline or replacing the route engine in one risky jump.

## Core finding

Parranda already has meaningful candidate infrastructure:

- `server/place-candidates/` defines place candidate kinds, trust tiers, confidence, freshness, source metadata, tags, vibes, time fit, and route roles.
- `server/route-candidates/` defines route candidate shape, source mix, trust summary, explanation inputs, warnings, limitations, route shape, and stop structure.
- `server/planner/route-candidate-shadow.js` compares generated planner output against route candidates and reports readiness/mismatch diagnostics.
- `server/pulse-sources/display-gates.js` already contains an important decision-boundary primitive: whether a source-backed signal may show, influence routes, create a place candidate, or appear nearby.

The issue is not that Parranda lacks candidate concepts. The issue is that candidate intelligence is still too much of a contract/shadow/diagnostic layer while real decisions are still split across bespoke paths: Pulse signals, Blitz scoring, and route-engine scoring.

The migration goal is therefore:

```txt
Promote existing candidate intelligence into the real decision path, surface by surface,
without building a fourth parallel pipeline.
```

## Product truth

Parranda should not win by owning the largest static catalog. It should win by using a broad candidate universe better than anyone else.

A broad candidate base matters because it gives the engine more possibilities:

- verified Parranda catalog entries
- citypack source candidates
- official open data
- live event feeds
- OSM/Wikidata/Wikipedia-style structured public data
- map/search-style public consensus where source policy allows it
- editorial/local/community/blog evidence
- nearby landmarks and obvious classics
- contextual signals such as weather, time, user location, intent, and route state

But those inputs are raw material. Parranda's USP is the judgment layer:

```txt
Which candidate fits this user, in this place, at this moment, with this weather,
this time window, this intent, this energy level, and this dayflow?
```

External consensus is useful evidence. It must not become the answer.

A highly rated place is not automatically right.  
A famous place is not automatically wrong.  
An obscure place is not automatically better.  
A weather signal is context, not a stop.  
A source URL is not a place.

## Recommended architecture direction

### 1. Candidate Intelligence Spine

Use the existing candidate contracts as the spine instead of creating a separate `Candidate Reservoir` pipeline.

Conceptual flow:

```txt
sources/catalog/providers
        ↓
place/event/anchor candidates
        ↓
evidence + provenance + derived confidence
        ↓
eligibility gates
        ↓
fit scoring
        ↓
bounded modifiers
        ↓
Blitz selector / Your Day composer / Pulse explanations
```

The spine should serve multiple surfaces, but each surface can be promoted gradually:

- first inspect/diagnostics
- then experimental Blitz
- then agnostic Blitz
- then generated `Your Day`

### 2. Evidence Ledger

Add an explicit evidence model so source claims stay separate from Parranda's belief and route decisions.

An evidence item should represent a claim, not a final truth:

```js
{
  claim_type: "existence" | "location" | "name" | "category" | "hours" | "popularity" | "sentiment" | "vibe" | "price" | "live_timing",
  value,
  source_ref: {
    provider_id,
    source_family,
    source_tier,
    url,
    label
  },
  observed_at,
  freshness,
  weight
}
```

Confidence should be derived from evidence, not hand-declared by each provider.

A reducer should produce a compact derived block:

```js
{
  existence_confidence: "high" | "medium" | "low" | "needs_review",
  category_confidence: "high" | "medium" | "low" | "needs_review",
  provenance_diversity: 0,
  freshness: "live" | "fresh" | "stale" | "unknown",
  consensus: {
    volume_band: "none" | "some" | "lots",
    sentiment_band: "unknown" | "mixed" | "positive" | "strong"
  },
  reasons: []
}
```

Consensus should be banded on purpose. Raw rating precision should not become a ranking shortcut. A place with 4.8 stars should not automatically beat a place with 4.6 stars. Public consensus can confirm that a candidate exists and matters; Parranda decides whether it fits the day.

### 3. Gate → Fit → Modifier

Do not collapse all signals into one weighted score. That is how the product drifts toward a generic review/ranking app.

Use three typed stages:

```txt
Stage 1 — Gates
Can this candidate be shown, suggested, used as a route anchor, used as a nearby move,
or only kept as context/debug?

Stage 2 — Fit
Among eligible candidates, how well does this candidate fit the user, lens, route,
time window, area, intent, and dayflow?

Stage 3 — Modifiers
Weather, public consensus, live context, freshness, and source confidence can tilt decisions
within bounded ranges, but they should not dominate the primary fit.
```

This implements the core product rule:

```txt
Context should bias, not dictate.
```

Examples:

- Rain lowers exposed outdoor candidates and raises indoor/covered candidates, but it does not delete all outdoor places.
- Good weather raises views/coast/terraces when route rhythm supports them, but it does not force them.
- Public consensus can help a candidate pass confidence thresholds or break ties, but it should not be the main sort key.
- Tourist/local/rediscover lenses can change how fame, novelty, and consensus are interpreted.

### 4. Universal eligibility gates

The Pulse display-gate idea should become a general candidate eligibility primitive.

Future candidate gates may include:

```js
{
  may_show: true,
  may_suggest_now: true,
  may_anchor_route: false,
  may_influence_route: true,
  may_create_place_candidate: false,
  may_show_as_nearby: true,
  may_show_in_debug_only: false,
  reasons: []
}
```

This is where hard product boundaries belong:

- weather can influence and explain, but cannot become a place
- source-url-only events cannot become place targets
- weak candidates can remain inspectable but hidden from user-facing recommendations
- live events need reliable place/time targeting before they affect routes
- no-route / thin-city states can be honest instead of hallucinated

### 5. Candidate Index / Graph vocabulary

`Candidate Reservoir` is useful as a conversation phrase, but the implementation vocabulary should be sharper:

- **Candidate Spine** — the shared decision substrate across surfaces.
- **Evidence Ledger** — append-only claims from sources.
- **Candidate Index** — the request/read projection of candidates after normalization, evidence reduction, gates, and fit preparation.
- **Candidate Graph** — the long-term model for entity resolution/deduplication across multiple source families.

Do not start by building a heavy graph system. Start with the spine, evidence model, reducer, gates, and inspectability. Treat graph/entity resolution as a long-term direction that becomes more important as external evidence volume grows.

## Migration ladder

The goal is forward motion without a giant risky rewrite.

### Step 0 — Source-aware Your Day

**Status:** Done via #231.

Sources/weather/live context now reaches generated `Your Day` through a day-level `dayflow_context` explanation layer. This was the first bridge from source intelligence into route experience.

### Step 1 — Candidate Intelligence Spine v1

**Goal:** Establish the shared primitives without changing default product output.

Expected scope:

- shared confidence normalization
- evidence item shape
- evidence reducer v1
- derived evidence summary
- initial candidate fit decomposition shape
- unit tests
- no default route/Blitz replacement

Exit criteria:

- a candidate can carry evidence and derived confidence
- source-family diversity is visible
- consensus is banded, not raw-ranking power
- confidence vocabulary starts converging instead of drifting
- existing output remains stable

### Step 2 — Universal Eligibility Gates v1

**Goal:** Lift the Pulse display-gate principle into candidate-level gates.

Expected scope:

- candidate gate module
- gate reasons
- weather/signal/event/place boundary tests
- source-url-only and weak-metadata rejection tests
- no default selector replacement yet

Exit criteria:

- candidates can be classified into allowed roles
- non-place context cannot become a place
- weak source-backed candidates remain inspectable but hidden
- gates are reusable by Blitz and Planner

### Step 3 — Candidate Inspect Mode

**Goal:** Make the candidate spine debuggable before it controls output.

Possible shape:

```txt
?inspect=candidates
```

Inspect should show:

- candidate id / label / kind
- source/provenance
- evidence summary
- derived confidence
- gates passed/failed
- fit inputs
- why hidden / why eligible
- source-family diversity

Exit criteria:

- reviewers can see what the engine thinks without guessing
- Claude/Codex/ChatGPT can inspect failures quickly
- no default UX risk

### Step 4 — Experimental Blitz candidate path

**Goal:** Let candidate intelligence control one real but bounded surface.

Recommended boundary:

- Blitz first, not generated `Your Day`
- behind explicit flag/inspect/config
- legacy Blitz remains default until the new path is better

Exit criteria:

- candidate spine can select a next move
- output includes gate/fit/modifier explanation
- default product is unchanged unless experimental mode is enabled
- tests cover no candidates, weak candidates, strong curated candidates, source-backed candidates, and time/weather context

### Step 5 — External evidence provider v1

**Goal:** Add broad candidate input without legal/source-policy chaos.

Start with source types that are easier to store and reason about:

- OSM
- Wikidata/Wikipedia
- official open data
- existing city/event feeds

Restricted map/search/review sources can be considered later as ephemeral evidence or research hints, depending on source policy. Do not build a persisted clone of Google/Tripadvisor data.

Exit criteria:

- external candidates enter as source-backed, not Parranda-verified
- evidence/provenance is explicit
- gates prevent weak candidates from becoming route anchors
- inspect mode explains why candidates are used or rejected

### Step 6 — Agnostic Blitz v1

**Goal:** Parranda can answer the real-world question: “We are here now. What is the smart move?” even in thin cities.

Scenarios:

- Athens
- Naxos
- Simrishamn
- Stenshuvud
- near Sagrada Família
- unknown city with coordinates but no dedicated pack

Exit criteria:

- usable next move in thin/no-citypack contexts
- confidence is honest
- time-of-day matters
- weather biases but does not dominate
- obvious landmarks and local finds can both win when appropriate
- weak candidates are hidden or downgraded

Current explicit contract:

- `anywhere_blitz=1` resolves a freeform place or explicit coordinates through
  the same trusted any-place intake used by Planner;
- local time comes only from resolver-attested or weather-provider-derived
  timezone evidence, with no fabricated midday fallback;
- the shared candidate spine supplies the place move and the existing bounded
  Live acquisition supplies source health plus a possible event option;
- a Live event may interrupt the place move only when it has already passed the
  event gates, is salient, within 2 km, and is happening now or starts within
  90 minutes;
- the contract never mutates a route or changes the day anchor. Public payload
  fields cannot inject resolved context, candidates, weather, time, or events.

The product UI must consume this contract deliberately. A random preference
bundle is not equivalent to Blitz's “smart move right now” promise.

### Step 7 — Candidate-driven Your Day

**Goal:** Generated `Your Day` can compose from the candidate spine, not only legacy templates.

This should come after Blitz because full-day sequencing is harder.

Exit criteria:

- candidate intelligence can compose a coherent day
- route rhythm, walking envelope, opening-hours confidence, time windows, weather, and user intent work together
- citypack candidates, external candidates, live events, and contextual signals can be mixed honestly
- legacy route path remains available until the new path is demonstrably better

### Step 8 — Experience Lens scoring

**Goal:** Tourist/local/rediscover becomes actual scoring behavior.

Possible lens values:

```txt
first_time
balanced
local
rediscover
surprise
```

Exit criteria:

- classic landmarks rise in first-time/tourist mode
- obvious tourist defaults are softened in local/rediscover mode
- local mode does not blindly reward obscurity
- rediscover helps users see familiar places differently
- same candidate universe can produce different routes through lens scoring

### Step 9 — Agnostic Parranda v1

Parranda reaches Agnostic v1 when it can:

```txt
Given location, time, weather, intent, experience lens, and thin/no citypack,
find credible nearby candidates, gate weak ones, explain confidence/provenance,
select a useful Blitz next move, and generate a basic coherent Your Day without pretending
it has full citypack confidence.
```

The bar is not perfection everywhere. The bar is usefulness everywhere, with honest confidence.

## Non-goals

The migration should not become a bureaucracy trap.

Do not do these as the first implementation:

- no full route-engine rewrite
- no default Blitz replacement without inspect/flag safety
- no heavy graph database or entity-resolution service in v1
- no new fourth pipeline beside existing candidate layers
- no raw persisted Google/Tripadvisor clone
- no strategy-only loop without code movement
- no city-specific hacks that cannot teach the generic engine

## Review rule for future PRs

Every PR in this migration should answer:

```txt
Does this move candidate intelligence closer to a shared decision spine?
Does it improve or prepare Blitz / Your Day without degrading trust?
Can we inspect why a candidate was accepted, rejected, or ranked?
Does it reduce pipeline drift rather than adding another path?
```

If the answer is no, it is probably not the right PR.

## Immediate next PR direction

The next implementation should be ambitious but bounded:

```txt
feat(candidates): introduce candidate intelligence spine v1
```

Target scope:

- evidence item model
- evidence reducer
- shared confidence normalization
- derived confidence/evidence summary
- first gate/fit/modifier vocabulary
- tests
- optional inspect stub if clean
- no default product-output replacement

This is not a timid step. It is the foundation that lets Parranda become agnostic without becoming generic.

## Operating principle

Citypacks remain valuable. They should become premium fuel for the engine, not life support.

Parranda's long-term advantage is the ability to source broadly, judge carefully, adapt to context, and compose a better day.
