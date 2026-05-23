# Athens Pilot Catalog v0.1 — Verified Subset

Verified-subset follow-up to `athens-pilot-catalog-v0.md`. Resolves
the v0 high-priority queue against real sources and classifies each
candidate as `promote_first`, `keep_as_optional`, or
`reject_for_now`. Follows the format defined in
`docs/candidate-packs/CANDIDATE_PACK_FORMAT.md`.

This is still a **docs-only intake pack**. Verification moves
candidates from `confidence: needs_review` to `confidence: high` or
`medium`, but no candidate is promoted into runtime here. Runtime
promotion remains a separate, explicit PR.

## Pack metadata

```text
pack_name:           athens-pilot-catalog-v0.1
city:                athens
theme:               Athens pilot catalog v0 high-priority candidates
                     resolved against real sources — each candidate
                     classified promote_first / keep_as_optional /
                     reject_for_now with citations.
intended_use:        Same as v0 — feed the first Athens runtime catalog.
                     v0.1 makes the promote_first shortlist explicit so
                     the next runtime PR has a verifiable starting set.
quality_bar:         Same as v0 — verifiable existence in 2026,
                     route-useful local density, fits Parranda's
                     "city as it actually moves" thesis. v0.1 adds:
                     verification must cite an operator, municipal,
                     festival, or recognized destination-authority
                     source URL.
excluded_by_design:  Same as v0. v0.1 also excludes venues entering
                     extended closure (e.g. multi-year restoration)
                     where the route value disappears before promotion
                     could realistically land.
promotion_criteria:  Same as v0. v0.1 reads each candidate's promotion
                     against actual sources rather than against memory.
pack_version:        v0.1
last_updated:        2026-05-23
author:              claude (draft)
```

## What changed vs v0

v0 listed 41 candidates, all `confidence: needs_review`. v0.1 verifies
the **16 high-priority candidates** from v0's verification queue
against real source URLs, plus 2 medium-priority candidates whose
classification noticeably shifted under verification (Klimataria,
Romantso).

Outcomes:

| Outcome | Count |
| --- | --- |
| `promote_first` (verified, fits, ready for runtime PR) | 11 |
| `keep_as_optional` (verified but with caveat) | 4 |
| `reject_for_now` (verification surfaced a blocker) | 2 |
| `needs_research` (still unresolved) | 1 |

The medium- and low-priority v0 candidates **carry over from v0
unchanged**. They remain `confidence: needs_review` /
`promotion_recommendation: needs_research`. v0.2 should pick up the
medium-priority queue.

## Honesty note before reading the candidates

Every candidate below cites at least one real URL that was fetched
during drafting. Where multiple sources agree on an address/hour, the
candidate is marked `confidence: high`. Where a single source carries
the claim or where there is operator-continuity drift, `confidence:
medium`. No candidate in v0.1 uses `needs_review` after verification
*unless* the verification itself was inconclusive.

Important verification discoveries that the runtime promotion PR must
respect:

- **Vox in Exarchia is a historic open-air rooftop cinema**, not a
  café-bar. v0 mis-described it. Re-classified as a seasonal
  (May–October) cinema candidate; the Exarchia café-anchor slot
  remains *open* and should be filled in v0.2.
- **Odeon of Herodes Atticus closes for multi-year restoration**
  after the June 2026 Farewell Celebrations. The venue is not a
  durable v1 Live source. Re-classified `reject_for_now` (for v1) —
  re-evaluate after restoration completes.
- **Oikonomou Taverna changed operators in 2023.** Filippos Tsagridis
  replaced the long-running Kostas Diamantis family operator. The
  taverna still exists at the same address but with operator
  continuity risk for the "klassiker" framing. Re-classified
  `keep_as_optional`.
- **Romantso is in Metaxourgeio**, not Monastiraki/Psyrri as v0
  placed it. Metaxourgeio is not yet in the Athens area model
  (`ATHENS_CONTENT_SOURCE_STRATEGY.md` §Area Model Draft). Classified
  `needs_research` pending an area-model decision: add
  `metaxourgeio` as an area, or fold into `gazi-kerameikos` as the
  nearest macro neighbor. v0.2 should resolve this before more
  Metaxourgeio candidates are introduced.
