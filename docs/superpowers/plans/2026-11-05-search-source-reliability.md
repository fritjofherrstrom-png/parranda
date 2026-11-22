# Search and source reliability implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one independent whole-branch review. A read-only diagnostic agent may prepare isolated repro tests; root implements product changes.

**Goal:** Preserve usable completed acquisition through optional enrichment failures, without concealing incomplete coverage.
**Architecture:** A job-owned canonical fallback survives only the internal autocomplete deadline; separate consumer cancellation remains authoritative. Wider-source failure metadata survives independent selection of the narrower records.
**Tech Stack:** Existing CommonJS modules, Node test runner, recorded Photon fixtures and injected provider responses.
**Spec:** docs/superpowers/specs/2026-11-05-search-source-reliability-design.md

## Global constraints

- Five-second maximum autocomplete budget, serial transport ownership, existing retry count and source trust remain unchanged.
- No new provider/dependency/config/telemetry/layout changes or public deployment.
- Unknown historical failure causes remain unknown; no city-specific logic.

## Review focus

- Deadline before any canonical result remains unavailable.
- Consumer cancellation cannot publish its abandoned result, including shared owners.
- Optional enrichment stuck at fetch or JSON-body stage keeps canonical choices but does not cache degraded ranking.
- A transport ignoring abort cannot open another native serial slot.
- Failed wider acquisition preserves selected base rows/radius/status while marking incomplete evidence; healthy empty acquisition has no error.

### Task 1: Preserve canonical suggestions at the enrichment deadline

**Files:** server/place-candidates/place-suggestions.js; tests/place-suggestions-exonyms.test.js and existing lifecycle controls.
**Interfaces:** createPlaceSuggestions signature and public result contract stay unchanged; internal job owns the validated fallback and an explicit deadline abort reason.

- [x] Add fetch/body deadline regressions using recorded canonical facts and virtual timers; run against unchanged product, expect ready-versus-unavailable failures. Add shared-owner cancellation/remaining-owner deadline control and no-canonical timeout control.
- [x] Distinguish internal deadline from owner cancellation; retain only the validated canonical fallback, mark it noncacheable, and preserve serial transport settlement.
- [x] Run all place-suggestions tests under the network guard; expect PASS. Commit the bounded fix and tests.

### Task 2: Preserve the failed wider pass's error

**Files:** server/place-candidates/open-data-loader.js; tests/open-data-loader-expansion-failure.test.js; existing open-data-loader tests.
**Interfaces:** loader records/status/metadata contract stays unchanged. Preserve a sanitized loader_error from the already-computed merged result when keeping the first pass.

- [x] Run thin-first/empty-first wider-failure regressions on unchanged loader; expect missing-error failures. Healthy non-richer control stays green.
- [x] Preserve the existing selected base result and acquisition error; never add provider calls or widen selection merely to retain metadata.
- [x] Run expansion regressions and affected loader/composition controls under the network guard; expect PASS. Commit the bounded fix and tests.

## Delivery

Record RED/GREEN and affected test output; independent whole-branch review. Resolve Important/Critical findings with regression coverage. Publish a main-targeted PR, obtain exact-head CI, keep source merge/runtime activation separate. No new merge/deploy is inferred from this continuation.

## Verification record

Unchanged base: 97 affected checks passed. Five new regressions failed for the intended ready-versus-unavailable and missing-error assertions, with two negative controls already passing. After the fixes, 118 adapter/API/loader checks passed under the network guard, including serial transport ownership, shared cancellation, incomplete-result recovery, and real empty acquisition. No frontend source or dist changed. Exact-head Linux CI and independent review remain delivery gates. A bounded runtime diagnostic did not reach the host (SSH exit255); no historical provider cause is established.
