# Barcelona Second-Hand Verification Scout

Source-backed verification pass over the six first-wave targets named in
`docs/candidate-packs/barcelona-second-hand-promotion-plan.md`. This is a
**docs-only report**. It does not promote, edit `server/cities/barcelona/catalog.js`,
add providers, or change Planner, Blitz, route-engine, Pulse, Live, UI, CSS, or
public API behavior.

Author: claude (scout pass)
Date: 2026-05-23
Pack: `docs/candidate-packs/barcelona-second-hand-v0.md`
Plan: `docs/candidate-packs/barcelona-second-hand-promotion-plan.md`

## Method and self-limits

- Web search + page fetch against reputable Barcelona sources: Ajuntament
  (`barcelona.cat`, `ajuntament.barcelona.cat`), `barcelonaturisme.com`,
  Time Out Barcelona (EN + CA), `barcelona-metropolitan.com`, named shop
  operator pages, plus secondary local guides used only to corroborate.
- Memory alone is **not** treated as a source. Any candidate that could not be
  cross-referenced against at least one current, address-bearing source stays
  `keep_for_more_research`.
- Hours that vary between sources are flagged with both values rather than
  silently picking one.
- No on-the-ground observation in this pass. "Verified" means
  multiple-independent-source verified, not in-person.
- Periodic / pop-up markets stay deferred per the promotion plan.

## What is already in the runtime catalog

Reading `server/cities/barcelona/catalog.js` before drafting recommendations
turned up two relevant existing entries that change the first-wave picture:

- **`mercat-encants`** (line 237) — already in runtime, classified
  `"classic"`, `confidence: high`, `source_type: "official_site"`,
  `source_url: "https://encants.cat/"`. Tags already include `second_hand`,
  `vintage`, `market`. `availability.strongWeekdays: [1, 3, 5, 6]` matches
  the Mon / Wed / Fri / Sat market days I verified below.
- **`mercat-sant-antoni`** (line 194) — already in runtime as the weekday
  food market, `closedWeekdays: [0]`. The Sunday dominical (books / comics /
  coins) is a **different runtime entity** — same building, different
  operator and schedule. The catalog does not currently model it.

These two facts shift the recommendation: the smallest safe runtime PR is
not "promote Encants" (it is already there) — it is to promote a small,
geographically split pair of named shops that *fill the cluster claims* the
v0 pack makes about Raval and Born.

---

## Targets

### 1. `barcelona-encants-vells` → already promoted, no new runtime work

- **Current evidence found:**
  - Official market name **Mercat Encants Vells / Fira de Bellcaire**,
    multi-source confirmed.
  - Address per Time Out: *"Meridiana, 69, Fort Pienc, Barcelona 08018."*
    Address per Ajuntament-adjacent listings: Castillejos 158, 08013. The
    building sits on the corner — both addresses refer to the same site at
    Plaça de les Glòries.
  - Open days and hours (multi-source consensus): **Mon, Wed, Fri, Sat
    09:00–20:00.** Closed Tue, Thu, Sun. Auctions Mon / Wed / Fri
    08:00–09:30. Site has existed since long before relocation in 2014.
  - Character: still a public-facing second-hand / flea-market space with
    ~300 stalls.
- **Source URLs / source type:**
  - `https://www.timeout.com/barcelona/shopping/mercat-encants-vells-fira-de-bellcaire`
    — Time Out Barcelona, primary corroboration for days and hours.
  - `https://www.barcelonaturisme.com/wv3/en/page/3837/fira-de-bellcaire.html`
    — Barcelona Turisme listing (page surfaced but body was navigation-only
    in this pass).
  - `https://encantsbarcelona.com/` — operator site appeared in search but
    `/en/` and `/en/visit/` returned 404 in this pass; existing runtime
    entry uses `https://encants.cat/` which should be re-checked.
- **What can be verified now:** Existence, address, days of operation,
  hours, second-hand character. All consistent with the existing
  `mercat-encants` runtime entry.
- **What remains uncertain:** Whether `encants.cat` or `encantsbarcelona.com`
  is the current canonical operator URL; whether the existing
  `source_url: "https://encants.cat/"` still resolves cleanly.
- **Promotion recommendation:** `structural_only` (already runtime).
- **Proposed runtime shape:** No new entry. **Optional follow-up:** a
  separate, even tinier PR to re-check / refresh the `source_url` and
  `last_checked` on the existing `mercat-encants` entry. Out of scope for
  the first-wave promotion PR.