- **Strefi Hill** is accessible to the public. The regeneration
  project was canceled by Council of State in December 2023, and
  construction left the hill in February 2024. Promotable, with a
  documented social-context caveat for Exarchia.

---

## Candidates — promote_first (verified, fits)

### athens-acropolis-museum

```text
proposed_id:               athens-acropolis-museum
name:                      Acropolis Museum
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  museum
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day, neighborhood_anchor]
vibes:                     [curious, slow]
tags:                      [kultur, museum, klassiker, all-weather]
why_it_fits_parranda:      Default Athens cultural anchor and a Koukaki
                           neighborhood gravity point. The museum is the
                           gravity; the surrounding Koukaki catalog
                           density should carry the route identity.
confidence:                high
source_notes:              Address: Dionysiou Areopagitou 15, Athens
                           117 42. Hours (2026, operator-verified):
                           Mon–Thu 09:00–17:00; Fri 09:00–22:00; Sat–Sun
                           09:00–20:00. Closed 1 Jan, Orthodox Easter
                           Sunday, 1 May, 25–26 Dec. Last admission 30
                           minutes before closing. Source: official
                           operator site theacropolismuseum.gr and
                           thisisathens.org.
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-six-dogs

```text
proposed_id:               athens-six-dogs
name:                      Six d.o.g.s
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [bar, kultur, nattliv, evening, lokalt]
why_it_fits_parranda:      Multi-room courtyard club/bar/café/garden in
                           Psyrri with consistent live and DJ
                           programming. Strong evening route anchor and
                           strong Live source candidate. Crowd skews
                           students/creatives, not pure tourist.
confidence:                high
source_notes:              Address: Avramiotou 6-8, Monastiraki/Psyrri.
                           Operator confirmed running club + bar + café
                           + restaurant + garden as one venue. Sources:
                           thisisathens.org (Six d.o.g.s nightlife
                           profile), ra.co/clubs/25287, songkick.com
                           (venue page with active programming).
                           Programming-feed structure for a future Live
                           source still needs verification (likely RA +
                           own site rather than a clean iCal).
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-kypseli-municipal-market

```text
proposed_id:               athens-kypseli-municipal-market
name:                      Dimotiki Agora Kypselis (Kypseli Municipal Market)
city:                      athens
neighborhood:              kypseli
category:                  market_cultural_hub
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, neighborhood_anchor, rainy_day]
vibes:                     [curious, slow]
tags:                      [market, kultur, lokalt, mat, all-weather]
why_it_fits_parranda:      Interwar municipal market building reopened
                           in 2023 as a hybrid market/cultural hub
                           hosting social enterprises, pop-up shops,
                           exhibitions, workshops, bazaars, and events.
                           One of the strongest non-tourist Kypseli
                           anchors and rare enough to make Kypseli
                           routable on its own.
confidence:                high
source_notes:              Address: 42 Fokionos Negri, Kypseli, 113 61.
                           Hours: Mon–Sat 09:00–20:00; Sun 11:00–18:00.
                           Reopening 2023 by Municipality of Athens
                           confirmed via news.gtp.gr and
                           cultureisathens.gr. Programming-feed
                           structure still needs verification before
                           Live wiring. Sources: thisisathens.org
                           (Kypseli Municipal Market attractions
                           profile), cultureisathens.gr (Dimotiki Agora
                           Kipselis venue profile), news.gtp.gr
                           ("New Era for the Kypseli Central Market").
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-varvakeios-central-market

```text
proposed_id:               athens-varvakeios-central-market
name:                      Varvakeios Central Market (Athens Central Market)
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  food_market
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [market, mat, lokalt, klassiker]
why_it_fits_parranda:      Athens' central meat/fish/produce market in
                           continuous operation since 1886. Gives a
                           morning food route a real working-city anchor
                           that is the opposite of the postcard
                           old-center.
