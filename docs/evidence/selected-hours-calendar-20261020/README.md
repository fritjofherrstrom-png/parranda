# Selected-place opening hours: bounded calendar completion

Owner: Codex. Target: `codex/selected-hours-calendar-completion-20261020`.
Base: `b602a7f98b83e9cc88df94bd85535549364729be`.
Preserved checkpoint: `4eeaa628e6beeaad1b43416b7308c174946da787`, tree `aacaae1c413c7279b30e1af975e99e4ec6ca7741`.
The PR records the final exact head and CI run; no merge/deployment is authorized.

## Behavior

Already selected identities can contribute source-owned ordinary weeks, annual/absolute validity and explicit dated exceptions. One calendar fact is cached by exact identity/contract; its original observation is not renewed when asking another date. Selection and public facts use the same trusted local-date projection. A closed date is never written as permanent business closure. The existing frozen-supply replay, source transport and four-identity/two-concurrent/six-second/512-KiB/one-content-hop limits remain.

Supported visible contact schedules can provide ordinary hours without hiding unresolved holiday conditions. The app says “Regular hours … · Holiday hours unconfirmed” (or selected-day uncertainty), preserves that fact through reload, and keeps actual availability unknown. Unknown remains route-allowed. Generic SEO descriptions and historical news do not become visitor schedules; conflicting marked visitor schedules reject the fact.

The reader is deliberately bounded, not a general natural-language schedule interpreter. Unsupported date labels, inline-year ambiguity, other services, negation, hidden text, conflicting exceptions and missing timezone/identity remain unknown. No holiday API, new place sources, inference of opening now, arrival-time scheduling or trust upgrade is added.

## Reproducible checks

```sh
node --require ./tests/helpers/no-live-network.js --test tests/opening-hours-calendar.test.js tests/selected-place-hours-calendar-reader.test.js tests/selected-place-contact-hours.test.js tests/selected-hours-calendar-integration.test.js tests/selected-visit-hours-cache.test.js tests/selected-visit-hours-http.test.js
node --test frontend/tests/planner-selected-hours-http-browser.test.mjs
npm run check:frontend
npm test -- --test-reporter=tap
npm run build:frontend
node scripts/check-frontend-dist-drift.js
```

Browser test boundary: built app → real local HTTP handlers/middleware → existing composer/enricher/publisher. Source identities/admission scaffold, external HTML transport, weather/resolver and clocks are controlled. Product API responses are never replaced. It covers unknown/failure, source-known closure, winter/summer/date isolation, explicit date override, temporal closure, conditional café hours and ordinary reload. This is not live-provider or public-runtime acceptance.

The sanitized Gustavianum and Centralkonditoriet fixtures and source provenance are in `tests/fixtures/selected-place-visit-hours/`. One bounded café owner fetch succeeded; its raw SHA256 is `fc59015c3b4a7a599d7b08bec6983683cb03299b6e666d8c3abf7ff9d1ddbcc9`. The same response contains historical news and a conflicting SEO description, intentionally retained to discriminate the reader. Fixture replay never proves future actual opening.

Local runtime: Node 24.15.0, macOS arm64. GitHub CI uses Node 22, Linux; neither establishes Node22/arm64 Pi acceptance. No new Pi image, public cache change or deployment was performed.

## Review and remaining boundary

See `REVIEW.md` for concrete reproduced review findings and their regressions. Earlier checkpoint evidence (4,780 PASS, 3 skips) applies only to that checkpoint and is not relabelled as final-head evidence. Final counts and CI links belong to the PR.

No general holiday-date classifier is present: ambiguous red-day/special-hours conditions stay unknown even if ordinary hours are displayed. Unsupported site structures and nonempty but uninterpretable legacy hours are outside this bounded acquisition extension. A source-owned schedule never proves a future visit can actually occur.
