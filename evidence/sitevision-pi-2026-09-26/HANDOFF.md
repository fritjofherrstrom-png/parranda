# Sitevision Pi evidence handoff (2026-09-26)

Branch purpose: **read-only evidence**, not a PR, merge target or product-code change.

The two official calendar listing pages and eight linked detail pages per city were fetched on the Pi at 13:19 CEST. `capture.json` records URL, response metadata and original SHA-256 for each fetched page. `fixtures/` contains **derived minimal HTML**, not the full pages: factual headings, dates, venues, addresses, map anchors and Sitevision app-state binding atoms needed by the adapter. Editorial paragraphs, images, embeds, unrelated scripts and styling were excluded. `fixture-manifest.json` maps original-response hashes to derived fixture hashes. Please review licensing and content before copying fixtures into #521.

Exact code refs at capture/replay: `main` `ceee59e7b4dac36b7c8832a2dee0146179d02932`; #518 `2ea85b8ab72dc3289c1d0ca525aabd4c6970926e`; #521 `4d69254aece23279829bb795978a4f6a4bcef45e`. With identical captured pages, provider `limit=8`, `detailLimit=8`, date 2026-09-26, direct detail pins and provider rows/pins were:

| Source | main | #518 | #521 |
|---|---|---|---|
| Simrishamn | 5 pins / 8 rows | 0 / 8 | 5 / 8 |
| Malmö | 0 / 8 | 5 / 8 | 5 / 8 |

`comparison.json` is the Pi's per-post replay output; `replay.cjs` lets you repeat it against a checkout of **one** code ref at a time. The minimal fixtures reproduced the complete Pi `comparison.json` (all per-post fields and provider results) exactly, not only the count table.

**Evidence boundary:** A provider row/pin is not an accepted Live event or route stop. Later Simrishamn listing labels can have a historical `starts_on` because recurrence dates require downstream interpretation. Resolver outcomes, selected-day/coming-week Live acceptance and real route stops were **not observed** in this probe. The real source may have changed since capture. #518/#521 remain draft; #518 must not be merged alone on these results.

The Malmö listing's last three selected detail links point to third-party public event pages. Their derived minimal fixtures do not imply reviewed Sitevision provenance for those pages. Recheck event URLs, licence/robots and scope before committing anything to the application branch.