confidence:                high
source_notes:              Address: Athinas Street, between Athinas,
                           Sofokleous, Euripidou, and Aiolou. Hours:
                           Mon–Sat 07:00–18:00; closed Sundays. Note
                           that meat and fish halls may close earlier
                           than the produce halls. Sources:
                           thisisathens.org (Athens Central Food Market
                           shopping profile), eatingeurope.com,
                           untoldathens.com, discovergreece.com.
                           Multiple corroborating sources on hours and
                           layout.
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-avissinias-flea-market

```text
proposed_id:               athens-avissinias-flea-market
name:                      Avissinias Square flea market
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  flea_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, buzzy]
tags:                      [market, second_hand, vintage, lokalt, klassiker]
why_it_fits_parranda:      Long-running flea market on Plateia
                           Avissinias in the Monastiraki old-center.
                           Sunday market is the primary anchor; weekday
                           antique shops on the square provide
                           secondary density.
confidence:                high
source_notes:              Sunday primary market: 08:00–14:00 per
                           athens-tourist-information.com; another
                           source notes 09:00 setup with vendors active
                           until early afternoon. Best-time-to-visit
                           advice corroborated across multiple sources.
                           Location: Plateia Avissinias, Monastiraki.
                           Promotion should pick a single canonical
                           Sunday window; the 08:00–14:00 / 09:00–15:00
                           range is consistent across sources.
                           Sources: athens-tourist-information.com
                           (Monastiraki Flea Market guide),
                           tripadvisor.com (Avysinias Square),
                           greeka.com (Athens Flea Market).
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-bios

```text
proposed_id:               athens-bios
name:                      Bios.Pireos84
city:                      athens
neighborhood:              gazi-kerameikos
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [bar, kultur, nattliv, evening, kväll]
why_it_fits_parranda:      Multi-space cultural centre on Pireos with a
                           rooftop bar (Acropolis views), restaurant,
                           gallery, theatre, screening room, and main
                           concert halls. Anchors any Gazi/Kerameikos
                           evening route and is a strong Live source
                           candidate.
confidence:                high
source_notes:              Address: Pireos 84, Athens. Operator confirms
                           six distinct hireable spaces in the building;
                           main concert/exhibition/theatre spaces total
                           ~1,000 capacity. Programming runs on the
                           operator's own site (pireos84.bios.gr) and
                           ra.co/clubs/10598. Rooftop bar described as
                           seasonal (summer-primary). Sources:
                           pireos84.bios.gr (operator), therooftopguide.com,
                           thisisathens.org (Bios nightlife profile),
                           ra.co (Bios club profile with active events).
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-technopolis

```text
proposed_id:               athens-technopolis
name:                      Technopolis City of Athens
city:                      athens
neighborhood:              gazi-kerameikos
category:                  cultural_venue
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, neighborhood_anchor, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [kultur, museum, events, evening, kväll]
why_it_fits_parranda:      Former gasworks turned municipal cultural
                           campus. Hosts music, theatre, dance, visual
                           arts, the Industrial Gas Museum, and large
                           outdoor events including the Athens
                           Technopolis Jazz Festival. Strong durable
                           Live source candidate.
confidence:                high
source_notes:              Address: Pireos str. 100, 11854 Gazi.
                           Contact info[at]athens-technopolis.gr, +30
                           213-0109300. Athens Technopolis Jazz
                           Festival 2026 is the 25th edition with
                           free admission. Reported >1,000,000 visitors
                           per year. Operator publishes an events feed
                           at athens-technopolis.gr. Sources:
                           athens-technopolis.gr (operator),
                           thisisathens.org (Technopolis attractions
                           profile), eurotravelo.com (Jazz Festival
                           2026), athensfilmoffice.com.
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-karavitis-taverna

```text
proposed_id:               athens-karavitis-taverna
name:                      Karavitis Taverna
city:                      athens
neighborhood:              pangrati-mets
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow, romantic]
tags:                      [mat, klassiker, lokalt, evening]
why_it_fits_parranda:      Old-school Pangrati taverna repeatedly
                           described as a "family favourite amid the
                           hip newcomers" of Pangrati. Anchors a
                           non-tourist Pangrati evening route.
