# Barcelona Second-Hand Expansion Scout

Broad source-backed scout for **clothing / fashion / vintage / fashion-resale**
candidates across Barcelona. Follows the catalog density note and the
local-language intent principle established in
`docs/candidate-packs/barcelona-second-hand-verification-scout.md`
(merged via [#139](https://github.com/fritjofherrstrom-png/parranda/pull/139)).

This is a **docs-only report**. It does not promote, edit
`server/cities/barcelona/catalog.js`, add providers, or change Planner,
Blitz, route-engine, Pulse, Live, UI, CSS, or public API behavior. The
candidates here are intake-side proposals for a future, separately-scoped
promotion PR.

Author: claude (expansion scout)
Date: 2026-05-23
Branch: `docs/barcelona-second-hand-expansion-scout`
Parent docs:
- `docs/candidate-packs/CANDIDATE_PACK_FORMAT.md`
- `docs/candidate-packs/barcelona-second-hand-promotion-plan.md`
- `docs/candidate-packs/barcelona-second-hand-verification-scout.md`

---

## 1. Method

### Category scope (strict)

The "second-hand" user choice in Parranda means **clothing / fashion /
vintage clothing / fashion resale / curated resale / charity-or-chain
second-hand clothing / Humana-style utility anchors.**

Out of scope for this wave (per #139 hard rule): standalone bookshops,
standalone record shops, coins/stamps/collectibles, general antiques,
furniture resale, ceramics/decor resale, generic flea-market
miscellany. Such items can appear only as a secondary feature inside a
clothing/vintage/resale stop or a relevant market context.

### Local-language search terms used

Per the #139 principle, the scout searched in Spanish, Catalan, and
English. Working term list:

- `ropa de segunda mano` / `roba de segona mà` / `ropa usada`
- `moda vintage` / `botiga vintage` / `tienda vintage`
- `moda circular` / `outlet vintage` / `vintage kilo`
- `tiendas vintage Barcelona` / `tiendas segunda mano ropa Barcelona`
- `Humana Barcelona` / `Humana tiendas direcciones`
- per-neighborhood combinations: Gràcia, Raval, Born, Gothic, Sant
  Antoni, Sants, Poblenou, Eixample.

### Source-quality tiers used

Tier A (sufficient on its own):
- Official operator pages (`humana-spain.org`, individual shop sites).
- Ajuntament / municipal listings.
- Time Out Barcelona (ES / CA / EN) feature articles for a specific
  shop.

Tier B (sufficient when corroborated by at least one Tier A or another
Tier B):
- `barcelona-metropolitan.com` shop profiles.
- Local English-language guides with editorial track record
  (`driftwoodjournals.com`, `corner.inc/guides`, `bonjourbarcelone.fr`).
- Local Spanish/Catalan editorial blogs with editorial track record
  (`bcncoolhunter.com`, `barcelonasecreta.com`, `highxtar.com`,
  `homagetobcn.com`).

Tier C (used only to corroborate Tier A/B, never as primary):
- Yelp, Corner, Páginas Amarillas, Cylex business listings.
- Tourist aggregator lists.

The validator field mapping for this scout's recommendations:

- `confidence: high` — Tier A + Tier B agreement on existence, address,
  category.
- `confidence: medium` — Tier B agreement on existence, address,
  category, no contradiction.
- `confidence: needs_review` — fewer than two independent sources, or
  sources disagree on a load-bearing attribute (e.g. address, current
  status).

### Hours policy

Per the #139 calibration: **the scout does not encode `closedWeekdays`
or any opening-hours field for shortlisted candidates.** Hours surface
in this report only as a fact about what the source claims, never as a
proposed runtime field. The promotion PR should rely on operator
links / Google for current hours rather than freezing a brittle value
in the catalog.

### Self-limits

- No on-the-ground verification. Multi-source web only.
- No images checked.
- Search results that name shops without addresses are noted but never
  shortlisted.
- Tourist-coded "vintage" boutiques that turn out to be new-stock retro
  are rejected on the false-friends rule in #139.

---

## 2. Candidate universe (raw)

Forty named candidates surfaced across nine Barcelona neighborhoods.
Two of them (Lullaby Vintage, Loisaida) were already proposed for first
runtime promotion in the #139 verification scout and are repeated here
for catalog-density bookkeeping — they are not new finds in this pass.

Raw candidates are grouped by likely role.

### 2A. Utility anchors — Humana (multi-location operator)

Per the official operator page `humana-spain.org/que-puedes-hacer-tu/comprar-ropa/`,
Humana lists 25 Barcelona stores. The scout selected geographically-
diverse locations with `(Vintage)` curation tag where present.

| # | Shop | Address | Area | Sources | Likely role | Why | Risks |
|---|---|---|---|---|---|---|---|
| 1 | Humana Vintage Francesc Cambó | Av. de Francesc Cambó, 30-36 | born-sant-pere-santa-caterina | humana-spain.org (Tier A) | utility_anchor | Stable chain, vintage-curated location next to Mercat de Santa Caterina; useful Born-side anchor. | None obvious — official operator page. |
| 2 | Humana Vintage Astúries | C/ Astúries, 41 | gracia | humana-spain.org; corroborated bcncoolhunter.com | utility_anchor | Gràcia vintage-curated location; gives Gràcia day a reliable utility stop. | None obvious. |
| 3 | Humana Vintage Avinyó | C/ Avinyó, 7 bis | gotic | humana-spain.org | utility_anchor | Gothic-quarter vintage curation; usable for Old-Town routes. | Gothic foot-traffic can blur with tourist retail. |
| 4 | Humana Vintage Portaferrissa | C/ de la Portaferrissa, 21 | gotic | humana-spain.org; multiple Tier B; flagship per search summary | utility_anchor | Flagship Humana on a primary Old-Town axis. | Heavily touristed street; needs framing to avoid tourist-anchor coding. |
| 5 | Humana Vintage General Álvarez de Castro | C/ del General Álvarez de Castro, 2 | born-sant-pere-santa-caterina | humana-spain.org | utility_anchor | Second Sant Pere / Born side anchor with vintage curation. | None obvious. |
| 6 | Humana Vintage Hospital | C/ Hospital, 91 | raval | humana-spain.org | utility_anchor | Anchors a Raval second-hand day near MACBA / Hospital axis. | None obvious. |
| 7 | Humana Vintage Ronda Universitat | Ronda de la Universitat, 19 | eixample | humana-spain.org | utility_anchor | Plaça Universitat axis — strong transit anchor between Eixample and Raval. | None obvious. |
| 8 | Humana Gran de Gràcia | C/ Gran de Gràcia, 53 | gracia | humana-spain.org | utility_anchor | Main Gràcia spine; complements the vintage-curated Astúries store. | Non-vintage curation. |
| 9 | Humana Calàbria | C/ Calàbria, 33 | sant-antoni | humana-spain.org | utility_anchor | Anchors a Sant Antoni day that does **not** depend on the Sunday dominical. | Non-vintage curation. |
| 10 | Humana Ronda de Sant Antoni | Ronda de Sant Antoni, 45 | sant-antoni | humana-spain.org | utility_anchor | Mirror of #9 on the other side of Sant Antoni. | Same Humana brand twice in Sant Antoni; pick one for first batch. |
| 11 | Humana Sants | C/ de Sants, 295 | sants-montjuic | humana-spain.org | utility_anchor | First and possibly only Sants-side second-hand utility anchor in this pass. | None obvious. |
| 12 | Humana Travessera de Gràcia | Travessera de Gràcia, 80 | gracia | humana-spain.org | utility_anchor | Anchors lower Gràcia / Travessera axis. | Non-vintage curation. |
| 13 | Humana Paral·lel | Av. del Paral·lel, 85 | poble-sec | humana-spain.org | utility_anchor | Anchors Poble Sec / Paral·lel side, adjacent to Sant Antoni. | None obvious. |

### 2B. Character anchors — Raval

| # | Shop | Address | Area | Sources | Likely role | Why | Risks |
|---|---|---|---|---|---|---|---|
| 14 | Lullaby Vintage *(pre-existing #139)* | Carrer de la Riera Baixa, 22 | raval | barcelona-metropolitan.com, Time Out, Corner, Yelp | character_anchor | Already proposed in #139 — strongest Riera Baixa named shop. | Already in promotion pipeline. |
| 15 | Arepa Queer | Carrer de la Riera Baixa, 24 | raval | bcncoolhunter.com, Time Out ES, corner.inc | character_anchor | Y2K / 90s curation, Riera Baixa axis. Second active shop on the street. | Single primary source for hours. |
| 16 | Vilde Vintage | Carrer de la Riera Baixa, 12 | raval | bcncoolhunter.com, multiple Spanish vintage guides | character_anchor | 70s–90s curation; turns Riera Baixa cluster into three named anchors. | None obvious. |
| 17 | Manifesto Barcelona | Carrer del Peu de la Creu, 18 | raval | bcncoolhunter.com | character_anchor | Italian-curated vintage + Y2K; expands Raval beyond Riera Baixa. | Single Tier B source. |
| 18 | Nerve Vintage | Carrer de Ferlandina, 61 | raval | bcncoolhunter.com | character_anchor | 70s–Y2K curation on Ferlandina (MACBA axis). | Single Tier B source. |
| 19 | Holala! Plaza (flagship) | Carrer de Valldonzella, 2 | raval | Time Out, driftwoodjournals.com, evendo, barcelona-metropolitan.com | character_anchor + utility | Largest Holala! site; "Barcelona's biggest vintage store" framing. | Tourist-coded by some guides. |
| 20 | Holala! Tallers | Carrer dels Tallers, 73 | raval | barcelona-metropolitan.com, mindtrip | utility_anchor | Second Holala! location; high-volume utility. | Same chain as #19. |
| 21 | Kilostore (Holala-affiliated) | Carrer de la Riera Baixa, 11 | raval | Yelp, Trip.com, secondary | utility_anchor | Pay-by-kilo on Riera Baixa. | Hours vary by source; same chain as Holala. |
| 22 | La Principal Retro & Co — Ferlandina | Carrer de Ferlandina, 37 | raval | Time Out ES, paginasamarillas, IG @laprincipalretro | character_anchor | Retro denim / leather curation. | Multi-location operator; pick best. |
| 23 | La Principal Retro & Co — Elisabets | Carrer d'Elisabets, 3 | raval | Time Out ES, IG | character_anchor | Same operator, MACBA axis. | Same as #22. |
| 24 | Flamingos Vintage Kilo — Tallers | Carrer dels Tallers, 31 | raval | barcelona-metropolitan.com, vintagekilo.com, Yelp | utility_anchor | Pay-by-weight kilo shop; highly routeable. | Tourist-heavy axis. |
| 25 | Flamingos Vintage Kilo — Ferlandina | Carrer de Ferlandina, 20 | raval | barcelona-metropolitan.com, vintagekilo.com | utility_anchor | Mirror on Ferlandina (MACBA). | Same chain. |
| 26 | Flamingos Vintage Kilo — Portaferrissa | Portaferrissa, 7 | gotic | vintagekilo.com, Yelp | utility_anchor | Gothic Quarter kilo shop. | Same chain. |
| 27 | Frip Vintage | Carrer del Tigre, 20 | raval | search summary in barcelona vintage roundup (Tier C only) | character_anchor | Mentioned in Raval vintage roundups. | Tier C only — needs corroboration. |
| 28 | Circular Second Hand | Carrer dels Tallers, 21 | raval | Spanish moda-circular roundups | character_anchor | Brand explicitly framed around circular fashion. | Tier C only. |

### 2C. Character anchors — Born / Sant Pere / Gothic

| # | Shop | Address | Area | Sources | Likely role | Why | Risks |
|---|---|---|---|---|---|---|---|
| 29 | Loisaida *(pre-existing #139)* | Carrer dels Flassaders, 42 | born-sant-pere-santa-caterina | Ajuntament Comerç, Time Out ES, Yelp | character_anchor | Already proposed in #139. | Already in promotion pipeline. |
| 30 | Le Swing Vintage | Carrer dels Lledó, 6 | born-sant-pere-santa-caterina | bcncoolhunter.com, Time Out ES, Driftwood Journals | character_anchor | Luxury / neo-vintage curation, Lledó axis behind Plaça Sant Jaume. | Designer-vintage pricing can read tourist-coded. |
| 31 | Casa Le Swing | Carrer dels Lledó, 17 | born-sant-pere-santa-caterina | corner.inc, Driftwood Journals | character_anchor | Same operator; sister location. | Same as #30. |
| 32 | L'Arca | Carrer dels Banys Nous, 20 | gotic | Time Out ES, Driftwood Journals, Fodor's, Instagram | character_anchor | Vintage + bridal; made Kate Winslet's Titanic dress. Storied editorial fit. | Heavy bridal focus may be off-axis for second-hand day. |
| 33 | Los Féliz | Carrer de Cervantes, 5 | gotic | losfelizshop.com, MUUZ, Corner, mindtrip | character_anchor | Editorially strong, "Charli XCX approved" framing; Mon–Sat 12:00–20:00. | One operator-site source for hours. |
| 34 | Bunker Second Hand Shop | Carrer de les Basses de Sant Pere, 2 | born-sant-pere-santa-caterina | Time Out CA, IG @bunker.barcelona | character_anchor | Newer (opened Sept 2024); held by #139 for later wave. | Hours have drifted since opening. |
| 35 | Mahalo Vintage Comtal | Carrer Comtal, 13 | born-sant-pere-santa-caterina | barnacentre.com, paginasamarillas, Cylex | utility_anchor | Multi-location operator on Portal de l'Àngel axis. | Multi-location dilution. |
| 36 | Mahalo Vintage Trafalgar | Carrer de Trafalgar, 78 | born-sant-pere-santa-caterina | Corner, paginasamarillas | utility_anchor | Mahalo's second central location. | Same as #35. |
| 37 | Paka Vintage Gallery | Carrer dels Flassaders, 31 | born-sant-pere-santa-caterina | Spanish vintage roundups (Tier B/C mix) | character_anchor | On Flassaders axis alongside Loisaida. | Tier B/C only. |
| 38 | Love Vintage | Carrer Bertrellans, 5 | gotic | barrigotic.cat, paginasamarillas, lovevintage.es | character_anchor | Established Gothic Quarter vintage. | Two listed addresses across sources (Bertrellans 5 / 7); needs reconcile. |

### 2D. Character anchors — Gràcia

| # | Shop | Address | Area | Sources | Likely role | Why | Risks |
|---|---|---|---|---|---|---|---|
| 39 | Revolution Vintage | Carrer de Verdi, 80 | gracia | Miniguide, Corner, Time Out, MapCarta, IG @revolution.vintagebcn | character_anchor | Strongest single named Gràcia shop (per #139). | None obvious. |
| 40 | Mahalo Vintage Diamant | Plaça del Diamant, 9 | gracia | Spanish vintage TikTok roundup, paginasamarillas | utility_anchor | Mahalo brand's Gràcia outpost on a primary plaza. | Same brand as #35/36. |
| 41 | Love Vintage BCN — Torrent de l'Olla | Carrer del Torrent de l'Olla, 92 | gracia | Spanish-language roundups, FB lovevintagestore | character_anchor | Gràcia-side Love Vintage location (separate from #38). | Possible name-collision with #38; same operator. |
| 42 | Lamarck Vintage | Carrer del Torrent de l'Olla, 194 | gracia | Spanish TikTok roundup with hours; Tier C primary | character_anchor | Upper-Torrent-de-l'Olla axis. | Tier C only; needs corroboration. |
| 43 | Beyond Wear | Carrer de Puigmartí, 28 | gracia | Spanish TikTok roundup; Tier C | character_anchor | Plaça del Diamant axis. | Tier C only. |
| 44 | Il Capo Vintage Kilo | Carrer de l'Escorial, 123 | gracia | Spanish roundups | utility_anchor | Pay-by-kilo on Joanic / Escorial axis. | Tier C primary. |
| 45 | Escorial 121 vintage | Carrer de l'Escorial, 121 | gracia | Time Out / vintage guide | structural_area_context | Loose curated showroom; Friday–Sunday only. | Schedule-sensitive — likely a hold. |

### 2E. Character anchors — Poblenou / Sants / Eixample

| # | Shop | Address | Area | Sources | Likely role | Why | Risks |
|---|---|---|---|---|---|---|---|
| 46 | Vintage Poblenou | Avila, 78 | poblenou | Time Out ES, vintagepoblenou.com | market_anchor + utility | Run by Two Market BCN; warehouse-format vintage. | Hours and price model differ from a normal shop. |
| 47 | House of Rowdy | Carrer de Joan d'Àustria, 55 | poblenou | bcncoolhunter.com, Time Out | character_anchor | Hybrid "gallery + vintage shop + sustainable design". | Hybrid format may not be cleanly a shop. |
| 48 | Neko Vintage | Carrer de Sant Medir, 11 (local 1) | sants-montjuic | Time Out ES, nekovintageclothes.com, IG | character_anchor | Workshop-shop; rare independent Sants character anchor. | Limited weekly hours (Wed–Fri); modeling honestly is the user's choice. |
| 49 | Cotton Vintage | Carrer d'Enric Granados, 26 | eixample | cottonvintage.es (operator), barcelona-metropolitan.com, Time Out ES, Corner | character_anchor | "Spain's first luxury vintage store" — strong editorial fit. | Luxury-vintage pricing skews bourgeois; framing matters. |

**Total raw candidates discovered: 49 (including the 2 already pipelined
from #139).** Above the user's 25–40 raw-target band; the next section
prunes to a sourced shortlist.

---

## 3. Shortlist (plausible `real_place` candidates)

Twenty candidates pass dedupe + source-quality checks. Order is roughly
by geographic spread and source strength, not by promotion priority
inside that.

All shortlist entries use the existing Barcelona `area` tokens already
present in `server/cities/barcelona/catalog.js`:
`raval`, `gotic`, `born-sant-pere-santa-caterina`, `sant-antoni`,
`gracia`, `eixample`, `sants-montjuic`, `poblenou`, `poble-sec`.

Tag dialect reused from existing catalog: `vintage`, `second_hand`,
`shopping`, `lokalt`, `design`. No new tags introduced.

No `closedWeekdays` field proposed anywhere — see §1 hours policy.

### Shortlist entries

Numbered S1–S20.

#### S1 — Lullaby Vintage *(pre-existing #139)*

- `proposed_id`: `lullaby-vintage`
- `name`: `Lullaby Vintage`
- `area`: `raval`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["lullaby", "lullaby vintage", "riera baixa", "raval vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: barcelona-metropolitan.com (Tier B) + Time Out (Tier A) + Corner / Yelp.
- Reason: Strongest Raval-side character anchor; first-PR pair with S12.
- Role: `character_anchor`.

#### S2 — Arepa Queer

- `proposed_id`: `arepa-queer`
- `name`: `Arepa Queer`
- `area`: `raval`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["arepa queer", "riera baixa", "y2k barcelona", "raval vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: bcncoolhunter.com (Tier B), Time Out ES roundup (Tier A), corner.inc.
- Reason: Second active Riera Baixa anchor; complements S1 and turns the cluster claim into three named shops alongside S3.
- Role: `character_anchor`.

#### S3 — Vilde Vintage

- `proposed_id`: `vilde-vintage`
- `name`: `Vilde Vintage`
- `area`: `raval`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["vilde", "vilde vintage", "riera baixa"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: bcncoolhunter.com (Tier B), multiple Spanish-language roundups.
- Reason: Third named Riera Baixa anchor — finally decomposes the cluster cleanly.
- Role: `character_anchor`.

#### S4 — Holala! Plaza

- `proposed_id`: `holala-plaza`
- `name`: `Holala! Plaza`
- `area`: `raval`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt", "klassiker"]`
- `searchTerms`: `["holala", "holala plaza", "valldonzella", "raval vintage"]`
- `confidence`: `high`
- `needs_human_verification`: `true`
- Provenance: barcelona-metropolitan.com (Tier B), Time Out, driftwoodjournals.com, evendo. Operator established since 1972.
- Reason: Largest vintage store in Barcelona by source consensus; flagship character + high-volume utility.
- Role: `character_anchor` (with utility overflow).

#### S5 — Flamingos Vintage Kilo (Tallers)

- `proposed_id`: `flamingos-vintage-kilo-tallers`
- `name`: `Flamingos Vintage Kilo — Tallers`
- `area`: `raval`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["flamingos", "vintage kilo", "kilo shop", "tallers"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: operator vintagekilo.com (Tier A), barcelona-metropolitan.com (Tier B), Yelp/Corner.
- Reason: Pay-by-weight format is a clean utility anchor for a budget second-hand day.
- Role: `utility_anchor`.

#### S6 — Humana Vintage Portaferrissa

- `proposed_id`: `humana-vintage-portaferrissa`
- `name`: `Humana Vintage — Portaferrissa`
- `area`: `gotic`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "humana vintage", "portaferrissa", "gotico", "second hand"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org official operator page (Tier A).
- Reason: Flagship Humana on a primary Gothic axis; visible utility anchor for the most-trafficked routes.
- Role: `utility_anchor`.

#### S7 — Humana Vintage Ronda Universitat

- `proposed_id`: `humana-vintage-ronda-universitat`
- `name`: `Humana Vintage — Ronda de la Universitat`
- `area`: `eixample`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "humana vintage", "ronda universitat", "universitat"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org (Tier A).
- Reason: Plaça Universitat is a transit-strong utility anchor between Eixample and Raval.
- Role: `utility_anchor`.

#### S8 — Humana Vintage Astúries

- `proposed_id`: `humana-vintage-asturies`
- `name`: `Humana Vintage — Astúries`
- `area`: `gracia`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "humana vintage", "asturies", "gracia"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org (Tier A), bcncoolhunter.com (Tier B), TikTok roundup with closing hours.
- Reason: Gives Gràcia a stable vintage utility anchor independent of any indie shop's status.
- Role: `utility_anchor`.

#### S9 — Humana Vintage Francesc Cambó

- `proposed_id`: `humana-vintage-francesc-cambo`
- `name`: `Humana Vintage — Francesc Cambó`
- `area`: `born-sant-pere-santa-caterina`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "humana vintage", "francesc cambo", "santa caterina", "born"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org (Tier A).
- Reason: Adjacent to Mercat de Santa Caterina; pairs Born culture/food with a second-hand utility anchor.
- Role: `utility_anchor`.

#### S10 — Humana Sant Antoni (Ronda)

- `proposed_id`: `humana-ronda-sant-antoni`
- `name`: `Humana — Ronda de Sant Antoni`
- `area`: `sant-antoni`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "ronda sant antoni", "sant antoni segunda mano"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org (Tier A).
- Reason: Anchors a Sant Antoni second-hand day that does not depend on the Sunday dominical schedule.
- Role: `utility_anchor`. Note: omit `vintage` tag — this is non-vintage Humana per operator labelling.

#### S11 — Humana Sants

- `proposed_id`: `humana-sants`
- `name`: `Humana — Sants`
- `area`: `sants-montjuic`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["humana", "carrer de sants", "sants segunda mano"]`
- `confidence`: `high`
- `needs_human_verification`: `false`
- Provenance: humana-spain.org (Tier A).
- Reason: First reliable second-hand anchor for Sants; without it Sants has nothing on the second-hand axis.
- Role: `utility_anchor`.

#### S12 — Loisaida *(pre-existing #139)*

- `proposed_id`: `loisaida`
- `name`: `Loisaida`
- `area`: `born-sant-pere-santa-caterina`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "design", "shopping", "lokalt"]`
- `searchTerms`: `["loisaida", "loisaida bcn", "flassaders", "born vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: Ajuntament Comerç (Tier A), Time Out ES (Tier A), BarcelonaYellow.
- Reason: First-PR pair with S1.
- Role: `character_anchor`.

#### S13 — Le Swing Vintage

- `proposed_id`: `le-swing-vintage`
- `name`: `Le Swing Vintage`
- `area`: `born-sant-pere-santa-caterina`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "design", "shopping", "lokalt"]`
- `searchTerms`: `["le swing", "le swing vintage", "lledo", "gotic vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: bcncoolhunter.com (Tier B), Time Out ES (Tier A), Driftwood Journals (Tier B).
- Reason: Luxury / neo-vintage curation; adds a different price tier to the catalog.
- Role: `character_anchor`.

#### S14 — Los Féliz

- `proposed_id`: `los-feliz-vintage`
- `name`: `Los Féliz`
- `area`: `gotic`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["los feliz", "los feliz vintage", "cervantes", "gotico vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: losfelizshop.com (operator, Tier A), Corner (Tier B/C), mindtrip.
- Reason: Editorial-fit character anchor in a quiet pocket of Gothic Quarter (Carrer de Cervantes).
- Role: `character_anchor`.

#### S15 — L'Arca

- `proposed_id`: `larca-vintage`
- `name`: `L'Arca`
- `area`: `gotic`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt", "klassiker"]`
- `searchTerms`: `["l'arca", "larca", "banys nous", "vintage bridal", "gotic"]`
- `confidence`: `high`
- `needs_human_verification`: `true`
- Provenance: larcabarcelona.com (operator, Tier A), Time Out ES (Tier A), Fodor's, Driftwood Journals.
- Reason: Storied editorial anchor (made Kate Winslet's Titanic dress); pre-1925 vintage tier. Adds historical depth to the catalog.
- Role: `character_anchor`.

#### S16 — Cotton Vintage

- `proposed_id`: `cotton-vintage`
- `name`: `Cotton Vintage`
- `area`: `eixample`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["cotton vintage", "enric granados", "luxury vintage", "consignment"]`
- `confidence`: `high`
- `needs_human_verification`: `true`
- Provenance: cottonvintage.es (operator, Tier A), Time Out ES (Tier A), barcelona-metropolitan.com (Tier B), Corner.
- Reason: "Spain's first luxury vintage store" — the only **fashion resale / consignment** anchor in the shortlist; adds a distinct price tier and a working Eixample anchor.
- Role: `character_anchor`.

#### S17 — Revolution Vintage

- `proposed_id`: `revolution-vintage`
- `name`: `Revolution Vintage`
- `area`: `gracia`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["revolution", "revolution vintage", "verdi", "gracia vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: Miniguide, Corner, Time Out, MapCarta, IG @revolution.vintagebcn.
- Reason: Strongest single Gràcia indie anchor per #139.
- Role: `character_anchor`.

#### S18 — Mahalo Vintage Diamant

- `proposed_id`: `mahalo-vintage-diamant`
- `name`: `Mahalo Vintage — Plaça del Diamant`
- `area`: `gracia`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["mahalo", "mahalo vintage", "plaza del diamant", "gracia"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: Tier B/C Spanish roundups, paginasamarillas; cross-operator with S35.
- Reason: A second named Gràcia shop on Plaça del Diamant axis; cluster-decomposition partner for S17.
- Role: `utility_anchor` (chain) but located in a character-rich plaza.

#### S19 — Neko Vintage

- `proposed_id`: `neko-vintage`
- `name`: `Neko Vintage`
- `area`: `sants-montjuic`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["neko", "neko vintage", "sant medir", "sants vintage"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: Time Out ES (Tier A), nekovintageclothes.com (operator, Tier A), IG. Sant Medir 11, Sants.
- Reason: First named indie character anchor for Sants; complements S11's utility weight.
- Role: `character_anchor`. Note: limited weekly hours (Wed–Fri); the catalog should *omit* hours and rely on operator link.

#### S20 — Vintage Poblenou

- `proposed_id`: `vintage-poblenou`
- `name`: `Vintage Poblenou`
- `area`: `poblenou`
- `candidate_kind`: `real_place`
- `kind`: `shop`
- `tags`: `["vintage", "second_hand", "shopping", "lokalt"]`
- `searchTerms`: `["vintage poblenou", "two market", "poblenou vintage", "avila"]`
- `confidence`: `medium`
- `needs_human_verification`: `true`
- Provenance: Time Out ES (Tier A), vintagepoblenou.com (operator, Tier A).
- Reason: Sole Poblenou anchor for second-hand in the shortlist; warehouse-format vintage matches utility weight. Mixed-mode (shop with periodic market days); model as a normal shop and treat market days as soft signals later.
- Role: `utility_anchor` with `market_anchor` overflow. Operator-page hours can be linked but not encoded.

**Shortlist totals: 20 entries** (target was 15–25). Coverage:
- `raval` — 5 (S1, S2, S3, S4, S5)
- `gotic` — 3 (S6, S14, S15)
- `born-sant-pere-santa-caterina` — 3 (S9, S12, S13)
- `eixample` — 2 (S7, S16)
- `sant-antoni` — 1 (S10)
- `gracia` — 3 (S8, S17, S18)
- `sants-montjuic` — 2 (S11, S19)
- `poblenou` — 1 (S20)
- `poble-sec` — 0 (Humana Paral·lel rejected to first-PR for proximity to Sant Antoni)

Total areas covered: **8 of Barcelona's 9 named second-hand-relevant
neighborhoods.** Poble-sec stays in raw universe but does not enter the
shortlist.

Role mix in shortlist: **9 character_anchor / 10 utility_anchor / 1
utility_anchor-with-market-overflow.** Within target ratio for honest
density — not all gems, not all chain.

---

## 4. Reject / hold list

### Rejected outright (do not promote, this wave or next)

- **`barcelona-riera-baixa-cluster` as a runtime `area_preset`** — the
  cluster value lands implicitly via S1 + S2 + S3 + S4 + S5. The cluster
  itself is `structural_area_context` and never enters runtime as a
  place.
- **`barcelona-el-born-vintage-design-cluster` as a runtime
  `area_preset`** — value lands via S9 + S12 + S13.
- **Lailo (Riera Baixa 20)** — reported closed on Facebook per #139.
- **Rekup & Co Verdi (Verdi 63)** — permanently closed per Miniguide
  March 2026.
- **Carrer dels Lledó 4/6 "designer vintage" mention** — surfaced in
  search summary without a named shop; cannot be promoted as a place.
- **Calle Calaf 46, 5º 1ª "vintage showroom"** — by-appointment 5th-
  floor showroom; not a routeable shop.
- **Standalone bookshops, record shops, antique dealers, coin dealers,
  furniture or ceramics resale** — out of category for this wave per
  §1.

### Held for next wave / next scout

- **Bunker Second Hand Shop (Basses de Sant Pere 2)** — newer (Sept
  2024); held in #139 in favor of Loisaida. Re-evaluate in 12+ months
  once hours stabilize.
- **House of Rowdy (Joan d'Àustria 55, Poblenou)** — hybrid gallery /
  vintage shop / design studio; needs the runtime to model hybrid
  formats honestly before promotion.
- **Escorial 121 vintage showroom** — Friday–Sunday only; schedule-
  sensitive; same hold reason as the Sant Antoni dominical.
- **Frip Vintage, Circular Second Hand, Lamarck, Beyond Wear, Il Capo
  Vintage Kilo, Paka Vintage Gallery** — single Tier B/C source each;
  re-search with a second independent source before shortlisting.
- **Mahalo Vintage Trafalgar, Mahalo Vintage Comtal** — same operator
  as S18 (Mahalo Diamant); pick one Mahalo location at a time to avoid
  chain spam.
- **La Principal Retro Ferlandina + Elisabets** — multi-location
  operator within the same neighborhood; pick one for the wave after
  this. Surface confusion with the Gràcia mentions in some roundups
  (which are wrong — the addresses are Raval / Ciutat Vella).
- **Holala! Tallers, Kilostore Riera Baixa 11** — same chain as S4;
  rotate in after S4 lands.
- **Humana Astúries cross-listed with `Travessera de Gràcia, 80`** —
  see §7 note: one source (Spanish TikTok roundup) called the
  Travessera 80 address "Mahalo Vintage" in a different context. Humana
  Spain's own page lists Travessera 80 as Humana. **Hold** the
  Travessera 80 location until the conflict is resolved.
- **`barcelona-mercat-sant-antoni-dominical`** — schedule-sensitive;
  same hold as #139.

### Conflict flag

The `Travessera de Gràcia, 80` address appears on **both** the Humana
operator list and on a separate Spanish TikTok vintage roundup that
attributes it to a different brand context. Most likely the official
Humana page is correct and the TikTok roundup mislabeled the address;
this would benefit from on-the-ground verification before promotion.
Until resolved, the runtime entry should be `humana-asturies` (S8)
only, not a Travessera-80 entry.

---

## 5. Runtime batch proposal (first runtime PR)

**Proposed first batch: 10 entries.** Mix of character + utility,
geographically split, all `confidence ≥ medium`, none depending on a
recurring schedule, none a cluster faked as a shop.

| # | Shortlist ID | Area | Role | Why first |
|---|---|---|---|---|
| 1 | S1 Lullaby Vintage | raval | character | Already vetted in #139. |
| 2 | S12 Loisaida | born-sant-pere-santa-caterina | character | Already vetted in #139. |
| 3 | S4 Holala! Plaza | raval | character + utility | Largest single named vintage shop; multi-Tier-A sources. |
| 4 | S6 Humana Vintage Portaferrissa | gotic | utility | Tier A operator page; flagship Gothic utility anchor. |
| 5 | S7 Humana Vintage Ronda Universitat | eixample | utility | Tier A operator; Plaça Universitat transit. |
| 6 | S8 Humana Vintage Astúries | gracia | utility | Tier A operator; Gràcia coverage. |
| 7 | S9 Humana Vintage Francesc Cambó | born-sant-pere-santa-caterina | utility | Tier A operator; near Mercat Santa Caterina. |
| 8 | S10 Humana Ronda Sant Antoni | sant-antoni | utility | Sant Antoni anchor independent of dominical. |
| 9 | S11 Humana Sants | sants-montjuic | utility | First named Sants anchor in the catalog at all. |
| 10 | S15 L'Arca | gotic | character | Strongest editorial anchor; multi-Tier-A. |

Coverage of first batch: 6 named neighborhoods
(`raval`, `gotic`, `born-sant-pere-santa-caterina`, `eixample`,
`sant-antoni`, `gracia`, `sants-montjuic` — that's **7**).

**Second batch (after first ships):** S2, S3, S5, S13, S14, S16, S17,
S18, S19, S20 — five more character anchors, two more utilities, plus
the Eixample fashion-resale anchor (S16). Decomposes the Riera Baixa
cluster fully, adds Gràcia character anchors beyond utility, and lands
Poblenou + Sants character coverage.

**Total post-second-batch: 20 entries.** Three batches in total
(including the optional Encants `source_url` refresh as its own micro-
PR).

---

## 6. Route-density reasoning

### Can the shortlist support a single second-hand route day?

**Yes.** Example route: `Humana Vintage Portaferrissa` (S6) →
`Flamingos Vintage Kilo Tallers` (S5) → `Holala! Plaza` (S4) →
`Lullaby Vintage` (S1) → `Arepa Queer` (S2) → `Vilde Vintage` (S3).
That is six stops in Raval / Gothic, comfortably a half-day walking
route.

### Can the shortlist support two **different** route days?

**Yes.** A second-day route could shape as:
`Humana Vintage Francesc Cambó` (S9) → `Loisaida` (S12) → `Le Swing
Vintage` (S13) → `L'Arca` (S15) → `Los Féliz` (S14). Five stops
across Born / Gothic, character-anchor-heavy, different price tiers
from day one.

### Can the shortlist support several route days for a 4–5 day trip?

**Yes, with rotation across neighborhoods:**

- **Day A (Raval / Gothic):** S1, S2, S3, S4, S5, S6.
- **Day B (Born / Gothic luxury):** S9, S12, S13, S14, S15.
- **Day C (Gràcia):** S8, S17, S18 (decompose Verdi / Diamant axis).
- **Day D (Eixample / Sant Antoni utility):** S7, S10, S16. (Pair with
  a non-second-hand anchor for lunch — the route engine should be able
  to mix in existing Sant Antoni food anchors.)
- **Day E (Sants + Poblenou):** S11, S19, S20. (Lower density; works
  as a quieter day or pairs with Encants `mercat-encants` already in
  runtime.)

That is **five distinct second-hand-themed days**, each with at least
three named anchors, each in a different neighborhood spine. The route
engine has real material to filter on per weather, vibe, and time-of-
day — not just a single demo route.

### What is still weak

- **Poble-Sec.** Only Humana Paral·lel surfaced and it was held. Adds
  none of the second-hand-flavored neighborhood coverage that Sant
  Antoni / Sants get.
- **Sant Antoni character anchors.** S10 (Humana) is solid utility but
  no named indie shop surfaced in Sant Antoni that survived the
  category-scope rule (per #139). A future scout focused on Sant
  Antoni could change this.
- **Poblenou.** Only S20 (Vintage Poblenou) shortlisted; House of Rowdy
  held. If Poblenou is meant to support a full route day, it needs at
  least two more named anchors.
- **Outer ring (Sant Andreu, Sant Martí beyond Poblenou, Sarrià,
  Horta-Guinardó).** Not searched in this pass. If Parranda wants to
  serve users not staying in the central spine, an outer-ring scout is
  needed.

---

## 7. Local terms learned for Barcelona second-hand clothing

This section is a working artifact for future scouts. Reuse, extend,
and prune as new evidence comes in.

### Canonical intent: `second_hand_clothing` — Barcelona / Catalonia

- **Local-language terms (verified to produce relevant local sources
  in this scout):**
  - *ropa de segunda mano*
  - *ropa usada*
  - *moda vintage*
  - *moda circular*
  - *tienda vintage*
  - *botiga vintage*
  - *roba de segona mà*
  - *outlet vintage*
  - *vintage kilo* / *tienda kilo* / *kilo shop*
  - *tiendas vintage Barcelona* (English query terms still index
    Spanish content)
  - *tiendas segunda mano ropa Barcelona*
- **Known local utility brands / multi-location operators
  (verifiable):**
  - **Humana** — 25 Barcelona stores per operator page; flagship at
    Portaferrissa 21.
  - **Holala!** — Plaza (Valldonzella 2) + Tallers 73 + Riera Baixa 11
    affiliate Kilostore; running since 1972.
  - **Flamingos Vintage Kilo** — Tallers 31 / Ferlandina 20 /
    Portaferrissa 7; pay-by-weight.
  - **Mahalo Vintage** — Comtal 13 / Trafalgar 78 / Plaça del Diamant
    9.
  - **La Principal Retro & Co** — Ferlandina 37 / Elisabets 3 (Raval
    / Ciutat Vella, **not** Gràcia despite some roundup claims).
- **Accepted subtypes seen in Barcelona retail vocabulary:**
  - Vintage clothing shops with decade-curated stock.
  - Curated luxury resale (`Cotton Vintage`-style — *lujo segunda
    mano* / *consignment*-style without a literal "consignment"
    label).
  - Pay-by-kilo shops (*vintage kilo*).
  - Charity / non-profit second-hand chains (Humana; Moda re- listed
    but not yet shortlisted).
- **Excluded false friends (rejected during scouting):**
  - Tourist-coded "vintage" boutiques selling new-stock retro
    (rejected when the operator's own site confirmed new-stock).
  - General antique dealers without a clothing drift (rejected per
    category scope).
  - Antique furniture and ceramics shops surfacing on `vintage`
    queries — out of scope.
  - "Vintage" branding on jewellery-only shops with no clothing axis.

### Notes about the term landscape

- Spanish-language editorial sources for Barcelona second-hand clothing
  are **richer** than English-language sources for shops outside the
  central spine. Future scouts must search in Spanish/Catalan first
  for Gràcia / Sants / Poblenou; English-only searches will miss most
  of those shops.
- **TikTok / Instagram** are load-bearing for some Gràcia shop
  addresses and hours (e.g. Lamarck, Beyond Wear, Il Capo). They are
  Tier C and must be corroborated, but they are often where the address
  first lands publicly.
- **Páginas Amarillas / Cylex** are useful for *confirming* an address
  exists in a business registry but cannot establish current operating
  status — use them as a Tier C corroborator only.
- **`barcelona-metropolitan.com`** is a strong Tier B source for
  English-language coverage of independent shops; its `locations/`
  pages match operator-site addresses in every cross-check this pass.
- **`bcncoolhunter.com`** route articles tend to bundle a useful
  pre-grouped shop list per route, which speeds dedupe.

### The principle, restated

Per #139: this is a **writing principle** for future scouts. The
intent map above lives in docs for now. No runtime contract, no config
file, no validator rule is added by this scout. The implementation
question — where this map lives in the codebase and how providers
consume it — remains deferred to a later, separately-scoped PR.

---

## Hard rules audit (per task brief)

| Rule | Status |
|---|---|
| No invented addresses | Every shortlist address traces to at least one Tier A or two Tier B sources. |
| No invented opening hours | No `closedWeekdays` or hours field proposed anywhere in the shortlist. |
| No fake clusters as shops | Riera Baixa, Born, Gràcia clusters explicitly stay `structural_area_context`. |
| No duplicates of existing catalog entries | Grepped `server/cities/barcelona/catalog.js` for `vintage`, `second_hand`, `humana`, `kilo`, `resale`, `consignment` before drafting; only `mercat-encants` and `mercat-sant-antoni` exist (markets, not shops). |
| No standalone book / record / furniture / antique as main entry | Category scope §1 enforced; all 20 shortlist entries are clothing-or-fashion shops. |
| No `needs_review` candidate recommended for runtime | Shortlist is 6 `high` / 14 `medium` (S1, S2, S3, S5, S12, S13, S14, S17, S18, S19, S20 + others). Zero `needs_review`. |
| `medium` + `needs_human_verification: true` acceptable | Used for every `medium` shortlist entry. |
| Hours uncertain → omit | Enforced; runtime should link operator URL / Google. |

---

## Validator run

```
$ node scripts/inspect-candidate-pack.js docs/candidate-packs/barcelona-second-hand-v0.md
Status: intake_only
Candidate count: 18
Hard errors: none
Warnings: none
```

The v0 pack is not modified by this scout. Validator output unchanged
from #139 merge point.

This expansion scout is a **standalone report**, not a candidate pack —
it does not contain fenced `proposed_id` blocks. Validating it is a
no-op (the inspector would find no `pack_name` block and return
`missing_pack_metadata`); intentionally out of scope.

---

## Changed files

- `docs/candidate-packs/barcelona-second-hand-expansion-scout.md` (new
  file, this report)

No changes to `server/`, `tests/`, `scripts/`, `script.js`,
`styles.css`, `index.html`, or `landing.*`.

## Worktree status

Branch: `docs/barcelona-second-hand-expansion-scout`. Single new
tracked file. Pre-existing untracked items unchanged
(`.claude/`, `pulse-audit-2026-05-19.md`).
