# Local discovery beside regional event calendars

Owner: Codex. Prepared from main `c6d85fcd9318c12169f53344312244c4780acd26`.
This is a source-discovery fix, separate from the offline model pilot and any
deployment. No model activation, new provider or named-place exception.

## Reproduced failure and change

The saved public Borrby response selected the two reviewed regional calendars,
a country holiday layer and Ticketmaster, with no request-time discovery.
`localSourceMixNeedsDiscovery` counted two publishers and two families without
checking their coverage footprints. The normal source cap then preferred the
existing three local rows to a newly discovered row with priority 184–192.
The observed coordinate-only resolver also lacked exact settlement boundaries.

The deterministic integration goes through `executeLiveEventQuery`, the real
request-time scout, catalogue demand normalization, actual reviewed calendar
adapters, programme adapter, collection, venue resolution and event gates.
Only transport and geocoder answers are controlled. The initial test failed
with **0 searches instead of 1**. After opening discovery, the coordinate-only
case failed because the found programme was still absent from the capped
collection. It now surfaces two factual local programme rows as low-trust,
Pulse-only evidence, retaining the calendars and the failed global source.
This proves the mechanism, not real search ranking or real venue resolution.

- Only source bboxes contained in the trusted discovery area count toward the
  two-publisher/two-family stopping heuristic. Broader calendars remain useful
  supply; neither their presence nor their failure means complete local coverage.
- A trusted coordinate/locality context without boundaries gets a bounded
  three-km anchor aperture for **discovery only**. It does not establish a town
  boundary or widen accepted event geometry. Catalogue normalization and the
  existing stable target/backoff still apply.
- At most one eligible newly discovered independent publisher replaces the
  last ordinary local selection, within the same four-total/three-local caps
  and reserved global slot. In the observed full plan this replaces the
  country calendar-reference layer; the two existing calendars remain selected.
  With other inventories the last selected source may be displaced; no claim
  is made that every provider fits simultaneously inside the same cap.
- Custom local caps are applied before reservation/truncation, including zero.
  Disabled, expired and outside sources cannot be made eligible by an ID.
- Discovery-required cache pools include the attested discovery context; a
  prior coordinate-only calendar warm-up cannot suppress local research.
  Namespace v20 leaves v19 files intact but does not reuse their regional-only
  answer as evidence that this path ran.

The ordinary access checks, source health, six-lookup request-discovery venue
budget, expiry, probation and date/geography gates remain authoritative. The
source plan does not grant source ownership, an open licence, coordinates or
route eligibility. A source found in this request is still a single observation.

## Verification and limits

Independent review identified four P2 findings: custom-cap truncation,
context-free warm-cache suppression, evaluator envelope mismatch and a stale
cache namespace assertion. All accepted findings have focused regressions and
were fixed. The evaluator now rejects an entire response over the current
reader's 24-event limit. Current focused run: **186 PASS / 0 FAIL**, plus the
affected generic-provider owned-cache test separately PASS. `git diff --check`
passes. The pilot baseline is recorded independently in
[`LOCAL_RESEARCH_MODEL_PILOT.md`](LOCAL_RESEARCH_MODEL_PILOT.md).

An initial complete local `npm test` finished with 5,379 PASS / 92 FAIL / 3 SKIP.
Five affected failures were stale namespace assertions or the now-normalized
scout-demand shape; their corresponding checks were rerun successfully.
The other 87 failures belong to existing published-day storage/publication and
mounted sharing tests on macOS. The unchanged store pins directory handles
through Linux `/proc/self/fd`; the observed macOS probe has no such path and
returns `storage_unavailable`. This local whole-suite run is **not a green
suite**. Linux CI on the published candidate remains the whole-suite gate.
The complete log and RED/GREEN logs are retained in the local evidence folder.

The reviewer declined to certify live search, real geocoder success, deployed
behavior, model quality, actual provider spend and unrelated UI. Those limits
are accepted: this delivery prepares a reviewable PR, not runtime acceptance.
Existing discovery-health `pending` presentation beside approved calendars was
not changed; the separately reported original calendar failures are retained.

During preparation main advanced to `df7d82a85917dff534dec71c610a461e72fa5eba`
(#659). Public health still reported `c6d85fcd` at the read-only check; those
versions must not be conflated. The parent chat owns its separate UI work and
any later deployment coordination. No merge or deployment is performed here.

Landing condition: independent findings addressed, exact-head Linux CI green,
current main/head reviewed and no unrelated UI included in these commits.
Next runtime action, only after coordination: freeze the selected SHA/image,
exercise real Borrby Live search and venue outcomes, and keep discovery,
acquisition, accepted facts and visible UI as distinct observations.