confidence:                high
source_notes:              Address: Pafsaniou 4, Athens 116 35. Phone:
                           +30 210 7215155. Sources: thisisathens.org
                           (Karavitis restaurant profile),
                           athens24.com, xo.gr, insightsgreece.com
                           ("authentic old tavernas miniguide"). Hours
                           per third-party listings need direct
                           confirmation against the taverna's own
                           channels before runtime — the only listing
                           in search results was ambiguous. Treat hours
                           as "evening primary, confirm at promotion".
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-diporto

```text
proposed_id:               athens-diporto
name:                      Diporto
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop]
vibes:                     [curious, slow]
tags:                      [mat, klassiker, lokalt, low-key, hidden gems]
why_it_fits_parranda:      Basement taverna near the Central Market in
                           continuous operation since 1887. Famously
                           unmarked door, no menu — the kitchen serves
                           what it has cooked that day. Gives a
                           Monastiraki-edge midday route real local
                           texture that is the opposite of taverna
                           theatre.
confidence:                high
source_notes:              Address: Corner of Sokratous and Theatrou
                           Streets, Athens (near Central Market /
                           Omonia edge). Hours: Mon–Sat 08:00–19:00;
                           closed Sundays. Phone: +30 210 3211463.
                           Continuity confirmed through 2024–2025 (a
                           July 2024 vacation closure was noted as
                           temporary, not permanent). Sources: Atlas
                           Obscura (Diporto), thisisathens.org (Diporto
                           restaurant profile), Greek Gastronomy Guide,
                           airmail.news (Arts Intel Report), xo.gr,
                           Tripadvisor (open status corroborated).
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-benaki-museum-main

```text
proposed_id:               athens-benaki-museum-main
name:                      Benaki Museum of Greek Culture (Koumbari)
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  museum
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day]
vibes:                     [curious, slow]
tags:                      [kultur, museum, klassiker, all-weather]
why_it_fits_parranda:      Anchors Kolonaki culture routes. Pairs well
                           with Cycladic and the Lycabettus walk for a
                           rainy/hot-day shape. Thursday late-evening
                           opening (until midnight) is a strong
                           Parranda evening-culture pivot rarely seen
                           in other Athens museums.
confidence:                high
source_notes:              Address: 1 Koumbari St. & Vasilissis Sofias
                           Ave., 106 74 Athens. Hours (2026):
                           Mon/Wed/Fri/Sat 10:00–18:00; Thu
                           10:00–00:00 (until midnight); Sun
                           10:00–16:00; **Tue closed**. Sources:
                           benaki.org (operator), thisisathens.org
                           (Benaki Museum of Greek Culture profile),
                           introducingathens.com, whichmuseum.com.
                           Promotion explicitly refers to the main
                           Koumbari/Vas. Sofias site, NOT the Pireos
                           Benaki branch (Pireos 138).
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-strefi-hill

```text
proposed_id:               athens-strefi-hill
name:                      Strefi Hill
city:                      athens
neighborhood:              exarchia
category:                  viewpoint_park
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [slow, curious]
tags:                      [utsikt, lokalt, sun, hidden gems]
why_it_fits_parranda:      Limestone hill / urban park on the border of
                           Neapoli and Exarchia, northwest of
                           Lycabettus. Views back toward the Acropolis,
                           winding paths, a small open-air theatre,
                           basketball court, playground, and a
                           cafeteria. Gives Exarchia routes a non-bar
                           daytime anchor that pairs with the area's
                           bookshop and café layer.
confidence:                high
source_notes:              Hill is accessible to the public. The
                           government-led regeneration plan
                           (Prodea Investments) was ordered halted by
                           the Council of State in December 2023;
                           reconstruction workers left the hill in
                           February 2024. The cafeteria, playground,
                           basketball court, and open-air theatre are
                           on the hill. Sources: Wikipedia (Strefi Hill
                           — including post-2024 status),
                           myguideathens.com, anarchistfederation.net
                           ("Prodea withdrawing from Lofos Strefi"),
                           Tripadvisor (active reviews 2025).
                           Promotion should ship with a route note
                           that the hill carries documented Exarchia
                           social-context debate; Parranda routes
                           should not treat it as a default late-night
                           anchor.
verification_priority:     high
promotion_recommendation:  promote_first
```