### 2. `barcelona-mercat-sant-antoni-dominical` → not yet promotable

- **Current evidence found:**
  - Official label in Ajuntament-affiliated sources: **Mercat dominical de
    Sant Antoni** (also "Sant Antoni Sunday Market" / "Mercat Dominical del
    Llibre de Sant Antoni"). It runs **every Sunday** around the perimeter
    of the Mercat de Sant Antoni building (Carrer del Comte d'Urgell 1,
    08011).
  - Scope: second-hand books, comics, magazines, postcards, vinyl, coins,
    stamps, plus some second-hand clothing.
  - Operator: dedicated dominical operator (`dominicaldesantantoni.com`,
    Twitter `@Santoni_dom`) plus Ajuntament endorsement.
  - Hours show a real source split:
    - Ajuntament / Info Barcelona / Barcelona Turisme: **Sundays 08:30–14:00**
      (some EN copy says "until 14:30").
    - BarcelonaYellow lists **Sundays 10:00–15:00** with extended hours over
      the December holidays (22–24 Dec, 2 / 4 / 5 Jan, 09:30–19:00).
- **Source URLs / source type:**
  - `https://www.barcelona.cat/infobarcelona/en/visita-el-mercat-dominical-de-sant-antoni_1423888.html`
    — Ajuntament (page surfaced but body fetch returned 418 in this pass;
    the search-result extract is the load-bearing evidence).
  - `https://www.barcelonaturisme.com/wv3/en/page/594/sant-antoni-market.html`
    — Barcelona Turisme, fetched successfully.
  - `https://www.barcelonayellow.com/bcn/shopping/antiques/book-market-sant-antoni`
    — secondary; corroborates address and scope.
- **What can be verified now:** Existence, address, weekly Sunday cadence,
  general scope (books / collectibles), official Ajuntament recognition.
- **What remains uncertain:** Exact current Sunday hours (08:30–14:00 vs
  10:00–15:00 vs extended December dates); whether holiday exceptions apply
  in the rest of the year.
- **Promotion recommendation:** `keep_for_more_research`.
- **Reasoning:** This is the canonical case the promotion plan flags. The
  runtime catalog already has `mercat-sant-antoni` with `closedWeekdays:
  [0]`. Modeling the dominical as a *new daily real_place* would lie about
  availability six days a week. Modeling it as a recurring event needs a
  runtime path (`event_venue` + `live_event_feed` provider, or a
  recurring-schedule field on catalog entries) that does not yet exist —
  see `docs/PLACE_CANDIDATES.md` "next likely step" pointing to
  `LiveEventVenueProvider`. Until then, promotion would either fake a
  schedule or fake a venue. Hold.

### 3. `barcelona-riera-baixa-cluster` → promote one verified shop, keep cluster structural

- **Current evidence found:**
  - Street-as-cluster reputation confirmed across Time Out, Casa Camper's
    own Raval shopping route, `barcelona-metropolitan.com`, and multiple
    local guides. *"The jewel of El Raval for vintage fashion lovers"* —
    Casa Camper.
  - Specific shops named-and-addressed in current sources:
    - **Lullaby Vintage** — Carrer de la Riera Baixa 22, 08001. Phone
      934 43 08 02. Currently operating. Mon–Sat 11:00–20:30, closed Sun.
      Profile on `barcelona-metropolitan.com` plus Time Out, Yelp, Corner.
    - **Holala! / Kilostore** — Carrer de la Riera Baixa 11, 08001.
      Mon–Sat 10:00 or 11:00–21:00 (sources differ on opening hour).
      Affiliated with the Holala! chain (Tallers 73, Plaça Castella 2).
    - **Lailo** — Carrer de la Riera Baixa 20, 08001. Founded 1989. Facebook
      reports the store as closed; cannot be treated as currently operating.
- **Source URLs / source type:**
  - `https://www.barcelona-metropolitan.com/locations/lullaby-vintage/` —
    independent Barcelona English-language magazine, profile page.
  - `https://www.timeout.com/barcelona/shopping/lullaby` — Time Out.
  - `https://www.casacamper.com/en/content/vintage-shopping-route-raval/` —
    Casa Camper editorial.
  - `https://www.yelp.com/biz/lullaby-barcelona` and
    `https://www.yelp.com/biz/kilostore-barcelona-3` — operator-attached
    business listings.
- **What can be verified now:** Street reputation; Lullaby Vintage existence,
  address, and current weekday hours; Holala! / Kilostore existence and
  address. Density of "two named active shops" meets the plan's "two or
  three active relevant shops" floor for cluster treatment but only just.
- **What remains uncertain:** Whether Holala! / Kilostore at #11 is open
  evenings or only daytime in 2026; Lailo current status; whether other
  unnamed shops on the street are currently operating.
- **Promotion recommendation:** `promote_candidate` (Lullaby Vintage only,
  for the first PR) **and** keep the cluster `structural_only` (do not
  expose Riera Baixa as a fake shop).
- **Proposed runtime shape (Lullaby Vintage):**
  - `candidate_kind`: `real_place`
  - Suggested catalog `id`: `lullaby-vintage`
  - `name`: `Lullaby Vintage`
  - `area`: `raval` (matches existing `barcelona/catalog.js` area token)
  - `kind`: `shop`
  - `tags`: `["vintage", "second_hand", "shopping", "lokalt"]` (mirrors
    existing tag dialect used elsewhere in Barcelona; `lokalt` already
    appears in the catalog)
  - `weatherTags`: `["all-weather"]`
  - `closedWeekdays`: `[0]` (Sunday, per `barcelona-metropolitan.com`)
  - `searchTerms`: `["lullaby", "lullaby vintage", "riera baixa", "raval vintage"]`
  - `availability` block: omit for now; the shop is a standard shop, not a
    market. Daily opening hours are not yet a runtime field.
  - Provenance metadata (mirror existing `provenance` block style):
    - `source_url`: `https://www.barcelona-metropolitan.com/locations/lullaby-vintage/`
    - `source_type`: `independent_local_magazine`
    - `confidence`: `medium` (independent profile + Time Out + Yelp; not an
      operator-owned official site; address consistent across sources)
    - `last_checked`: `2026-05-23`
    - `why_included`: *"Verified active Raval vintage shop on Carrer de la
      Riera Baixa; gives the catalog a named second-hand anchor for the
      Raval-side shopping drift without faking the street as a single
      venue."*
    - `tags_intents`: `["second_hand", "shopping"]`
    - `route_role`: `["connector", "shopping_anchor"]` *or* the closest
      existing role tokens that ship in the catalog
    - `classification`: `practical_connector`
    - `needs_human_verification`: `true` (no in-person check this pass)
- **Reason it belongs in Parranda:** Existing Raval catalog leans culture /
  food. A verified Riera Baixa shop turns the audit-recurring
  "Raval-second-hand" claim into a real named anchor without converting a
  street-as-a-cluster into a fake shop, and gives the second-hand layer
  geographic spread away from Glòries.

### 4. `barcelona-gracia-vintage-drift` → keep researching the cluster; promote one named shop in a later wave

- **Current evidence found:**
  - One strongly verified named shop: **Revolution Vintage**, Carrer de
    Verdi 80, Gràcia. Mon–Sat 11:00–20:30, closed Sun. Confirmed by
    Miniguide, Corner, Time Out, MapCarta, Yelp, plus an active Instagram
    `@revolution.vintagebcn`.
  - Cluster reputation in sources, but the named-shop list is thinner than
    expected:
    - *La Principal Retro & Co* appears in some "Gràcia vintage" lists but
      its actual addresses (Elisabets 3 / Ferlandina 37 / Valldonzella 52)
      put it in **Raval / Ciutat Vella**, not Gràcia. Treat lists that
      place it in Gràcia as unreliable.
    - *Rekup & Co Verdi* (Carrer de Verdi 63) is **permanently closed** as
      of March 2026 (Miniguide).
    - Humana, Roba Amiga, "L'Encant de Gràcia" appear in roundups but I did
      not cross-reference street-number-and-hours in this pass.
- **Source URLs / source type:**
  - `https://miniguide.co/place/revolution-vintage` — operator-adjacent
    profile with address + hours.
  - `https://www.corner.inc/place/914777` — second profile, same address.
  - `https://miniguide.co/place/rekup-co-verdi` — closure evidence.
- **What can be verified now:** Revolution Vintage as a single active
  vintage shop on Verdi.
- **What remains uncertain:** Whether the broader cluster has more than one
  current well-located shop; Humana / Roba Amiga / L'Encant de Gràcia each
  need a separate address + hours pass before they can be treated as
  promotable.
- **Promotion recommendation:** `keep_for_more_research` for the cluster.
  Revolution Vintage by itself is promotable as `real_place`, but holding
  it to the **next** wave makes the first runtime PR honest about the
  pack's "cluster" claim rather than promoting a single shop and calling
  the cluster verified.
- **If promotable later, proposed runtime shape (Revolution Vintage):**
  - `candidate_kind`: `real_place`
  - Suggested `id`: `revolution-vintage`
  - `name`: `Revolution Vintage`
  - `area`: `gracia`
  - `tags`: `["vintage", "second_hand", "shopping", "lokalt", "records"]`
    (the shop also stocks vinyl per Corner)
  - `closedWeekdays`: `[0]`
  - Provenance source: `https://miniguide.co/place/revolution-vintage`,
    `confidence: medium`, `needs_human_verification: true`.

### 5. `barcelona-sant-antoni-vintage-drift` → reject for now in the second-hand wave

- **Current evidence found:** Carrer del Parlament is described in tourism
  copy as having *"helpful secondhand shops, niche bookstores, … and
  beautifully designed boutiques selling Catalan goods"* and Carrer del
  Comte Borrell as having *"vintage furniture shops"*. **No specific named
  vintage / second-hand shop with a verified address surfaced in this pass.**
- **Source URLs / source type:**
  - `https://www.barcelonafoodexperience.com/blog/sant-antoni-neighborhood-guide`
    — secondary, descriptive only.
  - `https://www.foreverbarcelona.com/exploring-the-sant-antoni-market/` —
    secondary, focuses on the Sunday market, not the drift.
- **What can be verified now:** That the *neighborhood* has vintage /
  second-hand character (already reflected in the runtime tags on
  `mercat-sant-antoni`).
- **What remains uncertain:** Everything specific. No named shops, no
  addresses, no hours.
- **Promotion recommendation:** `reject_for_now` (for the second-hand
  promotion wave). Not "reject forever"; this is a "no evidence in this
  pass" verdict. A future on-the-ground or local-source pass could change
  it.
- **Reason:** The promotion plan explicitly warns against
  "over-concentrating Barcelona's second-hand layer in Sant Antoni" and
  against promoting vague cluster value. Without named shops there is
  nothing to promote that does not collapse into the existing
  `mercat-sant-antoni` entry.

### 6. `barcelona-el-born-vintage-design-cluster` → promote one verified shop, keep cluster structural

- **Current evidence found:**
  - Two named active shops with addresses:
    - **Loisaida** — Carrer dels Flassaders 42, 08003. Established Born
      vintage retro store; recognized by the Ajuntament's Premio Comercio
      de Barcelona. Multi-source: Time Out (ES), BarcelonaYellow,
      Ajuntament commerce site, Qantas Travel Insider, Yelp. Phone
      +34 93 295 5492.
    - **Bunker Second Hand Shop (Bunker Barcelona)** — Carrer de les Basses
      de Sant Pere 2, 08003. Opened ~September 2024. Mon–Sun 11:00–20:00
      most recent; earlier Time Out CA listed Wed–Sun 13:30–20:00.
      Operator-active Instagram `@bunker.barcelona`.
  - Street-level cluster reputation across Casa Camper, Time Out, and
    travel guides ("Carrer del Rec and side streets … elevated vintage
    finds").
- **Source URLs / source type:**
  - `https://www.yelp.com/biz/loisaida-barcelona-2` — operator-attached
    business listing.
  - `https://ajuntament.barcelona.cat/comerc/es/actualidad/con-el-premio-comercio-de-barcelona-la-tienda-loisaida-gano-el-reconocimiento-y-apoyo-de`
    — Ajuntament commerce announcement.
  - `https://www.timeout.cat/barcelona/ca/noticies/es-com-tenir-rebaixes-tot-lany-aixi-es-bunker-la-nova-botiga-vintage-i-de-segona-ma-de-barcelona-092524`
    — Time Out Barcelona (CA) profile of Bunker.
- **What can be verified now:** Both shops exist, addresses stable across
  sources, both currently operating.
- **What remains uncertain:** Exact current hours; Loisaida's current
  weekday/weekend schedule was not surfaced cleanly; Bunker's hours have
  drifted since opening.
- **Promotion recommendation:** `promote_candidate` (Loisaida only, for the
  first PR), keep the cluster `structural_only`.
- **Why Loisaida over Bunker for first promotion:**
  - Longer operating history (multiple years) vs Bunker (~1.7 years).
  - Explicit Ajuntament commerce recognition is a stronger provenance
    source than a single Time Out feature.
  - Loisaida's address has been stable across sources spanning multiple
    years; Bunker's hours have already shifted once since opening.
- **Proposed runtime shape (Loisaida):**
  - `candidate_kind`: `real_place`
  - Suggested `id`: `loisaida`
  - `name`: `Loisaida`
  - `area`: `born-sant-pere-santa-caterina` (matches the existing area
    token in `barcelona/catalog.js`)
  - `kind`: `shop`
  - `tags`: `["vintage", "second_hand", "design", "shopping", "lokalt"]`
  - `weatherTags`: `["all-weather"]`
  - `closedWeekdays`: omit for now until hours are verified in person or on
    operator site.
  - `searchTerms`: `["loisaida", "loisaida bcn", "flassaders", "born vintage"]`
  - Provenance:
    - `source_url`: `https://ajuntament.barcelona.cat/comerc/es/actualidad/con-el-premio-comercio-de-barcelona-la-tienda-loisaida-gano-el-reconocimiento-y-apoyo-de`
    - `source_type`: `municipal_recognition`
    - `confidence`: `medium`
    - `last_checked`: `2026-05-23`
    - `why_included`: *"Long-standing Born vintage / retro shop recognized
      by Ajuntament's commerce award; adds a verified design/second-hand
      anchor to Born beyond food / culture defaults."*
    - `tags_intents`: `["second_hand", "shopping", "design"]`
    - `route_role`: `["connector", "shopping_anchor"]`
    - `classification`: `practical_connector`
    - `needs_human_verification`: `true`
- **Reason it belongs in Parranda:** Born already carries food + culture
  density in the existing catalog. Loisaida is the simplest evidence-backed
  way to give Born a verified vintage/design afternoon anchor without
  pretending an area is a shop.

---

## Cluster handling summary

None of the `area_preset` clusters in the pack should ship as user-facing
catalog entries in the first runtime PR:

- `barcelona-riera-baixa-cluster`: structural only. Cluster claim is
  supported but two verified shops is a thin floor; promote individual
  shops instead.
- `barcelona-el-born-vintage-design-cluster`: structural only.
- `barcelona-gracia-vintage-drift`: hold; only one verified shop.
- `barcelona-sant-antoni-vintage-drift`: hold; no named shops.

This matches the pack's own hard rules: *"No area_preset becomes a fake
shop. No cluster can be shown to users as a normal place unless it has
first been decomposed into verified underlying real_place records."*

## First Runtime PR Proposal (smallest safe next step)

**Title:** `feat(barcelona): promote two verified second-hand anchors (Lullaby, Loisaida)`

**Scope (2 entries, both `real_place`):**

1. **Lullaby Vintage** — Carrer de la Riera Baixa 22, El Raval. Anchors the
   Riera Baixa cluster claim with a named, verifiable shop.
2. **Loisaida** — Carrer dels Flassaders 42, El Born. Anchors the Born
   vintage/design cluster claim with a named, Ajuntament-recognized shop.

**Why these two go first:**

- **Each has multiple independent sources, not just one.** Lullaby has
  `barcelona-metropolitan.com` + Time Out + Yelp/Corner. Loisaida has
  Ajuntament commerce recognition + BarcelonaYellow + Qantas Travel
  Insider + Time Out (ES) + Yelp.
- **Each has a stable street address that did not vary across sources.**
- **Neither is a chain** (the existing pack rule on `excluded_by_design`).
- **Neither duplicates an existing Barcelona catalog entry.** Closest
  existing entries are `mercat-encants` and `mercat-sant-antoni`; both are
  markets, neither is a shop on Riera Baixa or Flassaders.
- **They are geographically split** — one Raval, one Born. The plan flagged
  the open question *"prefer geographic spread … or strongest-source
  quality regardless of area"* — these two are the rare case where both
  criteria agree.
- **Neither claim depends on a recurring schedule.** Both are normal shops.
  This sidesteps the unresolved Sunday-dominical question entirely.

**Explicit non-goals for that PR:**

- Do **not** add `barcelona-encants-vells` — `mercat-encants` already
  exists in runtime. A `source_url` / `last_checked` refresh on the
  existing entry can be a separate tiny PR.
- Do **not** add `barcelona-mercat-sant-antoni-dominical` — needs a
  recurring-event runtime path first.
- Do **not** add `barcelona-riera-baixa-cluster` or
  `barcelona-el-born-vintage-design-cluster` as `area_preset` runtime
  entries. The cluster value is *implicit* in promoting the named shops.
- Do **not** add Revolution Vintage in the same PR. Hold for a Gràcia
  second-wave PR once a second Gràcia shop is verified.
- Do **not** add `closedWeekdays` for either shop until in-person or
  operator-page verification confirms the day; rely on the catalog
  default.
- Do **not** add new tags to the cross-city tag dialect. Both proposals
  reuse `vintage`, `second_hand`, `shopping`, `lokalt`, `design` —
  vocabulary already in `barcelona/catalog.js`.

**Suggested catalog tests for that future PR (informational only — this PR
adds none):**

- Each new entry has a valid Barcelona `area` token
  (`raval`, `born-sant-pere-santa-caterina`).
- Each new entry has a provenance block.
- Both entries are returned by Barcelona catalog search but not by Rome.
- Barcelona stays `visibility: "preview"`.
- No structural cluster ID becomes searchable as a place.

## Catalog density note: Parranda needs both character anchors and utility anchors

This scout recommends exactly two promotions (Lullaby Vintage and
Loisaida). That number reflects the **smallest safe first runtime PR**
— what survives a strict multi-source pass in one sitting. It is not the
desired final shape of Barcelona's second-hand catalog.

Parranda is not only a hidden-gem app. The longer goal is a broad **local
intelligence layer**: many usable places, intelligently filtered and
ranked for the individual user, the moment, the route, the weather, the
opening pattern, and the vibe. Filtering only works when there is enough
material to filter. A catalog with two vintage shops cannot produce a
believable second-hand day for anyone whose constraints rule one of them
out.

For second hand specifically, future expansion should deliberately
include more than indie / one-of-a-kind shops. Stable, verifiable
chain-or-multi-location stores — `Humana`-type charity / resale outlets
are the canonical example, if address and operator can be verified —
are valuable **utility anchors**. They should not be framed as hidden
gems, but they make a second-hand day actually routeable for a user
who is not in central Raval or Born on the right weekday.

### Future runtime roles (descriptive, not a new contract)

These are intake-side labels for thinking about *why* a candidate
belongs in the catalog. They are not new `candidate_kind` values — the
canonical vocabulary in `server/place-candidates/contract.js` still
governs runtime. They are a writing-aid for the next scout passes.

- **character_anchor** — unique, high-flavor, editorial-fit place.
  Examples in this pass: Lullaby Vintage, Loisaida, Revolution Vintage.
- **utility_anchor** — practical, stable, useful stop that adds route
  density even if it has no editorial sparkle. Examples worth searching
  for in a future pass: verified Humana locations, large multi-location
  second-hand chains with a Barcelona presence, predictable shop hours
  near transit.
- **market_anchor** — market or recurring / scheduled second-hand
  source. Examples in this pass: `mercat-encants` (already runtime), the
  Sant Antoni dominical (held pending recurring-event runtime path).
- **structural_area_context** — street / cluster / neighborhood context
  used by routing or diagnostics, **never shown to users as a place.**
  Examples in this pass: the Riera Baixa cluster, the Born vintage /
  design cluster, the Gràcia drift, the Sant Antoni drift.

### What the next expansion scout should do

A future, separately-scoped expansion scout (NOT this PR, NOT the first
runtime PR) should deliberately search for **8–15 additional named
`real_place` candidates** across Barcelona, deliberately mixing the
roles above:

- Independent vintage / second-hand shops beyond Raval and Born (e.g.
  Gràcia, Sant Antoni, Sants, Poblenou, Sant Pere).
- Chain or charity second-hand shops — Humana-style — where the
  organization itself is verifiable and address / category / operator
  are stable.
- Second-hand book and record shops (`book_resale`, `record_resale`),
  including used-bookshops outside Sant Antoni.
- Vintage and design resale (furniture, ceramics, decor) where the shop
  is named and the address is stable.
- Utility anchors near transit that make a second-hand day routeable
  for users who are not already on a Raval / Born loop.

### Calibration adjustments for the expansion pass

The bar for *first* promotion has to be strict because the first wave
defines how Parranda treats second-hand at all. The bar for *expansion*
candidates can be looser without lying to users, provided:

- **In-person verification is not required** for every candidate before
  catalog inclusion. The catalog already supports
  `needs_human_verification: true` plus `confidence: medium`. That
  combination is acceptable when address, category, and provenance are
  stable across independent sources.
- **Perfect opening hours are not required** if the runtime can honestly
  omit hours and the user can click through to the operator / source URL
  to verify current status. Avoid asserting hours the catalog does not
  actually know.
- `confidence: high` should still be reserved for entries whose
  existence, address, and category are confirmed by either an official
  operator page or a municipal source.

### What the expansion scout must still reject

The calibration loosening above does not relax the pack's hard rules.
The expansion scout must still reject:

- Invented addresses or invented operators.
- Duplicates of existing Barcelona catalog entries (always grep
  `server/cities/barcelona/catalog.js` first).
- Fake clusters dressed up as shops — `area_preset` candidates do not
  become `real_place` runtime entries unless they decompose cleanly
  into named, address-verified shops.
- Recurring markets modeled as always-on places. The Sant Antoni
  dominical waits for the recurring-event runtime path. So does any
  other "Sunday-only" or "first-Saturday-of-the-month" candidate.
- `confidence: needs_review` candidates entering runtime. The pack /
  validator hard rule still holds.

### Reading this scout in context

The Lullaby + Loisaida proposal is the **first one or two stones**, not
the path. Treat it as the first runtime PR that proves Parranda can
ship second-hand entries safely. The next scout (expansion) should plan
for an order of magnitude more candidates, organized by the role
vocabulary above, and the runtime promotion PRs that follow it can
batch entries that pass the looser-but-still-honest bar.

## Unresolved risks

- Hours sources for Sant Antoni dominical disagree (08:30–14:00 vs
  10:00–15:00). This is the single largest reason the dominical stays in
  the hold pile.
- Riera Baixa's other named historic shops (Lailo, Carrousel, M.O.T.E.L.)
  cannot be promoted from this pass — Lailo is reported closed on Facebook
  and the others were not address-and-hours verified in current sources.
- The Mercat dels Encants operator URL split (`encants.cat` vs
  `encantsbarcelona.com`) suggests the existing runtime entry's
  `source_url` may be stale. Worth a separate cleanup PR.
- Gràcia's cluster claim is weaker than the pack suggests. Promotion-wave
  ordering may need to deprioritize Gràcia second-hand until a second
  named shop is verified.

## Validator runs

### Before (`docs/candidate-packs/barcelona-second-hand-v0.md`)

```
Status: intake_only
Candidate count: 18
Hard errors: none
Warnings: none
```

### After

This PR adds only this scout report. It does not modify the v0 pack, does
not add a new candidate-pack file, and does not change validator behavior.
Re-running the validator after this PR yields the same output as before.

## Changed files

- `docs/candidate-packs/barcelona-second-hand-verification-scout.md` (new
  file, this report)

No changes to `server/`, no changes to `tests/`, no changes to runtime
behavior.

## Evidence quality summary

| Target                                       | Evidence | Promotion recommendation       |
| -------------------------------------------- | -------- | ------------------------------ |
| barcelona-encants-vells                      | strong   | `structural_only` (already in runtime) |
| barcelona-mercat-sant-antoni-dominical       | strong on existence; weak on exact hours | `keep_for_more_research` |
| barcelona-riera-baixa-cluster                | mixed    | cluster `structural_only`; promote Lullaby Vintage as `real_place` |
| barcelona-gracia-vintage-drift               | weak     | `keep_for_more_research`       |
| barcelona-sant-antoni-vintage-drift          | very weak | `reject_for_now`              |
| barcelona-el-born-vintage-design-cluster     | strong on two shops | cluster `structural_only`; promote Loisaida as `real_place` |

## Worktree status

Branch: `docs/barcelona-second-hand-verification-scout`. Single new file
added at `docs/candidate-packs/barcelona-second-hand-verification-scout.md`.
No other tracked file modified. Validator output unchanged because the v0
pack was not edited.
