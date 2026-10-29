# Local source coverage and offline model pilot

Owner: Codex. Branch: `codex/local-source-coverage-20261027`, from GitHub main
`c6d85fcd9318c12169f53344312244c4780acd26`. The user has requested autonomous
implementation, independent review and a main-targeted PR; no new deployment
or paid model/runtime activation is authorized.

## Design and scope

Reproduce the observed Borrby acquisition decision through the real supply,
scout and collector with deterministic source transport. A publisher/family
count over broad regional bounding boxes cannot close local discovery. Count
only sources whose coverage fits inside resolver-attested discovery bounds;
keep broader sources as useful acquisition, with their original health.
This is a conservative stopping heuristic, not a claim of complete coverage.
Unknown source geometry does not establish local coverage. When a trusted
resolver supplies coordinates/locality without boundaries, use a three-km
anchor aperture for discovery only. No named-place rule.

Keep the four-source/three-local caps and reserved global slot. When bounded
discovery finds an eligible independent publisher, reserve at most one local
slot for that complementary source, replacing the last ordinary selection
(a country calendar fact in the observed case). Source enablement, expiry,
robots, rights, probation and event/venue geography remain authoritative.

Alternatives considered: increasing fanout would spend more and alter request
budgets; globally preferring probation over approved sources would affect
ordinary collection. A server-only complementary ID seam limits the selection
change to actual discovery. Manual seeds/place exceptions cannot fix discovery.

The separate offline pilot compares stored model responses with deterministic
readers, reports evidence and human usefulness separately, retains immutable
document hashes and exact quotes, and provides reusable regression inputs.
No provider is chosen and no API is called. Prices require dated official
sources; proposed sample size/budget is not authorization.

## Execution

- [x] Task 1: reproduce broad regional source mix through real collector;
  test discovery demand, warm reuse and retained source health (RED).
- [x] Task 2: restrict the discovery stopping heuristic to attested local
  coverage; reserve one complementary eligible source within existing caps;
  test expired/disabled/duplicate publishers and unresolved/outside venues;
  rerun affected acquisition/discovery/programme tests (GREEN).
- [x] Task 3: preserve a runnable small offline corpus/evaluation with costs,
  reuse and reviewed learning loop; verify official pricing; no paid calls.
- [ ] Task 4: independent review, fix material findings, relevant checks,
  commit separate fix/pilot changes and publish one main-targeted PR.

## Evidence and landing

Baseline focused suite: 23 PASS, 0 FAIL (request-time discovery + programme
Live). Source fixtures are transport-controlled; this cannot prove public
search ranking, real resolver success or deployed UI acceptance. Existing
runtime evidence belongs to PR #658, not this candidate. Next runtime QA owner:
Codex after deployment coordination against fresh main/head/CI/public health.
Independent audit confirmed discovered priority 184–192 loses to the existing
three local slots; audit/pilot subagents then hit an account usage limit.
Work continued here after the user's explicit “fortsätt”; a fresh independent
review completed later. Its four P2 findings (custom caps, context-free warm
cache, evaluator 24-event limit and stale cache-version tests) were accepted
and repaired with focused regressions. The existing worker discovery-health
`pending` behavior was explicitly noted as predating this fix; calendars'
own failure status remains preserved. No live search/resolver/model acceptance
is inferred from controlled transport.