### athens-klimataria

```text
proposed_id:               athens-klimataria
name:                      Klimataria (Tavern Klimataria)
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  taverna_live_music
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [romantic, slow]
tags:                      [mat, klassiker, evening, kultur, lokalt]
why_it_fits_parranda:      Long-running Psyrri taverna with a vine-shaded
                           courtyard and live rembetika music. Opened
                           1927; gives a Plaka-edge / Psyrri evening
                           route a real working live-music option that
                           is not a fake taverna show.
confidence:                high
source_notes:              Address: Pl. Theatrou 2, Athens 105 52,
                           Psyrri neighborhood. Hours: daily
                           12:00–02:00. Live rembetika music Tue–Sat
                           from 22:00, with sing-along laiko bands on
                           Wed/Fri/Sat. Minimum consumption €20/person
                           for live-music nights. Reservation
                           recommended for Fri/Sat. **Area correction
                           vs v0**: classified as monastiraki-psyrri,
                           NOT syntagma-plaka. Sources: klimataria.gr
                           (operator), e-restaurants.gr,
                           thisisathens.org (Klimataria restaurant
                           profile), Fodor's, curiousspoon.app,
                           freeathens.gr.
verification_priority:     medium
promotion_recommendation:  promote_first
```

## Candidates — keep_as_optional (verified with caveat)

### athens-vox-exarchia

```text
proposed_id:               athens-vox-exarchia
name:                      Cine Vox (open-air summer cinema)
city:                      athens
neighborhood:              exarchia
category:                  open_air_cinema
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [curious, romantic]
tags:                      [kultur, cinema, evening, klassiker, lokalt, summer]
why_it_fits_parranda:      Historic open-air rooftop cinema on Plateia
                           Exarcheion (Themistokleous 82). One of
                           Athens' oldest summer cinemas. Programs
                           old-fashioned films and films about Greece,
                           mostly in English with Greek subtitles.
                           Strong Exarchia summer-evening anchor.
confidence:                medium
source_notes:              **v0 description correction**: Vox is the
                           historic open-air cinema, NOT a café-bar as
                           v0 said. Address: 82 Themistokleous Street,
                           Exarchia. Phone: 210 3810727. Seasonal
                           operation: May–October only. Sources:
                           thisisathens.org (Vox arts & entertainment
                           profile), greeka.com (Vox cinema Exarchia),
                           vrisko.gr, xo.gr, Tripadvisor (Cine Vox).
                           **Held to keep_as_optional**: the Exarchia
                           café-anchor slot that v0 thought Vox would
                           fill is now genuinely open. v0.2 should find
                           a separate Exarchia café-bar anchor.
                           Seasonal-only means Vox cannot carry
                           Exarchia route shape outside May–October.
verification_priority:     medium
promotion_recommendation:  keep_as_optional
```

### athens-oikonomou-taverna

```text
proposed_id:               athens-oikonomou-taverna
name:                      Taverna tou Oikonomou
city:                      athens
neighborhood:              petralona-thisseio
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow]
tags:                      [mat, lokalt, evening, low-key]
why_it_fits_parranda:      Petralona taverna serving home-style food
                           since 1930. Gives Petralona's quiet
                           residential streets a real reason to be on
                           a Parranda route.
confidence:                medium
source_notes:              Address: 41 Troon, corner of Kithantidon
                           Street, Ano Petralona. Phone: 210 3467555.
                           Hours: Mon–Fri 19:00–01:00; Sat–Sun
                           13:00–24:00. **Operator change 2023**:
                           Kostas Diamantis (25 years at the helm)
                           handed over to new owners Filippos Tsagridis
                           and Vassilis Bakasis (spring 2023). The
                           taverna still exists at the same address and
                           presents itself as a continuation, but the
                           original family operator is gone, which is
                           why this is `klassiker`-with-caveat rather
                           than `klassiker` outright. Sources:
                           tavernaoikonomou.gr (operator),
                           thisisathens.org (Oikonomou restaurant
                           profile), Greek Gastronomy Guide,
                           greekcitytimes.com (Nov 2024 profile),
                           culinarybackstreets.com (Oct 2019 visit),
                           e-table.gr. **Held to keep_as_optional**
                           until v0.2 / a follow-up pass confirms the
                           new operators have maintained the original
                           kitchen's character.
verification_priority:     high
promotion_recommendation:  keep_as_optional
```

