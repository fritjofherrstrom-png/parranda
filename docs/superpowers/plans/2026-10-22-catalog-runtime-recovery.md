# Catalogue runtime recovery

> Execute inline using superpowers:executing-plans. Codex owns this branch and release; no parallel product edits.

**Goal:** Restore actual public day delivery for dense catalogue windows and prevent a transient source failure discarding a still-usable identity-bound snapshot. Base:e504b6b26e742a6932a589886b00b69a8a32f285. Branch:codex/catalog-runtime-recovery-20261022.

**Architecture:**512KiB HTTP pieces, short-gap coalescing inside the unchanged aggregate32MiB allocation, four transfer workers, prompt sibling abort. Strong source identity and all fact/query/admission gates stay. Actual complete London acquisition took55.473s on Node22/arm64; therefore the native acquisition bound deliberately changes45→75s and the same owned server/client job60→90s/30polls. Per-operation10s, heap64MiB, DuckDB128MB, total scratch64MiB stay. Eight workers were tested and rejected, not shipped.

**Approved policy:** User explicitly authorized at most seven days since verifiedAt fallback on source failure, with discreet existing source-detail copy. No expiry/receipt renewal, false freshness, hours inference, changed-date or different-window inheritance. Stale paths and fresh collection remain separate evidence.

- [x] Preserve actual public failure/anchors, retained cache identity and cleanup evidence. No shared cache mutation.
- [x] RED: real dense footer oversized body/fragmentation, metadata cancellation, source fallback/abort,55.5s watchdog and client/server continuation beyond60s.
- [x] GREEN: native SQL/provenance and bounds, receipt/age/abort contract, real HTTP+built UI controlled-source integration. Fresh reviewers inspect final combined delta.
- [ ] Freeze source/dist, run exact-head CI/full suite, build immutable exact Node22/arm64 image and verify runtime files.
- [ ] Normal ancestry-preserving merge with green main CI and unchanged deployment coupling; guarded web/worker deploy, rollback ready, protected config/volumes intact.
- [ ] Actual public ParisTomorrow, LondonToday and Berlin days/reload, plus health/SHA/image. Record fresh versus fallback and any remaining constraints. Health or Stockholm alone is insufficient.

Evidence and rejected experiments:docs/evidence/catalog-runtime-recovery-20261022/README.md. No provider retry-to-green loops or arbitrary deadline tuning. No city rules, new sources or new product features.
