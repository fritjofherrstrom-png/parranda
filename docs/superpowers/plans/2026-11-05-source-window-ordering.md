# Source-window ordering implementation plan

**Goal:** Improve the practical sequence of an automatic day using the opening windows already known for the selected date. Public Linje is unchanged.

**Owner / branch / base:** Codex / codex/day-quality-20261105 / main6a55514c031e60e518d3a699f2da62d32be244be. PR677's visual direction is rejected and closed; it supplies no ancestry or UI changes here.

**User mandate:** Continue toward a smarter, more useful any-place product and launch; take implementation detail decisions without further design questions. No paid services, provider/config activation or deployment is added.

## Bounded design

The real composer currently permits a dinner-only18–23 stop before lunch-only11–15 when Food is unranked or on a future day. The separate current-meal urgency policy remains unchanged. A small order-only policy derives A-before-B preferences when all known same-day source windows for A finish before all of B's windows start. It applies to already admitted places, including non-food visits. Unknown, all-day, conditional, malformed/truncated, overlapping or interleaved windows supply no such ordering edge.

Use existing enumeration of at most6stops and its existing chain/geometry tolerances1.08 or +0.25km. Minimize known temporal inversions before existing meal-spacing/proximity scores. Strict retained manual order and replacement slots take precedence. Do not change set selection, preference weights, admission, trust, closure, walking checks, future-clock isolation or source facts. No arrival/dwell/open-now/full temporal-feasibility claim is introduced.

The alternative of extending current lunch urgency to all priorities/future days was rejected: it would borrow today's clock and change content selection. A full temporal scheduler is a separate capability, not this fix.

## Tasks

- [x] Reproduce through real composer with existing trusted fixtures; RED for unranked today and Food-first future plus a single-interest non-food order; negative controls remain green.
- [x] Add source-window-ordering.js, consuming normalized selected-day source hours and declining incomplete/unordered evidence.
- [x] Wire order-only score into orderBalancedDay, preserving strict edits, bounds and geometry vetoes.
- [x] Verify temporal controls: future across clocks, unknown/overlap/split/cross-midnight/malformed hours, retained reverse order, geometric veto, >6bound, source objects unchanged.
- [ ] Run affected composer/rhythm/meal/priority/edit/closure contracts, then fresh independent review and exact-head CI.

**Review focus:** Complete window evidence; conditional exceptions; one-interest and all-food routes; manual retained order; no new timestamps or trust; no set or API/UI changes; same walking envelope.

**Landing:** Reviewable main-targeted PR, green exact-head CI and separate release decision. Public runtime remains6a55514; no new QA environment/provider round is required for deterministic ordering proof.

## Execution and review record

Three expected original RED cases: neutral today, future Food-first and disjoint museum windows. Initial28scoped checks passed. Fresh independent review found one Important upstream-cap issue: normalization can already have omitted a fifth window. Both a direct normalized-fact test and real-composer test reproduced RED. Policy now abstains on four-or-more windows, retaining the shared API/normalizer; two-sided uncertainty controls cover both orientations. This conservatively declines even complete exact-four cases.

Ordering work is declined before inspecting source hours when stopcount exceeds6. A getter-based bound regression reproduced RED before moving that guard. No source facts or selected set are changed.

Final affected batch139PASS/0FAIL/0SKIP (composer, priorities, rhythm, edits, closure, retained admission and walking fit). Initial non-escalated attempt115PASS/22loopback-EPERM setup errors was corrected by allowing local fixture listeners; those setup errors are not reported as product failures. A separate existing real-HTTP trusted-context/forged-context contract also passes. Root/Linux whole-suite verification belongs to exact-head CI, not this targeted total.

Public Linje/compiledfrontend remain byte-identical to main6a55514. PR677 is closed unmerged and excluded from this branch. Public runtime/config unchanged.