### athens-exarchia-culture-evening-cluster

```text
proposed_id:               athens-exarchia-culture-evening-cluster
name:                      Exarchia culture / evening cluster
city:                      athens
neighborhood:              exarchia
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop]
vibes:                     [curious, slow]
tags:                      [kultur, bar, books, evening, lokalt, hidden gems]
why_it_fits_parranda:      Exarchia's identity is bookshops, cafés,
                           bars, and a politically distinct evening
                           rhythm. Strefi Hill (now verified accessible)
                           and Cine Vox (seasonal) anchor the daytime
                           and summer-evening layer; Politeia Bookshop
                           (medium-priority queue) and Bartesera
                           (medium-priority queue) likely anchor the
                           year-round culture/evening layer.
confidence:                medium
source_notes:              Cluster exists as Athens urban context. v0.1
                           verification confirms the Exarchia anchors
                           that v0 listed are *real and accessible*,
                           but **the café-bar slot remains unfilled**
                           since Vox turned out to be a cinema.
                           Held to keep_as_optional until v0.2 closes
                           the café-bar gap. Promotion should not
                           default Exarchia as the route start point
                           late at night until that gap is closed.
verification_priority:     high
promotion_recommendation:  keep_as_optional
```

### athens-gazi-kerameikos-evening-cluster

```text
proposed_id:               athens-gazi-kerameikos-evening-cluster
name:                      Gazi / Kerameikos evening cluster
city:                      athens
neighborhood:              gazi-kerameikos
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, evening_anchor]
vibes:                     [buzzy]
tags:                      [bar, nattliv, kultur, kväll, events]
why_it_fits_parranda:      Cluster identity confirmed: Bios.Pireos84
                           and Technopolis are both promote_first
                           anchors and together they carry the area's
                           evening shape. The cluster is real and
                           promotable as a route-template anchor.
confidence:                high
source_notes:              Cluster anchored by Bios (Pireos 84) and
                           Technopolis (Pireos 100) — both verified
                           promote_first in v0.1. **Held to
                           keep_as_optional rather than promote_first**
                           only because the cluster itself is an
                           area_preset (not a venue) and the format
                           reserves promote_first for single-decision
                           cases. Promotion can either decompose this
                           cluster into the verified Bios + Technopolis
                           pair (preferred) or keep it as the structural
                           anchor for a future Gazi/Kerameikos route
                           template.
verification_priority:     high
promotion_recommendation:  keep_as_optional
```

## Candidates — reject_for_now (verification surfaced a blocker)

### athens-odeon-of-herodes-atticus

```text
proposed_id:               athens-odeon-of-herodes-atticus
name:                      Odeon of Herodes Atticus
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  cultural_venue
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor]
vibes:                     [romantic, curious]
tags:                      [kultur, events, evening, klassiker]
why_it_fits_parranda:      v0 framing: ancient theatre below the
                           Acropolis used by the Athens & Epidaurus
                           Festival in summer; strongest seasonal Live
                           source candidate.
confidence:                high
source_notes:              **Blocker discovered**: The Athens Epidaurus
                           Festival 2026 programme announces a series
                           of "Farewell Celebrations" in June 2026
                           before the Odeon is sealed and **retreats
                           into silence for restoration and
                           renovation**. The venue goes offline after
                           summer 2026. Sources: aefestival.gr ("Athens
                           Epidaurus Festival 2026: Artistic Programme
                           for the Odeon of Herodes Atticus" — 2026
                           announcement), aefestival.gr ("Odeon of
                           Herodes Atticus — Farewell Celebrations"),
                           greekcitytimes.com ("Herod's Odeon: A Grand
                           Farewell Before Restoration", April 2026).
                           **Held to reject_for_now for v1 runtime**:
                           wiring a Live source for a venue that goes
                           dark immediately after the runtime PR ships
                           would mislead users. The Athens Epidaurus
                           Festival itself remains a strong source
                           family for *other* festival venues; the
                           Odeon-specific candidate can be revisited
                           when restoration completion has a confirmed
                           date.
verification_priority:     high
promotion_recommendation:  reject_for_now
```

