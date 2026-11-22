# Destination search implementation plan

> Execution: superpowers:executing-plans, inline. User asked to continue the obvious next step; scope is the reproduced destination-search bug.

**Goal:** Keep correct source-backed cities visible for English queries while retaining native names and safe explicit selection.
**Architecture:** Keep Photon default-name response as canonical. When a Latin query has a nonmatching major place in that page, read at most one English-name page in the same serial provider slot/deadline. Join alternate names by exact OSM identity, compatible class/kind and nearby point; use those source names only for matching. Preserve default title, candidate and receipt. No city list, provider switch or paid service.

Evidence: ../parranda-audit-20261101/search/provider (outside repo). In all four failing queries the correct city is already in the default page; `lang=en` supplies the exact English name for the same identity. Always forcing language reproduces the Göteborg regression. Promoting all fuzzy cities would break York; a source-owned alias join avoids it.

Limits: This fixes ranking of cities present in the default page; no claim of exhaustive global recall or support for every exonym language. Existing 20-row page, 5 visible choices, 750ms upstream start spacing, serial native transport ownership, 5s total budget, cancellation, max4 pending, 256-entry/1h memory cache stay bounded. Supplement failure uses canonical rows without caching that degraded result; cancellation/deadline retain existing unavailable behavior.

- [ ] Add failing recorded-boundary tests for Kyoto/Athens/Copenhagen/Munich, native-name preservation, false aliases/identity mismatches, receipt integrity, supplementary failure and serial/cancellation behavior.
- [ ] Implement generic conditional alternate-name matching in server/place-candidates/place-suggestions.js; run provider/API/selection lifecycle regressions.
- [ ] Add failing frontend and endpoint tests for two-character Han/Hiragana/Katakana/Hangul queries, noisy short Latin and IME. Implement one shared query guard in shared/place-search-query.mjs (+ declarations), consume in frontend field, HTTP endpoint and provider.
- [ ] Run focused suites, frontend check/build/dist; whole CI on frozen candidate. Review delta, open main-targeted PR with exact evidence and remaining runtime-QA condition. Preserve V5 release and #674.

Owner: Codex. Branch: codex/destination-search-20261101. Base: a572398db50cc4b0485b058ec9162f2bac306027. Landing condition: focused regressions + green frozen-head CI + actual endpoint/browser QA before activation.