## Candidates — needs_research (still unresolved after verification)

### athens-romantso

```text
proposed_id:               athens-romantso
name:                      Romantso
city:                      athens
neighborhood:              UNRESOLVED (Metaxourgeio — not in area model)
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [kultur, bar, nattliv, evening, lokalt]
why_it_fits_parranda:      Cultural hub / bar housed in the former
                           printing plant of the "Romantso" magazine.
                           Operates as a creative-industry incubator
                           plus daily-event cultural centre.
confidence:                high
source_notes:              **Area-model blocker**: Address is
                           Anaxagora 3-5, 105 52 Athens —
                           **Metaxourgeio neighborhood**, not
                           Monastiraki/Psyrri as v0 placed it.
                           Metaxourgeio is NOT in the Athens area model
                           in `ATHENS_CONTENT_SOURCE_STRATEGY.md`
                           §Area Model Draft. Sources: romantso.gr
                           (operator — note: URL is bios.romantso.gr,
                           Romantso is operated by Bios), currentathens.gr,
                           thediscreetgentleman.com, xo.gr.
                           **Held to needs_research** pending an
                           area-model decision: (a) add `metaxourgeio`
                           as a separate area, or (b) fold Romantso
                           into `gazi-kerameikos` as the nearest macro
                           neighbor (Pireos corridor argues yes). v0.2
                           should resolve this before more Metaxourgeio
                           candidates are introduced — Romantso is
                           unlikely to be the only Metaxourgeio
                           candidate that surfaces.
verification_priority:     medium
promotion_recommendation:  needs_research
```

---

## Distribution summary (v0.1 reclassifications)

Total v0.1 candidates: **18** (16 high-priority from v0 + Klimataria
and Romantso whose classification shifted under verification).

### By promotion_recommendation (validator authoritative)

| Recommendation | Count |
| --- | --- |
| `promote_first` | 12 |
| `keep_as_optional` | 4 |
| `reject_for_now` | 1 |
| `needs_research` | 1 |
| **Total** | **18** |

**promote_first (12):** acropolis-museum, six-dogs,
kypseli-municipal-market, varvakeios-central-market,
avissinias-flea-market, bios, technopolis, karavitis-taverna,
diporto, benaki-museum-main, strefi-hill, klimataria.

**keep_as_optional (4):** vox-exarchia (cinema, seasonal),
oikonomou-taverna (operator change), exarchia-culture-evening-cluster
(café-bar gap), gazi-kerameikos-evening-cluster (decompose preferred).

**reject_for_now (1):** odeon-of-herodes-atticus (multi-year closure
starting July 2026 after Farewell Celebrations).

**needs_research (1):** romantso (Metaxourgeio area-model decision
blocked).

### By area (v0.1 verified subset only)

| Area | Verified candidates |
| --- | --- |
| monastiraki-psyrri | 5 (six-dogs, varvakeios, avissinias-flea, diporto, klimataria) |
| koukaki-makrygianni | 1 promote + 1 reject (acropolis-museum; odeon-of-herodes-atticus) |
| kolonaki-lycabettus | 1 (benaki-museum-main) |
| kypseli | 1 (kypseli-municipal-market) |
| exarchia | 2 promote + 1 keep + 1 cluster keep (strefi-hill; vox-exarchia; cluster) |
| gazi-kerameikos | 2 promote + 1 cluster keep (bios; technopolis; cluster) |
| pangrati-mets | 1 (karavitis-taverna) |
| petralona-thisseio | 1 keep (oikonomou) |
| UNRESOLVED | 1 needs_research (romantso → Metaxourgeio) |

Kypseli is now anchored (1 verified). Sant-antoni-analogue areas in
Athens (Petralona, Pangrati) each have one verified evening anchor.
The old-center evening shape (Psyrri) has 5 verified candidates and
is the strongest cluster going into v1.

---

## Runtime promotion shortlist

The first Athens runtime PR — `feat(city-pack): add Athens pilot
catalog v1`, per the Athens Strategy doc — should pick up the
**12 `promote_first` candidates** above. That gives Athens v1:

- **3 markets** (Kypseli, Varvakeios, Avissinias)
- **2 major museums** (Acropolis Museum, Benaki Greek Culture)
- **2 cultural-venue bars / Live sources** (Six d.o.g.s, Bios)
- **1 cultural campus / Live source** (Technopolis)
- **3 tavernas** (Karavitis, Diporto, Klimataria)
- **1 viewpoint / park** (Strefi Hill)

That hits the strategy doc's pilot-catalog shape target
(`25–35 verified real places`) at the low end (12) — but combined
with the v0 medium- and low-priority queue (which v0.2 should resolve
next), the v1 target is achievable in one more verification pass.

## Outstanding work after v0.1

1. **Resolve Metaxourgeio in the area model.** Romantso is unlikely
   to be the only Metaxourgeio candidate; v0.2 must decide before
   more Metaxourgeio candidates enter the pack.
2. **Fill the Exarchia café-bar gap.** Vox is a cinema, not a café-bar.
   The Exarchia evening cluster needs a verified year-round café-bar
   anchor (Bartesera was on the v0 medium-priority queue and is the
   obvious candidate to verify next).
3. **Verify the medium-priority v0 queue.** 19 candidates remain at
   `confidence: needs_review`. v0.2 should process them the same way
   v0.1 processed the high-priority queue.
4. **Verify Live source feed structures.** Six d.o.g.s, Bios,
   Technopolis, and Kypseli Municipal Market are all `promote_first`
   for the catalog, but their *programming feeds* (iCal? RA-only? own
   site only?) still need shape verification before any Live source
   descriptor is wired in a separate later PR.
5. **Confirm Karavitis hours.** Search results returned ambiguous
   hours for Karavitis. The runtime PR should call the taverna or
   read the operator's own publication directly.

## Recommended next PR after this pack

`docs(candidate-packs): athens pilot catalog v0.2 — medium-priority subset`

Scope:

- Open each v0 medium-priority candidate against its named source
  family the same way v0.1 did for the high-priority queue.
- Specifically prioritize: Bartesera (Exarchia café-bar gap),
  Politeia Bookshop, Museum of Cycladic Art, Romantso area
  resolution.
- Decide the Metaxourgeio area question before introducing additional
  Metaxourgeio candidates.
- Leave Athens runtime visibility, catalog, route templates, Pulse,
  Blitz, and source descriptors **unchanged**.

After v0.2, the first runtime PR remains the strategy doc's
`feat(city-pack): add Athens pilot catalog v1`.

---

## Sources cited in this pack (deduplicated)

Operator / official:

- theacropolismuseum.gr
- benaki.org
- klimataria.gr
- tavernaoikonomou.gr
- athens-technopolis.gr
- pireos84.bios.gr / bios.romantso.gr (Bios + Romantso common operator)
- aefestival.gr (Athens Epidaurus Festival)
- xo.gr (business registry)

Municipal / destination authority:

- thisisathens.org (Official Athens Guide)
- cultureisathens.gr
- news.gtp.gr

Press / cultural press:

- greekcitytimes.com (Odeon closure; Oikonomou Nov 2024 profile)
- airmail.news ("Arts Intel Report")
- atlasobscura.com
- discovergreece.com
- eatingeurope.com
- untoldathens.com
- insightsgreece.com
- introducingathens.com
- e-restaurants.gr / e-table.gr (reservation registries)

Community / aggregator (verification-supporting, not quality proof):

- ra.co (Resident Advisor — Six d.o.g.s, Bios programming)
- songkick.com (venue programming)
- Wikipedia (Strefi Hill, post-2024 status)
- anarchistfederation.net (Strefi context)
- myguideathens.com / athens24.com / greeka.com / tripadvisor.com
  (corroborating only)
